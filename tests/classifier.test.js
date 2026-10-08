import test from "node:test";
import assert from "node:assert/strict";
import { preprocess } from "../imaging/pipeline.js";
import { fixture } from "./fixtures.js";
import { extractFeatures, rgbToLab } from "../classifier/features.js";
import {
  fitStandardizer,
  flyProjection,
  project,
  makeEmbedder,
  cosine,
  graphReservoir,
  mulberry32,
} from "../classifier/embedding.js";
import {
  similarityContext,
  querySimilarities,
  rwrScores,
  rwrTransitions,
  knnScores,
  argmax,
  calibrate,
  conformalPredict,
  splitCalibrate,
  leaveOneOut,
} from "../classifier/classify.js";
import { traceWalk, summarizeWalk } from "../walk.js";
import { gpa, fitLDA, procrustesDistance, pca2 } from "../classifier/morphometrics.js";

const options = {
  parameters: { width: 1024, height: 512, margin: 32 },
  createdAt: "2026-09-27T00:00:00Z",
};
const normalized = (f) => preprocess(fixture(f), options).normalized;

test("feature blocks have fixed dimensions and are deterministic", () => {
  const n = normalized({}),
    a = extractFeatures({ venation: n, wip: n }),
    b = extractFeatures({ venation: n, wip: n });
  assert.equal(a.blocks.shape.length, 66);
  assert.equal(a.blocks.venation.length, 288);
  assert.equal(a.blocks.wip.length, 112);
  assert.deepEqual(a, b);
  assert.ok(Object.values(a.blocks).flat().every(Number.isFinite));
});
test("size block only with a reliable metric size", () => {
  const n = normalized({});
  assert.equal(extractFeatures({ venation: n }).blocks.size, undefined);
  assert.equal(
    extractFeatures({ venation: n }, { metricSize: { wingLengthMm: 9, wingAreaMm2: 20, reliable: false } }).blocks.size,
    undefined,
  );
  const f = extractFeatures({ venation: n }, { metricSize: { wingLengthMm: 9, wingAreaMm2: 20, reliable: true } });
  assert.deepEqual(f.blocks.size, [Math.log(9), Math.log(20)]);
});
test("features ignore background outside the mask", () => {
  const a = extractFeatures({ venation: normalized({ bg: 240 }) }),
    b = extractFeatures({ venation: normalized({ bg: 205 }) });
  assert.ok(cosine(a.blocks.shape, b.blocks.shape) > 0.999);
  // Uniform membranes have no vein signal; zero vectors have undefined cosine.
  assert.ok(a.blocks.venation.every((v) => v === 0));
  assert.deepEqual(a.blocks.venation, b.blocks.venation);
});
test("WIP features respond to membrane colour", () => {
  const grey = extractFeatures({ wip: normalized({ bg: 0 }) }),
    blue = extractFeatures({ wip: normalized({ bg: 0, wip: true }) });
  // Fixture membrane: grey (100,100,100) vs blue (100,65,185) -> Lab b* negative.
  // Cell 9 (row 1, column 1) lies inside the wing.
  assert.ok(grey.blocks.wip[9 * 3] > 30 && Math.abs(grey.blocks.wip[9 * 3 + 2]) < 1);
  assert.ok(blue.blocks.wip[9 * 3 + 2] < -20);
  assert.deepEqual(rgbToLab(255, 255, 255).map((v) => Math.round(v) + 0), [100, 0, 0]);
});

test("standardizer equalises block influence and zeroes constant dims", () => {
  const rnd = mulberry32(3),
    records = Array.from({ length: 20 }, () => ({
      blocks: {
        shape: [rnd(), 5],
        venation: Array.from({ length: 50 }, () => rnd() * 100),
      },
    })),
    s = fitStandardizer(records, ["shape", "venation"]);
  const v = records.map((r) => s.transform(r));
  assert.ok(v.every((x) => x[1] === 0));
  const energy = (from, to) =>
    v.reduce((a, x) => a + x.slice(from, to).reduce((b, y) => b + y * y, 0), 0) / v.length;
  // Informative dims: shape has 1, venation 50; both blocks weighted 1/sqrt(dim).
  assert.ok(Math.abs(energy(2, 52) - 1) < 0.1);
  assert.ok(Math.abs(energy(0, 2) - 0.5) < 0.1);
});
test("FlyHash: sparse binary fan-in and exact WTA sparsity", () => {
  const p = flyProjection(40, { kenyonCells: 1000, fanIn: 6, seed: 9 });
  for (let c = 0; c < 1000; c++)
    assert.equal(new Set(p.idx.subarray(c * 6, c * 6 + 6)).size, 6);
  const x = Float32Array.from({ length: 40 }, (_, i) => Math.sin(i)),
    tag = project(p, x, 0.05);
  assert.equal(tag.reduce((a, b) => a + b, 0), 50);
  assert.ok(tag.every((v) => v === 0 || v === 1));
  assert.deepEqual(tag, project(flyProjection(40, { kenyonCells: 1000, fanIn: 6, seed: 9 }), x, 0.05));
});
test("FlyHash preserves neighbourhoods", () => {
  const embed = makeEmbedder("fly", 32),
    rnd = mulberry32(5),
    a = Float32Array.from({ length: 32 }, () => rnd() - 0.5),
    near = a.map((v) => v + (rnd() - 0.5) * 0.05),
    far = Float32Array.from({ length: 32 }, () => rnd() - 0.5);
  assert.ok(cosine(embed(a), embed(near)) > cosine(embed(a), embed(far)) + 0.3);
});
test("cosine refuses mismatched embeddings instead of truncating", () => {
  assert.throws(() => cosine([1, 0], [1, 0, 0]), /Dimensionen/);
});
test("graph reservoir is deterministic and uses edge weights", () => {
  const g = graphReservoir({ nodes: [1, 2, 3, 4], edges: [[0, 1, 5], [1, 2, 1], [2, 3, 2], [3, 0, 1]] }),
    embed = makeEmbedder("graph", 3, {}, g),
    e = embed([0.2, -0.4, 1]);
  assert.deepEqual(e, embed([0.2, -0.4, 1]));
  assert.ok(Math.abs(Math.hypot(...e) - 1) < 1e-6);
});

// Two Gaussian clusters; taxon A is 5x more abundant than B.
function clusters(nA = 40, nB = 8, seed = 11) {
  const rnd = mulberry32(seed),
    gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd()),
    point = (cx) => Float32Array.from({ length: 6 }, (_, i) => (i === 0 ? cx : 0) + 0.35 * gauss()),
    embeddings = [],
    labels = [],
    groups = [];
  for (let i = 0; i < nA; i++) {
    embeddings.push(point(1));
    labels.push("A");
    groups.push("a" + i);
  }
  for (let i = 0; i < nB; i++) {
    embeddings.push(point(-1));
    labels.push("B");
    groups.push("b" + i);
  }
  return { embeddings, labels, groups };
}
test("RWR and kNN recover separable taxa", () => {
  const { embeddings, labels, groups } = clusters(),
    ctx = similarityContext(embeddings);
  for (const method of ["rwr", "knn"]) {
    const r = leaveOneOut(ctx, labels, groups, method);
    assert.ok(r.balancedAccuracy > 0.9, method + " " + r.balancedAccuracy);
  }
  const q = Float32Array.from([-1, 0, 0, 0, 0, 0]),
    qs = querySimilarities(ctx, q);
  assert.equal(argmax(rwrScores(ctx, labels, qs)), "B");
  assert.equal(argmax(knnScores(ctx, labels, qs)), "B");
  const s = rwrScores(ctx, labels, qs);
  assert.ok(Math.abs(Object.values(s).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
test("walk view traces exactly the chain that is scored", () => {
  const { embeddings, labels } = clusters(12, 6, 3),
    ctx = similarityContext(embeddings),
    qs = querySimilarities(ctx, Float32Array.from([-0.5, 0.2, 0, 0, 0, 0])),
    { P, query } = rwrTransitions(ctx, qs);
  for (const row of P) assert.ok(Math.abs(row.reduce((a, [, w]) => a + w, 0) - 1) < 1e-9);
  const last = traceWalk(P, query, { steps: 40, restart: 0.2 }).distributions.at(-1),
    scores = rwrScores(ctx, labels, qs, undefined, { balanced: false });
  const refMass = labels.reduce((a, _, i) => a + last[i], 0);
  for (const taxon of ["A", "B"]) {
    const mass = labels.reduce((a, l, i) => a + (l === taxon ? last[i] : 0), 0) / refMass;
    assert.ok(Math.abs(mass - (scores[taxon] || 0)) < 1e-9, taxon);
  }
  const display = summarizeWalk(last, query, [...labels, null]),
    balanced = rwrScores(ctx, labels, qs);
  for (const row of display.rows)
    assert.ok(Math.abs(row.score - (balanced[row.name] || 0)) < 1e-12, row.name);
});
test("balanced scoring counters abundance bias", () => {
  const { embeddings, labels } = clusters(60, 6, 4),
    ctx = similarityContext(embeddings),
    // Query between the clusters, slightly on the rare taxon's side.
    qs = querySimilarities(ctx, Float32Array.from([-0.2, 0.5, 0, 0, 0, 0]));
  const balanced = rwrScores(ctx, labels, qs).B,
    raw = rwrScores(ctx, labels, qs, undefined, { balanced: false }).B;
  assert.ok(raw > 0 && balanced > raw);
});
test("RWR excludes held-out references and balances only the remaining counts", () => {
  const ctx = similarityContext([[1, 0], [.9, .1], [.8, .2], [0, 1], [.1, .9]]),
    labels = ["A", "A", "A", "B", "B"],
    excluded = Uint8Array.from([1, 1, 0, 0, 0]),
    qs = querySimilarities(ctx, [.6, .4]);
  for (const k of [1, 7]) {
    const opts = { k, alpha: .35, steps: 17 },
      { P, query } = rwrTransitions(ctx, qs, excluded, opts);
    for (let i = 0; i < P.length; i++) {
      if (excluded[i]) { assert.deepEqual(P[i], []); continue; }
      assert.ok(Math.abs(P[i].reduce((sum, [, w]) => sum + w, 0) - 1) < 1e-12);
      assert.ok(P[i].every(([target, w]) => !excluded[target] && Number.isFinite(w) && w > 0));
      assert.ok(P[i].length <= k);
    }
    const trace = traceWalk(P, query, { steps: opts.steps, restart: opts.alpha, random: () => .5 });
    for (const distribution of trace.distributions) {
      assert.equal(distribution[0], 0);
      assert.equal(distribution[1], 0);
      assert.ok(Math.abs(distribution.reduce((sum, w) => sum + w, 0) - 1) < 1e-12);
    }
    const final = trace.distributions.at(-1),
      balanced = rwrScores(ctx, labels, qs, excluded, opts),
      a = final[2], b = (final[3] + final[4]) / 2;
    assert.ok(Math.abs((balanced.A || 0) - a / (a + b)) < 1e-12);
    assert.ok(Math.abs((balanced.B || 0) - b / (a + b)) < 1e-12);
  }
});

test("non-positive similarities still produce finite stochastic transition rows", () => {
  const ctx = similarityContext([[1, 0], [-1, 0], [0, 1]]),
    qs = querySimilarities(ctx, [0, -1]),
    { P, query } = rwrTransitions(ctx, qs);
  for (const row of P) {
    assert.ok(row.every(([, w]) => Number.isFinite(w) && w > 0));
    assert.ok(Math.abs(row.reduce((sum, [, w]) => sum + w, 0) - 1) < 1e-12);
  }
  for (const distribution of traceWalk(P, query).distributions)
    assert.ok(Math.abs(distribution.reduce((sum, w) => sum + w, 0) - 1) < 1e-12);
  assert.throws(() => rwrTransitions(ctx, qs, new Uint8Array([1, 1, 1])), /Keine Referenzen/);
});
test("grouped leave-one-out prevents duplicate wings from vouching for each other", () => {
  // Every specimen contributes two identical wings; labels are random noise.
  const rnd = mulberry32(8),
    embeddings = [],
    labels = [],
    groups = [];
  for (let i = 0; i < 30; i++) {
    const v = Float32Array.from({ length: 8 }, () => rnd() - 0.5),
      label = rnd() < 0.5 ? "A" : "B";
    for (let side = 0; side < 2; side++) {
      embeddings.push(v);
      labels.push(label);
      groups.push("s" + i);
    }
  }
  const ctx = similarityContext(embeddings),
    leaky = leaveOneOut(ctx, labels, labels.map((_, i) => i), "knn", { voteK: 1 }),
    grouped = leaveOneOut(ctx, labels, groups, "knn", { voteK: 1 });
  assert.equal(leaky.accuracy, 1);
  assert.ok(grouped.accuracy < 0.8);
});
test("conformal: calibrated coverage, open-set rejection, explicit under-calibration", () => {
  const { embeddings, labels, groups } = clusters(40, 30, 21),
    ctx = similarityContext(embeddings),
    calibrationIndices = labels.map((l, i) => i).filter((i) => i < 15 || (i >= 40 && i < 52)),
    trainingIndices = labels.map((l, i) => i).filter((i) => !calibrationIndices.includes(i)),
    train = similarityContext(trainingIndices.map((i) => embeddings[i])),
    trainLabels = trainingIndices.map((i) => labels[i]), trainGroups = trainingIndices.map((i) => groups[i]),
    calibration = splitCalibrate(train, trainLabels, trainGroups, calibrationIndices.map((i) => embeddings[i]), calibrationIndices.map((i) => labels[i]), calibrationIndices.map((i) => groups[i])),
    inside = conformalPredict(querySimilarities(train, Float32Array.from([1, 0, 0, 0, 0, 0])), trainLabels, calibration, undefined, { referenceGroups: trainGroups });
  assert.ok(inside.openSetValid);
  assert.deepEqual(inside.set, ["A"]);
  const novel = conformalPredict(querySimilarities(train, Float32Array.from([0, 0, 0, 0, 0, -1])), trainLabels, calibration, undefined, { referenceGroups: trainGroups });
  assert.equal(novel.unknown, true);
  const few = clusters(40, 4, 21),
    fctx = similarityContext(few.embeddings),
    r = conformalPredict(
      querySimilarities(fctx, Float32Array.from([0, 0, 0, 0, 0, -1])),
      few.labels,
      calibrate(fctx, few.labels, few.groups),
    );
  assert.deepEqual(r.uncalibrated, ["B"]);
  assert.equal(r.openSetValid, false);
  assert.equal(r.unknown, false);
});

test("GPA removes translation, rotation and scale", () => {
  const base = [
      [0, 0],
      [4, 1],
      [7, 3],
      [5, 6],
      [1, 4],
    ],
    moved = base.map(([x, y]) => {
      const c = Math.cos(0.7) * 3.2,
        s = Math.sin(0.7) * 3.2;
      return [c * x - s * y + 50, s * x + c * y - 20];
    }),
    r = gpa([base, moved]);
  assert.ok(procrustesDistance(r.shapes[0], r.shapes[1]) < 1e-9);
});
test("shrinkage LDA separates taxa with correlated noise", () => {
  const rnd = mulberry32(2),
    X = [],
    y = [];
  for (let i = 0; i < 200; i++) {
    const t = i % 2,
      n = rnd() - 0.5;
    X.push([n * 10, n * 10 + (t ? 0.4 : -0.4) + (rnd() - 0.5) * 0.2, rnd()]);
    y.push(t ? "B" : "A");
  }
  const lda = fitLDA(X, y, { shrinkage: 0.01 });
  assert.equal(X.filter((x, i) => lda.predict(x) === y[i]).length, 200);
});
test("pca2 finds the dominant axis", () => {
  const pts = Array.from({ length: 20 }, (_, i) => [i, 2 * i + (i % 2) * 0.1, 0.5]),
    p = pca2(pts);
  const spread = (k) => Math.max(...p.map((v) => v[k])) - Math.min(...p.map((v) => v[k]));
  assert.ok(spread(0) > 40 * spread(1));
});


test("duplicating wings does not increase calibration animals or certify live coverage", () => {
  const ctx = similarityContext([[1, 0, 0], [0, 1, 0]]), labels = ["A", "B"], groups = ["train-A", "train-B"];
  const points = [], calLabels = [], calGroups = [];
  for (const taxon of labels) for (let i = 0; i < 5; i++) {
    points.push(taxon === "A" ? [1, 0.1, 0] : [0.1, 1, 0]); calLabels.push(taxon); calGroups.push(taxon + i);
  }
  const once = splitCalibrate(ctx, labels, groups, points, calLabels, calGroups);
  const twice = splitCalibrate(ctx, labels, groups, [...points, ...points], [...calLabels, ...calLabels], [...calGroups, ...calGroups]);
  assert.deepEqual(once, twice);
  const qs = querySimilarities(ctx, [0, 0, 1]);
  const result = conformalPredict(qs, labels, twice, undefined, { referenceGroups: groups });
  assert.deepEqual(result.counts, { A: 5, B: 5 });
  assert.equal(result.openSetValid, false);
  assert.equal(result.unknown, false);
  const heuristic = conformalPredict(qs, labels, calibrate(ctx, labels, groups));
  assert.equal(heuristic.protocol, "grouped-jackknife-heuristic");
  assert.equal(heuristic.openSetValid, false);
  assert.throws(() => splitCalibrate(ctx, labels, groups, points, calLabels, calGroups.map(() => "train-A")), /getrennte Exemplare/);
});

test("no-vein silhouette is reviewed and has no boundary-derived vein features", () => {
  const image = preprocess(fixture(), options);
  assert.equal(image.metadata.captureQuality.sharpnessInWing, 0);
  assert.equal(image.metadata.maskQuality.status, "REVIEW");
  assert.ok(image.metadata.maskQuality.reasons.some((r) => r.includes("Bilddetail")));
  assert.ok(extractFeatures({ venation: image.normalized }).blocks.venation.every((v) => v === 0));
  // Real internal line detail must survive the safe-interior mask.
  const detailed = fixture();
  for (let y = 170; y < 190; y++) for (let x = 160; x < 200; x++)
    for (let c = 0; c < 3; c++) detailed.data[(y * detailed.width + x) * 4 + c] = 30;
  const processed = preprocess(detailed, options);
  assert.ok(processed.metadata.captureQuality.sharpnessInWing > 0);
  assert.ok(Math.hypot(...extractFeatures({ venation: processed.normalized }).blocks.venation) > 0);
});
