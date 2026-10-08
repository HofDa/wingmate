// Regenerates the screenshots of docs/Benutzerhandbuch.md from the real app:
// a real Bombus wing with its published landmarks, real landmark references
// (Molasy & Tofilski), Chrome's fake camera for the live panel.
// Usage: NODE_PATH=/path/to/node_modules node scripts/manual-screenshots.cjs
// Needs an HTTP server for the project root at 127.0.0.1:8000 and `cwebp`.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { execFileSync } = require("node:child_process");

const root = path.join(__dirname, ".."),
  out = path.join(root, "docs/img"),
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wingmate-manual-"));
fs.mkdirSync(out, { recursive: true });
const rows = fs
  .readFileSync(path.join(root, "test-data/landmarks-original.csv"), "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(",").map((c) => c.replace(/"/g, "")));
const seriesOf = (f) => {
  const c = f.split("-")[2];
  return /^\d{6}$/.test(c) ? "Sammlung A" : c.startsWith("BUM") ? "Sammlung B" : c.startsWith("B_") ? "Sammlung C" : "Sammlung D";
};
let seed = 5;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296),
  chosen = new Set();
for (const sp of ["cryptarum", "lucorum", "terrestris"]) {
  const g = [...new Set(rows.filter(([f]) => f.startsWith(sp)).map(([f]) => f.replace(/-[LR]\.dw\.png$/, "")))];
  for (let i = g.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [g[i], g[j]] = [g[j], g[i]];
  }
  g.slice(0, 12).forEach((s) => chosen.add(s));
}
const FILE = "cryptarum-M-BUM0435_SEG37A-R.dw.png";
const refs = rows
  .filter(([f]) => chosen.has(f.replace(/-[LR]\.dw\.png$/, "")) && f !== FILE)
  .map(([f, ...c]) => ({
    id: f,
    species: "Bombus " + f.split("-")[0],
    specimenId: f.replace(/-[LR]\.dw\.png$/, ""),
    sex: f.split("-")[1],
    series: seriesOf(f),
    preprocessingVersion: "wing-normalizer-0.2",
    features: { version: "wing-features-1", landmarkScheme: "bombus-19", blocks: { landmarks: c.map((v) => -Number(v)) } },
    created: "2026-09-28T00:00:00Z",
  }));
const truth = rows.find(([f]) => f === FILE).slice(1).map(Number);

async function shot(page, name, target = null) {
  const png = path.join(tmp, name + ".png");
  // Clip by page coordinates: live elements (camera meters) never become "stable".
  if (target) {
    const clip = await page.locator(target).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    });
    await page.screenshot({ path: png, clip, fullPage: true });
  } else await page.screenshot({ path: png });
  execFileSync("cwebp", ["-quiet", "-q", "82", png, "-o", path.join(out, name + ".webp")]);
}

// Fake camera: the real wing photo as a short 1280 px video (ffmpeg), so the
// live panel shows a wing and headless rendering stays light.
const video = path.join(tmp, "wing.y4m");
execFileSync("ffmpeg", ["-loglevel", "error", "-loop", "1", "-i", path.join(root, "test-data/difficult", FILE), "-t", "1", "-r", "10", "-vf", "scale=1280:-2,format=yuv420p", video]);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["camera"] }),
    page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("http://127.0.0.1:8000/#exemplar");
  await page.evaluate((r) => {
    localStorage.clear();
    localStorage.setItem("wingmate-references-v2", JSON.stringify(r));
  }, refs);
  await page.reload();
  await page.addStyleTag({ content: "*{transition:none!important}" });
  await shot(page, "01-exemplar-leer");

  // Live camera panel (fake camera pattern).
  await page.click('[data-live="venation"]');
  await page.waitForFunction(() => document.querySelector("#captureCard .status").textContent.includes("Kamera aktiv"));
  await page.waitForTimeout(1200);
  // The fake device is named after its temp file; show what a phone shows.
  await page.evaluate(() => {
    for (const o of document.querySelectorAll("#captureCard option")) if (o.textContent.includes(".y4m")) o.textContent = "Rückkamera";
    const s = document.querySelector("#captureCard .status");
    s.textContent = s.textContent.replace(/\/tmp\/\S+\.y4m/, "Rückkamera");
  });
  await shot(page, "02-live-kamera", "#captureCard");
  await page.click('#captureCard button:has-text("Schließen")');

  // Real wing, orientation not yet confirmed.
  await page.evaluate(async (f) => {
    const blob = await (await fetch("/test-data/difficult/" + f)).blob();
    await window.wingQC.load("venation", new File([blob], f, { type: "image/png" }));
  }, FILE);
  await page.waitForFunction(() => window.wingQC.items.venation?.result);
  await page.locator(".qc-item").scrollIntoViewIfNeeded();
  await shot(page, "03-pruefen", ".qc-item");
  // Orientation as a user would set it, then all 19 published landmarks (dataset y-up).
  await page.evaluate(async (flat) => {
    const it = window.wingQC.items.venation,
      H = it.image.height,
      pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], y: H - 1 - flat[i + 1] });
    const ap = (m, p) => ({ x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] });
    for (const [flipped180, mirrored] of [[false, false], [true, false], [false, true], [true, true]]) {
      Object.assign(it.options, { flipped180, mirrored, standardConfirmed: true });
      await window.wingQC.recalculate();
      const m = it.result.metadata.transformMatrix;
      if (ap(m, pts[15]).x < ap(m, pts[18]).x && ap(m, pts[6]).y < ap(m, pts[12]).y) break;
    }
    it.landmarks.points = pts.map((p, i) => (i < 16 ? p : undefined));
    await window.wingQC.recalculate();
  }, truth);
  await page.click(".lm-details > summary");
  await page.waitForTimeout(300);
  await shot(page, "04-landmarken", ".lm-details");
  await page.evaluate(async (flat) => {
    const it = window.wingQC.items.venation,
      H = it.image.height;
    for (let i = 16; i < 19; i++) it.landmarks.points[i] = { x: flat[2 * i], y: H - 1 - flat[2 * i + 1] };
    await window.wingQC.recalculate();
  }, truth);
  await shot(page, "05-leiste-freigeben", "#nextBar");
  const reason = page.locator(".qc-review-reason input");
  if (await reason.count()) await reason.fill("Original, Kontur und publizierte Aderkreuzungen geprüft; Randkontakt dokumentiert.");
  await page.click("#qcAccept");
  await page.waitForFunction(() => window.wingQC.items.venation?.accepted);
  await shot(page, "06-leiste-bestimmen", "#nextBar");
  await page.click("#refToggle");
  await page.fill("#speciesInput", "Bombus cryptarum");
  await page.fill("#specimenInput", "BUM0435");
  await page.selectOption("#sexInput", "M");
  await page.fill("#seriesInput", "Sammlung B");
  await shot(page, "07-als-referenz", "#nextBar");
  await page.click("#refCancel");

  // Train a model on the references.
  await page.click('.tabs a[data-view="referenzen"]');
  await page.fill("#trainingCard input[type=text]", "Bombus lucorum-Komplex · Beispiel");
  await page.click("#trainingCard button:has-text('Trainieren')");
  await page.waitForFunction(() => document.querySelector("#trainingCard .status").textContent.includes("aktiviert"), null, { timeout: 180000 });
  await page.locator("#trainingCard .disclosure-inline > summary").click();
  await shot(page, "08-training", "#trainingCard");

  // Identify with the frozen model.
  await page.click('.tabs a[data-view="exemplar"]');
  await page.click("#classifyBtn");
  await page.waitForTimeout(400);
  await shot(page, "09-ergebnis", "#view-ergebnis");

  await page.click('.tabs a[data-view="einstellungen"]');
  await shot(page, "10-rig", "#rigCard");

  // Phone overview.
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto("http://127.0.0.1:8000/#exemplar");
  await phone.addStyleTag({ content: "*{transition:none!important}" });
  await phone.evaluate(async (f) => {
    const blob = await (await fetch("/test-data/difficult/" + f)).blob();
    await window.wingQC.load("venation", new File([blob], f, { type: "image/png" }));
  }, FILE);
  await phone.waitForFunction(() => window.wingQC.items.venation?.result);
  await shot(phone, "11-handy");
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fs.readdirSync(out).map((f) => `${f} ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`).join("\n"));
})();
