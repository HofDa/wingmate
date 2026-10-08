// Usage: node scripts/evaluate-model.mjs model.json test-references.json [report.json]
// All files stay local. Use an untouched animal/session test set after development.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { deserializeModel } from "../classifier/model-store.js";
import { evaluateExternal } from "../classifier/model.js";
const [modelPath, referencePath, outputPath] = process.argv.slice(2);
if (!modelPath || !referencePath) throw Error("Usage: node scripts/evaluate-model.mjs model.json test-references.json [report.json]");
if (outputPath && [modelPath, referencePath].some((p) => resolve(p) === resolve(outputPath))) throw Error("Report output must not overwrite model or test inputs.");
const modelText = readFileSync(modelPath, "utf8"), referenceText = readFileSync(referencePath, "utf8");
const model = deserializeModel(modelText), parsed = JSON.parse(referenceText);
const rows = Array.isArray(parsed) ? parsed : parsed.references;
if (!Array.isArray(rows) || !rows.length) throw Error("Testdatei enthält keine Referenzen.");
const refs = rows.map((r) => ({ ...r, group: r.group ?? r.specimenId }));
const hash = (s) => createHash("sha256").update(s).digest("hex");
const report = { createdAt: new Date().toISOString(), artifacts: { modelSha256: hash(modelText), testDataSha256: hash(referenceText) },
  ...evaluateExternal(model, refs) };
const json = JSON.stringify(report, null, 2) + "\n";
if (outputPath) writeFileSync(outputPath, json);
else process.stdout.write(json);
