// Real-data benchmark of the classification stage on the Molasy & Tofilski
// Bombus landmark table (test-data/landmarks-original.csv, 19 landmarks).
// Compares the geometric-morphometrics standard (Procrustes + LDA) with the
// similarity-graph methods, with and without reservoirs, under grouped
// leave-one-out (both wings of a specimen are held out together).
//
//   node scripts/landmark-benchmark.js [--out test-data/landmark-benchmark.json]
import { readFileSync, writeFileSync } from "node:fs";
import { gpa, fitLDA } from "../classifier/morphometrics.js";
import { fitStandardizer, makeEmbedder } from "../classifier/embedding.js";
import {
  similarityContext,
  leaveOneOut,
  summarize,
  groupMask,
  conformalEvaluation,
} from "../classifier/classify.js";

const csvPath = new URL("../test-data/landmarks-original.csv", import.meta.url),
  outArg = process.argv.indexOf("--out"),
  outPath = outArg > 0 ? process.argv[outArg + 1] : null;

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

const aligned = gpa(records.map((r) => r.config));
records.forEach((r, i) => (r.blocks = { shape: aligned.flat[i] }));
const labels = records.map((r) => r.taxon),
  groups = records.map((r) => r.specimen);

const started = Date.now(),
  results = {};
function time(name, fn) {
  const t = Date.now(),
    r = fn();
  results[name] = { ...r, ms: Date.now() - t };
  const pct = (v) => (v === null ? "—" : (100 * v).toFixed(1).padStart(5) + " %");
  console.log(
    name.padEnd(34),
    "acc",
    pct(r.accuracy),
    " balanced",
    pct(r.balancedAccuracy),
  );
}

time("Procrustes + LDA (shrinkage 0.1)", () => {
  const predictions = records.map((_, i) => {
    const excluded = groupMask(groups, groups[i]),
      X = [],
      y = [];
    records.forEach((r, j) => {
      if (!excluded[j]) {
        X.push(r.blocks.shape);
        y.push(labels[j]);
      }
    });
    return fitLDA(X, y).predict(records[i].blocks.shape);
  });
  return summarize(labels, predictions);
});

// Standardisation is unsupervised (no labels); fitted once on all wings.
const standardizer = fitStandardizer(records, ["shape"]),
  standardized = records.map((r) => standardizer.transform(r));
const contexts = {};
for (const [mode, params] of [
  ["none", {}],
  ["fly", {}],
  ["fly", { kenyonCells: 4096 }],
  ["dense", {}],
]) {
  const embed = makeEmbedder(mode, standardizer.dim, params),
    key = mode + (params.kenyonCells ? "-" + params.kenyonCells : ""),
    ctx = similarityContext(standardized.map(embed));
  contexts[key] = ctx;
  const title = {
    none: "no reservoir",
    fly: "FlyHash 2048 KC",
    "fly-4096": "FlyHash 4096 KC",
    dense: "dense random proj. (control)",
  }[key];
  time(`kNN · ${title}`, () => leaveOneOut(ctx, labels, groups, "knn"));
  time(`RWR · ${title}`, () => leaveOneOut(ctx, labels, groups, "rwr"));
  if (key === "none")
    time("RWR · no reservoir, unbalanced", () =>
      leaveOneOut(ctx, labels, groups, "rwr", { balanced: false }),
    );
}

const conformal = {};
for (const key of ["none", "fly"]) {
  conformal[key] = conformalEvaluation(contexts[key], labels, groups);
  const c = conformal[key];
  console.log(
    `conformal ${key.padEnd(5)} ε=${c.epsilon}: coverage ${(100 * c.coverage).toFixed(1)} %,`,
    `false unknown ${(100 * c.falseUnknownRate).toFixed(1)} %, mean set ${c.meanSetSize.toFixed(2)};`,
    "novel flagged:",
    Object.entries(c.novelTaxon)
      .map(([t, v]) => `${t} ${(100 * v.flaggedUnknown).toFixed(0)} %`)
      .join(", "),
  );
}

const summary = {
  kind: "classification-stage benchmark on real landmark coordinates; not an image-pipeline benchmark",
  source: "Molasy & Tofilski, Zenodo 19703357, landmarks-original.csv (unmodified)",
  wings: records.length,
  specimens: new Set(groups).size,
  perTaxon: Object.fromEntries(
    [...new Set(labels)].sort().map((t) => [t, labels.filter((l) => l === t).length]),
  ),
  protocol:
    "grouped leave-one-out by specimen; GPA and z-scoring fitted without labels on all wings; LDA refitted per fold with equal priors",
  runtimeMs: Date.now() - started,
  results,
  conformal,
};
if (outPath) {
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log("written", outPath);
}
