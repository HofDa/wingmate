// Real-data benchmark of the classification stage on the Molasy & Tofilski
// Bombus landmark table (test-data/landmarks-original.csv, 19 landmarks).
// Compares the geometric-morphometrics standard (Procrustes + LDA) with the
// similarity-graph methods, with and without reservoirs, under grouped
// leave-one-out (both wings of a specimen are held out together).
//
//   node scripts/landmark-benchmark.js [--out test-data/landmark-benchmark.json]
import { readFileSync, writeFileSync } from "node:fs";
import { gpa, fitLDA, fitShapeLDA, fitCalibratedShapeLDA } from "../classifier/morphometrics.js";
import { fitStandardizer, makeEmbedder, mulberry32 } from "../classifier/embedding.js";
import {
  similarityContext,
  leaveOneOut,
  summarize,
  groupMask,
  conformalEvaluation,
  rwrScores,
  knnScores,
  argmax,
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

const ldaLOO = (shrinkage) => () => {
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
    return fitLDA(X, y, { shrinkage }).predict(records[i].blocks.shape);
  });
  return summarize(labels, predictions);
};
time("Procrustes + LDA (Ledoit–Wolf shrinkage)", ldaLOO("auto"));
time("Procrustes + LDA (shrinkage 0.1)", ldaLOO(0.1));
time("Procrustes + PCA + LDA (app default)", () =>
  summarize(
    labels,
    records.map((_, i) => {
      const keep = records.map((_, j) => j).filter((j) => groups[j] !== groups[i]);
      return fitShapeLDA(keep.map((j) => records[j].blocks.shape), keep.map((j) => labels[j])).predict(records[i].blocks.shape);
    }),
  ),
);

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

// Small reference sets, as in a first own dataset: 10 specimens per taxon as
// references (all their wings), every other wing is a query. 20 seeded draws.
const smallReference = {};
{
  const perTaxon = 10,
    draws = 20,
    rnd = mulberry32(2026),
    specimensOf = {};
  records.forEach((r) => ((specimensOf[r.taxon] ??= new Set()).add(r.specimen)));
  const methods = {
    "Procrustes + LDA (Ledoit–Wolf)": [],
    "Procrustes + LDA (shrinkage 0.1)": [],
    "Procrustes + PCA + LDA (app default)": [],
    "RWR · no reservoir": [],
    "kNN · no reservoir": [],
  };
  const ctx = contexts.none;
  for (let d = 0; d < draws; d++) {
    const chosen = new Set();
    for (const list of Object.values(specimensOf)) {
      const ids = [...list];
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      ids.slice(0, perTaxon).forEach((id) => chosen.add(id));
    }
    const isRef = groups.map((g) => chosen.has(g)),
      excluded = Uint8Array.from(isRef, (v) => (v ? 0 : 1)),
      X = records.filter((_, i) => isRef[i]).map((r) => r.blocks.shape),
      y = labels.filter((_, i) => isRef[i]),
      lda = { auto: fitLDA(X, y), fixed: fitLDA(X, y, { shrinkage: 0.1 }), pca: fitShapeLDA(X, y) },
      preds = { lda: [], fixed: [], pca: [], rwr: [], knn: [] };
    records.forEach((r, i) => {
      if (isRef[i]) {
        for (const k of Object.keys(preds)) preds[k].push(null);
        return;
      }
      const qs = ctx.sims.subarray(i * ctx.n, (i + 1) * ctx.n);
      preds.lda.push(lda.auto.predict(r.blocks.shape));
      preds.fixed.push(lda.fixed.predict(r.blocks.shape));
      preds.pca.push(lda.pca.predict(r.blocks.shape));
      preds.rwr.push(argmax(rwrScores(ctx, labels, qs, excluded)));
      preds.knn.push(argmax(knnScores(ctx, labels, qs, excluded)));
    });
    methods["Procrustes + LDA (Ledoit–Wolf)"].push(summarize(labels, preds.lda).balancedAccuracy);
    methods["Procrustes + LDA (shrinkage 0.1)"].push(summarize(labels, preds.fixed).balancedAccuracy);
    methods["Procrustes + PCA + LDA (app default)"].push(summarize(labels, preds.pca).balancedAccuracy);
    methods["RWR · no reservoir"].push(summarize(labels, preds.rwr).balancedAccuracy);
    methods["kNN · no reservoir"].push(summarize(labels, preds.knn).balancedAccuracy);
  }
  for (const [name, values] of Object.entries(methods)) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length,
      sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
    smallReference[name] = { meanBalancedAccuracy: mean, sd, draws };
    console.log(`10 specimens/taxon · ${name.padEnd(32)} balanced ${(100 * mean).toFixed(1)} % ± ${(100 * sd).toFixed(1)}`);
  }
}

// Probability calibration: does "p %" mean "right in p % of cases"? Mean top
// posterior vs. balanced accuracy on held-out wings, 3/5/10 specimens per taxon.
const calibration = {};
for (const perTaxon of [3, 5, 10]) {
  const rnd = mulberry32(7),
    specimensOf = {},
    acc = { "LDA, uncalibrated": [0, 0, 0, 0], "PCA + LDA, temperature-calibrated (app)": [0, 0, 0, 0] };
  records.forEach((r) => ((specimensOf[r.taxon] ??= new Set()).add(r.specimen)));
  for (let d = 0; d < 20; d++) {
    const chosen = new Set();
    for (const list of Object.values(specimensOf)) {
      const ids = [...list];
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      ids.slice(0, perTaxon).forEach((id) => chosen.add(id));
    }
    const train = records.map((_, i) => i).filter((i) => chosen.has(groups[i])),
      test = records.map((_, i) => i).filter((i) => !chosen.has(groups[i])),
      X = train.map((i) => records[i].blocks.shape),
      y = train.map((i) => labels[i]),
      models = {
        "LDA, uncalibrated": fitLDA(X, y),
        "PCA + LDA, temperature-calibrated (app)": fitCalibratedShapeLDA(X, y, train.map((i) => groups[i])),
      },
      count = {};
    test.forEach((i) => (count[labels[i]] = (count[labels[i]] || 0) + 1));
    for (const [name, m] of Object.entries(models))
      for (const i of test) {
        const p = m.predictProba(records[i].blocks.shape),
          [top, pt] = Object.entries(p).sort((a, b) => b[1] - a[1])[0],
          w = 1 / count[labels[i]],
          a = acc[name];
        a[0] += w * pt;
        a[1] += w * (top === labels[i]);
        a[2] += w * Object.entries(p).reduce((s, [t, v]) => s + (v - (t === labels[i])) ** 2, 0);
        a[3] += w;
      }
  }
  calibration[perTaxon] = Object.fromEntries(
    Object.entries(acc).map(([name, [p, hit, brier, n]]) => [name, { meanTopProbability: p / n, balancedAccuracy: hit / n, brier: brier / n }]),
  );
  for (const [name, v] of Object.entries(calibration[perTaxon]))
    console.log(
      `calibration ${perTaxon}/taxon · ${name.padEnd(40)} stated ${(100 * v.meanTopProbability).toFixed(1)} %  correct ${(100 * v.balancedAccuracy).toFixed(1)} %  Brier ${v.brier.toFixed(3)}`,
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
  smallReference,
  calibration,
  conformal,
};
if (outPath) {
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log("written", outPath);
}
