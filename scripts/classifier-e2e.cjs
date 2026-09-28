// End-to-end UI check of the classification stage: real QC flow on the
// development Bombus images -> references -> classify -> walk view -> validate.
// Usage: NODE_PATH=/path/to/node_modules node scripts/classifier-e2e.cjs
// Requires a local HTTP server at 127.0.0.1:8000 and Playwright + Chromium.
// Checks wiring and consistency only; the images are not a validation set.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(r.status() + " " + r.url());
  });
  page.on("dialog", (d) => d.accept());
  await page.goto("http://127.0.0.1:8000");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const accept = async (file, species) => {
    await page.evaluate(async (file) => {
      const blob = await (await fetch("/test-data/difficult/" + file)).blob();
      await window.wingQC.load("venation", new File([blob], file, { type: "image/png" }));
      window.wingQC.items.venation.options.standardConfirmed = true;
      await window.wingQC.recalculate();
    }, file);
    await page.click("#qcAccept");
    await page.waitForFunction(() => window.wingQC.items.venation?.accepted);
    if (species) {
      await page.click("#refToggle");
      await page.fill("#speciesInput", species);
      await page.fill("#specimenInput", file.replace(/-[LR]\.dw\.png$/, ""));
      await page.click("#addReferenceBtn");
    }
  };
  const refs = {
    "Bombus cryptarum": [
      "cryptarum-F-BUM0440_SEG20A-L.dw.png",
      "cryptarum-F-BUM0446_SEG29A-R.dw.png",
      "cryptarum-M-BUM0402_SEG27A-L.dw.png",
      "cryptarum-M-BUM0435_SEG37A-R.dw.png",
    ],
    "Bombus lucorum": [
      "lucorum-F-000007-L.dw.png",
      "lucorum-F-000257-R.dw.png",
      "lucorum-M-B_3_U4_13_139-R.dw.png",
      "lucorum-M-BUM0401_SEG07A-L.dw.png",
    ],
  };
  for (const [species, files] of Object.entries(refs))
    for (const f of files) await accept(f, species);
  const stored = await page.evaluate(() => window.wingClassifier.state.references.length);
  await accept("lucorum-M-BUM0451_SEG28A-R.dw.png", null);
  await page.click("#classifyBtn");
  const result = await page.evaluate(() => ({
    status: document.querySelector("#classifyStatus").textContent,
    bars: [...document.querySelectorAll("#resultBars .barrow")].map((r) => r.textContent),
    pill: document.querySelector("#openSetPill").textContent,
    set: document.querySelector("#predictionSet").textContent,
    walkNodes: document.querySelectorAll("#walkView [data-nodes] tr").length,
    walkCircles: document.querySelectorAll("#walkView [data-graph] circle").length,
    playEnabled: !document.querySelector("#walkView [data-play]").disabled,
  }));
  // Slide to the last step: table probabilities must reproduce the unbalanced
  // walk mass per taxon that the classifier computed.
  await page.evaluate(() => {
    const s = document.querySelector("#walkView [data-step]");
    s.value = s.max;
    s.dispatchEvent(new Event("input"));
  });
  result.walkLast = await page.evaluate(() => document.querySelector("#walkView [data-counter]").textContent);
  result.walkTop = await page.evaluate(() =>
    [...document.querySelectorAll("#walkView [data-nodes] tr")].slice(0, 3).map((r) => r.textContent),
  );
  await page.evaluate(() => {
    window.wingShell.show("referenzen");
    document.querySelector("#validateBtn").closest("details").open = true;
  });
  await page.click("#validateBtn");
  result.validation = await page.evaluate(() =>
    [...document.querySelectorAll("#validation tbody tr")].map((r) => r.textContent),
  );
  // Any change of the query must clear the walk view.
  await page.evaluate(() => window.wingQC.recalculate());
  result.walkAfterChange = await page.evaluate(
    () => document.querySelectorAll("#walkView [data-nodes] tr").length,
  );
  await page.screenshot({ path: process.env.SHOT || require("node:path").join(require("node:os").tmpdir(), "classifier-e2e.png"), fullPage: true });
  console.log(JSON.stringify({ stored, ...result, errors }, null, 2));
  await browser.close();
  const ok =
    stored === 8 &&
    result.bars.length === 2 &&
    result.walkNodes === 9 &&
    result.playEnabled &&
    result.walkAfterChange === 0 &&
    result.validation.length === 3 &&
    !errors.length;
  process.exit(ok ? 0 : 1);
})();
