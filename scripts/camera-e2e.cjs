// End-to-end check of camera capture + rig calibration with Chrome's fake
// camera fed by synthetic Y4M videos: (1) empty rig -> calibrate & save
// profile, (2) same browser profile, rig with wing -> capture -> QC.
// Usage: NODE_PATH=/path/to/node_modules node scripts/camera-e2e.cjs
// Needs an HTTP server for the project root at 127.0.0.1:8000 (localhost is a
// secure context, so getUserMedia works without HTTPS).
const { chromium } = require("playwright");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");

const W = 640,
  H = 480,
  FRAMES = 20,
  UMPP = 5; // µm per pixel of the synthetic rig
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wingmate-cam-"));

// Same wing silhouette as tests/fixtures.js, 400 px long, centred.
function inside(x, y) {
  const u = x - W / 2,
    v = y - H / 2,
    t = (u + 200) / 400;
  if (t <= 0 || t >= 1) return false;
  const half = 90 * Math.sin(Math.PI * t) ** 0.65 * (0.3 + 0.7 * t),
    centre = 14 * Math.sin(t * Math.PI);
  return Math.abs(v - centre) < half;
}
function rgb(x, y, wing, rnd) {
  const r2 = ((x - W / 2) ** 2 + (y - H / 2) ** 2) / (W / 2) ** 2,
    light = 230 * (1 - 0.35 * Math.min(1, r2)),
    t = wing && inside(x, y) ? 0.45 : 1,
    n = () => (rnd() - 0.5) * 6;
  return [light * t + n(), light * 0.9 * t + n(), light * 0.8 * t + n()];
}
function y4m(file, wing) {
  let seed = wing ? 7 : 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296),
    header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`),
    chunks = [header];
  for (let f = 0; f < FRAMES; f++) {
    const Y = Buffer.alloc(W * H),
      U = Buffer.alloc((W * H) / 4),
      V = Buffer.alloc((W * H) / 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const [r, g, b] = rgb(x, y, wing, rnd),
          yy = 0.299 * r + 0.587 * g + 0.114 * b;
        Y[y * W + x] = Math.max(0, Math.min(255, Math.round(yy)));
        if (!(x % 2) && !(y % 2)) {
          const i = (y / 2) * (W / 2) + x / 2;
          U[i] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)));
          V[i] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)));
        }
      }
    chunks.push(Buffer.from("FRAME\n"), Y, U, V);
  }
  fs.writeFileSync(file, Buffer.concat(chunks));
  return file;
}

async function session(video, fn) {
  const context = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
    viewport: { width: 1400, height: 1000 },
    permissions: ["camera"],
  });
  const page = context.pages()[0] ?? (await context.newPage()),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto("http://127.0.0.1:8000");
  try {
    return { ...(await fn(page)), errors };
  } finally {
    await context.close();
  }
}
const waitStatus = (page, text) =>
  page.waitForFunction((t) => document.querySelector("#captureCard .status").textContent.includes(t), text, { timeout: 60000 });

(async () => {
  const empty = y4m(path.join(tmp, "empty.y4m"), false),
    wing = y4m(path.join(tmp, "wing.y4m"), true);

  const calibration = await session(empty, async (page) => {
    await page.click('[data-live="venation"]');
    await waitStatus(page, "Kamera aktiv");
    await page.waitForTimeout(800);
    const meters = await page.evaluate(() => document.querySelector(".cam-meters").textContent);
    await page.click("#captureCard .cam-calibration summary");
    await page.locator("#captureCard .cam-steps li").first().locator("button").click();
    await waitStatus(page, "Kalibrieraufnahme gespeichert");
    // Ruler step: set the two points programmatically (400 px = 2 mm at 5 µm/px).
    await page.evaluate(({ umpp }) => {
      const d = window.wingCamera.draft;
      d.scaleImage = { width: 640, height: 480 };
      d.scale = { micrometersPerPixel: umpp, source: "e2e synthetic ruler", points: [], distanceMm: 2 };
    }, { umpp: UMPP });
    await page.fill("#captureCard input[type=text]", "E2E-Rig");
    await page.click("text=Rig speichern & aktivieren");
    await waitStatus(page, "gespeichert und aktiviert");
    await page.evaluate(() => window.wingShell.show("einstellungen"));
    return { meters, rigInfo: await page.textContent("#rigCard p.mini:nth-of-type(2)") };
  });

  const capture = await session(wing, async (page) => {
    await page.click('[data-live="venation"]');
    await waitStatus(page, "Kamera aktiv");
    await page.waitForTimeout(800);
    await page.selectOption("#captureCard select >> nth=0", "venation");
    await page.click('#captureCard .cam-toolbar button:has-text("Aufnehmen")');
    await page.waitForFunction(() => window.wingQC.items.venation?.result, null, { timeout: 60000 });
    return page.evaluate(({ W, H }) => {
      const item = window.wingQC.items.venation,
        m = item.result.metadata,
        mask = item.result.mask;
      // Ground truth from the generator's geometry (analysis = full 640 × 480).
      let i = 0,
        u = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const uu = x - W / 2,
            v = y - H / 2,
            t = (uu + 200) / 400,
            half = t > 0 && t < 1 ? 90 * Math.sin(Math.PI * t) ** 0.65 * (0.3 + 0.7 * t) : 0,
            truth = t > 0 && t < 1 && Math.abs(v - 14 * Math.sin(t * Math.PI)) < half,
            a = mask[y * W + x];
          if (a && truth) i++;
          if (a || truth) u++;
        }
      return {
        rigNote: item.rigNote,
        method: m.segmentationMethod,
        radiometric: m.radiometricCorrection?.method,
        drift: m.rigDrift,
        metricSize: m.metricSize,
        capture: m.capture,
        iou: i / u,
        qcText: document.querySelector("#qcImages").textContent.slice(0, 400),
      };
    }, { W, H });
  });

  console.log(JSON.stringify({ calibration, capture }, null, 2));
  const c = capture;
  const ok =
    !calibration.errors.length &&
    !c.errors.length &&
    c.method === "rig-background-difference-close-fill-largest" &&
    c.radiometric === "flat-field" &&
    c.drift?.status === "ok" &&
    c.iou > 0.95 &&
    Math.abs(c.metricSize.wingLengthMm - 2) < 0.08 &&
    c.capture?.frames === 4;
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})();
