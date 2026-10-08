import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { bombusReferences, canonicalBombusCoordinates } from "../scripts/bombus-source.mjs";
import { VERSION } from "../imaging/pipeline.js";
import { csvToImage, landmarkBlock } from "../classifier/landmarks.js";
import { loadModel, evaluateExternal } from "../classifier/model.js";
import { serializeModel, deserializeModel } from "../classifier/model-store.js";

const folder = new URL("../models/bombus-starter/", import.meta.url);
const raw = readFileSync(new URL("source-landmarks.csv", folder));
const database = JSON.parse(readFileSync(new URL("references.json", folder), "utf8"));
const model = deserializeModel(readFileSync(new URL("model.json", folder), "utf8"));

test("starter numeric database preserves the publisher source, identities and rights", () => {
  const record = JSON.parse(readFileSync(new URL("source-record.json", folder)));
  assert.equal(record.metadata.license.id, "odc-odbl");
  assert.equal(`md5:${createHash("md5").update(raw).digest("hex")}`, record.files.find((f) => f.key.endsWith("csv")).checksum);
  assert.deepEqual(raw, readFileSync(new URL("../test-data/landmarks-original.csv", import.meta.url)));
  assert.equal(createHash("sha256").update(raw).digest("hex"), model.attribution.sourceSha256);
  assert.equal(model.attribution.license, "ODbL-1.0");
  assert.match(model.attribution.citation, /Molasy.*Tofilski.*19703357/);
  assert.match(model.attribution.databaseUrl, /references.json$/);
  assert.deepEqual(database.attribution, model.attribution);
  assert.deepEqual(database.references, bombusReferences(raw.toString("utf8"), VERSION));
  assert.equal(database.references.length, 814);
  assert.equal(new Set(database.references.map((r) => r.group)).size, 423);
  assert.ok(database.references.every((r) => r.series === null));
  assert.equal(model.calibration.labels.filter((t) => t === "Bombus cryptarum").length, 2);
  assert.equal(model.starter.independentTest, false);
  assert.equal(model.starter.unknownSpeciesValidated, false);
});

test("source coordinate adapter agrees with the original-image UI path, preserving handedness", () => {
  const [, ...values] = raw.toString("utf8").split(/\r?\n/)[1].split(",").map((c) => c.replaceAll('"', ''));
  const original = values.map(Number), adapted = canonicalBombusCoordinates(original);
  const points = Array.from({ length: 19 }, (_, i) => csvToImage(original[2 * i], original[2 * i + 1], 2616));
  const ui = landmarkBlock({ scheme: "bombus-19", points }, {
    standardConfirmed: true, transformMatrix: [-1, 0, 3487, 0, 1, 0, 0, 0, 1],
  });
  for (let i = 0; i < 38; i++) assert.equal(ui[i] - adapted[i], i % 2 ? 2615 : 3487);
  assert.ok(adapted[30] < adapted[36] && adapted[13] < adapted[25]);
  assert.throws(() => canonicalBombusCoordinates(Array(38).fill(0)), /orientation/);
  assert.throws(() => bombusReferences(raw.toString("utf8").replace('"1797"', '""'), VERSION), /Invalid/);
});

test("starter export/import retains citation and predictions; it cannot claim calibrated unknowns", () => {
  const runtime = loadModel(model), query = database.references[0];
  const result = runtime.classify(query.features, VERSION);
  assert.equal(model.primary, "lda");
  assert.deepEqual(model.blocks, ["landmarks"]);
  assert.ok(Object.values(result.lda.probabilities).every(Number.isFinite));
  assert.equal(result.conformal.openSetValid, false);
  const roundTrip = deserializeModel(serializeModel(model));
  assert.deepEqual(roundTrip.attribution, model.attribution);
  assert.deepEqual(loadModel(roundTrip).classify(query.features, VERSION).lda.probabilities, result.lda.probabilities);
  assert.throws(() => runtime.classify({ ...query.features, blocks: { shape: [1] } }, VERSION), /landmarks/);
  assert.throws(() => evaluateExternal(model, [query]), /überschneidet/);
  // A perturbed mechanical fixture checks report attribution; not new biology.
  const features = { ...query.features, blocks: { landmarks: query.features.blocks.landmarks.map((v, i) => v + (i === 0 ? .01 : 0)) } };
  const report = evaluateExternal(model, [{ ...query, id: "mechanical-fixture", group: "mechanical-fixture", features }]);
  assert.deepEqual(report.dataAttribution, model.attribution);
});
