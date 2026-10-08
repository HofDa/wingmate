// Builds only from the pinned, already archived numeric source data; no network.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { trainModel } from "../classifier/model.js";
import { serializeModel } from "../classifier/model-store.js";
import { VERSION as preprocessingVersion } from "../imaging/pipeline.js";
import { bombusReferences } from "./bombus-source.mjs";

const root = new URL("../", import.meta.url), destination = new URL("models/bombus-starter/", root);
const csv = readFileSync(new URL("test-data/landmarks-original.csv", root));
const sourceRecord = readFileSync(new URL("test-data/source-record.json", root));
const publisher = JSON.parse(sourceRecord), sourceFile = publisher.files.find((f) => f.key === "Bombus_cry_luc_ter-raw-coordinates.csv");
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
if (publisher.id !== 19703357 || publisher.metadata.access_right !== "open" || publisher.metadata.license.id !== "odc-odbl" ||
    sourceFile?.checksum !== `md5:${digest("md5", csv)}`) throw Error("Pinned publisher rights/checksum contract does not match. Review the source before rebuilding.");
const refs = bombusReferences(csv.toString("utf8"), preprocessingVersion);
if (refs.length !== 814 || new Set(refs.map((r) => r.group)).size !== 423) throw Error("Unexpected source population.");
const attribution = {
  title: publisher.metadata.title, authors: publisher.metadata.creators.map((c) => c.name),
  citation: "Molasy, B.; Tofilski, A. (2026). Fore wing images of Bombus cryptarum, B. lucorum, and B. terrestris. Zenodo. https://doi.org/10.5281/zenodo.19703357",
  sourceUrl: publisher.doi_url, sourceFile: sourceFile.key,
  license: "ODbL-1.0", licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
  notice: "Contains information from Molasy & Tofilski's Bombus wing database, made available under the Open Database License (ODbL) 1.0. Attribution and database terms apply to this numeric reference/model database; application code has separate terms.",
  sourceSha256: digest("sha256", csv), sourceRecordSha256: digest("sha256", sourceRecord),
  alterations: "Convert raw y-up landmarks to base-left/anterior-up coordinates; group paired wings by filename specimen ID; fit animal prototypes and frozen GPA/PCA/shrinkage-LDA and separate distance calibration. No source images are included. Collection/session IDs are not inferred from filenames.",
  recipe: "scripts/build-bombus-starter.mjs and scripts/bombus-source.mjs; npm run build:starter",
  databaseFiles: ["source-landmarks.csv", "references.json", "model.json"],
  databaseUrl: "https://hofda.github.io/wingmate/models/bombus-starter/references.json",
  sourceDatabaseUrl: "https://hofda.github.io/wingmate/models/bombus-starter/source-landmarks.csv",
  recipeUrl: "https://github.com/HofDa/wingmate/blob/master/scripts/build-bombus-starter.mjs",
};
const model = trainModel(refs, { name: "Bombus · 3 Arten · Landmarken-Startmodell", id: "bombus-19703357-landmarks-v3",
  mode: "none", blocks: ["landmarks"], preprocessingVersion }, (_, stage) => { if (stage !== "fertig") console.log(stage); });
model.attribution = attribution;
model.starter = { id: "bombus-19703357-landmarks-v3", scope: Object.keys(model.taxa).sort(),
  status: "development-only", requiresLandmarks: "bombus-19", imagePipelineValidated: false, independentTest: false,
  unknownSpeciesValidated: false, acquisitionTransferValidated: false,
  limitations: ["Only the three named species are supported; other bees require another reference model.",
    "Published manual landmarks, not an end-to-end image-pipeline validation or automatic landmark detector.",
    "B. cryptarum has only 14 animals and two final calibration animals; unknown-species rejection is insufficiently calibrated.",
    "No independent final test; no collection/session transfer test; source data have already informed development."] };
mkdirSync(destination, { recursive: true });
writeFileSync(new URL("model.json", destination), serializeModel(model));
writeFileSync(new URL("references.json", destination), JSON.stringify({ format: "wingmate-numeric-landmark-database-1", attribution, references: refs }) + "\n");
copyFileSync(new URL("test-data/landmarks-original.csv", root), new URL("source-landmarks.csv", destination));
copyFileSync(new URL("test-data/source-record.json", root), new URL("source-record.json", destination));
console.log(JSON.stringify({ animals: Object.fromEntries(Object.entries(model.taxa).map(([t, x]) => [t, x.specimens])),
  trainingAnimals: model.references.trainingCount, calibrationAnimals: model.references.calibrationSpecimens,
  balancedAccuracy: model.evaluation.methods.lda.balancedAccuracy, output: destination.pathname }, null, 2));
