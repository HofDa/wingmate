// Browser integration test: node scripts/pwa-smoke.cjs (requires Playwright + Chrome).
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.PWA_SITE_ROOT ? path.resolve(process.env.PWA_SITE_ROOT) : path.resolve(__dirname, '..');
let version = 'v1';
const mime = {'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server = http.createServer(async (req,res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname.replace(/^\/nested\//, '/');
    const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    let body = await fs.readFile(file);
    if (file.endsWith('/sw.js')) body = body.toString().replace(/const VERSION = '[^']+'/, `const VERSION = '${version}'`);
    res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  } catch { res.writeHead(404);res.end(); }
});
(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const contexts=[];
  try {
    for (const prefix of ['/', '/nested/']) {
      version='v1';
      const context=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox']});contexts.push(context);const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+prefix);
      await page.waitForFunction(()=>document.querySelector('#pwaStatus').textContent==='Offline bereit');
      await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
      const manifest=await cdp.send('Page.getAppManifest');assert.deepEqual(manifest.errors,[]);
      const install=await cdp.send('Page.getInstallabilityErrors');assert.deepEqual(install.installabilityErrors,[]);
      // Store an archived specimen through the real storage module before going offline.
      await page.evaluate(async()=>{
        localStorage.setItem('pwa-persistence-check','retained');
        const {saveSpecimen}=await import('./imaging/storage.js');
        await saveSpecimen({});
      });
      await context.setOffline(true);
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('#pwaStatus').textContent==='Offline · lokal nutzbar');
      const result=await page.evaluate(async()=>{
        const {latestSpecimen}=await import('./imaging/storage.js');
        const {traceWalk}=await import('./walk.js');
        const workerResult=await new Promise((resolve,reject)=>{
          const worker=new Worker(new URL('./imaging/worker.js',location.href),{type:'module'});
          const timeout=setTimeout(()=>{worker.terminate();reject(Error('Worker timed out'));},10000);
          worker.onerror=e=>{clearTimeout(timeout);worker.terminate();reject(Error(e.message));};
          worker.onmessage=e=>{clearTimeout(timeout);worker.terminate();resolve(e.data);};
          worker.postMessage({id:'offline-worker',image:{width:16,height:16,data:new Uint8ClampedArray(1024).fill(255)},options:{}});
        });
        return {saved:!!await latestSpecimen(),local:localStorage.getItem('pwa-persistence-check'),steps:traceWalk([[[1,1]],[[0,1]]],0).path.length,worker:workerResult.id};
      });
      assert.deepEqual(result,{saved:true,local:'retained',steps:41,worker:'offline-worker'});
      await page.setViewportSize({width:390,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await context.setOffline(false);
      version='v2';
      await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
      await page.waitForFunction(()=>!document.querySelector('#updateApp').hidden);
      assert.ok(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting));
      await page.click('#updateApp');
      await page.waitForFunction(async()=>!(await navigator.serviceWorker.getRegistration()).waiting && (await caches.keys()).some(k=>k.endsWith(':v2')));
      await page.waitForFunction(()=>document.querySelector('#pwaStatus').textContent==='Offline bereit');
      assert.equal(await page.evaluate(()=>localStorage.getItem('pwa-persistence-check')),'retained');
      assert.ok(await page.evaluate(async()=>!(await caches.keys()).some(k=>k.endsWith(':v1'))));
      assert.deepEqual(errors,[]);
      console.log(`PASS ${prefix}: installability, offline reload, worker, walk, storage, mobile, controlled update`);
      await context.close();
    }
  } finally { await Promise.all(contexts.map(context=>context.close()));server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
