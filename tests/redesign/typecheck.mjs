import ts from 'typescript';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

const output = process.argv[2];
const loaded = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, process.cwd());
const options = { ...config.options, noEmit: true, incremental: false };
const check = files => ts.getPreEmitDiagnostics(ts.createProgram(files, options));
const key = diagnostic => `${diagnostic.file?.fileName}:${diagnostic.start}:${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
const harnessFiles = config.fileNames.filter(file => file.replaceAll('\\', '/').includes('tests/redesign/'));
const baseline = check(config.fileNames.filter(file => !harnessFiles.includes(file)));
const full = check(config.fileNames);
// Preserve existing ambient Next/CSS declarations for imported components;
// exclude route/layout roots rather than accidentally dropping ambient types.
const harness = check([...new Set([...harnessFiles, ...config.fileNames.filter(file => file.endsWith('.d.ts')), resolve('node_modules/next/types/global.d.ts')])]);
const format = diagnostics => ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' });
await writeFile(resolve(output, 'typecheck-baseline.log'), format(baseline));
await writeFile(resolve(output, 'typecheck-harness.log'), format(harness));
const same = JSON.stringify(full.map(key).sort()) === JSON.stringify(baseline.map(key).sort());
await writeFile(resolve(output, 'typecheck-comparison.json'), JSON.stringify({ baselineDiagnostics: baseline.map(key), fullDiagnostics: full.map(key), same, harnessDiagnostics: harness.map(key) }, null, 2));
console.log(`Baseline diagnostics: ${baseline.length}; full: ${full.length}; identical: ${same}; harness entry diagnostics: ${harness.length}`);
if (!same || harness.length) process.exitCode = 1;
