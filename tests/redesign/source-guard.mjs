import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export async function checkSources({ read = readFile } = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const hashes = JSON.parse((await readFile(new URL('./protected-source-hashes.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
  for (const [path, expected] of Object.entries(hashes)) {
    const actual = createHash('sha256').update(await read(resolve(root, path))).digest('hex');
    if (actual !== expected) throw new Error(`Protected source changed: ${path}`);
  }
  return hashes;
}
