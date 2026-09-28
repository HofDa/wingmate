import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preprocess } from "../imaging/pipeline.js";
import { fixture } from "./fixtures.js";
import {
  SCHEMES,
  emptyLandmarks,
  toNormalized,
  toOriginal,
  landmarkBlock,
  alignLandmarkBlocks,
  landmarksCsv,
  csvToImage,
  nextOpen,
  isComplete,
  isResolved,
} from "../classifier/landmarks.js";
import { commonBlocks } from "../classifier/embedding.js";
import { gpa, procrustesDistance, fitLDA, ledoitWolf } from "../classifier/morphometrics.js";
import * as morph from "../classifier/morphometrics.js";
import { fitGuide, outliers } from "../imaging/landmark-ui.js";
import { mulberry32 } from "../classifier/embedding.js";

const options = {
  parameters: { width: 1024, height: 512, margin: 32 },
  createdAt: "2026-09-28T00:00:00Z",
  standardConfirmed: true,
};
// Landmarks in the fixture's wing frame (u along the axis, v across).
const WING = [
  [-90, 0], [-60, -12], [-40, 10], [-10, -20], [5, 15], [30, -8], [55, 20], [70, -5], [85, 4], [95, -2],
];
// Image position of wing-frame point (u, v) for fixture({ angle, mirror }).
function imagePoint([u, v], { angle = 0, mirror = false } = {}) {
  const c = Math.cos((angle * Math.PI) / 180),
    s = Math.sin((angle * Math.PI) / 180),
    vv = mirror ? -v : v;
  return { x: 180 + u * c - vv * s, y: 180 + u * s + vv * c };
}
function landmarksFor(f) {
  const lm = emptyLandmarks("bombus-19");
  lm.points = WING.map((p) => imagePoint(p, f));
  return lm;
}

test("original <-> normalized round trip survives flip and mirror", () => {
  for (const extra of [{}, { flipped180: true }, { mirrored: true }]) {
    const m = preprocess(fixture({ angle: 25 }), { ...options, ...extra }).metadata,
      p = { x: 123.25, y: 201.5 },
      back = toOriginal(toNormalized({ points: [p] }, m)[0], m);
    assert.ok(Math.hypot(back.x - p.x, back.y - p.y) < 1e-9);
  }
});
test("mirror-image wings give the same shape once the mirror is confirmed", () => {
  const plain = { angle: 30 },
    mirrored = { angle: -40, mirror: true },
    a = preprocess(fixture(plain), options).metadata,
    b = preprocess(fixture(mirrored), { ...options, mirrored: true }).metadata,
    wrong = preprocess(fixture(mirrored), options).metadata;
  const flat = (lm, m) => {
    const f = toNormalized(lm, m),
      out = [];
    for (const p of f) out.push([p.x, p.y]);
    return out;
  };
  const shapes = gpa([flat(landmarksFor(plain), a), flat(landmarksFor(mirrored), b), flat(landmarksFor(mirrored), wrong)]).shapes;
  assert.ok(procrustesDistance(shapes[0], shapes[1]) < 0.02, "confirmed mirror");
  assert.ok(procrustesDistance(shapes[0], shapes[2]) > 0.1, "unmirrored reflection must stay different");
});
test("feature block needs complete landmarks and a confirmed standard view", () => {
  const m = preprocess(fixture(), options).metadata,
    lm = landmarksFor({});
  assert.equal(landmarkBlock(lm, { ...m, standardConfirmed: false }), null);
  const partial = { ...lm, points: [...lm.points.slice(0, 5), null, ...lm.points.slice(6)] };
  assert.equal(landmarkBlock(partial, m), null);
  assert.equal(landmarkBlock(lm, m).length, WING.length * 2);
});
test("placement state: next open landmark, missing vs. unset", () => {
  const lm = emptyLandmarks();
  assert.equal(lm.points.length, 19);
  assert.equal(nextOpen(lm), 0);
  lm.points[0] = { x: 1, y: 1 };
  lm.points[1] = null;
  assert.equal(nextOpen(lm, 1), 2);
  assert.equal(isComplete(lm), false);
  lm.points = lm.points.map((p) => (p === undefined ? { x: 0, y: 0 } : p));
  assert.equal(isResolved(lm), true);
  assert.equal(isComplete(lm), false); // one is marked missing
});
test("landmark blocks of different schemes are never compared", () => {
  const a = { landmarkScheme: "bombus-19", blocks: { landmarks: [1, 2], shape: [1] } },
    b = { landmarkScheme: "other-12", blocks: { landmarks: [1, 2], shape: [1] } };
  assert.deepEqual(commonBlocks([a, a]), ["landmarks", "shape"]);
  assert.deepEqual(commonBlocks([a, b]), ["shape"]);
  const aligned = alignLandmarkBlocks([
    { blocks: { landmarks: [0, 0, 4, 0, 0, 3] } },
    { blocks: { landmarks: [10, 10, 10, 18, 4, 10] } },
  ]);
  const [p, q] = [...aligned.values()];
  assert.ok(Math.hypot(...p.map((v, i) => v - q[i])) < 1e-9); // same triangle up to similarity
});
test("guide fit predicts positions and flags swapped landmarks", () => {
  const guide = SCHEMES["bombus-19"].guide,
    // Guide under a similarity: scale 700, rotation 0.3 rad, shifted.
    c = Math.cos(0.3) * 700,
    s = Math.sin(0.3) * 700,
    pts = guide.map(([x, y]) => ({ x: c * x - s * y + 150, y: s * x + c * y + 90 }));
  const fit = fitGuide(guide, pts.map((p, i) => (i < 3 ? p : undefined)));
  for (let i = 0; i < 19; i++) {
    const q = fit.map(guide[i]);
    assert.ok(Math.hypot(q.x - pts[i].x, q.y - pts[i].y) < 1e-6);
  }
  assert.deepEqual(outliers(guide, pts), []);
  const swapped = pts.slice();
  [swapped[6], swapped[12]] = [swapped[12], swapped[6]];
  assert.deepEqual(outliers(guide, swapped).sort((a, b) => a - b), [6, 12]);
});
test("CSV export matches the dataset layout; dataset y axis points up", () => {
  const lm = { scheme: "bombus-19", points: [{ x: 10, y: 20 }, null, ...Array(17).fill({ x: 1, y: 2 })] },
    csv = landmarksCsv([{ file: "a.png", landmarks: lm, height: 100 }], { yUp: true }).split("\n");
  assert.equal(csv[0].split(",").length, 39);
  assert.ok(csv[1].startsWith('"a.png",10.00,79.00,,,'));
  assert.deepEqual(csvToImage(10, 79, 100), { x: 10, y: 20 });
});
test("guide is the documented Procrustes mean of the 814 dataset wings", () => {
  const rows = readFileSync(new URL("../test-data/landmarks-original.csv", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(",").map((c) => c.replace(/"/g, "")));
  // y-up CSV -> standard view (base left, anterior up) is a 180° rotation.
  const configs = rows.map(([, ...c]) => {
    const v = c.map(Number),
      o = [];
    for (let i = 0; i < v.length; i += 2) o.push([-v[i], -v[i + 1]]);
    return o;
  });
  let m = gpa(configs).mean;
  const a = Math.atan2(m[18][1] - m[15][1], m[18][0] - m[15][0]),
    c = Math.cos(-a),
    s = Math.sin(-a);
  m = m.map(([x, y]) => [c * x - s * y, s * x + c * y]);
  const x0 = Math.min(...m.map((p) => p[0])),
    y0 = Math.min(...m.map((p) => p[1])),
    k = 1 / (Math.max(...m.map((p) => p[0])) - x0);
  m.forEach(([x, y], i) => {
    const [gx, gy] = SCHEMES["bombus-19"].guide[i];
    assert.ok(Math.abs((x - x0) * k - gx) < 1e-3 && Math.abs((y - y0) * k - gy) < 1e-3, "landmark " + (i + 1));
  });
  // Costal landmark 7 above posterior landmark 13 in the standard view.
  assert.ok(SCHEMES["bombus-19"].guide[6][1] < SCHEMES["bombus-19"].guide[12][1]);
});
test("Ledoit–Wolf shrinkage grows when data are scarce; LDA posteriors are consistent", () => {
  // Strongly correlated dimensions (far from the identity target): shrinkage
  // should be small with plenty of data and large with few samples.
  const rnd = mulberry32(4),
    rows = (n, d) =>
      Array.from({ length: n }, () => {
        const f = rnd() - 0.5;
        return Array.from({ length: d }, (_, j) => f * (1 + j / d) + 0.05 * (rnd() - 0.5));
      }),
    centre = (Z) => {
      const m = Z[0].map((_, j) => Z.reduce((a, z) => a + z[j], 0) / Z.length);
      return Z.map((z) => z.map((v, j) => v - m[j]));
    };
  const plenty = ledoitWolf(centre(rows(2000, 5))),
    scarce = ledoitWolf(centre(rows(6, 40)));
  assert.ok(plenty >= 0 && plenty < 0.05, "plenty " + plenty);
  assert.ok(scarce > 3 * plenty && scarce <= 1, "scarce " + scarce);
  const X = [],
    y = [];
  for (let i = 0; i < 60; i++) {
    const t = i % 3;
    X.push([t + (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4, rnd()]);
    y.push("T" + t);
  }
  const lda = fitLDA(X, y);
  for (const x of X.slice(0, 10)) {
    const p = lda.predictProba(x);
    assert.ok(Math.abs(Object.values(p).reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.equal(Object.entries(p).sort((a, b) => b[1] - a[1])[0][0], lda.predict(x));
  }
});
test("Jacobi eigen-decomposition and PCA basis", () => {
  const { symmetricEigen, pcaBasis } = morph;
  const A = [4, 1, 0, 1, 3, 1, 0, 1, 2],
    { values, vectors } = symmetricEigen(A, 3);
  for (let k = 0; k < 3; k++)
    for (let i = 0; i < 3; i++) {
      const Av = A[i * 3] * vectors[k][0] + A[i * 3 + 1] * vectors[k][1] + A[i * 3 + 2] * vectors[k][2];
      assert.ok(Math.abs(Av - values[k] * vectors[k][i]) < 1e-9);
    }
  assert.ok(values[0] >= values[1] && values[1] >= values[2]);
  const pts = Array.from({ length: 50 }, (_, i) => [i, 2 * i + (i % 3) * 0.01, 7]),
    basis = pcaBasis(pts, 1);
  assert.ok(basis.explained > 0.999);
});
test("temperature scaling softens overconfident posteriors", () => {
  const { fitTemperature, fitCalibratedShapeLDA } = morph;
  // Scores that are always extremely confident but right only 60 % of the time.
  const labels = Array.from({ length: 50 }, (_, i) => (i % 2 ? "A" : "B")),
    scores = labels.map((l, i) => ((i % 5 < 3) === (l === "A") ? { A: 20, B: 0 } : { A: 0, B: 20 }));
  assert.ok(fitTemperature(scores, labels) > 10);
  // Overlapping taxa, few references: calibrated mean top probability close to accuracy.
  const rnd = mulberry32(12),
    gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd()),
    sample = (t) => Array.from({ length: 12 }, (_, j) => (j === 0 ? (t ? 0.6 : -0.6) : 0) + gauss()),
    X = [],
    y = [],
    g = [];
  for (let i = 0; i < 24; i++) {
    X.push(sample(i % 2));
    y.push(i % 2 ? "A" : "B");
    g.push("s" + i);
  }
  const m = fitCalibratedShapeLDA(X, y, g);
  let top = 0,
    hit = 0;
  for (let i = 0; i < 400; i++) {
    const t = i % 2,
      p = m.predictProba(sample(t)),
      [label, v] = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
    top += v / 400;
    hit += (label === (t ? "A" : "B")) / 400;
  }
  assert.ok(m.temperature > 0);
  assert.ok(Math.abs(top - hit) < 0.15, `stated ${top} vs correct ${hit}`);
});
