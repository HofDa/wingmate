// Read-only diagnostic probes for docs/pipeline-audit.md.
// These report observed behaviour, not bee-identification accuracy or test passes.
// Run from any directory: node /path/to/wingmate/scripts/audit-pipeline.mjs
import { trainModel, loadModel, stratifiedGroupFolds, calibrationSplit } from "../classifier/model.js";
import { fitStandardizer, makeEmbedder, commonBlocks, mulberry32 } from "../classifier/embedding.js";
import {
  similarityContext, querySimilarities, calibrate, conformalPredict,
  rwrScores, knnScores, argmax, summarize,
} from "../classifier/classify.js";
import { fixture } from "../tests/fixtures.js";
import { preprocess } from "../imaging/pipeline.js";
import { extractFeatures } from "../classifier/features.js";
import { register } from "../imaging/registration.js";
import { animalReferences } from "../classifier/specimens.js";

const result = {};

// Independent animals stay fixed; only the number of identical wing records changes.
result.conformalByWings = [1, 2].map((copies) => {
  const embeddings = [], labels = [], groups = [];
  for (const species of ["A", "B"])
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < copies; j++) {
        embeddings.push(species === "A" ? [1, 0.01 * i, 0] : [-1, 0.01 * i, 0]);
        labels.push(species);
        groups.push(species + i);
      }
  const ctx = similarityContext(embeddings);
  return {
    specimensPerSpecies: 5,
    wingsPerSpecimen: copies,
    ...conformalPredict(querySimilarities(ctx, [0, 0, 1]), labels, calibrate(ctx, labels, groups)),
  };
});

// A small synthetic feature space isolates scaling from image quality/biology.
const settings = { mode: "fly", params: { kenyonCells: 256 }, folds: 5, id: "audit" };
const rnd = mulberry32(1);
const refs = Array.from({ length: 30 }, (_, i) => ({
  id: String(i),
  group: String(i),
  species: i < 15 ? "A" : "B",
  features: {
    version: "wing-features-1",
    blocks: {
      shape: Array.from({ length: 8 }, (_, d) =>
        (rnd() - 0.5) * (d + 1) + (d === 0 ? (i < 15 ? -0.2 : 0.2) : 0)),
    },
  },
}));
const model = trainModel(refs, settings);
const labels = refs.map((r) => r.species), groups = refs.map((r) => r.group);
const folds = stratifiedGroupFolds(labels, groups, 5);
const predictions = { rwr: [], knn: [] };
for (let fold = 0; fold < 5; fold++) {
  const views = calibrationSplit(refs.filter((_, i) => folds[i] !== fold)).training;
  const train = animalReferences(views, commonBlocks(views.map((r) => r.features)));
  const features = train.map((r) => r.features);
  const scaler = fitStandardizer(features, commonBlocks(features));
  const embed = makeEmbedder(settings.mode, scaler.dim, settings.params);
  const ctx = similarityContext(features.map((f) => embed(scaler.transform(f))));
  const trainLabels = train.map((r) => r.species);
  for (let i = 0; i < refs.length; i++) {
    if (folds[i] !== fold) continue;
    const qs = querySimilarities(ctx, embed(scaler.transform(refs[i].features)));
    predictions.rwr[i] = argmax(rwrScores(ctx, trainLabels, qs));
    predictions.knn[i] = argmax(knnScores(ctx, trainLabels, qs));
  }
}
result.cvComparison = {
  fixture: "30 synthetic references; 8 features; seed 1; identical specimen folds; FlyHash 256",
  current: model.evaluation.methods,
  fitWithinFold: Object.fromEntries(Object.entries(predictions).map(([m, p]) => [m, summarize(labels, p)])),
};

const mixed = refs.map((r, i) => ({
  ...r,
  features: {
    ...r.features,
    blocks: { ...r.features.blocks, venation: [i, i + 1], ...(i ? { wip: [i, i + 2] } : {}) },
  },
}));
result.modalityDrop = {
  records: mixed.length,
  withWip: mixed.filter((r) => r.features.blocks.wip).length,
  automaticRejected: (() => { try { trainModel(mixed, settings); return false; } catch { return true; } })(),
  explicitVenationBlocks: trainModel(mixed, { ...settings, blocks: ["shape", "venation"] }).blocks,
};

const runtime = loadModel(model);
result.featureVersionMismatchAccepted = (() => { try { runtime.classify({ ...refs[0].features, version: "incompatible-future-feature-version" }); return true; } catch { return false; } })();
const changed = { ...model, classifier: { ...model.classifier, alpha: 1 } };
const qs = runtime.classify(refs[0].features).qs;
result.savedClassifierSettings = {
  storedAlpha: changed.classifier.alpha,
  loadedModelScores: loadModel(changed).classify(refs[0].features).scores,
  scoresIfStoredSettingsApplied: rwrScores(runtime.ctx, runtime.labels, qs, undefined, changed.classifier),
};

// The fixture has a uniform gray interior and no veins. Remove any boundary
// colour introduced by normalization to isolate its effect on the descriptors.
const processed = preprocess(fixture(), { standardConfirmed: true });
const uniform = { ...processed.normalized, data: processed.normalized.data.slice() };
for (let i = 0; i < uniform.mask.length; i++)
  if (uniform.mask[i])
    for (let c = 0; c < 3; c++) uniform.data[i * 4 + c] = 100;
const describeVenation = (image) => {
  const v = extractFeatures({ venation: image }).blocks.venation;
  return {
    dimensions: v.length,
    l2: Math.hypot(...v),
    gradientL2: Math.hypot(...v.slice(0, 256)),
    darknessL2: Math.hypot(...v.slice(256)),
  };
};
result.uniformSilhouette = {
  maskStatus: processed.metadata.maskQuality.status,
  reasons: processed.metadata.maskQuality.reasons,
  sharpness: processed.metadata.captureQuality.sharpnessInWing,
  normalized: describeVenation(processed.normalized),
  uniformMaskedPixels: describeVenation(uniform),
};
result.identicalMaskRegistration = register(
  processed.normalized.mask, processed.normalized.mask,
  processed.normalized.width, processed.normalized.height,
);

console.log(JSON.stringify(result, null, 2));
