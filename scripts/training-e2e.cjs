// Browser check of the training mode with real landmark references
// (Molasy & Tofilski Bombus, 12 random specimens per species, sex and
// collection from the file names): readiness -> train in worker -> report
// -> classify a held-out wing with the frozen model -> stale warning ->
// export / import round trip -> reload restores the active model.
// Usage: NODE_PATH=/path/to/node_modules node scripts/training-e2e.cjs
// Needs an HTTP server for the project root at 127.0.0.1:8000.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path");

const rows = fs
  .readFileSync(path.join(__dirname, "../test-data/landmarks-original.csv"), "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(",").map((c) => c.replace(/"/g, "")));
const seriesOf = (file) => {
  const code = file.split("-")[2];
  return /^\d{6}$/.test(code) ? "numbered" : code.startsWith("BUM") ? "BUM" : code.startsWith("B_") ? "B" : code.slice(0, 4);
};
// Landmarks in the app's standard view: 180° rotation of the y-up CSV.
const wings = rows.map(([file, ...c]) => ({
  file,
  species: "Bombus " + file.split("-")[0],
  specimen: file.replace(/-[LR]\.dw\.png$/, ""),
  sex: file.split("-")[1],
  series: seriesOf(file),
  landmarks: c.map((v) => -Number(v)),
}));
let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296),
  chosen = new Set();
for (const species of new Set(wings.map((w) => w.species))) {
  const g = [...new Set(wings.filter((w) => w.species === species).map((w) => w.specimen))];
  for (let i = g.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [g[i], g[j]] = [g[j], g[i]];
  }
  g.slice(0, 12).forEach((s) => chosen.add(s));
}
const features = (w) => ({ version: "wing-features-2", landmarkScheme: "bombus-19", blocks: { landmarks: w.landmarks } });
const references = wings
  .filter((w) => chosen.has(w.specimen))
  .map((w) => ({
    id: w.file,
    species: w.species,
    specimenId: w.specimen,
    sex: w.sex,
    series: w.series,
    preprocessingVersion: "wing-normalizer-0.3",
    features: features(w),
    created: "2026-09-28T00:00:00Z",
  }));
const heldOut = wings.find((w) => !chosen.has(w.specimen) && w.species === "Bombus lucorum");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto("http://127.0.0.1:8000");
  await page.evaluate((refs) => {
    localStorage.clear();
    localStorage.setItem("wingmate-references-v2", JSON.stringify(refs));
  }, references);
  await page.reload();
  const status = () => page.textContent("#trainingCard .status");
  const readinessRows = await page.$$eval("#trainingCard .train-table tbody tr", (r) => r.map((x) => x.textContent));

  await page.evaluate(() => window.wingShell.show("referenzen"));
  await page.fill("#trainingCard input[type=text]", "E2E Bombus");
  await page.click("#trainingCard button:has-text('Trainieren')");
  await page.waitForFunction(() => document.querySelector("#trainingCard .status").textContent.includes("aktiviert"), null, { timeout: 120000 });
  const report = await page.evaluate(() => ({
    title: document.querySelector(".train-report h3")?.textContent,
    headings: [...document.querySelectorAll(".train-report h4")].map((h) => h.textContent),
    cv: [...document.querySelectorAll(".train-report .train-table")[0].querySelectorAll("tbody tr")].map((r) => r.textContent),
    confusionRows: document.querySelectorAll(".train-report .confusion tbody tr").length,
    stale: document.querySelectorAll("#trainingCard .status")[1].textContent,
    button: document.querySelector("#classifyBtn").textContent,
  }));

  const classifyHeldOut = async () => {
    await page.evaluate((f) => {
      window.wingClassifier.state.query = { features: f, preprocessing: { version: "wing-normalizer-0.3", images: {} }, specimenArchiveId: null };
      for (const id of ["#classifyBtn", "#addReferenceBtn"]) Object.assign(document.querySelector(id), { disabled: false, hidden: false });
      window.wingShell.show("exemplar");
    }, features(heldOut));
    await page.click("#classifyBtn");
    return page.evaluate(() => ({
      status: document.querySelector("#classifyStatus").textContent,
      lda: document.querySelector("#ldaResult")?.textContent.slice(0, 120),
      walkNodes: document.querySelectorAll("#walkView [data-nodes] tr").length,
    }));
  };
  const first = await classifyHeldOut();

  // Adding a reference makes the frozen model stale (it does not change by itself).
  await page.evaluate(() => {
    window.wingShell.show("exemplar");
    document.querySelector("#refForm").hidden = false;
  });
  await page.fill("#speciesInput", heldOut.species);
  await page.fill("#specimenInput", heldOut.specimen);
  await page.click("#addReferenceBtn");
  const staleAfterAdd = await page.evaluate(() => document.querySelectorAll("#trainingCard .status")[1].textContent);

  // Export, deactivate, re-import.
  await page.evaluate(() => window.wingShell.show("referenzen"));
  await page.locator("#trainingCard .more > summary").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#trainingCard button:has-text('Exportieren')")]),
    file = path.join(require("node:os").tmpdir(), "wingmate-e2e-model.json");
  await download.saveAs(file);
  await page.selectOption("#trainingCard select", "");
  await page.waitForFunction(() => document.querySelector("#classifyBtn").textContent === "Bestimmen");
  const liveButton = await page.textContent("#classifyBtn");
  await page.evaluate(() => window.wingShell.show("referenzen"));
  await page.setInputFiles("#trainingCard input[type=file]", file);
  await page.waitForFunction(() => document.querySelector("#trainingCard .status").textContent.includes("importiert"));
  const second = await classifyHeldOut();
  await page.reload();
  await page.waitForFunction(() => document.querySelector(".train-report h3"));
  const afterReload = await page.evaluate(() => document.querySelector(".train-report h3").textContent);
  const size = fs.statSync(file).size;
  // QC: review acknowledgement and same-wing confirmation are required.
  await page.evaluate(() => window.wingShell.show("exemplar"));
  const fixturePng = async (wip) => page.evaluate(async (wip) => {
    const { fixture } = await import("./tests/fixtures.js");
    const image = fixture({ wip, bg: wip ? 0 : 240 });
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext("2d").putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  }, wip);
  const settled = () => page.waitForFunction(() => !document.querySelector("#qcRecalculate").disabled);
  await page.setInputFiles("#venInput", { name: "uniform-venation.png", mimeType: "image/png", buffer: Buffer.from(await fixturePng(false), "base64") });
  await page.getByLabel("Standard geprüft: Basis links, Spitze rechts, Vorderrand oben").check();
  await settled();
  if (!(await page.locator("#qcAccept").isDisabled())) throw Error("QC accepted an unreviewed no-detail image");
  await page.getByRole("textbox", { name: "Venation: Begründung der Freigabe" }).fill("Synthetic software test only; no vein anatomy.");
  if (await page.locator("#qcAccept").isDisabled()) throw Error("Recorded QC review did not enable acceptance");
  await page.setInputFiles("#wipInput", { name: "uniform-wip.png", mimeType: "image/png", buffer: Buffer.from(await fixturePng(true), "base64") });
  await page.getByLabel("Standard geprüft: Basis links, Spitze rechts, Vorderrand oben").nth(1).check();
  await settled();
  await page.getByRole("textbox", { name: "Venation: Begründung der Freigabe" }).fill("Synthetic software test only; no vein anatomy.");
  await page.getByRole("textbox", { name: "WIP: Begründung der Freigabe" }).fill("Synthetic colour fixture only.");
  if (!(await page.locator("#qcAccept").isDisabled())) throw Error("Unconfirmed image pair was accepted");
  await page.getByLabel("Beide Bilder zeigen denselben Flügel desselben Tieres; innere Adern stimmen überein.").check();
  await page.locator("#qcAccept").click();
  await page.waitForFunction(() => window.wingClassifier.state.query?.specimenArchiveId);
  const qc = await page.evaluate(() => ({
    review: window.wingClassifier.state.query.preprocessing.images.venation.qcReview,
    uniformVeinSignal: Math.hypot(...window.wingClassifier.state.query.features.blocks.venation),
  }));
  if (!qc.review.reason || !qc.review.pairConfirmed || qc.uniformVeinSignal !== 0) throw Error("QC provenance or safe-interior feature extraction failed");
  console.log(JSON.stringify({ qc }, null, 2));
  await browser.close();

  const result = { readinessRows, report, first, staleAfterAdd, liveButton, second, afterReload, modelFileBytes: size, trainingStatus: await Promise.resolve("ok"), errors };
  console.log(JSON.stringify(result, null, 2));
  const ok =
    !errors.length &&
    readinessRows.length === 3 &&
    report.title === "E2E Bombus" &&
    report.headings.some((h) => h.startsWith("Kreuzvalidierung")) &&
    report.headings.some((h) => h.startsWith("Transfer")) &&
    report.cv.length === 3 &&
    report.confusionRows === 3 &&
    report.button === "Mit Modell bestimmen" &&
    first.status.includes("Modell „E2E Bombus“") &&
    first.lda?.includes("Procrustes + LDA") &&
    staleAfterAdd.includes("geändert") &&
    liveButton === "Bestimmen" &&
    second.status === first.status &&
    afterReload === "E2E Bombus";
  process.exit(ok ? 0 : 1);
})();
