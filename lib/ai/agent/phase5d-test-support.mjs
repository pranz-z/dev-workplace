import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
export async function loadPulse(modulePath) {
  const cache = new Map();
  function load(file) {
    assert.ok(existsSync(file), `Missing Phase 5D implementation: ${file}`);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'exports', source)(name => {
      if (name === 'server-only') return {};
      if (name.startsWith('@/')) return load(resolve(root, `${name.slice(2)}.ts`));
      if (name.startsWith('.')) return load(resolve(dirname(file), `${name}.ts`));
      return require(name);
    }, exports);
    return exports;
  }
  return load(resolve(root, modulePath));
}

export const complete = { complete: true };
export const project = (overrides = {}) => ({
  id: 'project-a', userId: 'owner', title: 'Project', status: 'In Development',
  workflowStage: 'development', targetDate: null, priority: 'High',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  sourceToken: 'sql-project', ...overrides,
});
export const task = (overrides = {}) => ({
  id: 'task-a', userId: 'owner', projectId: 'project-a', title: 'Task',
  status: 'Todo', priority: 'High', dueDate: '2026-10-15',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  completedAt: null, sourceToken: 'sql-task', ...overrides,
});
export const milestone = (overrides = {}) => ({
  id: 'milestone-a', userId: 'owner', projectId: 'project-a', title: 'Milestone',
  status: 'pending', targetDate: '2026-10-15',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  sourceToken: 'sql-milestone', ...overrides,
});
export const block = (overrides = {}) => ({
  id: 'block-a', userId: 'owner', projectId: 'project-a', taskId: 'task-a',
  kind: 'focus', status: 'scheduled', startAt: '2026-10-15T09:00:00Z',
  endAt: '2026-10-15T10:00:00Z', ...overrides,
});
export function makeSource(overrides = {}) {
  return {
    userId: 'owner', evaluatedAt: '2026-10-15T08:00:00Z', timeZone: 'UTC',
    settingsRevision: 1, policyVersion: 'pulse-v1', projects: [project()], tasks: [],
    milestones: [], blocks: [], preferences: null, existing: [],
    coverage: { projects: complete, tasks: complete, milestones: complete, blocks: complete },
    taskBlocks: {}, projectActivity: {}, targetChecks: {}, baseline: {},
    tomorrowSourceToken: 'sql-tomorrow', ...overrides,
  };
}
