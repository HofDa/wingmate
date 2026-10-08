// Adapter for numeric landmarks only. Source/database terms: ODbL 1.0.
// Source images and their separate content rights are outside this adapter.
import { FEATURE_VERSION } from "../classifier/features.js";

export function canonicalBombusCoordinates(values) {
  if (values.length !== 38 || !values.every(Number.isFinite)) throw Error("Expected 19 finite Bombus landmarks.");
  // Source origin is y-up. Translation (including image height) and uniform
  // scale disappear in Procrustes. Match the UI's base-left/anterior-up view.
  const points = Array.from({ length: 19 }, (_, i) => [values[2 * i], -values[2 * i + 1]]);
  for (const [sx, sy] of [[1, 1], [-1, -1], [-1, 1], [1, -1]]) {
    const p = points.map(([x, y]) => [sx * x, sy * y]);
    if (p[15][0] < p[18][0] && p[6][1] < p[12][1]) return p.flat();
  }
  throw Error("Landmarks do not establish base-left/anterior-up orientation.");
}

export function bombusReferences(csv, preprocessingVersion) {
  const lines = csv.trim().split(/\r?\n/);
  const cells = (line) => line.split(",").map((c) => c.replace(/^"|"$/g, ""));
  const expected = ["file", ...Array.from({ length: 19 }, (_, i) => [`x${i + 1}`, `y${i + 1}`]).flat()];
  if (JSON.stringify(cells(lines.shift())) !== JSON.stringify(expected)) throw Error("Unexpected source CSV columns.");
  const seen = new Set();
  return lines.map((line) => {
    const [file, ...coordinates] = cells(line);
    if (!/^(cryptarum|lucorum|terrestris)-[FM]-.+\.dw\.png$/.test(file) || seen.has(file) || coordinates.some((c) => !c.trim())) throw Error(`Invalid or duplicate source wing identity: ${file}`);
    seen.add(file);
    const specimenId = file.replace(/-[LR]\.dw\.png$/, "");
    return { id: file, group: specimenId, specimenId, species: `Bombus ${file.split("-")[0]}`,
      sex: file.split("-")[1], series: null, preprocessingVersion,
      features: { version: FEATURE_VERSION, landmarkScheme: "bombus-19",
        blocks: { landmarks: canonicalBombusCoordinates(coordinates.map(Number)) } } };
  });
}
