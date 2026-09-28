import test from "node:test";
import assert from "node:assert/strict";
import { preprocess } from "../imaging/pipeline.js";
import {
  averageFrames,
  buildModalityProfile,
  createRigProfile,
  flatFieldCorrect,
  sharpness,
  clippedFraction,
  metricScaleFromPoints,
} from "../imaging/rig.js";
import { serializeRig, deserializeRig } from "../imaging/rig-store.js";
import { fixture } from "./fixtures.js";
import { mulberry32 } from "../classifier/embedding.js";

// Transmitted-light rig: vignetting (corners ~45 % darker), warm colour cast,
// a static dust spot on the glass touching the wing edge, Gaussian sensor noise.
const W = 360,
  H = 360,
  DUST = { x: 180, y: 128, r: 9 };
function lightField(x, y, gain = 1) {
  const r2 = ((x - W / 2) ** 2 + (y - H / 2) ** 2) / (W / 2) ** 2,
    dust = Math.hypot(x - DUST.x, y - DUST.y) < DUST.r ? 0.35 : 1,
    v = 235 * gain * (1 - 0.45 * Math.min(1, r2 / 2)) * dust;
  return [v, v * 0.9, v * 0.78];
}
function frame(transmission, seed, { gain = 1, sigma = 2 } = {}) {
  const rnd = mulberry32(seed),
    gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd()),
    data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x,
        light = lightField(x, y, gain),
        t = transmission ? transmission[p] : 1;
      for (let c = 0; c < 3; c++) data[p * 4 + c] = light[c] * t + sigma * gauss();
      data[p * 4 + 3] = 255;
    }
  return { data, width: W, height: H };
}
// Wing transmission 0.39 (fixture membrane 100 on white 255), plus its ground-truth mask.
const clean = fixture({ bg: 255 }),
  transmission = new Float32Array(W * H),
  truth = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
  transmission[p] = clean.data[p * 4] / 255;
  truth[p] = clean.data[p * 4] < 255 ? 1 : 0;
}
const backgrounds = [1, 2, 3, 4].map((s) => frame(null, s)),
  venation = buildModalityProfile({ kind: "transmitted", background: backgrounds }),
  rig = createRigProfile({
    name: "Test-Rig",
    venation,
    originalMetricScale: { micrometersPerPixel: 10, source: "test" },
  }),
  rigOption = { ...venation, id: rig.id, name: rig.name },
  specimen = frame(transmission, 99),
  options = { parameters: { width: 320, height: 160, margin: 12 }, createdAt: "2026-09-28T00:00:00Z" };
const iou = (a, b) => {
  let i = 0,
    u = 0;
  for (let p = 0; p < a.length; p++) {
    if (a[p] && b[p]) i++;
    if (a[p] || b[p]) u++;
  }
  return i / u;
};

test("averaging estimates temporal noise and reduces it", () => {
  const r = averageFrames(backgrounds);
  assert.equal(r.frames, 4);
  // Injected σ = 2 per channel -> luminance σ ≈ 1.5; the median of 4-frame
  // standard deviations is biased low (≈ 1.3).
  assert.ok(r.temporalNoise > 1 && r.temporalNoise < 2, String(r.temporalNoise));
});
test("flat field removes vignetting and colour cast", () => {
  // Judge 20 × 20 block means: single-pixel noise is amplified by the gain
  // in dark corners and is not what the correction is supposed to remove.
  const corrected = flatFieldCorrect(frame(null, 7), venation.illumination).data,
    raw = frame(null, 7).data,
    stats = (d) => {
      let min = 255,
        max = 0,
        cast = 0;
      for (let by = 0; by < H; by += 20)
        for (let bx = 0; bx < W; bx += 20) {
          if (Math.hypot(bx + 10 - DUST.x, by + 10 - DUST.y) < DUST.r + 24) continue; // low-pass field keeps a halo
          let r = 0,
            g = 0,
            b = 0;
          for (let y = by; y < by + 20; y++)
            for (let x = bx; x < bx + 20; x++) {
              const p = (y * W + x) * 4;
              r += d[p];
              g += d[p + 1];
              b += d[p + 2];
            }
          const l = (r + g + b) / 1200;
          min = Math.min(min, l);
          max = Math.max(max, l);
          cast = Math.max(cast, Math.abs(r - b) / 400);
        }
      return { range: max - min, cast };
    };
  const before = stats(raw),
    after = stats(corrected);
  assert.ok(before.range > 60 && before.cast > 30, JSON.stringify(before));
  assert.ok(after.range < 6, "uniformity " + after.range);
  assert.ok(after.cast < 3, "cast " + after.cast);
});
test("rig background model segments a vignetted, dusty image correctly", () => {
  const withRig = preprocess(specimen, { ...options, rig: rigOption }),
    without = preprocess(specimen, options);
  const a = iou(withRig.mask, truth),
    b = iou(without.mask, truth);
  assert.ok(a > 0.95, "with rig " + a);
  assert.ok(a > b + 0.05, `rig ${a} vs border-mode ${b}`);
  // Dust pixels outside the wing are not part of the mask.
  let dustOutside = 0;
  for (let y = DUST.y - DUST.r; y <= DUST.y + DUST.r; y++)
    for (let x = DUST.x - DUST.r; x <= DUST.x + DUST.r; x++) {
      const p = y * W + x;
      if (Math.hypot(x - DUST.x, y - DUST.y) < DUST.r - 1 && !truth[p] && withRig.mask[p]) dustOutside++;
    }
  assert.ok(dustOutside < 5, "dust pixels in mask: " + dustOutside);
  const m = withRig.metadata;
  assert.equal(m.segmentationMethod, "rig-background-difference-close-fill-largest");
  assert.equal(m.radiometricCorrection.method, "flat-field");
  assert.equal(m.rigDrift.status, "ok");
  assert.equal(m.resampling.rgb, "bilinear from flat-field-corrected decoded RGBA");
});
test("normalized output is flat-field corrected and deterministic", () => {
  const a = preprocess(specimen, { ...options, rig: rigOption }),
    b = preprocess(specimen, { ...options, rig: rigOption });
  assert.deepEqual(a, b);
  // Membrane under corrected light: neutral and uniform, whatever the vignetting.
  const n = a.normalized,
    values = [];
  for (let p = 0; p < n.mask.length; p++)
    if (n.mask[p] && n.mask[p - 3] && n.mask[p + 3] && n.mask[p - 3 * n.width] && n.mask[p + 3 * n.width])
      values.push([n.data[p * 4], n.data[p * 4 + 2]]);
  const reds = values.map((v) => v[0]).sort((x, y) => x - y);
  assert.ok(reds.at(-1) - reds[0] < 50, `membrane spread ${reds[0]}..${reds.at(-1)}`);
  assert.ok(values.every(([r, b]) => Math.abs(r - b) < 18));
});
test("drift from the rig profile forces REVIEW", () => {
  const dim = frame(transmission, 5, { gain: 0.75 }),
    r = preprocess(dim, { ...options, rig: rigOption });
  assert.equal(r.metadata.rigDrift.status, "drift");
  assert.equal(r.metadata.segmentationMethod, "border-mode-RGB-close-fill-largest");
  assert.ok(r.metadata.maskQuality.reasons.includes("Licht/Hintergrund weicht vom Rig-Profil ab"));
  assert.equal(r.metadata.maskQuality.status, "REVIEW");
});
test("images from another resolution are refused, not silently corrected", () => {
  assert.throws(() => preprocess(fixture({ bg: 240 }), { ...options, rig: { ...rigOption, sourceWidth: 400 } }), /passt nicht zum Rig-Profil/);
});
test("metric wing size from the rig scale", () => {
  const r = preprocess(specimen, { ...options, rig: rigOption, originalMetricScale: rig.originalMetricScale }),
    s = r.metadata.metricSize;
  // Fixture wing: 220 px long -> 2.2 mm at 10 µm/px.
  assert.ok(Math.abs(s.wingLengthMm - 2.2) < 0.07, String(s.wingLengthMm));
  let area = 0;
  for (const v of truth) area += v;
  assert.ok(Math.abs(s.wingAreaMm2 - area / 1e4) / (area / 1e4) < 0.05);
  assert.equal(s.reliable, true);
  const scale = metricScaleFromPoints({ x: 10, y: 10 }, { x: 310, y: 10 }, 3);
  assert.equal(scale.micrometersPerPixel, 10);
  assert.throws(() => metricScaleFromPoints({ x: 0, y: 0 }, { x: 2, y: 0 }, 1));
});
test("capture checks: sharpness drops with blur, clipping is detected", () => {
  const sharp = fixture({ bg: 240 }),
    blurred = { ...sharp, data: new Uint8ClampedArray(sharp.data) };
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += sharp.data[((y + k) * W + x + k) * 4 + c];
        blurred.data[(y * W + x) * 4 + c] = s / 5;
      }
  assert.ok(sharpness(blurred) < 0.5 * sharpness(sharp));
  const bright = { ...sharp, data: sharp.data.map((v, i) => (i % 4 === 3 ? 255 : Math.min(255, v * 3))) };
  assert.ok(clippedFraction(bright) > 0.5);
  // Gain 2.8 saturates the wing centre (235 × 2.8 × 0.39 > 255).
  const r = preprocess(frame(transmission, 3, { gain: 2.8 }), options);
  assert.ok(r.metadata.maskQuality.reasons.includes("Überbelichtung im Flügel (Sensor gesättigt)"));
});
test("reflected-light (WIP) profile: grey card removes the colour cast, dark background needs no flat field", () => {
  const card = [1, 2].map((s) => {
      const rnd = mulberry32(s),
        data = new Uint8ClampedArray(W * H * 4);
      for (let p = 0; p < W * H; p++) {
        data.set([200 + rnd() * 2, 170 + rnd() * 2, 130 + rnd() * 2, 255], p * 4);
      }
      return { data, width: W, height: H };
    }),
    black = [3, 4].map((s) => {
      const rnd = mulberry32(s),
        data = new Uint8ClampedArray(W * H * 4);
      for (let p = 0; p < W * H; p++) data.set([6 + rnd() * 3, 6 + rnd() * 3, 7 + rnd() * 3, 255], p * 4);
      return { data, width: W, height: H };
    });
  const wip = buildModalityProfile({ kind: "reflected", background: black, illumination: card });
  assert.equal(wip.illuminationSource, "grey card");
  // Membrane reflecting a neutral 50 % under the tinted light.
  const img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  for (let p = 0; p < W * H; p++) {
    const inside = truth[p];
    img.data.set(inside ? [100, 85, 65, 255] : [7, 7, 8, 255], p * 4);
  }
  const r = preprocess(img, { ...options, rig: { ...wip, id: "w", name: "w" } });
  assert.ok(iou(r.mask, truth) > 0.97);
  let p = r.normalized.mask.findIndex((v, i) => v && r.normalized.mask[i + 5] && r.normalized.mask[i - 5]);
  p += 2;
  const [R, G, B] = r.normalized.data.slice(p * 4, p * 4 + 3);
  assert.ok(Math.abs(R - B) < 4 && Math.abs(R - G) < 4, `${R},${G},${B}`);
  assert.throws(() => buildModalityProfile({ kind: "reflected", background: black, illumination: black }), /zu dunkel/);
});

test("rig profiles survive JSON export with typed arrays intact", () => {
  const back = deserializeRig(serializeRig(rig));
  assert.deepEqual(back, rig);
  assert.ok(back.modalities.venation.background.data instanceof Uint8ClampedArray);
  assert.ok(back.modalities.venation.illumination.data instanceof Float32Array);
  assert.throws(() => deserializeRig('{"version":"x"}'), /Rig-Profil/);
});
