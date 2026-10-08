import { segment } from "./segmentation.js";
import { quality } from "./quality.js";
import { orientation } from "./orientation.js";
import { normalization, resample, interiorMask } from "./normalization.js";
import { inverse } from "./matrix.js";
import { flatFieldCorrect, driftCheck, sharpness, clippedFraction } from "./rig.js";
export const VERSION = "wing-normalizer-0.3";
export const DEFAULTS = Object.freeze({
  analysisMax: 640,
  width: 1024,
  height: 512,
  margin: 32,
  threshold: null,
  closeRadius: null,
});
// Deterministic area averaging for segmentation only; RGB output uses original pixels.
export function analysisImage(image, max = 640) {
  const ratio = Math.min(1, max / Math.max(image.width, image.height)),
    w = Math.max(1, Math.round(image.width * ratio)),
    h = Math.max(1, Math.round(image.height * ratio)),
    data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * image.width) / w),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / w)),
        y0 = Math.floor((y * image.height) / h),
        y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / h));
      for (let c = 0; c < 4; c++) {
        let s = 0,
          n = 0;
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++) {
            s += image.data[(yy * image.width + xx) * 4 + c];
            n++;
          }
        data[(y * w + x) * 4 + c] = s / n;
      }
    }
  return { data, width: w, height: h };
}
// options.rig: one modality of a rig profile ({sourceWidth, sourceHeight,
// analysisMax, illumination, background, stats, id, name}). When given, the
// image is flat-field corrected before analysis *and* before resampling, and
// segmentation uses the per-pixel background model.
export function preprocess(image, options = {}, { keepSource = false } = {}) {
  const parameters = { ...DEFAULTS, ...options.parameters },
    rig = options.rig ?? null;
  if (rig) {
    if (image.width !== rig.sourceWidth || image.height !== rig.sourceHeight)
      throw Error(
        `Bildgröße ${image.width}×${image.height} passt nicht zum Rig-Profil (${rig.sourceWidth}×${rig.sourceHeight}). Andere Auflösung, Zoom oder Kamera?`,
      );
    if (rig.analysisMax !== parameters.analysisMax)
      throw Error("Rig-Profil wurde mit anderer Analyseauflösung erstellt");
  }
  const source = rig?.illumination ? flatFieldCorrect(image, rig.illumination) : image,
    small = analysisImage(source, parameters.analysisMax),
    raw = source === image ? small : analysisImage(image, parameters.analysisMax),
    { width: w, height: h } = small;
  // A drifted rig (light changed, rig moved) invalidates the per-pixel model;
  // fall back to border-mode segmentation instead of failing, and force REVIEW.
  const drift = rig ? driftCheck(small, rig.background, rig.stats?.temporalNoise) : null,
    useModel = rig && drift.status === "ok";
  const segmentation = segment(
    small,
    useModel ? { ...parameters, backgroundImage: rig.background } : parameters,
  );
  if (options.manualMask) {
    if (options.manualMask.length !== w * h)
      throw Error("Manuelle Maske hat falsche Größe");
    segmentation.mask = Uint8Array.from(options.manualMask, (v) => (v ? 1 : 0));
    segmentation.plausibleComponentFound = true;
    segmentation.componentAreas = [
      segmentation.mask.reduce((a, b) => a + b, 0),
    ];
  }
  const mask = segmentation.mask,
    q = quality(mask, w, h, segmentation),
    o = orientation(mask, w, h);
  const review = (reason) => {
    q.reasons.push(reason);
    q.status = "REVIEW";
    q.maskConfidence = "low";
  };
  if (o.elongation < 3) review("Keine ausgeprägte Längsachse");
  // Clipping is judged on the uncorrected pixels: saturated sensor values are
  // lost information, whereas flat-field gain may legitimately reach 255.
  const captureQuality = {
    clippedFractionInWing: clippedFraction(raw, mask),
    sharpnessInWing: sharpness(small, interiorMask(mask, w, h)),
    sharpnessMeaning: "Laplacian variance in eroded wing interior at analysis resolution; not proof of vein detail",
  };
  if (captureQuality.clippedFractionInWing > 0.005) review("Überbelichtung im Flügel (Sensor gesättigt)");
  if (captureQuality.sharpnessInWing < 1e-6) review("Kein messbares Bilddetail im Flügelinneren – Adern/WIP prüfen");
  if (rig && !useModel) review("Licht/Hintergrund weicht vom Rig-Profil ab");
  const metricScale = options.originalMetricScale ?? null,
    umpp = metricScale?.micrometersPerPixel,
    pixelScale = Math.sqrt((image.width / w) * (image.height / h)),
    metricSize = umpp
      ? {
          wingLengthMm: (o.axisLength * pixelScale * umpp) / 1000,
          wingAreaMm2: ((q.wingArea * pixelScale ** 2) * umpp ** 2) / 1e6,
          reliable: !q.edgeContact,
          note: "Masken-Längsachse und -Fläche; bei Randkontakt oder abgeschnittener Basis unterschätzt",
        }
      : null;
  const norm = normalization(mask, w, h, o, {
    ...parameters,
    pixelScaleX: image.width / w,
    pixelScaleY: image.height / h,
    flipped180: !!options.flipped180,
    mirrored: !!options.mirrored,
  });
  // Original pixel centers -> analysis pixel centers, including half-pixel offset.
  const sx = w / image.width,
    sy = h / image.height,
    toAnalysis = [sx, 0, (sx - 1) / 2, 0, sy, (sy - 1) / 2, 0, 0, 1],
    matrix = norm.matrix;
  const fromAnalysis = inverse(toAnalysis),
    originalPoint = (p) => ({
      x: fromAnalysis[0] * p.x + fromAnalysis[2],
      y: fromAnalysis[4] * p.y + fromAnalysis[5],
    });
  const metadata = {
    version: VERSION,
    preprocessingVersion: VERSION,
    segmentationMethod: options.manualMask
      ? "manual-mask"
      : useModel
        ? "rig-background-difference-close-fill-largest"
        : "border-mode-RGB-close-fill-largest",
    radiometricCorrection: rig
      ? {
          method: rig.illumination ? "flat-field" : "none",
          illuminationSource: rig.illuminationSource ?? null,
          rigProfileId: rig.id ?? null,
          rigName: rig.name ?? null,
          channelTargets: rig.illumination?.target ?? null,
          note: "out = in × target / illumination(x,y,c); original file archived unchanged",
        }
      : null,
    rigDrift: drift,
    captureQuality,
    metricSize,
    capture: options.capture ?? null,
    maskQuality: q,
    orientationConfidence: o.orientationConfidence,
    originalWidth: image.width,
    originalHeight: image.height,
    normalizedWidth: norm.width,
    normalizedHeight: norm.height,
    rotationDeg: norm.rotationDeg,
    mirrored: !!options.mirrored,
    flipped180: !!options.flipped180,
    autoFlipped180: o.autoFlipped180,
    scale: Math.sqrt(Math.abs(matrix[0] * matrix[4] - matrix[1] * matrix[3])),
    translationX: matrix[2],
    translationY: matrix[5],
    transformMatrix: matrix,
    inverseTransformMatrix: inverse(matrix),
    originalSide: options.originalSide ?? "unknown",
    normalizedSide: options.standardConfirmed ? "right" : "unconfirmed",
    standard: "base-left; tip-right; anterior-up; posterior-down",
    standardConfirmed: !!options.standardConfirmed,
    coordinateSpace: "shape-normalized-pixels",
    sourceCoordinateConvention:
      "decoded image; EXIF orientation applied; integer pixel centers",
    resampling: {
      rgb: rig?.illumination
        ? "bilinear from flat-field-corrected decoded RGBA"
        : "bilinear from original decoded RGBA",
      mask: "nearest-neighbor",
      colorEnhancement: "none",
    },
    originalMetricScale: options.originalMetricScale ?? null,
    centroid: originalPoint(o.centroid),
    baseCandidate: originalPoint(o.base),
    tipCandidate: originalPoint(o.tip),
    parameters: {
      ...parameters,
      fixedAlgorithmParameters: {
        borderBinWidth: 16,
        borderInsetFraction: 0.025,
        borderBandWidth: 3,
        minThreshold: 9,
        noiseMultiplier: 3,
        noiseOffset: 5,
        connectivity: 4,
        pcaWidthBins: 40,
        baseWidthBins: [3, 13],
        tipWidthBins: [27, 37],
        directionScoreThreshold: 0.2,
        qualityAreaRange: [0.025, 0.8],
        fragmentationThreshold: 0.12,
      },
      backgroundRGB: segmentation.background,
      backgroundModel: segmentation.backgroundModel,
      effectiveThreshold: segmentation.threshold,
      effectiveCloseRadius: segmentation.closeRadius,
    },
    analysisWidth: w,
    analysisHeight: h,
    qualityCoordinateSpace: "analysis-pixels",
    wingAreaOriginalPixels: q.wingArea / (sx * sy),
    manualMask: !!options.manualMask,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
  const result = {
    metadata,
    mask,
    analysis: small,
    orientation: o,
    normalized: resample(source, mask, w, h, matrix, norm.width, norm.height),
  };
  // The worker needs the corrected source for re-resampling after
  // registration; it is not returned by default (full-resolution copy).
  if (keepSource) result.source = source;
  return result;
}
