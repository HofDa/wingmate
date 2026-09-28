const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const b = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:8000");
  const report = await p.evaluate(async () => {
    const { preprocess } = await import("/imaging/pipeline.js");
    const blob = await (
        await fetch("/test-data/venation/Spiesman-S2-F-Bombus-perplexus.png")
      ).blob(),
      im = await createImageBitmap(blob);
    const results = [],
      runs = [];
    for (const [angle, scale, dx, dy, bg] of [
      [0, 1, 0, 0, 235],
      [25, 1, 0, 0, 235],
      [90, 1, 0, 0, 235],
      [180, 1, 0, 0, 235],
      [0, 1, 30, -25, 235],
      [0, 0.7, 0, 0, 235],
      [0, 1.25, 0, 0, 235],
      [0, 1, 0, 0, 225],
    ]) {
      const c = document.createElement("canvas");
      c.width = c.height = 800;
      const ctx = c.getContext("2d");
      ctx.fillStyle = `rgb(${bg} ${bg} ${bg})`;
      ctx.fillRect(0, 0, 800, 800);
      ctx.translate(400 + dx, 400 + dy);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.drawImage(im, -im.width / 2, -im.height / 2);
      const r = preprocess(ctx.getImageData(0, 0, 800, 800));
      runs.push(r);
      let i = 0,
        u = 0;
      const base = runs[0].normalized.mask;
      for (let p = 0; p < base.length; p++) {
        if (base[p] && r.normalized.mask[p]) i++;
        if (base[p] || r.normalized.mask[p]) u++;
      }
      results.push({
        angle,
        scale,
        dx,
        dy,
        bg,
        maskIoU: i / u,
        status: r.metadata.maskQuality.status,
      });
    }
    return results;
  });
  console.log(report);
  fs.writeFileSync(
    "test-data/real-invariance.json",
    JSON.stringify(
      {
        source: "venation/Spiesman-S2-F-Bombus-perplexus.png",
        note: "Controlled affine perturbations on padded canvas; not independent captures",
        results: report,
      },
      null,
      2,
    ),
  );
  await b.close();
})();
