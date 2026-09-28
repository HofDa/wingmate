import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
test('offline cache includes every runtime module and manifest icon', async () => {
  const sw = await readFile(new URL('sw.js', root), 'utf8');
  const scope = 'https://example.test/wingmate/';
  const files = vm.runInNewContext(`${sw}\nAPP_FILES`, {
    self: { registration: { scope }, addEventListener() {} }, URL,
  });
  for (const file of files) if (file !== './') await readFile(new URL(file, root));
  for (const dir of ['classifier', 'imaging']) {
    for (const file of await readdir(new URL(dir + '/', root))) {
      if (file.endsWith('.js')) assert.ok(files.includes(`./${dir}/${file}`), `Missing offline module: ${file}`);
    }
  }
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(new URL(manifest.start_url, scope).href, scope);
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    assert.ok(files.includes('./' + icon.src));
    const png = await readFile(new URL(icon.src, root));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});
