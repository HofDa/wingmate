import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const folder = new URL("models/apis-source/", root);
const database = JSON.parse(readFileSync(new URL("references.json", folder)));
const record = JSON.parse(readFileSync(new URL("source-record.json", folder)));

test("Apis numeric sources match the pinned publisher's inventory and rights", () => {
  assert.equal(record.id, 18845767);
  assert.equal(record.metadata.access_right, "open");
  assert.equal(record.metadata.license.id, "odc-odbl");
  const files = record.files.filter((file) => file.key.endsWith(".csv"));
  assert.equal(files.length, 20);
  for (const file of files) {
    const bytes = readFileSync(new URL(`originals/${file.key}`, folder));
    assert.equal(bytes.length, file.size);
    assert.equal(`md5:${createHash("md5").update(bytes).digest("hex")}`, file.checksum);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), database.attribution.sourceSha256[file.key]);
  }
  assert.equal(database.attribution.license, "ODbL-1.0");
  for (const creator of record.metadata.creators) assert.ok(database.attribution.citation.includes(creator.name));
});

test("Apis collection preserves colony independence and distinct landmark semantics", () => {
  assert.equal(database.sourceWings, 29043);
  assert.equal(database.references.length, 1342);
  assert.equal(new Set(database.references.map((r) => r.colony)).size, 1342);
  assert.equal(database.landmarkScheme, "apis-nawrocka-2018-19");
  assert.match(database.coordinateSystem, /lower-left, y-up/);
  assert.deepEqual([...new Set(database.references.map((r) => r.country))].sort(), ["BY", "DE", "ES", "FR", "GB", "IE", "LT", "NL", "NO", "PL"]);
  for (const r of database.references) {
    assert.equal(r.species, "Apis mellifera");
    assert.equal(r.splitGroup, r.colony);
    assert.ok(r.id.startsWith(`${r.colony}-`));
    assert.equal(r.landmarks.length, 38);
    assert.ok(r.landmarks.every((v) => Number.isInteger(v) && v >= 0));
  }
  assert.deepEqual(database.excludedJoins[0].landmarksOnly, ["DE-0003-14.dw.png", "DE-0003-4.dw.png"]);
  assert.ok(database.references.every((r) => !database.excludedJoins[0].landmarksOnly.includes(r.id)));
});

test("offline Apis recipe reproduces the complete attributed collection", () => {
  const script = "import importlib.util,json; s=importlib.util.spec_from_file_location('apis','scripts/build-apis-references.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.build()))";
  const rebuilt = JSON.parse(execFileSync("python3", ["-c", script], { cwd: root, maxBuffer: 2_000_000 }));
  assert.deepEqual(rebuilt, database);
  const parserCheck = "import importlib.util; s=importlib.util.spec_from_file_location('apis','scripts/build-apis-references.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); rows=m.parse_csv(b'\\xef\\xbb\\xbffile,sample,notes\\r\\na,DE-0001,\"comma, and\\nnewline\"\\r\\n'); assert rows == [{'file':'a','sample':'DE-0001','notes':'comma, and\\nnewline'}]";
  execFileSync("python3", ["-c", parserCheck], { cwd: root });
});
