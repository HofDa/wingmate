// Usage: NODE_PATH=/path/to/node_modules node scripts/browser-benchmark.cjs
// Requires a local HTTP server at localhost:8000 and Playwright + Chromium.
const { chromium } = require("playwright");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:8000/"))
      errors.push("Unexpected non-local request: " + r.url());
  });
  await page.goto("http://127.0.0.1:8000");
  const report = await page.evaluate(async () => {
    const { preprocess } = await import("/imaging/pipeline.js");
    const entries = await (await fetch("/test-data/metadata.json")).json();
    const report = [];
    for (const row of entries) {
      const blob = await (await fetch("/test-data/" + row.file)).blob(),
        bitmap = await createImageBitmap(blob),
        c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const input = ctx.getImageData(0, 0, c.width, c.height),
        start = performance.now();
      try {
        const r = preprocess(input, { createdAt: "benchmark" });
        report.push({
          file: row.file,
          width: c.width,
          height: c.height,
          elapsedMs: Math.round(performance.now() - start),
          status: r.metadata.maskQuality.status,
          reasons: r.metadata.maskQuality.reasons,
          areaFraction: r.metadata.maskQuality.areaFraction,
          orientationConfidence: r.metadata.orientationConfidence,
          transformMatrix: r.metadata.transformMatrix,
        });
      } catch (e) {
        report.push({ file: row.file, error: e.message });
      }
    }
    return report;
  });
  fs.writeFileSync(
    "test-data/benchmark.json",
    JSON.stringify(
      {
        version: "wing-normalizer-0.2",
        kind: "development smoke benchmark; no segmentation ground truth; timings hardware dependent",
        results: report,
      },
      null,
      2,
    ),
  );
  const path = "test-data/venation/Spiesman-S2-F-Bombus-perplexus.png";
  await page.locator("#venInput").setInputFiles(path);
  await page.waitForFunction(() => window.wingQC?.items.venation?.result);
  await page.locator("#qcImages .qc-check input").check();
  await page.waitForFunction(
    () => !document.querySelector("#qcAccept").disabled,
  );
  await page.locator("#qcAccept").click();
  await page.waitForFunction(
    () => !document.querySelector("#addReferenceBtn").disabled,
  );
  if (await page.locator("#addReferenceBtn").isDisabled())
    throw Error("Accept did not enable features");
  await page.getByRole("button", { name: "Flip 180°", exact: true }).click();
  await page.waitForFunction(
    () => window.wingQC.items.venation?.result?.metadata.flipped180,
  );
  if (!(await page.locator("#addReferenceBtn").isDisabled()))
    throw Error("Edit failed to invalidate acceptance");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.wingQC.items.venation?.result &&
      !window.wingQC.items.venation.result.metadata.flipped180,
  );
  await page.locator("#wipInput").setInputFiles(path);
  await page.waitForFunction(
    () => window.wingQC.items.wip?.result?.metadata.registration,
  );
  const reg = await page.evaluate(
    () => window.wingQC.items.wip.result.metadata.registration,
  );
  if (reg.maskIoU < 0.99) throw Error("Identity registration failed");
  await page.locator("#qcImages").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/wing-qc-verified.png", fullPage: true });
  await page.locator("#clearImagesBtn").click();
  if (await page.locator("#qcImages").textContent())
    throw Error("Clear failed");
  await page.locator("#qcRestore").click();
  await page.waitForFunction(() => window.wingQC.items.venation?.result);
  if (!(await page.locator("#addReferenceBtn").isDisabled()))
    throw Error("Restored specimen requires fresh QC");
  await page.locator("#qcAccept").click();
  await page.waitForFunction(
    () => !document.querySelector("#addReferenceBtn").disabled,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#qcExport").click();
  const download = await downloadPromise;
  await download.saveAs("/tmp/wing-export-test.json");
  const exported = JSON.parse(
    fs.readFileSync("/tmp/wing-export-test.json", "utf8"),
  );
  if (!exported.preprocessing.images.venation.mask.runs.length)
    throw Error("Export missing corrected mask");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        images: report.length,
        processed: report.filter((r) => !r.error).length,
        review: report.filter((r) => r.status === "REVIEW").length,
        good: report.filter((r) => r.status === "GOOD").length,
        identityRegistration: reg.maskIoU,
        ui: "PASS",
      },
      null,
      2,
    ),
  );
  await browser.close();
})();
