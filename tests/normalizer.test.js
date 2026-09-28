import test from "node:test";
import assert from "node:assert/strict";
import { preprocess } from "../imaging/pipeline.js";
import { apply } from "../imaging/matrix.js";
import { register } from "../imaging/registration.js";
import { quality } from "../imaging/quality.js";
import { fixture } from "./fixtures.js";
const options = {
  parameters: { width: 320, height: 160, margin: 12 },
  createdAt: "2026-09-27T00:00:00Z",
};
function iou(a, b) {
  let i = 0,
    u = 0;
  for (let p = 0; p < a.length; p++) {
    if (a[p] && b[p]) i++;
    if (a[p] || b[p]) u++;
  }
  return i / u;
}
const baseline = preprocess(fixture(), options);
for (const angle of [0, 25, 90, 180])
  test("rotation " + angle, () => {
    const r = preprocess(fixture({ angle }), options);
    assert.ok(iou(baseline.normalized.mask, r.normalized.mask) > 0.95);
    const base = apply(
        r.metadata.transformMatrix,
        r.metadata.baseCandidate.x,
        r.metadata.baseCandidate.y,
      ),
      tip = apply(
        r.metadata.transformMatrix,
        r.metadata.tipCandidate.x,
        r.metadata.tipCandidate.y,
      );
    assert.ok(base.x < tip.x);
    assert.ok(Math.abs(base.y - tip.y) < 1e-8);
  });
test("translation", () => {
  const r = preprocess(fixture({ dx: 31, dy: -22 }), options);
  assert.ok(iou(baseline.normalized.mask, r.normalized.mask) > 0.99);
  const c = apply(
    r.metadata.transformMatrix,
    r.metadata.centroid.x,
    r.metadata.centroid.y,
  );
  assert.ok(Math.abs(c.x - 159.5) < 1e-8 && Math.abs(c.y - 79.5) < 1e-8);
});
test("scale", () => {
  for (const scale of [0.6, 1.25])
    assert.ok(
      iou(
        baseline.normalized.mask,
        preprocess(fixture({ scale }), options).normalized.mask,
      ) > 0.94,
    );
});
test("background variation and dark WIP", () => {
  for (const bg of [210, 250, 5])
    assert.ok(
      iou(
        baseline.normalized.mask,
        preprocess(fixture({ bg, wip: bg === 5 }), options).normalized.mask,
      ) > 0.99,
    );
});
test("mirror preserves original side", () => {
  const r = preprocess(fixture({ mirror: true }), {
    ...options,
    mirrored: true,
    originalSide: "left",
    standardConfirmed: true,
  });
  assert.ok(iou(baseline.normalized.mask, r.normalized.mask) > 0.99);
  assert.equal(r.metadata.originalSide, "left");
  assert.equal(r.metadata.normalizedSide, "right");
});
test("determinism includes identical RGB and matrices", () => {
  assert.deepEqual(preprocess(fixture(), options), baseline);
});
test("inverse transforms landmarks", () => {
  for (const p of [
    [0, 0],
    [85, 110],
    [359, 359],
  ]) {
    const q = apply(baseline.metadata.transformMatrix, ...p),
      r = apply(baseline.metadata.inverseTransformMatrix, q.x, q.y);
    assert.ok(Math.hypot(r.x - p[0], r.y - p[1]) < 1e-9);
  }
});
test("blank image fails explicitly", () => {
  const f = fixture();
  f.data.fill(255);
  assert.throws(() => preprocess(f, options), /Keine plausible/);
});
test("WIP colors are unchanged inside uniform membrane", () => {
  const r = preprocess(fixture({ wip: true, bg: 0 }), options);
  let n = 0;
  for (let p = 0; p < r.normalized.mask.length; p++)
    if (
      r.normalized.mask[p] &&
      r.normalized.mask[p - 2] &&
      r.normalized.mask[p + 2] &&
      r.normalized.mask[p - 640] &&
      r.normalized.mask[p + 640]
    ) {
      assert.equal(r.normalized.data[p * 4 + 1], 65);
      assert.equal(r.normalized.data[p * 4 + 2], 185);
      n++;
    }
  assert.ok(n > 1000);
});
test("quality catches clipping and fragmentation", () => {
  const mask = new Uint8Array(100);
  mask.fill(1, 0, 20);
  const q = quality(mask, 10, 10, { componentAreas: [20, 15], noise: 0 });
  assert.equal(q.status, "REVIEW");
  assert.equal(q.edgeContact, true);
  assert.ok(q.fragmentationScore > 0.4);
});
test("registration improves transformed shape", () => {
  const a = baseline.normalized.mask,
    b = new Uint8Array(a.length),
    w = 320,
    h = 160;
  for (let y = 0; y < h - 4; y++)
    for (let x = 0; x < w - 8; x++) b[(y + 4) * w + x + 8] = a[y * w + x];
  const r = register(a, b, w, h);
  assert.ok(r.maskIoU > r.initialIoU);
  assert.ok(r.maskIoU > 0.98);
});

test("different raster resolution and uniform affine scale", () => {
  const f = fixture(),
    width = 721,
    height = 719,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p =
        (Math.min(359, Math.floor(y / 2)) * 360 +
          Math.min(359, Math.floor(x / 2))) *
        4;
      data.set(f.data.subarray(p, p + 4), (y * width + x) * 4);
    }
  const r = preprocess({ width, height, data }, options),
    m = r.metadata.transformMatrix;
  assert.ok(iou(baseline.normalized.mask, r.normalized.mask) > 0.96);
  assert.ok(Math.abs(Math.hypot(m[0], m[3]) - Math.hypot(m[1], m[4])) < 1e-12);
  assert.ok(Math.abs(m[0] * m[1] + m[3] * m[4]) < 1e-12);
});
test("manual correction preserves exact mask and metric metadata", () => {
  const manual = baseline.mask.slice(),
    metric = { micrometersPerPixel: 2.5, source: "stage micrometer" };
  const r = preprocess(fixture(), {
    ...options,
    manualMask: manual,
    originalMetricScale: metric,
  });
  assert.deepEqual(r.mask, manual);
  assert.equal(r.metadata.segmentationMethod, "manual-mask");
  assert.deepEqual(r.metadata.originalMetricScale, metric);
});
test("holes filled and isolated artifacts removed", () => {
  const f = fixture();
  for (let y = 170; y < 180; y++)
    for (let x = 180; x < 190; x++) {
      const p = (y * f.width + x) * 4;
      f.data[p] = f.data[p + 1] = f.data[p + 2] = 240;
    }
  for (let y = 20; y < 24; y++)
    for (let x = 20; x < 24; x++) {
      const p = (y * f.width + x) * 4;
      f.data[p] = f.data[p + 1] = f.data[p + 2] = 10;
    }
  const r = preprocess(f, options);
  assert.equal(r.mask[175 * f.width + 185], 1);
  assert.equal(r.mask[21 * f.width + 21], 0);
});

test("registration handles small scale and rotation errors without shear", () => {
  const w = 320,
    h = 160,
    src = baseline.normalized.mask,
    dst = new Uint8Array(src.length),
    angle = 0.08,
    scale = 1.04,
    c = Math.cos(angle),
    s = Math.sin(angle);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xx = (x - 159.5 - 3) / scale,
        yy = (y - 79.5 + 2) / scale,
        u = Math.round(xx * c + yy * s + 159.5),
        v = Math.round(-xx * s + yy * c + 79.5);
      if (u >= 0 && v >= 0 && u < w && v < h) dst[y * w + x] = src[v * w + u];
    }
  const r = register(src, dst, w, h);
  assert.ok(r.maskIoU > 0.95);
  assert.ok(r.maskIoU > r.initialIoU);
  const m = r.matrix;
  assert.ok(Math.abs(m[0] * m[1] + m[3] * m[4]) < 1e-12);
});
test("explicit 180 flip and ambiguous symmetric geometry", () => {
  const r = preprocess(fixture(), { ...options, flipped180: true });
  const p = apply(
    r.metadata.transformMatrix,
    r.metadata.tipCandidate.x,
    r.metadata.tipCandidate.y,
  );
  assert.ok(p.x < 160);
  const f = fixture();
  for (let y = 0; y < f.height; y++)
    for (let x = 0; x < f.width; x++) {
      const val = Math.hypot(x - 180, y - 180) < 60 ? 100 : 240,
        idx = (y * f.width + x) * 4;
      f.data[idx] = f.data[idx + 1] = f.data[idx + 2] = val;
    }
  assert.equal(preprocess(f, options).metadata.orientationConfidence, "low");
});
