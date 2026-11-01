import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { checkSources } from './source-guard.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultEsbuild = 'C:/Users/Franz/.codex/visualizations/2026/10/04/01a1069b-4375-7fe2-a9b9-4435879efc5e/sql-runtime/node_modules/esbuild/lib/main.js';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function buildFixture(output, esbuildPath = defaultEsbuild, options = {}) {
  await checkSources();
  const { build } = await import(pathToFileURL(esbuildPath).href);
  const fixturePath = resolve(root, 'tests/redesign/fixtures.ts');
  const result = await build({ entryPoints: [resolve(root, options.entry ?? 'tests/redesign/fixture-entry.tsx')],
    absWorkingDir: root, outfile: resolve(output, 'fixture.js'), bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', metafile: true, tsconfig: resolve(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [...(options.plugins ?? []), { name: 'synthetic-boundaries', setup(builder) {
      builder.onResolve({ filter: /^@\/(components\/auth\/auth-provider|data\/agentInboxService)$/ }, () => ({ path: fixturePath }));
    } }],
  });
  const inputs = Object.keys(result.metafile.inputs).map(value => value.replaceAll('\\', '/'));
  for (const forbidden of ['components/auth/auth-provider.tsx', 'data/agentInboxService.ts', 'data/context.ts', 'lib/supabase/', 'app/api/']) {
    if (inputs.some(value => !value.startsWith('matrix-service:') && value.includes(forbidden))) throw new Error(`Live boundary included in fixture: ${forbidden}`);
  }
  if (!inputs.some(value => value.endsWith('components/ai/AgentInbox.tsx'))) throw new Error('Real AgentInbox is missing');
  const cssSource = await readFile(resolve(root, 'app/globals.css'), 'utf8');
  const css = await postcss([tailwind({ base: root, optimize: false })]).process(cssSource, { from: resolve(root, 'app/globals.css') });
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'fixture.js'), result.outputFiles.find(file => file.path.endsWith('.js')).contents);
  const combinedCss = css.css + '\n' + result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  await writeFile(resolve(output, 'app.css'), combinedCss);
  const sources = {};
  for (const path of ['app/globals.css', 'app/fonts.ts', 'app/app/page.tsx', 'components/workspace/WorkspaceGreeting.tsx', 'components/calendar/WorkspaceCalendar.tsx', 'components/accountability/accountability-workspace.tsx', 'components/workspace/WorkspaceShell.tsx', 'components/auth/user-menu.tsx', 'components/projects/project-screenshots.tsx', 'components/tasks/TaskKanbanBoard.tsx', 'components/google-drive/DriveFiles.tsx', 'components/github/repository-browser.tsx', 'components/github/project-activity.tsx', 'components/ai/AgentInbox.tsx', 'components/ai/WorkspaceAiChat.tsx', 'components/auth/auth-provider.tsx', 'data/agentInboxService.ts', 'package-lock.json', 'tests/redesign/fixtures.ts', 'tests/redesign/fixture-entry.tsx']) sources[path] = sha256(await readFile(resolve(root, path)));
  for (const path of inputs.filter(path => path.startsWith('tests/redesign/'))) sources[path] = sha256(await readFile(resolve(root, path)));
  await writeFile(resolve(output, 'build-manifest.json'), JSON.stringify({ sources, inputs, cssSha256: sha256(combinedCss), esbuildVersion: (await import(pathToFileURL(esbuildPath).href)).version }, null, 2));
}
