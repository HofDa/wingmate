// Run with Playwright available: node scripts/generate-pwa-icons.cjs
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const svg = await fs.readFile(path.join(root, 'icons/wing.svg'), 'utf8');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    for (const [name, size, maskable] of [['icon-192',192,false],['icon-512',512,false],['maskable-512',512,true],['apple-touch-icon',180,true]]) {
      await page.setViewportSize({ width:size, height:size });
      await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#1f6e4b}svg{width:100%;height:100%;display:block}</style>${maskable ? svg.replace('rx="104"', 'rx="0"') : svg}`);
      await page.screenshot({ path:path.join(root,`icons/${name}.png`) });
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
