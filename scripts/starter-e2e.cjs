// Local browser test of starter installation, inference, attribution and export.
const { chromium } = require("playwright");
const http = require("node:http"), fs = require("node:fs/promises"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer(async (req, res) => {
  try {
    const name = new URL(req.url, "http://localhost").pathname.replace(/^\/nested\//, "/");
    const file = path.resolve(root, "." + name + (name.endsWith("/") ? "index.html" : ""));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "text/plain" }); res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  try {
    for (const prefix of ["/", "/nested/"]) {
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
      await page.waitForFunction(() => document.querySelector("#pwaStatus").textContent === "Offline bereit");
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.evaluate(() => window.wingShell.show("referenzen"));
      await page.getByText("Veröffentlichtes Startmodell (3 Bombus-Arten)", { exact: true }).click();
      await context.setOffline(true);
      await page.getByText("Apis mellifera · veröffentlichte Referenzdaten", { exact: true }).click();
      const [apisDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Apis-Referenzsammlung herunterladen (ODbL-1.0)", exact: true }).click()]);
      const apis = JSON.parse(await fs.readFile(await apisDownload.path(), "utf8"));
      assert.equal(apis.references.length, 1342);
      assert.equal(apis.attribution.license, "ODbL-1.0");
      assert.equal(apis.landmarkScheme, "apis-nawrocka-2018-19");
      assert.match(apis.attribution.citation, /18845767/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole("button", { name: "Bombus-Startmodell laden", exact: true }).click();
      await page.waitForFunction(() => window.wingClassifier.state.model?.model.starter);
      assert.match(await page.locator(".train-report").innerText(), /19703357/);
      assert.match(await page.locator(".train-report").innerText(), /ODbL-1.0/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.evaluate(async () => {
        const data = await (await fetch("./models/bombus-starter/references.json")).json();
        const r = data.references[0];
        window.wingClassifier.state.query = { features: r.features, preprocessing: { version: r.preprocessingVersion } };
        Object.assign(document.querySelector("#classifyBtn"), { disabled: false, hidden: false });
        window.wingShell.show("exemplar");
      });
      await page.locator("#classifyBtn").click();
      assert.match(await page.locator("#classifyStatus").innerText(), /Standardverfahren/);
      assert.match(await page.locator("#ldaResult").innerText(), /ODbL-1.0/);
      assert.match(await page.locator("#ldaResult").innerText(), /unzureichend kalibriert/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.evaluate(() => window.wingShell.show("referenzen"));
      await page.getByText("Modelle verwalten", { exact: true }).click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportieren", exact: true }).click()]);
      const exported = JSON.parse(await fs.readFile(await download.path(), "utf8"));
      assert.equal(exported.attribution.license, "ODbL-1.0");
      assert.equal(exported.starter.independentTest, false);
      await page.reload();
      await page.waitForFunction(() => window.wingClassifier.state.model?.model.starter);
      assert.equal(await page.evaluate(() => window.wingClassifier.state.references.length), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS ${prefix}: offline Apis collection download, starter, mobile layout, inference, citation, export, reload; personal references unchanged`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e); server.close(); process.exitCode = 1; });
