// NODE_PATH=/path/to/node_modules node scripts/markov-ui-e2e.cjs
// Requires the app server on 127.0.0.1:8000. Synthetic chains exercise UI
// presentation and controls independently of the image-processing pipeline.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8000');
    await page.waitForFunction(() => window.wingShell);
    await page.evaluate(async () => {
      const { createWalkView, traceWalk } = await import('./walk.js');
      const original = document.querySelector('#walkView'), root = original.cloneNode(true);
      original.replaceWith(root);
      window.walkTest = { view: createWalkView(root), traceWalk };
      window.wingShell.show('ergebnis');
      document.querySelector('#walkView').open = true;
      const P = [[[1, .7], [2, .3]], [[0, 1]], [[0, .4], [1, .6]], [[0, .5], [2, .5]]];
      window.walkTest.view.show({ P, query: 3, labels: ['Bombus A · #1', 'Bombus A · #2', 'Bombus B · #3', 'Dein Exemplar'], taxa: ['Bombus A', 'Bombus A', 'Bombus B', null], restart: .2, ...traceWalk(P, 3, { random: () => .5 }) });
    });
    const root = page.locator('#walkView');
    assert.equal(await root.locator('[data-query-mass]').textContent(), '100,0 %');
    assert.equal(await root.locator('[data-ref-mass]').textContent(), '0,0 %');
    assert.deepEqual(await root.locator('[data-taxa] .walk-score').allTextContents(), ['—', '—']);
    const positions = () => root.locator('[data-graph] g').evaluateAll(nodes => nodes.map(node => [node.dataset.node, node.querySelector('circle').getAttribute('cx'), node.querySelector('circle').getAttribute('cy')]));
    const initial = await positions();
    await root.locator('[data-next]').click();
    assert.equal(await root.locator('[data-counter]').textContent(), 'Schritt 1 / 40');
    assert.equal(await root.locator('[data-ref-mass]').textContent(), '80,0 %');
    assert.deepEqual(await root.locator('[data-taxa] .walk-score').allTextContents(), ['33,3 %', '66,7 %']);
    assert.deepEqual(await positions(), initial);
    await root.locator('[data-prev]').click();
    assert.equal(await root.locator('[data-counter]').textContent(), 'Schritt 0 / 40');
    await root.locator('[data-end]').click();
    assert.equal(await root.locator('[data-counter]').textContent(), 'Schritt 40 / 40');
    assert.match(await root.locator('[data-score-note]').textContent(), /Random-Walk-Balken/);
    await root.locator('[data-graph] [data-node="0"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await root.locator('[data-selected-title]').textContent(), 'Bombus A · #1');
    assert.equal(await root.locator('[data-graph] [data-node="0"]').getAttribute('aria-pressed'), 'true');
    await root.locator('[data-example]').uncheck();
    assert.equal(await root.locator('[data-status]').isVisible(), false);
    assert.equal(await root.locator('[data-graph] [marker-end="url(#walk-arrow)"]').count(), 0);
    await root.locator('[data-reset]').click();
    await root.locator('[data-play]').click();
    await page.waitForTimeout(1100);
    assert.equal(await root.locator('[data-counter]').textContent(), 'Schritt 1 / 40');
    await root.locator('[data-play]').click();
    await page.waitForTimeout(1100);
    assert.equal(await root.locator('[data-counter]').textContent(), 'Schritt 1 / 40');
    await root.locator('[data-end]').click();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflow at ' + width);
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: `/tmp/wingmate-markov-${width}.png`, fullPage: true });
    }
    // Force a self-restart, then check the orange dashed loop.
    await page.evaluate(() => {
      const { view, traceWalk } = window.walkTest, P = [[[1, 1]], [[0, 1]]];
      view.show({ P, query: 0, labels: ['Dein Exemplar', 'Bombus A · #2'], taxa: [null, 'Bombus A'], ...traceWalk(P, 0, { random: () => 0 }) });
    });
    await root.locator('[data-example]').check();
    await root.locator('[data-next]').click();
    assert.equal(await root.locator('path[marker-end="url(#walk-arrow)"]').getAttribute('stroke-dasharray'), '7 5');
    // Larger collections keep a stable subset and retain every node in the table.
    await page.evaluate(() => {
      const { view, traceWalk } = window.walkTest, n = 50;
      const P = Array.from({ length: n }, (_, i) => [[(i + 1) % n, 1]]);
      view.show({ P, query: n - 1, labels: Array.from({ length: n }, (_, i) => i === n - 1 ? 'Dein Exemplar' : `Bombus ${i % 3} · #${i + 1}`), taxa: Array.from({ length: n }, (_, i) => i === n - 1 ? null : `Bombus ${i % 3}`), ...traceWalk(P, n - 1, { random: () => .5 }) });
    });
    const subset = await positions();
    assert.equal(subset.length, 13);
    assert.equal(await root.locator('[data-nodes] tr').count(), 50);
    await root.locator('[data-end]').click();
    assert.deepEqual(await positions(), subset);
    assert.match(await root.locator('[data-limit]').textContent(), /13 von 50/);
    await page.evaluate(() => window.walkTest.view.reset());
    assert.equal(await root.locator('[data-content]').isVisible(), false);
    assert.equal(await root.locator('[data-empty]').isVisible(), true);
    assert.equal(await root.locator('[data-nodes] tr').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: probability summaries, balanced scores, stable layout, keyboard node selection, stepping, playback, example toggle, self-restarts, large collections, reset and 320/390/1280 px layouts.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
