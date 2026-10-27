import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('External output required');
await mkdir(output, { recursive: true });
const commands = [
  ['isolation', ['--test', 'tests/redesign/isolation.test.mjs', 'tests/redesign/source-guard.test.mjs']],
  ['agent-existing-ui', ['--test', 'lib/ai/agent/phase5d-ui.test.mjs']],
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']],
  ['typecheck-comparison', ['tests/redesign/typecheck.mjs', output]],
  ['lint', ['node_modules/eslint/bin/eslint.js', 'tests/redesign/']],
];
const results = [];
for (const [name, args] of commands) {
  const result = spawnSync(process.execPath, args, { env: process.env, encoding: 'utf8' });
  await writeFile(resolve(output, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  results.push({ name, command: `node ${args.join(' ')}`, exitCode: result.status });
  console.log(`${name}: exit ${result.status}`);
}
await writeFile(resolve(output, 'validation-results.json'), JSON.stringify(results, null, 2));
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
