// Training mode: fit every component once on the labelled references,
// evaluate with stratified grouped k-fold cross-validation, pick the best
// method, and freeze the result as a versioned, serialisable model.
//
// A frozen model does not change when references are added; retrain to
// include them. Queries are aligned to the model's stored landmark mean
// shape (ordinary Procrustes) instead of re-running GPA.
import { commonBlocks, fitStandardizer, standardizerFromParams, makeEmbedder, mulberry32 } from "./embedding.js";
import {
  similarityContext,
  querySimilarities,
  rwrScores,
  knnScores,
  argmax,
  calibrate,
  conformalPredict,
  conformalEvaluation,
  summarize,
  CLASSIFIER_DEFAULTS,
} from "./classify.js";
import { gpa, alignToMean, fitCalibratedShapeLDA, shapeLDAFromParams } from "./morphometrics.js";

export const MODEL_VERSION = "wingmate-model-1";
export const READY_SPECIMENS = 10; // per taxon; below ~9 the conformal set cannot reject (ε = 0.1)
const METHODS = {
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

// Order-independent fingerprint of a reference set (FNV-1a over sorted ids).
export function referenceFingerprint(ids) {
  let h = 2166136261 >>> 0;
  for (const id of [...ids].sort()) for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
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

// refs: [{ id, species, group, features }]. settings: { name, mode, params,
// preprocessingVersion, folds }. onProgress(fraction, stage).
export function trainModel(refs, settings, onProgress = () => {}) {
  const { mode = "fly", params = {}, folds: k = 5, name = "Modell" } = settings;
  if (mode === "graph") throw Error("Der FlyWire-Graphmodus ist explorativ und wird nicht eingefroren.");
  const taxa = [...new Set(refs.map((r) => r.species))];
  if (taxa.length < 2) throw Error("Training braucht mindestens zwei Taxa.");
  const labels = refs.map((r) => r.species),
    groups = refs.map((r) => r.group),
    features = refs.map((r) => r.features),
    blocks = commonBlocks(features);
  if (!blocks.length) throw Error("Keine Merkmalsblöcke, die alle Referenzen haben.");
  onProgress(0.02, "Merkmale ausrichten");

  // Landmarks: Procrustes consensus of the references (label-free).
  const withLandmarks = blocks.includes("landmarks"),
    alignment = withLandmarks ? gpa(features.map((f) => configOf(f.blocks.landmarks))) : null,
    X = alignment ? alignment.flat : null,
    prepared = features.map((f, i) => (X ? { ...f, blocks: { ...f.blocks, landmarks: X[i] } } : f));
  const standardizer = fitStandardizer(prepared, blocks),
    vectors = prepared.map((f) => standardizer.transform(f)),
    embed = makeEmbedder(mode, standardizer.dim, params),
    ctx = similarityContext(vectors.map(embed)),
    calibration = calibrate(ctx, labels, groups);

  // Stratified grouped k-fold: identical folds for every method.
  const foldCount = Math.max(2, Math.min(k, new Set(groups).size)),
    fold = stratifiedGroupFolds(labels, groups, foldCount),
    predictions = { rwr: Array(refs.length).fill(null), knn: Array(refs.length).fill(null), lda: X ? Array(refs.length).fill(null) : null },
    ldaProbabilities = X ? Array(refs.length).fill(null) : null;
  for (let f = 0; f < foldCount; f++) {
    onProgress(0.05 + (0.8 * f) / foldCount, `Kreuzvalidierung ${f + 1}/${foldCount}`);
    const excluded = Uint8Array.from(fold, (v) => (v === f ? 1 : 0)),
      train = refs.map((_, i) => i).filter((i) => !excluded[i]);
    if (!train.length || new Set(train.map((i) => labels[i])).size < 2) continue;
    const lda = X ? fitCalibratedShapeLDA(train.map((i) => X[i]), train.map((i) => labels[i]), train.map((i) => groups[i])) : null;
    for (let i = 0; i < refs.length; i++) {
      if (!excluded[i]) continue;
      // A taxon absent from the training folds cannot be predicted: skip, like LOO does.
      if (!train.some((j) => labels[j] === labels[i])) continue;
      const qs = ctx.sims.subarray(i * ctx.n, (i + 1) * ctx.n);
      predictions.rwr[i] = argmax(rwrScores(ctx, labels, qs, excluded));
      predictions.knn[i] = argmax(knnScores(ctx, labels, qs, excluded));
      if (lda) {
        ldaProbabilities[i] = lda.predictProba(X[i]);
        predictions.lda[i] = argmax(ldaProbabilities[i]);
      }
    }
  }
  const evaluation = { folds: foldCount, protocol: "stratifizierte, nach Exemplar gruppierte Kreuzvalidierung", methods: {} };
  for (const [key, preds] of Object.entries(predictions))
    if (preds) evaluation.methods[key] = { name: METHODS[key], ...summarize(labels, preds) };
  if (ldaProbabilities) evaluation.ldaCalibration = calibrationStats(ldaProbabilities, labels);
  // Transfer check: hold out one whole series (collection / capture session)
  // at a time. Only when every reference names its series.
  const series = refs.map((r) => r.series || null);
  if (series.every(Boolean) && new Set(series).size >= 2) {
    onProgress(0.8, "Serien-Transfer prüfen");
    const transfer = { rwr: Array(refs.length).fill(null), knn: Array(refs.length).fill(null), lda: X ? Array(refs.length).fill(null) : null };
    for (const held of new Set(series)) {
      const excluded = Uint8Array.from(series, (v) => (v === held ? 1 : 0)),
        train = refs.map((_, i) => i).filter((i) => !excluded[i]);
      if (new Set(train.map((i) => labels[i])).size < 2) continue;
      const lda = X ? fitCalibratedShapeLDA(train.map((i) => X[i]), train.map((i) => labels[i]), train.map((i) => groups[i])) : null;
      for (let i = 0; i < refs.length; i++) {
        if (!excluded[i] || !train.some((j) => labels[j] === labels[i])) continue;
        const qs = ctx.sims.subarray(i * ctx.n, (i + 1) * ctx.n);
        transfer.rwr[i] = argmax(rwrScores(ctx, labels, qs, excluded));
        transfer.knn[i] = argmax(knnScores(ctx, labels, qs, excluded));
        if (lda) transfer.lda[i] = lda.predict(X[i]);
      }
    }
    evaluation.seriesTransfer = {
      series: new Set(series).size,
      methods: Object.fromEntries(Object.entries(transfer).filter(([, p]) => p).map(([k, p]) => [k, { name: METHODS[k], ...summarize(labels, p) }])),
    };
  }
  onProgress(0.88, "Open-Set kalibrieren");
  evaluation.conformal = conformalEvaluation(ctx, labels, groups);
  const ranked = Object.entries(evaluation.methods)
      .filter(([, m]) => m.balancedAccuracy !== null)
      .sort((a, b) => b[1].balancedAccuracy - a[1].balancedAccuracy || ["lda", "rwr", "knn"].indexOf(a[0]) - ["lda", "rwr", "knn"].indexOf(b[0])),
    primary = ranked[0]?.[0] ?? "rwr";

  onProgress(0.92, "Endmodell anpassen");
  const lda = X ? fitCalibratedShapeLDA(X, labels, groups) : null,
    dim = standardizer.dim,
    packed = new Float32Array(refs.length * dim);
  vectors.forEach((v, i) => packed.set(v, i * dim));
  onProgress(1, "fertig");
  return {
    version: MODEL_VERSION,
    id: settings.id ?? (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
    name,
    createdAt: new Date().toISOString(),
    featureVersion: features[0].version,
    preprocessingVersion: settings.preprocessingVersion ?? null,
    blocks,
    landmarkScheme: withLandmarks ? features[0].landmarkScheme : null,
    reservoir: { mode, params },
    classifier: { ...CLASSIFIER_DEFAULTS },
    references: { count: refs.length, fingerprint: referenceFingerprint(refs.map((r) => r.id)), ids: refs.map((r) => r.id) },
    taxa: readiness(refs),
    standardizer: standardizer.params,
    vectors: packed,
    labels,
    groups,
    calibration: Float32Array.from(calibration, (v) => (v === null ? NaN : v)),
    landmarkMean: alignment ? Float32Array.from(flatOf(alignment.mean)) : null,
    lda: lda?.params ?? null,
    evaluation,
    primary,
  };
}

// Balanced mean top probability vs. balanced accuracy, and Brier score.
function calibrationStats(probabilities, labels) {
  const count = {};
  labels.forEach((l, i) => probabilities[i] && (count[l] = (count[l] || 0) + 1));
  let p = 0,
    hit = 0,
    brier = 0,
    n = 0;
  probabilities.forEach((prob, i) => {
    if (!prob) return;
    const w = 1 / count[labels[i]],
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
  if (model?.version !== MODEL_VERSION) throw Error("Kein Modell der Version " + MODEL_VERSION);
  const standardizer = standardizerFromParams(model.standardizer),
    dim = standardizer.dim,
    embed = makeEmbedder(model.reservoir.mode, dim, model.reservoir.params),
    n = model.labels.length,
    vectors = Array.from({ length: n }, (_, i) => model.vectors.subarray(i * dim, (i + 1) * dim)),
    ctx = similarityContext(vectors.map(embed)),
    calibration = Array.from(model.calibration, (v) => (Number.isNaN(v) ? null : v)),
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
    classify(features) {
      const missing = this.missingBlocks(features);
      if (missing.length) throw Error(`Das Modell braucht Merkmale, die dieser Aufnahme fehlen: ${missing.join(", ")}.`);
      const landmarks = alignedLandmarks(features),
        prepared = landmarks ? { ...features, blocks: { ...features.blocks, landmarks } } : features,
        q = embed(standardizer.transform(prepared)),
        qs = querySimilarities(ctx, q);
      return {
        qs,
        embedding: q,
        scores: rwrScores(ctx, model.labels, qs),
        knn: knnScores(ctx, model.labels, qs),
        conformal: conformalPredict(qs, model.labels, calibration),
        lda: lda && landmarks ? { probabilities: lda.predictProba(landmarks), model: lda } : null,
        best: Math.max(...qs),
      };
    },
  };
}
