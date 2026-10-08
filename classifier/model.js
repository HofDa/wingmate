// Training mode: fit every component once on the labelled references,
// evaluate with stratified grouped k-fold cross-validation, apply the fixed
// default-method policy, and freeze a versioned, serialisable model.
//
// A frozen model does not change when references are added; retrain to
// include them. Queries are aligned to the model's stored landmark mean
// shape (ordinary Procrustes) instead of re-running GPA.
import { commonBlocks, fitStandardizer, standardizerFromParams, makeEmbedder, mulberry32, RESERVOIR_DEFAULTS } from "./embedding.js";
import {
  similarityContext,
  querySimilarities,
  rwrScores,
  knnScores,
  distanceScores,
  argmax,
  splitCalibrate,
  conformalPredict,

  summarizeAnimals,
  CLASSIFIER_DEFAULTS,
} from "./classify.js";
import { gpa, alignToMean, fitCalibratedShapeLDA, fitShapeLDA, shapeLDAFromParams } from "./morphometrics.js";

export const MODEL_VERSION = "wingmate-model-3";
export const READY_SPECIMENS = 10; // dataset-size heuristic; not a calibration guarantee
import { animalReferences, distinctViews, ANIMAL_POLICY, viewKey } from "./specimens.js";

const METHODS = {
  distance: "Distanz-kNN (standardisierte Merkmale, unabhängige Tiere)",
  lda: "Procrustes + PCA + LDA (Landmarken)",
  rwr: "Random Walk (kNN-Graph)",
  knn: "kNN-Abstimmung",
};

// Folds by specimen (all wings of one animal together), stratified by taxon:
// each taxon's specimens are shuffled (seeded) and dealt round-robin.
export function stratifiedGroupFolds(labels, groups, k = 5, seed = 1) {
  const taxonOf = new Map();
  groups.forEach((g, i) => {
    if (taxonOf.has(g) && taxonOf.get(g) !== labels[i])
      throw Error(`Exemplar ${g} hat mehrere Taxa (${taxonOf.get(g)}, ${labels[i]})`);
    taxonOf.set(g, labels[i]);
  });
  const rnd = mulberry32(seed),
    foldOf = new Map(),
    byTaxon = {};
  for (const [g, t] of taxonOf) (byTaxon[t] ??= []).push(g);
  let offset = 0;
  for (const t of Object.keys(byTaxon).sort()) {
    const list = byTaxon[t].sort();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    // Rotate the starting fold per taxon so small taxa do not all land in fold 0.
    list.forEach((g, i) => foldOf.set(g, (i + offset) % k));
    offset += list.length;
  }
  return Int32Array.from(groups, (g) => foldOf.get(g));
}

// Order-independent fingerprint of reference identities, features and provenance.
export function referenceFingerprint(ids) {
  let h = 2166136261 >>> 0;
  const entries = ids.map((r) => typeof r === "string" ? r : JSON.stringify({ id: r.id, species: r.species, group: r.group, sex: r.sex, series: r.series, features: r.features, sourceHashes: r.sourceHashes })).sort();
  for (const id of entries) for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return `${ids.length}:${h.toString(16)}`;
}

// Per taxon: specimens, wings, landmark coverage, sexes and series. Cross-
// validation only predicts field performance if the references cover the
// variation seen later. On the Bombus landmark data (lucorum vs terrestris):
// references from one collection gave 100 % in CV but 70 % on the other
// collections; females only cost about 6 points on males (92 % vs 86 %).
export function readiness(refs) {
  const taxa = {};
  for (const r of refs) {
    const t = (taxa[r.species] ??= { specimens: new Set(), wings: 0, withLandmarks: 0, sexes: {}, series: new Set(), sexKnown: 0 });
    t.specimens.add(r.group);
    t.wings++;
    if (r.features.blocks.landmarks) t.withLandmarks++;
    if (r.sex === "F" || r.sex === "M") {
      t.sexes[r.sex] = (t.sexes[r.sex] || 0) + 1;
      t.sexKnown++;
    }
    if (r.series) t.series.add(r.series);
  }
  return Object.fromEntries(
    Object.entries(taxa)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, v]) => {
        const n = v.specimens.size,
          warnings = [];
        if (v.sexKnown && Object.keys(v.sexes).length === 1)
          warnings.push(`nur ${Object.keys(v.sexes)[0] === "F" ? "♀" : "♂"} – das andere Geschlecht wird unzuverlässig erkannt`);
        if (v.sexKnown < v.wings) warnings.push(`${v.wings - v.sexKnown} Flügel ohne Geschlecht`);
        if (v.series.size === 1) warnings.push("nur eine Serie/Fundort");
        return [
          t,
          {
            specimens: n,
            wings: v.wings,
            withLandmarks: v.withLandmarks,
            sexes: v.sexes,
            series: v.series.size,
            warnings,
            status: n >= READY_SPECIMENS ? "ready" : n >= 5 ? "weak" : "insufficient",
          },
        ];
      }),
  );
}

const configOf = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};
const flatOf = (config) => config.flat();

// A model's input contract is explicit. Partial diagnostic modalities require
// a selected mode rather than silently discarding them for every reference.
export function resolveBlocks(features, selected = null) {
  const blocks = selected ?? commonBlocks(features);
  if (!selected) {
    const partial = ["venation", "wip", "landmarks"].filter((b) =>
      features.some((f) => f.blocks?.[b]) && !blocks.includes(b));
    if (partial.length) throw Error(`Unvollständige Merkmale (${partial.join(", ")}). Eingabemodus wählen oder fehlende Aufnahmen ergänzen.`);
  }
  if (!blocks.length) throw Error("Keine gemeinsamen Merkmalsblöcke.");
  for (const f of features) {
    for (const b of blocks) {
      const v = f.blocks?.[b];
      if (!Array.isArray(v) || !v.length || v.length !== features[0].blocks?.[b]?.length || !v.every(Number.isFinite))
        throw Error(`Merkmalsblock ${b} fehlt, hat falsche Länge oder ungültige Werte.`);
    }
    if (f.version !== features[0].version) throw Error("Merkmalsversionen stimmen nicht überein.");
    if (blocks.includes("landmarks") && (f.landmarkScheme !== features[0].landmarkScheme || f.blocks.landmarks.length % 2))
      throw Error("Landmark-Schemata stimmen nicht überein.");
  }
  return [...blocks];
}

// All learned transforms belong exclusively to these training references.
export function fitReferenceSpace(refs, settings = {}) {
  const { mode = "none", params = {}, graph = null } = settings;
  const blocks = resolveBlocks(refs.map((r) => r.features), settings.blocks);
  const animals = animalReferences(refs, blocks), features = animals.map((r) => r.features);
  const configs = blocks.includes("landmarks") ? features.map((f) => configOf(f.blocks.landmarks)) : null;
  const alignment = configs ? gpa(configs) : null;
  const prepare = (f) => alignment
    ? { ...f, blocks: { ...f.blocks, landmarks: flatOf(alignToMean(configOf(f.blocks.landmarks), alignment.mean)) } }
    : f;
  const prepared = features.map(prepare), standardizer = fitStandardizer(prepared, blocks);
  const embed = makeEmbedder(mode, standardizer.dim, params, graph);
  if (![...standardizer.params.weight].some((w) => w > 0)) throw Error("Keine messbare Merkmalsvariation zwischen unabhängigen Exemplaren.");
  const vectors = prepared.map((f) => standardizer.transform(f)), embeddings = vectors.map(embed);
  return {
    blocks, configs, alignment, standardizer, vectors, embeddings, animals,
    X: alignment ? prepared.map((f) => f.blocks.landmarks) : null,
    toVector: (f) => { resolveBlocks([features[0], f], blocks); return standardizer.transform(prepare(f)); },
    toEmbedding: (f) => { resolveBlocks([features[0], f], blocks); return embed(standardizer.transform(prepare(f))); },
    landmarkVector: (f) => prepare(f).blocks.landmarks,
    ctx: similarityContext(embeddings), distanceCtx: similarityContext(vectors, "euclidean"),
    labels: animals.map((r) => r.species), groups: animals.map((r) => r.group),
  };
}

// Deterministic, taxon-stratified animal holdout; both wings stay together.
// Small taxa retain at least two training animals. Limited calibration is
// reported honestly instead of borrowing animals back into training.
export function calibrationSplit(refs, fraction = 0.2, seed = 17) {
  if (!(fraction > 0 && fraction < 1)) throw Error("Ungültiger Kalibrierungsanteil.");
  const byTaxon = {}, chosen = new Set(), rnd = mulberry32(seed);
  for (const r of refs) (byTaxon[r.species] ??= new Set()).add(r.group);
  for (const taxon of Object.keys(byTaxon).sort()) {
    const list = [...byTaxon[taxon]].sort();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    const n = Math.max(0, Math.min(list.length - 2, Math.max(1, Math.floor(list.length * fraction))));
    list.slice(0, n).forEach((g) => chosen.add(g));
  }
  return { training: refs.filter((r) => !chosen.has(r.group)), calibration: refs.filter((r) => chosen.has(r.group)) };
}
function fitPipeline(refs, settings) {
  const split = calibrationSplit(refs, settings.calibrationFraction ?? 0.2);
  const space = fitReferenceSpace(split.training, settings);
  const calibration = splitCalibrate(space.distanceCtx, space.labels, space.groups,
    split.calibration.map((r) => space.toVector(r.features)),
    split.calibration.map((r) => r.species), split.calibration.map((r) => r.group), settings.classifier);
  const lda = !space.X || settings.includeLDA === false ? null
    : settings.calibrateLDA === false ? fitShapeLDA(space.X, space.labels)
    : fitCalibratedShapeLDA(space.X, space.labels, space.groups, { landmarkConfigs: space.configs });
  return { ...space, training: space.animals, trainingViews: split.training, calibration, lda };
}
function predictPipeline(pipeline, features, classifier) {
  const qs = querySimilarities(pipeline.ctx, pipeline.toEmbedding(features));
  return {
    rwr: rwrScores(pipeline.ctx, pipeline.labels, qs, undefined, classifier),
    knn: knnScores(pipeline.ctx, pipeline.labels, qs, undefined, classifier),
    distance: distanceScores(pipeline.distanceCtx, pipeline.labels, querySimilarities(pipeline.distanceCtx, pipeline.toVector(features)), undefined, classifier),
    lda: pipeline.lda?.predictProba(pipeline.landmarkVector(features)) ?? null,
    conformal: conformalPredict(querySimilarities(pipeline.distanceCtx, pipeline.toVector(features)), pipeline.labels, pipeline.calibration, undefined, { ...classifier, referenceGroups: pipeline.groups }),
  };
}

export function evaluateReferences(refs, settings = {}, onProgress = () => {}) {
  if (refs.some((r) => r.group === null || r.group === undefined || r.group === "")) throw Error("Validierung braucht eine stabile Exemplar-ID für jede Referenz.");
  const blocks = resolveBlocks(refs.map((r) => r.features), settings.blocks);
  const sourceAnimals = new Map(), animalSeries = new Map();
  for (const r of refs) {
    if (!animalSeries.has(r.group)) animalSeries.set(r.group, new Set());
    animalSeries.get(r.group).add(r.series || null);
    for (const hash of r.sourceHashes ?? Object.values(r.preprocessing?.images ?? {}).map((i) => i.sourceSha256).filter(Boolean)) {
      if (sourceAnimals.has(hash) && sourceAnimals.get(hash) !== r.group) throw Error("Dasselbe Quellbild wurde mehreren Exemplar-IDs zugeordnet.");
      sourceAnimals.set(hash, r.group);
    }
  }
  refs = distinctViews(refs, blocks);
  const labels = refs.map((r) => r.species), groups = refs.map((r) => r.group);
  const foldCount = Math.max(2, Math.min(settings.folds ?? 5, new Set(groups).size));
  const fold = stratifiedGroupFolds(labels, groups, foldCount);
  const predictions = { distance: Array(refs.length).fill(null), rwr: Array(refs.length).fill(null), knn: Array(refs.length).fill(null),
    ...(blocks.includes("landmarks") && settings.includeLDA !== false ? { lda: Array(refs.length).fill(null) } : {}) };
  const probabilities = Array(refs.length).fill(null), conformal = Array(refs.length).fill(null);
  const evaluateHoldout = (held, target, withCalibration = false) => {
    const heldGroups = new Set(refs.filter(held).map((r) => r.group));
    const train = refs.filter((r) => !heldGroups.has(r.group));
    if (new Set(train.map((r) => r.species)).size < 2) return;
    const pipeline = fitPipeline(train, { ...settings, blocks });
    refs.forEach((r, i) => {
      if (!heldGroups.has(r.group) || !pipeline.labels.includes(r.species)) return;
      const result = predictPipeline(pipeline, r.features, settings.classifier);
      for (const key of Object.keys(target)) target[key][i] = argmax(result[key]);
      if (withCalibration) { probabilities[i] = result.lda; conformal[i] = result.conformal; }
    });
  };
  for (let f = 0; f < foldCount; f++) {
    onProgress(0.05 + 0.75 * f / foldCount, `Kreuzvalidierung ${f + 1}/${foldCount}`);
    evaluateHoldout((_, i) => fold[i] === f, predictions, true);
  }
  const evaluation = {
    folds: foldCount, protocol: "nach Exemplar gruppiert; alle Anpassungen nur im Trainingsfold",
    selectionOnly: false, developmentOnly: true, unit: "animal",
    methods: Object.fromEntries(Object.entries(predictions).map(([k, p]) => [k, { name: METHODS[k], ...summarizeAnimals(labels, p, groups) }])),
  };
  if (predictions.lda && settings.calibrateLDA !== false) evaluation.ldaCalibration = calibrationStats(probabilities, labels, groups);
  evaluation.conformal = summarizeConformal(conformal, labels, groups, settings.classifier);
  const series = refs.map((r) => r.series || null);
  if (series.every(Boolean) && new Set(series).size >= 2 && [...animalSeries.values()].every((s) => s.size === 1)) {
    const transfer = Object.fromEntries(Object.keys(predictions).map((k) => [k, Array(refs.length).fill(null)]));
    for (const held of new Set(series)) evaluateHoldout((r) => r.series === held, transfer);
    evaluation.seriesTransfer = { series: new Set(series).size,
      methods: Object.fromEntries(Object.entries(transfer).map(([k, p]) => [k, { name: METHODS[k], ...summarizeAnimals(labels, p, groups) }])) };
  } else evaluation.seriesTransferUnavailable = "Serientransfer braucht mindestens zwei vollständige Serien und genau eine Serie pro Tier.";
  return evaluation;
}

export function trainModel(refs, settings = {}, onProgress = () => {}) {
  const { mode = "none", params = {}, name = "Modell" } = settings;
  if (mode === "graph") throw Error("Der FlyWire-Graphmodus ist explorativ und wird nicht eingefroren.");
  if (new Set(refs.map((r) => r.species)).size < 2) throw Error("Training braucht mindestens zwei Taxa.");
  if (refs.some((r) => r.group === null || r.group === undefined || r.group === "")) throw Error("Training braucht eine stabile Exemplar-ID für jede Referenz.");
  // Reject contradictory specimen labels before making any split.
  stratifiedGroupFolds(refs.map((r) => r.species), refs.map((r) => r.group));
  const blocks = resolveBlocks(refs.map((r) => r.features), settings.blocks);
  const classifier = { ...CLASSIFIER_DEFAULTS, ...settings.classifier };
  const resolved = { ...settings, mode, params: { ...RESERVOIR_DEFAULTS, ...params }, blocks, classifier };
  const evaluation = evaluateReferences(refs, resolved, onProgress);
  const primary = settings.primaryMethod ?? (evaluation.methods.lda ? "lda" : "distance");
  if (!evaluation.methods[primary] || evaluation.methods[primary].balancedAccuracy === null) throw Error("Keine auswertbaren Folds. Mehr unabhängige Exemplare pro Taxon ergänzen.");
  onProgress(0.9, "Endmodell und unabhängige Kalibrierung anpassen");
  const pipeline = fitPipeline(refs, resolved), dim = pipeline.standardizer.dim;
  const packed = new Float32Array(pipeline.training.length * dim);
  pipeline.vectors.forEach((v, i) => packed.set(v, i * dim));
  const model = {
    version: MODEL_VERSION, id: settings.id ?? (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
    name, createdAt: new Date().toISOString(), featureVersion: refs[0].features.version,
    preprocessingVersion: settings.preprocessingVersion ?? null, blocks,
    landmarkScheme: blocks.includes("landmarks") ? refs[0].features.landmarkScheme : null,
    reservoir: { mode, params: resolved.params }, classifier,
    animalPolicy: ANIMAL_POLICY, primaryPolicy: settings.primaryMethod ? "explicit-development-method" : "landmarks-first-distance-fallback",
    references: { count: refs.length, fingerprint: referenceFingerprint(refs), ids: refs.map((r) => r.id),
      trainingIds: pipeline.trainingViews.map((r) => r.id), calibrationGroups: pipeline.calibration.groups,
      trainingCount: pipeline.training.length, trainingViewCount: pipeline.trainingViews.length, calibrationSpecimens: pipeline.calibration.groups.length },
    provenance: refs.map((r) => ({ id: r.id, group: r.group, series: r.series ?? null, featureKey: viewKey(r, blocks),
      sourceHashes: r.sourceHashes ?? Object.values(r.preprocessing?.images ?? {}).map((i) => i.sourceSha256).filter(Boolean) })),
    taxa: readiness(refs), standardizer: pipeline.standardizer.params, vectors: packed,
    labels: pipeline.labels, groups: pipeline.groups, calibration: pipeline.calibration,
    landmarkMean: pipeline.alignment ? Float32Array.from(flatOf(pipeline.alignment.mean)) : null,
    lda: pipeline.lda?.params ?? null, evaluation, primary,
  };
  onProgress(1, "fertig");
  return model;
}

// Evaluate a whole animal using the intersection of its distinct-view sets.
// This matches maximum-view calibration; duplicates are removed before scoring.
function summarizeConformal(results, labels, groups, classifier = {}) {
  const animals = new Map();
  groups.forEach((g, i) => {
    if (!animals.has(g)) animals.set(g, { label: labels[i], results: [] });
    animals.get(g).results.push(results[i]);
  });
  const known = [...animals.values()].filter((a) => a.results.every(Boolean));
  const valid = known.filter((a) => a.results.every((r) => r.openSetValid));
  const sets = valid.map((a) => a.results[0].set.filter((t) => a.results.every((r) => r.set.includes(t))));
  return { protocol: "split-specimen-max", metric: "euclidean", unit: "animal",
    epsilon: classifier.epsilon ?? CLASSIFIER_DEFAULTS.epsilon,
    knownQueries: known.length, validQueries: valid.length,
    coverage: valid.length ? sets.filter((s, i) => s.includes(valid[i].label)).length / valid.length : null,
    falseUnknownRate: valid.length ? sets.filter((s) => !s.length).length / valid.length : null,
    meanSetSize: valid.length ? sets.reduce((n, s) => n + s.length, 0) / valid.length : null,
    novelTaxon: {} };
}

// Class-balanced diagnostics, averaging distinct wings equally within each animal.
function calibrationStats(probabilities, labels, groups) {
  const animals = {}, views = {};
  labels.forEach((l, i) => {
    if (!probabilities[i]) return;
    (animals[l] ??= new Set()).add(groups[i]);
    views[groups[i]] = (views[groups[i]] ?? 0) + 1;
  });
  let p = 0,
    hit = 0,
    brier = 0,
    n = 0;
  probabilities.forEach((prob, i) => {
    if (!prob) return;
    const w = 1 / (animals[labels[i]].size * views[groups[i]]),
      [top, pt] = Object.entries(prob).sort((a, b) => b[1] - a[1])[0];
    p += w * pt;
    hit += w * (top === labels[i]);
    brier += w * [...new Set([...Object.keys(prob), labels[i]])].reduce((s, t) => s + ((prob[t] ?? 0) - (t === labels[i])) ** 2, 0);
    n += w;
  });
  return n ? { meanTopProbability: p / n, balancedAccuracy: hit / n, brier: brier / n } : null;
}

// Rebuild a runtime classifier from a (deserialised) model.
export function loadModel(model) {
  if (model?.version !== MODEL_VERSION) throw Error("Modell-Version nicht unterstützt. Referenzen mit der aktuellen Version neu trainieren (" + MODEL_VERSION + ").");
  if (model.animalPolicy !== ANIMAL_POLICY || !Array.isArray(model.groups) || new Set(model.groups).size !== model.groups.length ||
      !["lda", "distance", "rwr", "knn"].includes(model.primary) || (model.primary === "lda" && !model.lda)) throw Error("Ungültiger Exemplar- oder Verfahrensvertrag im Modell.");
  const c = model.classifier, cal = model.calibration;
  if (!c || !(c.alpha >= 0 && c.alpha <= 1) || !(c.epsilon > 0 && c.epsilon < 1) ||
      !["k", "steps", "voteK", "conformalM"].every((k) => Number.isInteger(c[k]) && c[k] > 0) ||
      !(Number.isFinite(c.power) && c.power > 0) || typeof c.balanced !== "boolean") throw Error("Ungültige Klassifikator-Einstellungen im Modell.");
  if (!cal || cal.protocol !== "split-specimen-max" || cal.metric !== "euclidean" || !Array.isArray(cal.scores) ||
      cal.labels?.length !== cal.scores.length || cal.groups?.length !== cal.scores.length ||
      new Set(cal.groups).size !== cal.groups.length || cal.groups.some((g) => model.groups.includes(g)) ||
      !cal.scores.every(Number.isFinite) || !cal.labels.every((l) => model.labels.includes(l))) throw Error("Ungültige oder überlappende Kalibrierungsdaten im Modell.");
  const layout = model.standardizer?.layout, nRefs = model.labels?.length;
  if (!layout?.length || !nRefs || model.groups?.length !== nRefs) throw Error("Unvollständiges Modell.");
  const dimensions = layout.reduce((n, l) => n + l.dim, 0);
  if (!layout.every((l) => Number.isInteger(l.dim) && l.dim > 0) || model.vectors?.length !== nRefs * dimensions ||
      ![model.vectors, model.standardizer.mean, model.standardizer.sd, model.standardizer.weight].every((v) => v && [...v].every(Number.isFinite)) ||
      !["mean", "sd", "weight"].every((k) => model.standardizer[k].length === dimensions) ||
      JSON.stringify(model.blocks) !== JSON.stringify(layout.map((l) => l.block)) ||
      [...model.standardizer.sd].some((s, i) => s < 0 || (s === 0 && model.standardizer.weight[i] !== 0))) throw Error("Ungültige Merkmalswerte im Modell.");
  const params = model.reservoir?.params;
  if (!params || !["kenyonCells", "fanIn", "seed"].every((k) => Number.isInteger(params[k])) ||
      params.kenyonCells <= 0 || params.fanIn <= 0 || !(params.activeFraction > 0 && params.activeFraction <= 1)) throw Error("Ungültige Reservoir-Einstellungen im Modell.");
  if (model.blocks.includes("landmarks") && (!model.landmarkMean ||
      model.landmarkMean.length !== layout.find((l) => l.block === "landmarks").dim ||
      ![...model.landmarkMean].every(Number.isFinite))) throw Error("Ungültige Landmark-Mittelform im Modell.");
  const standardizer = standardizerFromParams(model.standardizer),
    dim = standardizer.dim,
    embed = makeEmbedder(model.reservoir.mode, dim, model.reservoir.params),
    n = model.labels.length,
    vectors = Array.from({ length: n }, (_, i) => model.vectors.subarray(i * dim, (i + 1) * dim)),
    ctx = similarityContext(vectors.map(embed)), distanceCtx = similarityContext(vectors, "euclidean"),
    calibration = model.calibration,
    mean = model.landmarkMean ? configOf(Array.from(model.landmarkMean)) : null,
    lda = model.lda ? shapeLDAFromParams(model.lda) : null;
  const alignedLandmarks = (features) => {
    const lm = features.blocks.landmarks;
    if (!lm || !mean || features.landmarkScheme !== model.landmarkScheme || lm.length !== mean.length * 2) return null;
    return flatOf(alignToMean(configOf(lm), mean));
  };
  return {
    model,
    ctx,
    labels: model.labels,
    groups: model.groups,
    missingBlocks: (features) => model.blocks.filter((b) => !Array.isArray(features.blocks[b]) || (b === "landmarks" && !alignedLandmarks(features))),
    classify(features, preprocessingVersion = model.preprocessingVersion) {
      if (features?.version !== model.featureVersion) throw Error("Merkmalsversion passt nicht zum Modell.");
      if (preprocessingVersion !== model.preprocessingVersion) throw Error("Vorverarbeitungsversion passt nicht zum Modell.");
      resolveBlocks([features], model.blocks);
      const missing = this.missingBlocks(features);
      if (missing.length) throw Error(`Das Modell braucht Merkmale, die dieser Aufnahme fehlen: ${missing.join(", ")}.`);
      const landmarks = alignedLandmarks(features),
        prepared = landmarks ? { ...features, blocks: { ...features.blocks, landmarks } } : features,
        vector = standardizer.transform(prepared), q = embed(vector),
        qs = querySimilarities(ctx, q), distances = querySimilarities(distanceCtx, vector);
      return {
        qs,
        embedding: q,
        scores: rwrScores(ctx, model.labels, qs, undefined, model.classifier),
        knn: knnScores(ctx, model.labels, qs, undefined, model.classifier),
        distance: distanceScores(distanceCtx, model.labels, distances, undefined, model.classifier),
        conformal: conformalPredict(distances, model.labels, calibration, undefined, { ...model.classifier, referenceGroups: model.groups }),
        lda: lda && landmarks ? { probabilities: lda.predictProba(landmarks), model: lda } : null,
        best: Math.max(...qs),
      };
    },
  };
}

// Evaluate an already frozen model without refitting, method selection or
// calibration. Unknown taxa remain outside the model's supported labels.
export function evaluateExternal(model, records) {
  if (!Array.isArray(records) || !records.length) throw Error("Externer Test braucht unabhängige Exemplare.");
  if (records.some((r) => typeof r.species !== "string" || !r.species.trim())) throw Error("Jedes Testexemplar braucht sein unabhängig bestimmtes Taxon.");
  const runtime = loadModel(model);
  resolveBlocks(records.map((r) => r.features), model.blocks);
  const refs = distinctViews(records, model.blocks);
  if (!model.provenance?.length) throw Error("Externer Test braucht Referenzherkunft im Modell.");
  const usedGroups = new Set(model.provenance.map((r) => r.group));
  const usedIds = new Set(model.provenance.map((r) => r.id).filter(Boolean));
  const usedFeatures = new Set(model.provenance.map((r) => r.featureKey));
  const usedHashes = new Set(model.provenance.flatMap((r) => r.sourceHashes ?? []));
  const testSourceAnimals = new Map();
  // Check every original's provenance before removing identical views.
  for (const r of records) {
    const hashes = r.sourceHashes ?? Object.values(r.preprocessing?.images ?? {}).map((i) => i.sourceSha256).filter(Boolean);
    if (usedGroups.has(r.group) || usedIds.has(r.id) || usedFeatures.has(viewKey(r, model.blocks)) || hashes.some((h) => usedHashes.has(h)))
      throw Error(`Testexemplar ${r.group} überschneidet sich mit Training/Kalibrierung (Identität, Bild oder identische Merkmale).`);
    for (const hash of hashes) {
      if (testSourceAnimals.has(hash) && testSourceAnimals.get(hash) !== r.group) throw Error("Dasselbe Test-Quellbild wurde mehreren Exemplar-IDs zugeordnet.");
      testSourceAnimals.set(hash, r.group);
    }
  }
  const results = refs.map((r) => runtime.classify(r.features, r.preprocessingVersion ?? null));
  const knownIndices = refs.map((r, i) => model.labels.includes(r.species) ? i : -1).filter((i) => i >= 0);
  const knownLabels = knownIndices.map((i) => refs[i].species), knownGroups = knownIndices.map((i) => refs[i].group);
  const primaryScores = (r) => model.primary === "lda" ? r.lda?.probabilities : model.primary === "distance" ? r.distance : model.primary === "knn" ? r.knn : r.scores;
  const methods = Object.fromEntries(["distance", "rwr", "knn", ...(model.lda ? ["lda"] : [])].map((key) => [key, {
    name: METHODS[key], ...summarizeAnimals(knownLabels, knownIndices.map((i) => argmax(key === "lda" ? results[i].lda?.probabilities ?? {} : key === "rwr" ? results[i].scores : results[i][key])), knownGroups),
  }]));
  const unknown = new Map();
  refs.forEach((r, i) => {
    if (model.labels.includes(r.species)) return;
    if (!unknown.has(r.group)) unknown.set(r.group, { taxon: r.species, results: [] });
    unknown.get(r.group).results.push(results[i].conformal);
  });
  const novelTaxon = {};
  for (const a of unknown.values()) {
    const t = (novelTaxon[a.taxon] ??= { animals: 0, validAnimals: 0, rejected: 0 });
    t.animals++;
    if (!a.results.every((r) => r.openSetValid)) continue;
    t.validAnimals++;
    if (!a.results[0].set.some((label) => a.results.every((r) => r.set.includes(label)))) t.rejected++;
  }
  for (const t of Object.values(novelTaxon)) t.detectionRate = t.validAnimals ? t.rejected / t.validAnimals : null;
  const knownConformal = summarizeConformal(knownIndices.map((i) => results[i].conformal), knownLabels, knownGroups, model.classifier);
  return { protocol: "frozen-external-test; no refitting or calibration", modelId: model.id, primary: model.primary,
    ...(model.attribution ? { dataAttribution: model.attribution } : {}),
    animalPolicy: model.animalPolicy, methods, knownConformal, novelTaxon,
    calibration: calibrationStats(knownIndices.map((i) => results[i].lda?.probabilities ?? null), knownLabels, knownGroups),
    reliability: reliabilityDiagnostics(knownIndices.map((i) => results[i].lda?.probabilities ?? null), knownLabels, knownGroups),
    acquisition: { testSeries: [...new Set(records.map((r) => r.series).filter(Boolean))],
      sharedSeries: [...new Set(records.map((r) => r.series).filter((s) => s && model.provenance.some((r) => r.series === s)))],
      note: "IDs and exact-source checks cannot prove that this dataset was untouched during development. Verify acquisition independence and seal the test set before model development." },
    predictions: refs.map((r, i) => ({ id: r.id, group: r.group, truth: r.species, candidate: argmax(primaryScores(results[i]) ?? {}),
      predictionSet: results[i].conformal.set, calibrated: results[i].conformal.openSetValid, unknown: results[i].conformal.unknown })) };
}

// Average view posteriors within an animal; bins use the external sample's
// observed prevalence. These differ from class-balanced loss diagnostics.
export function reliabilityDiagnostics(probabilities, labels, groups) {
  const animals = new Map();
  probabilities.forEach((p, i) => {
    if (!p) return;
    if (!animals.has(groups[i])) animals.set(groups[i], { truth: labels[i], sum: {}, n: 0 });
    const animal = animals.get(groups[i]);
    if (animal.truth !== labels[i]) throw Error("Exemplar hat mehrere Taxa");
    animal.n++;
    for (const [label, value] of Object.entries(p)) animal.sum[label] = (animal.sum[label] ?? 0) + value;
  });
  if (!animals.size) return null;
  const rows = [...animals.values()].map((a) => {
    const p = Object.fromEntries(Object.entries(a.sum).map(([label, v]) => [label, v / a.n]));
    const top = argmax(p), confidence = p[top];
    return { truth: a.truth, confidence, correct: Number(top === a.truth),
      brier: [...new Set([...Object.keys(p), a.truth])].reduce((s, t) => s + ((p[t] ?? 0) - Number(t === a.truth)) ** 2, 0) };
  });
  const bins = Array.from({ length: 10 }, (_, i) => {
    const bin = rows.filter((r) => Math.min(9, Math.floor(10 * r.confidence)) === i);
    return { lower: i / 10, upper: (i + 1) / 10, animals: bin.length,
      confidence: bin.length ? bin.reduce((s, r) => s + r.confidence, 0) / bin.length : null,
      accuracy: bin.length ? bin.reduce((s, r) => s + r.correct, 0) / bin.length : null };
  });
  const byTrueTaxon = Object.fromEntries([...new Set(labels)].map((t) => {
    const subset = rows.filter((r) => r.truth === t);
    return [t, { animals: subset.length, meanTopProbability: subset.reduce((s, r) => s + r.confidence, 0) / subset.length,
      accuracy: subset.reduce((s, r) => s + r.correct, 0) / subset.length }];
  }).filter(([, stats]) => stats.animals));
  return { unit: "animal", viewAggregation: "mean-view-posteriors", weighting: "observed-test-prevalence",
    animals: rows.length, bins, byTrueTaxon,
    brier: rows.reduce((s, r) => s + r.brier, 0) / rows.length,
    ece: bins.reduce((s, b) => s + b.animals / rows.length * Math.abs((b.confidence ?? 0) - (b.accuracy ?? 0)), 0) };
}
