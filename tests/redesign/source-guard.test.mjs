import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkSources } from './source-guard.mjs';
const hashes = JSON.parse((await readFile(new URL('./protected-source-hashes.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
test('recorded Phase 0a source hashes still match', async () => { await checkSources(); });
for (const path of Object.keys(hashes)) test(`rejects changed protected source: ${path}`, async () => {
  await assert.rejects(checkSources({ read: async file => String(file).replaceAll('\\', '/').endsWith(path) ? Buffer.from('changed source') : readFile(file) }), /Protected source changed/);
});
