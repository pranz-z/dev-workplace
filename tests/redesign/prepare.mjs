import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildFixture, sha256 } from './build-fixture.mjs';

// Explicit package/font access only, invoked separately before the isolated
// capture process. No dotenv/config loader and no production app server.
const output = process.argv[2];
if (!output) throw new Error('Usage: node tests/redesign/prepare.mjs ABSOLUTE_EXTERNAL_OUTPUT');
if (process.argv[3] === '--offline') { await buildFixture(output); console.log('Fixture rebuilt offline using existing external font assets.'); process.exit(0); }
await mkdir(resolve(output, 'fonts'), { recursive: true });
const fonts = { caveat: 'Caveat:wght@500;700', kalam: 'Kalam:wght@300;400;700', geist: 'Geist:wght@400;500;600;700', 'geist-mono': 'Geist+Mono:wght@400;500;600' };
const manifest = [];
for (const [name, query] of Object.entries(fonts)) {
  // One Latin subset with needed weights from the official font host.
  const cssUrl = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
  const response = await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' }, redirect: 'error' });
  if (!response.ok) throw new Error(`Font CSS failed: ${name}`);
  const css = await response.text();
  const entries = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)];
  const latin = entries.filter(entry => /U\+0000-00FF/.test(entry[1]));
  if (!latin.length) { await writeFile(resolve(output, `${name}-font-response.css`), css); throw new Error(`Latin font declaration missing: ${name}`); }
  for (let index = 0; index < latin.length; index++) {
    const declaration = latin[index][1];
    const url = /url\((https:\/\/[^)]+)\)/.exec(declaration)?.[1];
    if (!url || new URL(url).hostname !== 'fonts.gstatic.com') throw new Error('Unexpected font asset host');
    const asset = await fetch(url, { redirect: 'error' });
    if (!asset.ok) throw new Error(`Font asset failed: ${name}`);
    const bytes = Buffer.from(await asset.arrayBuffer());
    const filename = `${name}-${index}.woff2`;
    await writeFile(resolve(output, 'fonts', filename), bytes);
    manifest.push({ name, filename, weight: /font-weight:\s*([^;]+)/.exec(declaration)?.[1], sha256: sha256(bytes), cssUrl, assetUrl: url });
  }
}
await writeFile(resolve(output, 'font-manifest.json'), JSON.stringify(manifest, null, 2));
await buildFixture(output);
console.log('Fixture bundle/CSS and fonts prepared outside repository. No application server started.');
