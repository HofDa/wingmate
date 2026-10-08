// Browser check of the landmark tool on real images with published landmarks
// (Molasy & Tofilski, test-data/landmarks-original.csv, y-up). For each wing:
// choose flip/mirror like a user would, click all 19 landmarks through the
// UI (main view, then loupe refinement), compare the stored original-pixel
// coordinates with the published ones, accept and save as reference. Finally
// classify one wing and validate: the Procrustes + LDA path must appear.
// Usage: NODE_PATH=/path/to/node_modules node scripts/landmark-e2e.cjs
// Needs an HTTP server for the project root at 127.0.0.1:8000.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path");

const csv = fs
  .readFileSync(path.join(__dirname, "../test-data/landmarks-original.csv"), "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(",").map((c) => c.replace(/"/g, "")));
const published = Object.fromEntries(csv.map(([file, ...c]) => [file, c.map(Number)]));
const refs = {
  "Bombus cryptarum": ["cryptarum-F-BUM0463_SEG37A-R.dw.png", "cryptarum-M-BUM0402_SEG27A-L.dw.png", "cryptarum-M-BUM0450_SEG37A-R.dw.png"],
  "Bombus lucorum": ["lucorum-F-000257-R.dw.png", "lucorum-M-BUM0451_SEG28A-R.dw.png", "lucorum-M-B_3_U4_13_139-R.dw.png"],
};
const query = "cryptarum-M-BUM0435_SEG37A-R.dw.png";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto("http://127.0.0.1:8000");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  async function annotate(file, loupeRefine) {
    const height = await page.evaluate(async (file) => {
      const blob = await (await fetch("/test-data/difficult/" + file)).blob();
      await window.wingQC.load("venation", new File([blob], file, { type: "image/png" }));
      return window.wingQC.items.venation.image.height;
    }, file);
    const truth = [];
    for (let i = 0; i < published[file].length; i += 2) truth.push({ x: published[file][i], y: height - 1 - published[file][i + 1] });
    // Orientation as a user would confirm it: base (LM16) left of distal (LM19), costal LM7 above LM13.
    await page.evaluate(async (truth) => {
      const item = window.wingQC.items.venation,
        ap = (m, p) => ({ x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] });
      for (const [flipped180, mirrored] of [[false, false], [true, false], [false, true], [true, true]]) {
        Object.assign(item.options, { flipped180, mirrored, standardConfirmed: true });
        await window.wingQC.recalculate();
        const m = item.result.metadata.transformMatrix,
          [b, d, c, p] = [truth[15], truth[18], truth[6], truth[12]].map((q) => ap(m, q));
        if (b.x < d.x && c.y < p.y) return;
      }
      throw Error("keine passende Orientierung");
    }, truth);
    // Open the landmark editor and click every landmark at its published position.
    // The editor remembers its open state between images.
    if (!(await page.evaluate(() => document.querySelector(".lm-details").open))) await page.click(".lm-details > summary");
    const main = page.locator(".lm-main"),
      loupe = page.locator(".lm-loupe");
    const errorsPx = [];
    await main.evaluate((c) => c.scrollIntoView({ block: "center" }));
    for (let i = 0; i < truth.length; i++) {
      const target = await page.evaluate(
        ({ p }) => {
          const m = window.wingQC.items.venation.result.metadata.transformMatrix;
          return { x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] };
        },
        { p: truth[i] },
      );
      const box = await main.boundingBox(),
        W = await main.evaluate((c) => c.width),
        H = await main.evaluate((c) => c.height);
      await page.mouse.click(box.x + ((target.x + 0.5) * box.width) / W, box.y + ((target.y + 0.5) * box.height) / H);
      if (loupeRefine) {
        // Select the just placed landmark (p key moves back), then refine in the loupe.
        await page.mouse.move(box.x - 5, box.y - 5);
        await main.focus();
        if (i < truth.length - 1) await page.keyboard.press("p");
        const stored = await page.evaluate((i) => {
          const m = window.wingQC.items.venation.result.metadata.transformMatrix,
            p = window.wingQC.items.venation.landmarks.points[i];
          return { x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] };
        }, i);
        const lb = await loupe.boundingBox(),
          zoom = 6,
          size = 220;
        await page.mouse.click(lb.x + (((target.x - stored.x) * zoom + size / 2) * lb.width) / size, lb.y + (((target.y - stored.y) * zoom + size / 2) * lb.height) / size);
      }
      const p = await page.evaluate((i) => window.wingQC.items.venation.landmarks.points[i], i);
      errorsPx.push(Math.hypot(p.x - truth[i].x, p.y - truth[i].y));
    }
    const summary = await page.textContent(".lm-details > summary"),
      warning = await page.textContent(".lm-editor .status");
    const review = page.getByRole("textbox", { name: "Venation: Begründung der Freigabe" });
    if (await review.count()) await review.fill("Published landmark fixture; coordinate-path software check, not independent image identification validation.");
    await page.click("#qcAccept");
    await page.waitForFunction(() => window.wingQC.items.venation?.accepted);
    const scale = await page.evaluate(() => window.wingQC.items.venation.result.metadata.scale);
    // Drawn positions must coincide with the displayed image: landmarks are
    // vein junctions, so the normalized image is dark under them.
    const darkness = await page.evaluate(() => {
      const it = window.wingQC.items.venation,
        m = it.result.metadata.transformMatrix,
        n = it.result.normalized;
      let sum = 0;
      for (const p of it.landmarks.points) {
        const x = Math.round(m[0] * p.x + m[1] * p.y + m[2]),
          y = Math.round(m[3] * p.x + m[4] * p.y + m[5]),
          i = y * n.width + x;
        sum += n.mask[i] ? 255 - n.data[i * 4] : 0;
      }
      return sum / it.landmarks.points.length;
    });
    return { file, summary, warning, darknessUnderLandmarks: Math.round(darkness), maxErrorPx: Math.max(...errorsPx), meanErrorPx: errorsPx.reduce((a, b) => a + b, 0) / errorsPx.length, originalPxPerNormalizedPx: 1 / scale };
  }

  const report = [];
  for (const [species, files] of Object.entries(refs))
    for (const [k, file] of files.entries()) {
      report.push(await annotate(file, k === 0));
      await page.click("#refToggle");
      await page.fill("#speciesInput", species);
      await page.fill("#specimenInput", file.replace(/-[LR]\.dw\.png$/, ""));
      await page.click("#addReferenceBtn");
    }
  report.push(await annotate(query, false));
  const hasBlock = await page.evaluate(() => window.wingClassifier.state.query.features.blocks.landmarks?.length);
  await page.click("#classifyBtn");
  const lda = await page.evaluate(() => document.querySelector("#ldaResult")?.textContent ?? "");
  await page.evaluate(() => {
    window.wingShell.show("referenzen");
    document.querySelector("#validateBtn").closest("details").open = true;
  });
  await page.click("#validateBtn");
  const validation = await page.evaluate(() => [...document.querySelectorAll("#validation tbody tr")].map((r) => r.textContent));
  await page.evaluate(() => {
    window.wingShell.show("exemplar");
    document.querySelector("#qcLandmarkCsv").closest("details").open = true;
  });
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#qcLandmarkCsv")]),
    csvText = fs.readFileSync(await download.path(), "utf8");
  await page.screenshot({ path: process.env.SHOT || require("node:path").join(require("node:os").tmpdir(), "landmark-e2e.png"), fullPage: false, clip: { x: 0, y: 0, width: 1440, height: 1100 } });
  await browser.close();
  console.log(JSON.stringify({ report, hasBlock, lda: lda.slice(0, 300), validation, csvHeader: csvText.split("\n")[0].slice(0, 40), errors }, null, 2));
  const refined = report.filter((_, i) => i === 0 || i === 3),
    ok =
      !errors.length &&
      report.every((r) => r.summary.includes("19 / 19") && r.maxErrorPx < r.originalPxPerNormalizedPx && r.darknessUnderLandmarks > 150) &&
      refined.every((r) => r.maxErrorPx < 1.5) &&
      hasBlock === 38 &&
      lda.includes("Procrustes + LDA") &&
      validation.some((row) => row.startsWith("Procrustes + PCA + LDA"));
  process.exit(ok ? 0 : 1);
})();
