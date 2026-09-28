// Radiometric calibration for a fixed smartphone rig (constant focal length,
// background and lighting). A rig profile is built from averaged frames of
// the *empty* rig and provides:
//  - an illumination field for flat-field correction (vignetting, uneven
//    light, colour cast; the corrected background becomes neutral grey),
//  - a per-pixel background model for segmentation (also cancels static dust
//    on glass or diffuser),
//  - temporal noise, used to set segmentation thresholds,
//  - an optional metric scale from a ruler capture.
// Pure functions on ImageData-like objects {data, width, height}.
export const RIG_VERSION = "rig-profile-1";
export const FIELD_MAX_SIDE = 128;

// Streaming mean of identically sized frames, so a camera burst never has to
// be held in memory. Averaging N frames reduces sensor noise by sqrt(N). The
// temporal noise estimate is the median per-pixel standard deviation over a
// fixed pixel sample (luminance, 0–255 scale).
export function createAccumulator(width, height) {
  const sum = new Float64Array(width * height * 4),
    step = Math.max(1, Math.floor((width * height) / 20000)),
    samples = Math.ceil((width * height) / step),
    s1 = new Float64Array(samples),
    s2 = new Float64Array(samples);
  let n = 0;
  return {
    get frames() {
      return n;
    },
    add(frame) {
      if (frame.width !== width || frame.height !== height)
        throw Error("Frames haben unterschiedliche Größe");
      const d = frame.data;
      for (let i = 0; i < sum.length; i++) sum[i] += d[i];
      for (let k = 0, p = 0; p < width * height; p += step, k++) {
        const v = luminance(d, p);
        s1[k] += v;
        s2[k] += v * v;
      }
      n++;
    },
    result() {
      if (!n) throw Error("Keine Frames");
      const data = new Uint8ClampedArray(sum.length);
      for (let i = 0; i < sum.length; i++) data[i] = Math.round(sum[i] / n);
      let temporalNoise = null;
      if (n > 1) {
        const sds = Array.from(s1, (a, k) =>
          Math.sqrt(Math.max(0, s2[k] / n - (a / n) ** 2) * (n / (n - 1))),
        ).sort((a, b) => a - b);
        temporalNoise = sds[Math.floor(sds.length / 2)];
      }
      return { image: { data, width, height }, frames: n, temporalNoise };
    },
  };
}
export function averageFrames(frames) {
  if (!frames.length) throw Error("Keine Frames");
  const acc = createAccumulator(frames[0].width, frames[0].height);
  for (const f of frames) acc.add(f);
  return acc.result();
}
const luminance = (d, p) => 0.2126 * d[p * 4] + 0.7152 * d[p * 4 + 1] + 0.0722 * d[p * 4 + 2];

// Area-averaged float RGB at most `maxSide` pixels on the long side.
export function areaAverage(image, maxSide) {
  const ratio = Math.min(1, maxSide / Math.max(image.width, image.height)),
    w = Math.max(1, Math.round(image.width * ratio)),
    h = Math.max(1, Math.round(image.height * ratio)),
    out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * image.width) / w),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / w)),
        y0 = Math.floor((y * image.height) / h),
        y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / h));
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * image.width + xx) * 4;
          r += image.data[i];
          g += image.data[i + 1];
          b += image.data[i + 2];
          n++;
        }
      out[(y * w + x) * 3] = r / n;
      out[(y * w + x) * 3 + 1] = g / n;
      out[(y * w + x) * 3 + 2] = b / n;
    }
  return { data: out, width: w, height: h };
}
// Separable box blur: illumination varies slowly, dust and texture must not
// be imprinted into the flat field.
function blur(field, radius) {
  const { width: w, height: h } = field;
  let src = field.data;
  for (const horizontal of [true, false]) {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 3; c++) {
          let s = 0,
            n = 0;
          for (let k = -radius; k <= radius; k++) {
            const xx = horizontal ? x + k : x,
              yy = horizontal ? y : y + k;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            s += src[(yy * w + xx) * 3 + c];
            n++;
          }
          dst[(y * w + x) * 3 + c] = s / n;
        }
    src = dst;
  }
  return { ...field, data: src };
}
export function illuminationField(image, { maxSide = FIELD_MAX_SIDE, radius = 2 } = {}) {
  const field = blur(areaAverage(image, maxSide), radius),
    medians = [0, 1, 2].map((c) => {
      const v = [];
      for (let i = c; i < field.data.length; i += 3) v.push(field.data[i]);
      v.sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    });
  if (medians.some((m) => m < 8))
    throw Error("Referenzfläche zu dunkel für eine Flat-Field-Korrektur (für WIP eine Graukarte verwenden)");
  // One common target for all channels: the corrected reference becomes neutral grey.
  const target = medians.reduce((a, b) => a + b, 0) / 3;
  return { ...field, medians, target };
}
// Bilinear lookup at the source pixel centre (x, y) of a srcW × srcH image.
function sampleField(field, x, y, srcW, srcH, c) {
  const fx = Math.min(field.width - 1, Math.max(0, ((x + 0.5) * field.width) / srcW - 0.5)),
    fy = Math.min(field.height - 1, Math.max(0, ((y + 0.5) * field.height) / srcH - 0.5)),
    x0 = Math.floor(fx),
    y0 = Math.floor(fy),
    x1 = Math.min(field.width - 1, x0 + 1),
    y1 = Math.min(field.height - 1, y0 + 1),
    ax = fx - x0,
    ay = fy - y0,
    v = (xx, yy) => field.data[(yy * field.width + xx) * 3 + c];
  return (
    v(x0, y0) * (1 - ax) * (1 - ay) +
    v(x1, y0) * ax * (1 - ay) +
    v(x0, y1) * (1 - ax) * ay +
    v(x1, y1) * ax * ay
  );
}
// out = in × target / field. Deterministic and documented; the original file
// is archived unchanged. Pixels saturated in the input stay saturated.
export function flatFieldCorrect(image, field) {
  const { width: w, height: h, data } = image,
    out = new Uint8ClampedArray(data.length);
  // Row-wise gains are cheap to recompute; cache one row of field samples.
  const gains = new Float32Array(w * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++)
        gains[x * 3 + c] = field.target / Math.max(1, sampleField(field, x, y, w, h, c));
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++)
        out[p + c] = data[p + c] >= 255 ? 255 : data[p + c] * gains[x * 3 + c];
      out[p + 3] = data[p + 3];
    }
  }
  return { data: out, width: w, height: h };
}

// Analysis-resolution RGBA image, identical to pipeline.analysisImage().
export function analysisResample(image, max) {
  const f = areaAverage(image, max),
    data = new Uint8ClampedArray(f.width * f.height * 4);
  for (let p = 0; p < f.width * f.height; p++) {
    for (let c = 0; c < 3; c++) data[p * 4 + c] = f.data[p * 3 + c];
    data[p * 4 + 3] = 255;
  }
  return { data, width: f.width, height: f.height };
}

// kind: "transmitted" (venation: bright empty background = illumination) or
// "reflected" (WIP: dark empty background; illumination only from an optional
// grey-card capture).
// background / illumination: an array of frames or an accumulator result.
const averaged = (x) => (Array.isArray(x) ? (x.length ? averageFrames(x) : null) : (x ?? null));
export function buildModalityProfile({ kind, background, illumination = null, analysisMax = 640 }) {
  const bg = averaged(background),
    card = averaged(illumination);
  if (!bg) throw Error("Kein Hintergrund");
  if (card && (card.image.width !== bg.image.width || card.image.height !== bg.image.height))
    throw Error("Graukarte und Hintergrund haben unterschiedliche Auflösung");
  const field =
    kind === "transmitted" ? illuminationField(bg.image) : card ? illuminationField(card.image) : null;
  const corrected = field ? flatFieldCorrect(bg.image, field) : bg.image,
    backgroundAnalysis = analysisResample(corrected, analysisMax);
  return {
    kind,
    sourceWidth: bg.image.width,
    sourceHeight: bg.image.height,
    analysisMax,
    illumination: field,
    illuminationSource: kind === "transmitted" ? "empty transmitted-light background" : card ? "grey card" : null,
    background: backgroundAnalysis,
    stats: {
      frames: bg.frames,
      temporalNoise: bg.temporalNoise,
      clippedFraction: clippedFraction(bg.image),
      meanRGB: meanRGB(corrected),
    },
  };
}
export function createRigProfile({ name, venation = null, wip = null, originalMetricScale = null, capture = null, id }) {
  if (!name?.trim()) throw Error("Rig braucht einen Namen");
  if (!venation && !wip) throw Error("Mindestens ein Hintergrund (Venation oder WIP) nötig");
  return {
    version: RIG_VERSION,
    id: id ?? crypto.randomUUID(),
    name: name.trim(),
    createdAt: new Date().toISOString(),
    modalities: { venation, wip },
    originalMetricScale,
    capture,
  };
}

function meanRGB(image) {
  const s = [0, 0, 0],
    n = image.width * image.height;
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) s[c] += image.data[p * 4 + c];
  return s.map((v) => v / n);
}
export function clippedFraction(image, mask = null) {
  let clipped = 0,
    n = 0;
  for (let p = 0; p < image.width * image.height; p++) {
    if (mask && !mask[p]) continue;
    n++;
    const d = image.data;
    if (d[p * 4] >= 254 || d[p * 4 + 1] >= 254 || d[p * 4 + 2] >= 254) clipped++;
  }
  return n ? clipped / n : 0;
}
// Focus measure: variance of the Laplacian of luminance (Pech-Pacheco et al.
// 2000), optionally restricted to a mask. Only comparable between images of
// the same rig and resolution.
export function sharpness(image, mask = null) {
  const { width: w, height: h, data } = image;
  let s = 0,
    sq = 0,
    n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (mask && !mask[p]) continue;
      const l =
        luminance(data, p - 1) + luminance(data, p + 1) + luminance(data, p - w) + luminance(data, p + w) - 4 * luminance(data, p);
      s += l;
      sq += l * l;
      n++;
    }
  return n ? sq / n - (s / n) ** 2 : 0;
}
// Compare the image border band with the rig background. A large difference
// means the rig moved, the light changed, or the profile belongs to another setup.
export function driftCheck(image, background, noise = null) {
  if (image.width !== background.width || image.height !== background.height)
    return { status: "mismatch", medianDifference: null };
  const w = image.width,
    h = image.height,
    inset = Math.max(2, Math.round(Math.min(w, h) * 0.025)),
    diffs = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge < inset || edge >= inset + 3) continue;
      const p = (y * w + x) * 4;
      diffs.push(
        Math.hypot(
          image.data[p] - background.data[p],
          image.data[p + 1] - background.data[p + 1],
          image.data[p + 2] - background.data[p + 2],
        ) / Math.sqrt(3),
      );
    }
  diffs.sort((a, b) => a - b);
  const medianDifference = diffs[Math.floor(diffs.length / 2)],
    limit = Math.max(6, 4 * (noise ?? 0));
  return { status: medianDifference > limit ? "drift" : "ok", medianDifference, limit };
}
export function metricScaleFromPoints(a, b, distanceMm) {
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(distanceMm > 0) || px < 10) throw Error("Maßstab: zwei deutlich getrennte Punkte und eine Distanz > 0 angeben");
  return {
    micrometersPerPixel: (distanceMm * 1000) / px,
    source: "rig calibration: two-point ruler",
    points: [a, b],
    distanceMm,
  };
}
