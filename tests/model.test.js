import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trainModel, loadModel, stratifiedGroupFolds, referenceFingerprint, readiness, MODEL_VERSION } from "../classifier/model.js";
import { stringifyTyped, parseTyped } from "../classifier/typed-json.js";
import { mulberry32 } from "../classifier/embedding.js";

// Real Bombus landmarks (Molasy & Tofilski) in the app's standard view:
// the dataset CSV is y-up, the standard view is a 180° rotation of it.
const rows = readFileSync(new URL("../test-data/landmarks-original.csv", import.meta.url), "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(",").map((c) => c.replace(/"/g, "")));
// Series = collection, recognisable from the specimen code style in the file names.
const seriesOf = (file) => {
  const code = file.split("-")[2];
  return /^\d{6}$/.test(code) ? "numbered" : code.startsWith("BUM") ? "BUM" : code.startsWith("B_") ? "B" : code.slice(0, 4);
};
const wings = rows.map(([file, ...c]) => ({
  id: file,
  species: "Bombus " + file.split("-")[0],
  group: file.replace(/-[LR]\.dw\.png$/, ""),
  sex: file.split("-")[1],
  series: seriesOf(file),
  features: {
    version: "wing-features-1",
    landmarkScheme: "bombus-19",
    blocks: { landmarks: c.map((v) => -Number(v)) },
  },
}));
// 12 random specimens (all their wings) per species as references, the rest as queries.
const pick = (count, seed, filter = () => true) => {
  const rnd = mulberry32(seed),
    out = new Set();
  for (const species of new Set(wings.map((w) => w.species))) {
    const g = [...new Set(wings.filter((w) => w.species === species && filter(w)).map((w) => w.group))];
    for (let i = g.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [g[i], g[j]] = [g[j], g[i]];
    }
    g.slice(0, count).forEach((x) => out.add(x));
  }
  return out;
};
const chosen = pick(12, 3);
const refs = wings.filter((w) => chosen.has(w.group)),
  queries = wings.filter((w) => !chosen.has(w.group));
const settings = { name: "Test", mode: "fly", params: { kenyonCells: 512 }, preprocessingVersion: "wing-normalizer-0.2", id: "m1" };
const model = trainModel(refs, settings);

test("stratified grouped folds keep specimens together and spread taxa", () => {
  const labels = refs.map((r) => r.species),
    groups = refs.map((r) => r.group),
    fold = stratifiedGroupFolds(labels, groups, 5);
  const foldOfGroup = new Map();
  groups.forEach((g, i) => {
    if (foldOfGroup.has(g)) assert.equal(foldOfGroup.get(g), fold[i], "specimen split across folds");
    foldOfGroup.set(g, fold[i]);
  });
  for (const species of new Set(labels)) {
    const folds = new Set(labels.map((l, i) => (l === species ? fold[i] : -1)).filter((f) => f >= 0));
    assert.equal(folds.size, 5, species);
  }
  assert.throws(() => stratifiedGroupFolds(["A", "B"], ["s1", "s1"]), /mehrere Taxa/);
});
test("training evaluates all methods with the same folds and picks the best", () => {
  assert.equal(model.version, MODEL_VERSION);
  assert.deepEqual(Object.keys(model.evaluation.methods).sort(), ["knn", "lda", "rwr"]);
  for (const m of Object.values(model.evaluation.methods)) {
    assert.ok(m.balancedAccuracy > 0.34 && m.balancedAccuracy <= 1, m.name);
    assert.equal(m.evaluated, refs.length);
  }
  const best = Math.max(...Object.values(model.evaluation.methods).map((m) => m.balancedAccuracy));
  assert.equal(model.evaluation.methods[model.primary].balancedAccuracy, best);
  const cal = model.evaluation.ldaCalibration;
  assert.ok(Math.abs(cal.meanTopProbability - cal.balancedAccuracy) < 0.2, JSON.stringify(cal));
  // Twelve animals per taxon cannot provide nine independent calibration
  // animals in each development fold with the 20% holdout policy.
  assert.equal(model.evaluation.conformal.coverage, null);
  assert.equal(model.evaluation.conformal.validQueries, 0);
  assert.equal(model.calibration.protocol, "split-specimen-max");
  assert.equal(new Set(model.calibration.groups).size, model.calibration.groups.length);
  assert.ok(model.calibration.groups.every((g) => !model.groups.includes(g)));
  assert.equal(model.taxa["Bombus terrestris"].specimens, 12);
  assert.equal(model.taxa["Bombus terrestris"].status, "ready");
});
test("frozen model survives JSON export and classifies held-out wings identically", () => {
  const live = loadModel(model),
    restored = loadModel(parseTyped(stringifyTyped(model)));
  let correct = 0;
  const sample = queries.filter((_, i) => i % 25 === 0);
  for (const q of sample) {
    const a = live.classify(q.features),
      b = restored.classify(q.features);
    assert.deepEqual(a.scores, b.scores);
    assert.deepEqual(a.lda.probabilities, b.lda.probabilities);
    assert.deepEqual(a.conformal, b.conformal);
    const p = a.lda.probabilities;
    assert.ok(Math.abs(Object.values(p).reduce((s, v) => s + v, 0) - 1) < 1e-9);
    if (Object.entries(p).sort((x, y) => y[1] - x[1])[0][0] === q.species) correct++;
  }
  assert.ok(correct / sample.length > 0.6, `held-out accuracy ${correct}/${sample.length}`);
});
test("query alignment: rotating, scaling and shifting the landmarks changes nothing", () => {
  const runtime = loadModel(model),
    q = queries[0],
    flat = q.features.blocks.landmarks,
    moved = [];
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i],
      y = flat[i + 1],
      c = Math.cos(0.4) * 2.5,
      s = Math.sin(0.4) * 2.5;
    moved.push(c * x - s * y + 300, s * x + c * y - 80);
  }
  const a = runtime.classify(q.features).lda.probabilities,
    b = runtime.classify({ ...q.features, blocks: { landmarks: moved } }).lda.probabilities;
  for (const t of Object.keys(a)) assert.ok(Math.abs(a[t] - b[t]) < 1e-6);
});
test("clear errors: missing features, graph mode, too few taxa", () => {
  const runtime = loadModel(model);
  assert.throws(() => runtime.classify({ version: "wing-features-1", blocks: { shape: [1, 2] } }), /landmarks/);
  assert.throws(() => runtime.classify({ ...queries[0].features, landmarkScheme: "other" }), /landmarks/);
  assert.throws(() => trainModel(refs, { ...settings, mode: "graph" }), /explorativ/);
  assert.throws(() => trainModel(refs.filter((r) => r.species === "Bombus terrestris"), settings), /zwei Taxa/);
  assert.throws(() => loadModel({ version: "x" }), /Version/);
});
test("unrepresentative references: CV looks perfect, other collections fail, readiness warns", () => {
  // lucorum vs terrestris, references only from the "numbered" collection.
  const pool = wings.filter((w) => w.species !== "Bombus cryptarum"),
    inSeries = pool.filter((w) => w.series === "numbered"),
    others = pool.filter((w) => w.series !== "numbered"),
    m = trainModel(inSeries, { ...settings, mode: "none" }),
    runtime = loadModel(m),
    hit = {};
  for (const q of others) {
    const top = Object.entries(runtime.classify(q.features).lda.probabilities).sort((a, b) => b[1] - a[1])[0][0];
    (hit[q.species] ??= [0, 0])[0] += top === q.species;
    hit[q.species][1]++;
  }
  const transfer = Object.values(hit).reduce((a, [c, n]) => a + c / n, 0) / Object.keys(hit).length;
  assert.ok(m.evaluation.methods.lda.balancedAccuracy > 0.95, "CV " + m.evaluation.methods.lda.balancedAccuracy);
  assert.ok(transfer < 0.8, "other collections " + transfer);
  assert.ok(m.taxa["Bombus terrestris"].warnings.includes("nur eine Serie/Fundort"));
  const females = readiness(pool.filter((w) => w.sex === "F"));
  assert.ok(females["Bombus lucorum"].warnings.some((w) => w.startsWith("nur ♀")));
});
test("leave-one-series-out reports transfer across collections", () => {
  const t = model.evaluation.seriesTransfer;
  assert.ok(t.series >= 2);
  assert.deepEqual(Object.keys(t.methods).sort(), ["knn", "lda", "rwr"]);
  assert.ok(t.methods.lda.evaluated > 0);
});
test("reference fingerprint and readiness", () => {
  assert.equal(referenceFingerprint(["b", "a"]), referenceFingerprint(["a", "b"]));
  assert.notEqual(referenceFingerprint(["a", "b"]), referenceFingerprint(["a", "c"]));
  const r = readiness([
    { species: "A", group: "1", features: { blocks: {} } },
    { species: "A", group: "1", features: { blocks: { landmarks: [] } } },
  ]);
  assert.deepEqual(r.A, {
    specimens: 1,
    wings: 2,
    withLandmarks: 1,
    sexes: {},
    series: 0,
    warnings: ["2 Flügel ohne Geschlecht"],
    status: "insufficient",
  });
});


test("saved classifier settings and model contracts are enforced", () => {
  const query = queries[0].features;
  const changed = { ...model, classifier: { ...model.classifier, alpha: 1 } };
  assert.deepEqual(loadModel(changed).classify(query).scores, {});
  assert.throws(() => loadModel(model).classify({ ...query, version: "future" }), /Merkmalsversion/);
  assert.throws(() => loadModel(model).classify(query, "future"), /Vorverarbeitungsversion/);
  const invalid = { ...query, blocks: { landmarks: query.blocks.landmarks.map((v, i) => i ? v : NaN) } };
  assert.throws(() => loadModel(model).classify(invalid), /ungültige Werte/);
  const overlap = { ...model, calibration: { ...model.calibration, groups: model.calibration.groups.map((g, i) => i ? g : model.groups[0]) } };
  assert.throws(() => loadModel(overlap), /Kalibrierungsdaten/);
  assert.ok(Object.keys(model.reservoir.params).includes("seed"));
});

test("frozen standardizer is fitted only to training animals", () => {
  const rnd = mulberry32(3);
  const synthetic = Array.from({ length: 30 }, (_, i) => ({
    id: String(i), group: String(i), species: i < 15 ? "A" : "B",
    features: { version: "test", blocks: { shape: [i * i, rnd()] } },
  }));
  const m = trainModel(synthetic, { ...settings, mode: "none" });
  const train = synthetic.filter((r) => m.groups.includes(r.group));
  const expected = train.reduce((sum, r) => sum + r.features.blocks.shape[0], 0) / train.length;
  assert.ok(Math.abs(m.standardizer.mean[0] - expected) < 1e-4);
  assert.notEqual(m.standardizer.mean[0], synthetic.reduce((sum, r) => sum + r.features.blocks.shape[0], 0) / synthetic.length);
  assert.throws(() => trainModel(synthetic.map((r, i) => ({ ...r, group: i ? r.group : null })), settings), /Exemplar-ID/);
  const original = referenceFingerprint(synthetic);
  assert.notEqual(referenceFingerprint(synthetic.map((r, i) => i ? r : { ...r, species: "B" })), original);
});

test("missing diagnostic modalities require an explicit input contract", () => {
  const partial = refs.map((r, i) => ({ ...r, features: { ...r.features, blocks: { ...r.features.blocks, ...(i ? { wip: [i, 2] } : {}) } } }));
  assert.throws(() => trainModel(partial, settings), /Eingabemodus/);
  assert.throws(() => trainModel(partial, { ...settings, blocks: ["wip"] }), /wip/);
});
