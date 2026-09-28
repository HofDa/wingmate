// Landmark schemes, coordinate handling and Procrustes preparation.
//
// Landmarks are stored in *original image* pixel coordinates (decoded,
// EXIF-oriented, integer pixel centres) so they survive any change of the
// normalization (flip, mirror, threshold, registration). The editor works on
// the normalized view and converts with the stored transform matrices.
import { apply } from "../imaging/matrix.js";
import { gpa } from "./morphometrics.js";

// Default scheme: the 19 forewing landmarks of the Molasy & Tofilski Bombus
// dataset (Zenodo 19703357, same numbering as test-data/landmarks-original.csv;
// IdentiFly/DrawWing convention). The guide is the Procrustes mean of all 814
// wings of that dataset, rotated to the app standard (base left, anterior up)
// and scaled to unit length – a placement aid, not an anatomical definition.
// Its CSV uses a y-up origin; see csvToImage().
export const SCHEMES = Object.freeze({
  "bombus-19": {
    id: "bombus-19",
    name: "19 Landmarken (Bombus, Molasy & Tofilski / IdentiFly-Nummerierung)",
    count: 19,
    guide: [
      [0.7787, 0.2582], [0.7479, 0.2609], [0.7688, 0.1178], [0.626, 0.1928], [0.6108, 0.3455],
      [0.666, 0.1116], [0.5347, 0.0056], [0.5719, 0.076], [0.4459, 0.0904], [0.4915, 0.1633],
      [0.3298, 0.2088], [0.3201, 0.3024], [0.2871, 0.3622], [0.3783, 0], [0.3404, 0.0369],
      [0.0311, 0.1022], [0.0313, 0.1275], [0, 0.1877], [1, 0.1022],
    ],
    source: "Molasy & Tofilski, Zenodo 19703357; mean of 814 wings",
    note: "Für Bombus/Apis-artige Aderung. Andere Gattungen (z. B. 2 statt 3 Submarginalzellen) brauchen ein eigenes Schema.",
  },
});
export const DEFAULT_SCHEME = "bombus-19";
export function scheme(id) {
  const s = SCHEMES[id];
  if (!s) throw Error("Unbekanntes Landmark-Schema: " + id);
  return s;
}

export function emptyLandmarks(schemeId = DEFAULT_SCHEME) {
  return { scheme: schemeId, points: Array(scheme(schemeId).count).fill(undefined) };
}
// points[i]: {x, y} in original pixels, null = explicitly missing (damaged
// wing), undefined = not yet placed.
export const placed = (lm) => lm.points.filter((p) => p).length;
export const isComplete = (lm) => lm.points.every((p) => p);
export const isResolved = (lm) => lm.points.every((p) => p !== undefined);
export const nextOpen = (lm, from = 0) => {
  const n = lm.points.length;
  for (let k = 0; k < n; k++) if (lm.points[(from + k) % n] === undefined) return (from + k) % n;
  return -1;
};
export const toNormalized = (lm, metadata) =>
  lm.points.map((p) => (p ? apply(metadata.transformMatrix, p.x, p.y) : p));
export const toOriginal = (point, metadata) => apply(metadata.inverseTransformMatrix, point.x, point.y);

// The dataset CSV has its origin at the bottom-left (y up); images are y-down.
export const csvToImage = (x, y, height) => ({ x, y: height - 1 - y });

// Feature block: flattened coordinates of a complete set in the confirmed
// standard view (base left, anterior up). Original pixels would not do: a
// left and a right wing are mirror images there, and Procrustes removes
// rotation, translation and scale but never reflection. Alignment happens at
// comparison time (alignLandmarkBlocks).
export function landmarkBlock(lm, metadata) {
  if (!lm || !isComplete(lm) || !metadata?.standardConfirmed) return null;
  return toNormalized(lm, metadata).flatMap((p) => [p.x, p.y]);
}
const configOf = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};
// Generalized Procrustes over all given feature records (label-free, so the
// query may be included). Returns a Map record -> aligned flat coordinates.
export function alignLandmarkBlocks(records) {
  const aligned = gpa(records.map((r) => configOf(r.blocks.landmarks))).flat,
    map = new Map();
  records.forEach((r, i) => map.set(r, aligned[i]));
  return map;
}

// IdentiFly/DrawWing-like CSV: file,x1,y1,...,xN,yN (original pixels, y-down;
// set yUp to write the dataset's bottom-left convention). Missing points are empty.
export function landmarksCsv(rows, { yUp = false } = {}) {
  const n = Math.max(...rows.map((r) => r.landmarks.points.length));
  const header = ["file", ...Array.from({ length: n }, (_, i) => [`x${i + 1}`, `y${i + 1}`]).flat()];
  const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = rows.map(({ file, landmarks, height }) =>
    [
      quote(file),
      ...landmarks.points.flatMap((p) =>
        p ? [p.x.toFixed(2), (yUp ? height - 1 - p.y : p.y).toFixed(2)] : ["", ""],
      ),
    ].join(","),
  );
  return [header.map(quote).join(","), ...lines].join("\n") + "\n";
}
