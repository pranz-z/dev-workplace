import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultEsbuild } from './build-fixture.mjs';

// The existing CMS test fails during bundling, before its loopback server is
// created. Its PGlite database is in-memory. Do not fix the existing test here.
const output = process.argv[2];
const result = spawnSync(process.execPath, ['--test', 'lib/portfolio/cms-editor.test.mjs'], {
  encoding: 'utf8', env: { ...process.env,
    PORTFOLIO_TEST_ESBUILD_MODULE: defaultEsbuild,
    PORTFOLIO_TEST_PGLITE_MODULE: 'C:/Users/Franz/AppData/Local/Temp/workspace-agent-phase2-tools/node_modules/@electric-sql/pglite/dist/index.js',
  },
});
const log = `${result.stdout ?? ''}${result.stderr ?? ''}`;
await writeFile(resolve(output, 'cms-baseline.log'), log);
assert.notEqual(result.status, 0, 'Expected historical failure did not reproduce; inspect baseline result');
assert.match(log, /Cannot import .*PortfolioHero\.module\.css.*without an output path configured/);
console.log('Existing CMS CSS/esbuild failure reproduced unchanged; see cms-baseline.log. This is an expected baseline failure, not a green CMS suite.');
