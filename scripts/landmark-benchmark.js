// Leakage-free grouped development benchmark on real Bombus landmarks.
// Evaluates the current training/calibration procedure on identical folds.
// This is a classification-stage benchmark, not an image-pipeline test.
// node scripts/landmark-benchmark.js [--out test-data/landmark-benchmark.json]
import { readFileSync, writeFileSync } from "node:fs";
import { evaluateReferences } from "../classifier/model.js";
import { FEATURE_VERSION } from "../classifier/features.js";

const csvPath = new URL("../test-data/landmarks-original.csv", import.meta.url);
const outArg = process.argv.indexOf("--out");
const outPath = outArg > 0 ? process.argv[outArg + 1] : null;
const rows = readFileSync(csvPath, "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.split(",").map((c) => c.replace(/^"|"$/g, "")));
const records = rows.map(([file, ...coords]) => {
  const values = coords.map(Number),
    config = [];
  for (let i = 0; i < values.length; i += 2) config.push([values[i], values[i + 1]]);
  return {
    file,
    taxon: "Bombus " + file.split("-")[0],
    specimen: file.replace(/-[LR]\.dw\.png$/, ""),
    side: /-L\.dw\.png$/.test(file) ? "L" : "R",
    config,
  };
});
if (records.some((r) => r.config.length !== 19 || r.config.flat().some(Number.isNaN)))
  throw Error("Unerwartetes Landmark-Format");


const refs = records.map((r) => ({
  id: r.file, species: r.taxon, group: r.specimen,
  features: { version: FEATURE_VERSION, landmarkScheme: "bombus-19", blocks: { landmarks: r.config.flat() } },
}));
const started = Date.now(), results = {}, evaluations = {};
for (const [mode, params, title] of [
  ["none", {}, "no reservoir"], ["fly", {}, "FlyHash 2048 KC"],
  ["fly", { kenyonCells: 4096 }, "FlyHash 4096 KC"], ["dense", {}, "dense random projection"],
]) {
  const t = Date.now();
  const evaluation = evaluateReferences(refs, { mode, params, includeLDA: mode === "none", folds: 5 });
  evaluations[title] = evaluation;
  for (const [method, metrics] of Object.entries(evaluation.methods)) {
    const key = method === "lda" ? "Procrustes + PCA + LDA" : `${method.toUpperCase()} · ${title}`;
    results[key] = { ...metrics, ms: Date.now() - t };
    console.log(`${key}: balanced ${(100 * metrics.balancedAccuracy).toFixed(1)}%, evaluated ${metrics.evaluated}`);
  }
}
const summary = {
  version: 3, kind: "animal-level classification-stage benchmark on real landmark coordinates; not an image-pipeline benchmark",
  source: "Molasy & Tofilski, Zenodo 19703357, landmarks-original.csv",
  wings: refs.length, specimens: new Set(refs.map((r) => r.group)).size,
  perTaxon: Object.fromEntries([...new Set(refs.map((r) => r.species))].map((t) => [t, refs.filter((r) => r.species === t).length])),
  protocol: "5-fold stratified grouped CV; distinct-view animal prototypes; GPA, scaling, PCA/LDA and nested temperature fitted within training animals; distance-based split calibration; animal majority outcomes and stratified animal bootstrap intervals; development comparison, no independent final test",
  runtimeMs: Date.now() - started, results, evaluations,
};
if (outPath) {
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log("written", outPath);
}
