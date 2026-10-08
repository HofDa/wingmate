// Mask-aware wing descriptors computed on the normalized 1024 × 512 canvas
// (base left, tip right, anterior up). Only pixels inside the wing mask
// contribute; background and the contour edge never enter venation or WIP
// statistics. All blocks are deterministic and interpretable.
export const FEATURE_VERSION = "wing-features-2";
const GRID_X = 8,
  GRID_Y = 4,
  ORIENTATION_BINS = 8,
  PROFILE_BINS = 32,
  HUE_BINS = 12,
  CHROMA_BINS = 4;

// Area-average the normalized image by `factor`; coverage = fraction of
// source pixels inside the mask. Colour is averaged over masked pixels only.
export function downsample({ data, mask, signalMask = mask, width, height }, factor = 4) {
  const w = Math.floor(width / factor),
    h = Math.floor(height / factor),
    rgb = new Float32Array(w * h * 3),
    coverage = new Float32Array(w * h),
    signalCoverage = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0,
        n = 0,
        maskCount = 0;
      for (let yy = y * factor; yy < (y + 1) * factor; yy++)
        for (let xx = x * factor; xx < (x + 1) * factor; xx++) {
          const p = yy * width + xx;
          if (mask[p]) maskCount++;
          if (!signalMask[p]) continue;
          r += data[p * 4];
          g += data[p * 4 + 1];
          b += data[p * 4 + 2];
          n++;
        }
      const q = y * w + x;
      coverage[q] = maskCount / (factor * factor);
      signalCoverage[q] = n / (factor * factor);
      if (n) {
        rgb[q * 3] = r / n;
        rgb[q * 3 + 1] = g / n;
        rgb[q * 3 + 2] = b / n;
      }
    }
  return { rgb, coverage, signalCoverage, width: w, height: h };
}

const srgbToLinear = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
// sRGB (D65) -> CIELAB. Browser decoding is not colour-calibrated; Lab only
// makes distances more perceptual, it does not make colours absolute.
export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r),
    G = srgbToLinear(g),
    B = srgbToLinear(b);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047),
    y = f(0.2126 * R + 0.7152 * G + 0.0722 * B),
    z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const cellOf = (x, y, w, h) =>
  Math.min(GRID_Y - 1, Math.floor((y * GRID_Y) / h)) * GRID_X +
  Math.min(GRID_X - 1, Math.floor((x * GRID_X) / w));

// Outline: upper and lower mask extent per x-bin (fraction of canvas height)
// plus bounding-box occupancy. Scale is already removed by normalization.
export function shapeFeatures(small) {
  const { coverage, width: w, height: h } = small,
    top = new Float32Array(PROFILE_BINS).fill(0.5),
    bottom = new Float32Array(PROFILE_BINS).fill(0.5);
  let area = 0,
    minX = w,
    maxX = -1,
    minY = h,
    maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (coverage[y * w + x] >= 0.5) {
        area++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  if (!area) throw Error("Leere Flügelmaske – keine Formmerkmale");
  const seen = new Uint8Array(PROFILE_BINS);
  for (let y = 0; y < h; y++)
    for (let x = minX; x <= maxX; x++)
      if (coverage[y * w + x] >= 0.5) {
        const b = Math.min(
          PROFILE_BINS - 1,
          Math.floor(((x - minX) * PROFILE_BINS) / (maxX - minX + 1)),
        );
        if (!seen[b]) {
          top[b] = bottom[b] = y / h;
          seen[b] = 1;
        }
        top[b] = Math.min(top[b], y / h);
        bottom[b] = Math.max(bottom[b], (y + 1) / h);
      }
  const out = [...top, ...bottom];
  out.push(area / ((maxX - minX + 1) * (maxY - minY + 1)));
  out.push((maxY - minY + 1) / (maxX - minX + 1));
  return Float32Array.from(out); // 2 * 32 + 2 = 66
}

// Venation (transmitted light): HOG-like unsigned gradient orientation
// histograms per cell plus mean relative darkness per cell. Luminance is
// z-scored over wing pixels, so global exposure does not matter. Gradients are
// only taken where the full 3 × 3 neighbourhood is inside the wing, which
// excludes the silhouette edge.
export function venationFeatures(small) {
  const { rgb, width: w, height: h } = small,
    coverage = small.signalCoverage ?? small.coverage,
    gray = new Float32Array(w * h);
  let sum = 0,
    sq = 0,
    n = 0;
  for (let p = 0; p < w * h; p++)
    if (coverage[p] >= 0.99) {
      const v = 0.2126 * rgb[p * 3] + 0.7152 * rgb[p * 3 + 1] + 0.0722 * rgb[p * 3 + 2];
      gray[p] = v;
      sum += v;
      sq += v * v;
      n++;
    }
  if (n < 50) throw Error("Zu wenig Flügelinneres für Adermerkmale");
  const mean = sum / n,
    sd = Math.sqrt(Math.max(1e-6, sq / n - mean * mean));
  // Do not amplify a uniform membrane/quantisation noise into apparent veins.
  if (sd < 1) return new Float32Array(GRID_X * GRID_Y * (ORIENTATION_BINS + 1));
  const hist = new Float32Array(GRID_X * GRID_Y * ORIENTATION_BINS),
    dark = new Float32Array(GRID_X * GRID_Y),
    count = new Float32Array(GRID_X * GRID_Y);
  const inside = (x, y) => coverage[y * w + x] >= 0.99;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (!inside(x, y)) continue;
      const c = cellOf(x, y, w, h);
      dark[c] += -(gray[y * w + x] - mean) / sd;
      count[c]++;
      if (
        !inside(x - 1, y) ||
        !inside(x + 1, y) ||
        !inside(x, y - 1) ||
        !inside(x, y + 1)
      )
        continue;
      const gx = (gray[y * w + x + 1] - gray[y * w + x - 1]) / sd,
        gy = (gray[(y + 1) * w + x] - gray[(y - 1) * w + x]) / sd,
        mag = Math.hypot(gx, gy);
      if (!mag) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      const bin = Math.min(
        ORIENTATION_BINS - 1,
        Math.floor((angle / Math.PI) * ORIENTATION_BINS),
      );
      hist[c * ORIENTATION_BINS + bin] += mag;
    }
  for (let c = 0; c < GRID_X * GRID_Y; c++) {
    const k = count[c] || 1;
    dark[c] /= k;
    for (let b = 0; b < ORIENTATION_BINS; b++) hist[c * ORIENTATION_BINS + b] /= k;
  }
  return Float32Array.from([...hist, ...dark]); // 256 + 32 = 288
}

// WIP (reflected light): mean CIELAB per cell plus a chroma-weighted hue
// histogram and chroma distribution over the whole membrane. No white balance
// is applied – colour is the signal, so capture conditions must be fixed.
export function wipFeatures(small) {
  const { rgb, width: w, height: h } = small,
    coverage = small.signalCoverage ?? small.coverage,
    cells = new Float32Array(GRID_X * GRID_Y * 3),
    count = new Float32Array(GRID_X * GRID_Y),
    hue = new Float32Array(HUE_BINS),
    chroma = new Float32Array(CHROMA_BINS);
  let n = 0,
    chromaTotal = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (coverage[p] < 0.99) continue;
      const [L, a, b] = rgbToLab(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]),
        c = cellOf(x, y, w, h),
        C = Math.hypot(a, b);
      cells[c * 3] += L;
      cells[c * 3 + 1] += a;
      cells[c * 3 + 2] += b;
      count[c]++;
      let angle = Math.atan2(b, a);
      if (angle < 0) angle += 2 * Math.PI;
      hue[Math.min(HUE_BINS - 1, Math.floor((angle / (2 * Math.PI)) * HUE_BINS))] += C;
      chroma[Math.min(CHROMA_BINS - 1, Math.floor(C / 20))]++;
      chromaTotal += C;
      n++;
    }
  if (n < 50) throw Error("Zu wenig Flügelinneres für WIP-Merkmale");
  for (let c = 0; c < GRID_X * GRID_Y; c++)
    for (let k = 0; k < 3; k++) cells[c * 3 + k] /= count[c] || 1;
  for (let i = 0; i < HUE_BINS; i++) hue[i] /= chromaTotal || 1;
  for (let i = 0; i < CHROMA_BINS; i++) chroma[i] /= n;
  return Float32Array.from([...cells, ...hue, ...chroma]); // 96 + 12 + 4 = 112
}

// Returns plain arrays so records are JSON-serialisable. `shape` prefers the
// venation mask (transmitted light gives the cleanest silhouette). `size`
// (log wing length and area in mm) needs a calibrated rig scale and a wing
// that does not touch the image border; normalization removes scale otherwise.
export function extractFeatures({ venation, wip }, { metricSize = null } = {}) {
  if (!venation && !wip) throw Error("Kein normalisiertes Flügelbild");
  const blocks = {},
    v = venation && downsample(venation),
    c = wip && downsample(wip);
  blocks.shape = Array.from(shapeFeatures(v || c));
  if (v) blocks.venation = Array.from(venationFeatures(v));
  if (c) blocks.wip = Array.from(wipFeatures(c));
  if (metricSize?.reliable && metricSize.wingLengthMm > 0 && metricSize.wingAreaMm2 > 0)
    blocks.size = [Math.log(metricSize.wingLengthMm), Math.log(metricSize.wingAreaMm2)];
  return { version: FEATURE_VERSION, blocks };
}
