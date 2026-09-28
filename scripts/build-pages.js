import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const output = new URL('_site/', root);
const assets = ['index.html', 'styles.css', 'app.js', 'walk.js', 'pwa.js',
  'sw.js', 'manifest.webmanifest', 'icons', 'classifier', 'imaging'];

// Refuse to reuse a nonempty output directory, preventing stale files from shipping.
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw Error('The _site directory must be empty before building.');
for (const asset of assets) await cp(new URL(asset, root), new URL(asset, output), { recursive: true });

// Every changed deployment gets a fresh offline cache without a manual version bump.
const hash = createHash('sha256');
async function fingerprint(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) await fingerprint(url);
    else { hash.update(url.href.slice(output.href.length)); hash.update(await readFile(url)); }
  }
}
await fingerprint(output);
const version = `pages-${hash.digest('hex').slice(0, 16)}`;
const swFile = new URL('sw.js', output);
const sw = await readFile(swFile, 'utf8');
if (!/const VERSION = '[^']+';/.test(sw)) throw Error('Cannot locate the service worker cache version.');
await writeFile(swFile, sw.replace(/const VERSION = '[^']+';/, `const VERSION = '${version}';`));
await writeFile(new URL('.nojekyll', output), '');
console.log(`GitHub Pages artifact: _site (${version})`);
