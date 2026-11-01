import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = resolve(import.meta.dirname, '../../..'), require = createRequire(import.meta.url);
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const itemId = '44444444-4444-4444-8444-444444444444', targetId = '55555555-5555-4555-8555-555555555555';
const stamp = '2026-10-17T08:00:00.000000Z';
const settings = (patch = {}) => ({ settings: { mode: 'off', cadence: 'normal', settingsRevision: 0, policyVersion: 'pulse-v1',
  checksConsented: false, aiConsented: false, aiProjectIds: [], aiEligible: false, timezoneReadiness: 'configured', checksEnabled: false,
  nextDueAt: null, lastSuccessAt: null, lastDeterministicAt: null, coverage: { complete: false, unknown: 0 },
  usage: { ownerPulses: 0, ownerRequests: 0, installationRequests: 0, ownerIdeas: 0 }, ...patch },
  disclosures: { checksConsentVersion: 'checks-v1', aiConsentVersion: 'ai-v1' }, projectChoices: [], projectChoicesTruncated: false });
const item = (patch = {}) => ({ id: itemId, kind: 'signal', title: 'Canonical task', summary: 'Deadline today.', explanation: 'Recorded facts.',
  state: 'active', target: { type: 'task', id: targetId }, rowRevision: 3, contentRevision: 2, seen: false, stale: false, unavailable: false,
  watching: false, reasonCodes: ['DEADLINE_TODAY'], firstNoticedAt: stamp, lastCheckedAt: stamp, snoozeUntil: null, revisitAt: null, ...patch });
const detail = () => ({ item: item(), reviewContext: { targetLabel: 'Canonical task', deterministicSummary: 'Deadline today.', deterministicExplanation: 'Recorded facts.', advisoryIdea: null } });
const journal = (patch = {}) => ({ id: itemId, status: 'succeeded', startedAt: stamp, completedAt: stamp, summary: 'Checked current workspace.',
  createdCount: 1, updatedCount: 0, resolvedCount: 0, aiOutcome: 'none', errorCode: null, coverage: { complete: true, unknown: 0 },
  checkedCounts: { projects: 1, tasks: 1, milestones: 0, blocks: 0 }, ...patch });
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function load(path, overrides = {}) {
  const cache = new Map();
  function module(file) {
    assert.ok(existsSync(file), `Task22 implementation missing: ${file}`);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'exports', source)(name => {
      if (name in overrides) return overrides[name];
      if (name === 'server-only') return {};
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? resolve(root, name.slice(2)) : resolve(dirname(file), name);
        return module(['.ts', '.tsx', '.mjs'].map(ext => base + ext).find(existsSync) ?? base + '.ts');
      }
      return require(name);
    }, exports); return exports;
  }
  return module(resolve(root, path));
}
const service = () => load('data/agentInboxService.ts').agentInboxService;
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) :
  [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) :
  Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
function find(tree, label, kind) {
  const result = nodes(tree).find(node => (!kind || node.type === kind) && (node.props?.['aria-label'] === label || text(node.props?.children).trim() === label));
  assert.ok(result, `Missing control/text: ${label}`); return result;
}
const changed = value => ({ target: { value, checked: value }, preventDefault() {} });

/** Test-only hook host: execute real component callbacks, effects and rendered elements without a DOM dependency. */
function mount(path, name, props = {}, api = {}, initialAuth = { status: 'authenticated', user: { id: owner } }) {
  let cells = [], effects = [], cursor = 0, dirty = true, tree, auth = initialAuth, sessionKey;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = { ...React,
    useState(initial) { const i = cursor++; cells[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [cells[i].value, value => { const next = typeof value === 'function' ? value(cells[i].value) : value; if (!Object.is(next, cells[i].value)) { cells[i].value = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; cells[i] ??= { value: { current: initial } }; return cells[i].value; },
    useMemo(fn, deps) { const i = cursor++; if (!cells[i] || !depsEqual(cells[i].deps, deps)) cells[i] = { value: fn(), deps }; return cells[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || !depsEqual(effects[i].deps, deps)) effects[i] = { ...effects[i], fn, deps, pending: true }; },
  };
  const exports = load(path, { react, '@/components/auth/auth-provider': { useAuth: () => auth },
    ...(Object.keys(api).length ? { '@/data/agentInboxService': { agentInboxService: api, AgentInboxError: load('data/agentInboxService.ts').AgentInboxError, inboxErrorMessage: error => error.message || 'Agent data is unavailable.' } } : {}) });
  assert.equal(typeof exports[name], 'function', `Task22 ${name} missing`);
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); };
  const render = () => {
    cursor = 0; dirty = false; tree = exports[name](props);
    if (typeof tree?.type === 'function' && /Session$/.test(tree.type.name)) {
      if (sessionKey !== undefined && sessionKey !== tree.key) { cleanup(); cells = []; effects = []; cursor = 0; }
      sessionKey = tree.key; tree = tree.type(tree.props);
    }
    return tree;
  };
  const flush = async () => {
    for (let i = 0; i < 30; i++) {
      if (dirty) render();
      for (const effect of effects) if (effect?.pending) { effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.fn(); }
      await Promise.resolve(); await Promise.resolve();
    }
    if (dirty) render(); return tree;
  };
  render();
  return { get tree() { return tree; }, flush, unmount: cleanup,
    owner(next) { auth = next; dirty = true; render(); }, props(next) { props = { ...props, ...next }; dirty = true; render(); } };
}
const apiDefaults = overrides => ({ getPulseSettings: async () => settings(), getInboxPage: async () => ({ items: [], nextCursor: null }),
  getPulseBrief: async () => ({ items: [], lastCheckedAt: null }),
  getInboxDetail: async () => detail(), getPulseJournal: async () => ({ items: [], nextCursor: null }),
  ackInbox: async () => ({ acknowledged: 1 }), sendInboxFeedback: async () => ({ id: itemId, state: 'dismissed', rowRevision: 4, contentRevision: 2 }),
  updatePulseSettings: async () => settings({ settingsRevision: 1 }), clearPulseMemory: async () => ({ cleared: true, settingsRevision: 1 }), ...overrides });
const inbox = (props = {}, api = {}) => mount('components/ai/AgentInbox.tsx', 'AgentInbox', { onReview() {}, ...props }, apiDefaults(api));
const settingsUi = (api = {}) => mount('components/ai/AgentPulseSettings.tsx', 'AgentPulseSettings', { onChanged() {} }, apiDefaults(api));

/** Mount the actual panel selected by the shell, including its real session effects. */
function workspacePanels(api, props = {}) {
  const shell = mount('components/ai/WorkspaceAiChat.tsx', 'WorkspaceAiChat', {
    projects: [], tasks: [], plans: [], open: true, onOpenChange() {}, ...props,
  }, api);
  let panel, selected;
  return { shell, get panel() { return panel; },
    async flush() {
      await shell.flush();
      const elements = nodes(shell.tree).filter(node => ['AgentInbox', 'AgentPulseSettings'].includes(node.type?.name));
      assert.ok(elements.length <= 1, 'Settings and Inbox must never mount together');
      const element = elements[0];
      if (element?.type !== selected) {
        panel?.unmount(); panel = undefined; selected = element?.type;
        if (element) panel = mount(`components/ai/${element.type.name}.tsx`, element.type.name, element.props, api);
      }
      if (panel) await panel.flush();
    },
    unmount() { panel?.unmount(); shell.unmount(); },
  };
}

function settingsSurfaceFixture(t) {
  const previous = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  let h;
  t.after(() => { h?.unmount(); globalThis.window = previous; });
  const observation = item(), original = structuredClone(observation), calls = [];
  let canonical = { ...settings({ mode: 'workspace', settingsRevision: 1, checksConsented: true, checksEnabled: true }),
    projectChoices: [{ id: targetId, title: 'Synthetic project' }] };
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(options.credentials, 'same-origin');
    const method = options.method; calls.push({ path, method, body: options.body && JSON.parse(options.body) });
    if (path === '/api/ai/agent/pulse-settings' && method === 'GET') return Response.json(canonical);
    if (path === '/api/ai/agent/pulse-settings' && method === 'POST') {
      const input = JSON.parse(options.body); assert.equal(input.expectedRevision, canonical.settings.settingsRevision);
      const aiConsented = input.aiConsentVersion === 'ai-v1';
      canonical = { ...canonical, settings: { ...canonical.settings, mode: input.mode, cadence: input.cadence,
        settingsRevision: input.expectedRevision + 1, checksConsented: input.checksConsentVersion === 'checks-v1',
        aiConsented, aiProjectIds: input.aiProjectIds, aiEligible: input.mode === 'workspace_ai' && aiConsented && input.aiProjectIds.length > 0 } };
      return Response.json(canonical);
    }
    if (path.startsWith('/api/ai/agent/inbox?') && method === 'GET') return Response.json({ items: [observation], nextCursor: null });
    if (path === '/api/ai/agent/inbox/ack' && method === 'POST') {
      assert.deepEqual(JSON.parse(options.body), { items: [{ id: itemId, contentRevision: 2 }], brief: false });
      observation.seen = true; observation.rowRevision++; return Response.json({ acknowledged: 1 });
    }
    assert.fail(`Unexpected provider/scheduler/feedback/detail request: ${method} ${path}`);
  });
  h = workspacePanels(service());
  return { h, observation, original, calls };
}

test('standalone Workspace AI Settings reads settings without mounting or acknowledging Inbox', async t => {
  const f = settingsSurfaceFixture(t); await f.h.flush();
  find(f.h.shell.tree, 'Settings', 'button').props.onClick(); await f.h.flush();
  find(f.h.panel.tree, 'Agent settings', 'section');
  assert.deepEqual(f.calls.map(({ path, method }) => ({ path, method })), [{ path: '/api/ai/agent/pulse-settings', method: 'GET' }]);
  assert.deepEqual(f.observation, f.original);
});

test('standalone Settings draft and close preserve the unseen observation without saving', async t => {
  const f = settingsSurfaceFixture(t); await f.h.flush();
  find(f.h.shell.tree, 'Settings', 'button').props.onClick(); await f.h.flush();
  find(f.h.panel.tree, 'Agent checks cadence', 'select').props.onChange(changed('quiet')); await f.h.flush();
  f.h.shell.props({ open: false }); await f.h.flush();
  assert.equal(f.h.panel, undefined);
  assert.deepEqual(f.calls.map(x => [x.path, x.method]), [['/api/ai/agent/pulse-settings', 'GET']]);
  assert.deepEqual(f.observation, f.original);
});

test('standalone Settings enable and Workspace-only restoration POST only settings and never ACK', async t => {
  const f = settingsSurfaceFixture(t); await f.h.flush();
  find(f.h.shell.tree, 'Settings', 'button').props.onClick(); await f.h.flush();
  find(f.h.panel.tree, 'Agent checks mode', 'select').props.onChange(changed('workspace_ai'));
  find(f.h.panel.tree, 'Allow proactive AI provider disclosure', 'input').props.onChange(changed(true)); await f.h.flush();
  find(f.h.panel.tree, 'AI scope: Synthetic project', 'input').props.onChange(changed(true)); await f.h.flush();
  find(f.h.panel.tree, 'Save Agent settings', 'button').props.onClick(); await f.h.flush();
  assert.deepEqual(f.calls.map(x => [x.path, x.method]), [['/api/ai/agent/pulse-settings', 'GET'], ['/api/ai/agent/pulse-settings', 'POST']]);
  assert.deepEqual(f.calls[1].body, { expectedRevision: 1, mode: 'workspace_ai', cadence: 'normal', aiProjectIds: [targetId], checksConsentVersion: 'checks-v1', aiConsentVersion: 'ai-v1' });
  assert.deepEqual(f.observation, f.original);
  assert.equal(find(f.h.shell.tree, 'Settings', 'button').props['aria-pressed'], true);
  find(f.h.panel.tree, 'Agent checks mode', 'select').props.onChange(changed('workspace'));
  find(f.h.panel.tree, 'Allow proactive AI provider disclosure', 'input').props.onChange(changed(false)); await f.h.flush();
  find(f.h.panel.tree, 'Save Agent settings', 'button').props.onClick(); await f.h.flush();
  assert.deepEqual(f.calls.map(x => [x.path, x.method]), [['/api/ai/agent/pulse-settings', 'GET'], ['/api/ai/agent/pulse-settings', 'POST'], ['/api/ai/agent/pulse-settings', 'POST']]);
  assert.deepEqual(f.calls[2].body, { expectedRevision: 2, mode: 'workspace', cadence: 'normal', aiProjectIds: [], checksConsentVersion: 'checks-v1' });
  assert.deepEqual(f.observation, f.original);
});

for (const destination of ['Inbox', 'Activity', 'Chat', 'Agent']) test(`Settings to ${destination} renders only the selected panel`, async t => {
  const f = settingsSurfaceFixture(t); await f.h.flush();
  find(f.h.shell.tree, 'Settings', 'button').props.onClick(); await f.h.flush();
  assert.equal(nodes(f.h.shell.tree).filter(x => x.type?.name === 'AgentPulseSettings').length, 1);
  find(f.h.shell.tree, destination, 'button').props.onClick(); await f.h.flush();
  assert.equal(nodes(f.h.shell.tree).filter(x => x.type?.name === 'AgentPulseSettings').length, 0);
  for (const label of ['Chat', 'Agent', 'Activity', 'Inbox', 'Settings']) assert.equal(find(f.h.shell.tree, label, 'button').props['aria-pressed'], label === destination);
  assert.equal(nodes(f.h.shell.tree).filter(x => x.type === 'textarea').length, ['Chat', 'Agent'].includes(destination) ? 1 : 0);
  if (destination === 'Inbox') {
    assert.equal(f.calls.filter(x => x.path.startsWith('/api/ai/agent/inbox?')).length, 1);
    assert.equal(f.calls.filter(x => x.path === '/api/ai/agent/inbox/ack').length, 1);
    assert.equal(f.observation.seen, true);
    assert.ok(!nodes(f.h.panel.tree).some(x => x.type === 'button' && text(x).trim() === 'Agent settings'));
    assert.ok(nodes(f.h.panel.tree).some(x => x.type?.name === 'AgentPulseStatus'));
    find(f.h.shell.tree, 'Settings', 'button').props.onClick(); await f.h.flush();
    assert.equal(nodes(f.h.shell.tree).filter(x => x.type?.name === 'AgentInbox').length, 0);
    assert.equal(find(f.h.shell.tree, 'Settings', 'button').props['aria-pressed'], true);
    assert.equal(f.calls.filter(x => x.path.startsWith('/api/ai/agent/inbox?')).length, 1);
    assert.equal(f.calls.filter(x => x.path === '/api/ai/agent/inbox/ack').length, 1);
  } else assert.deepEqual(f.observation, f.original);
});

test('Brief Inbox-open request closes Settings and preserves unsent Review prefill', async t => {
  const f = settingsSurfaceFixture(t); await f.h.flush();
  find(f.h.shell.tree, 'Settings', 'button').props.onClick(); await f.h.flush();
  f.h.shell.props({ inboxOpenRequest: 1 }); await f.h.flush();
  assert.equal(find(f.h.shell.tree, 'Inbox', 'button').props['aria-pressed'], true);
  assert.equal(find(f.h.shell.tree, 'Settings', 'button').props['aria-pressed'], false);
  const before = f.calls.length, draft = 'Review current facts without sending.';
  nodes(f.h.shell.tree).find(x => x.type?.name === 'AgentInbox').props.onReview(draft); await f.h.flush();
  assert.equal(find(f.h.shell.tree, 'Agent', 'button').props['aria-pressed'], true);
  assert.equal(find(f.h.shell.tree, 'Message Workspace AI', 'textarea').props.value, draft);
  assert.equal(f.calls.length, before);
  find(f.h.shell.tree, 'Settings', 'button').props.onClick(); await f.h.flush();
  f.h.shell.props({ inboxOpenRequest: 1 }); await f.h.flush();
  assert.equal(find(f.h.shell.tree, 'Settings', 'button').props['aria-pressed'], true);
});

for (const [name, args, url, method, body, response] of [
  ['getPulseSettings', [], '/api/ai/agent/pulse-settings', 'GET', undefined, settings()],
  ['updatePulseSettings', [{ expectedRevision: 0, mode: 'workspace', cadence: 'normal', aiProjectIds: [], checksConsentVersion: 'checks-v1' }], '/api/ai/agent/pulse-settings', 'POST', { expectedRevision: 0, mode: 'workspace', cadence: 'normal', aiProjectIds: [], checksConsentVersion: 'checks-v1' }, settings({ mode: 'workspace', settingsRevision: 1 })],
  ['clearPulseMemory', [{ expectedRevision: 0, confirmation: 'CLEAR_AGENT_MEMORY' }], '/api/ai/agent/pulse-settings/clear', 'POST', { expectedRevision: 0, confirmation: 'CLEAR_AGENT_MEMORY' }, { cleared: true, settingsRevision: 1 }],
  ['getInboxPage', [{ state: 'active', limit: 20, cursor: 'opaque_cursor' }], '/api/ai/agent/inbox?state=active&limit=20&cursor=opaque_cursor', 'GET', undefined, { items: [item()], nextCursor: 'opaque_cursor' }],
  ['getInboxDetail', [itemId], '/api/ai/agent/inbox?id=' + itemId, 'GET', undefined, detail()],
  ['sendInboxFeedback', [{ id: itemId, expectedRevision: 3, action: 'dismiss' }], '/api/ai/agent/inbox/feedback', 'POST', { id: itemId, expectedRevision: 3, action: 'dismiss' }, { id: itemId, state: 'dismissed', rowRevision: 4, contentRevision: 2 }],
  ['ackInbox', [{ items: [{ id: itemId, contentRevision: 2 }], brief: false }], '/api/ai/agent/inbox/ack', 'POST', { items: [{ id: itemId, contentRevision: 2 }], brief: false }, { acknowledged: 1 }],
  ['getPulseBrief', [], '/api/ai/agent/brief', 'GET', undefined, { items: [], lastCheckedAt: null }],
  ['getPulseJournal', [{ limit: 20, cursor: 'journal_cursor' }], '/api/ai/agent/journal?limit=20&cursor=journal_cursor', 'GET', undefined, { items: [journal()], nextCursor: 'journal_cursor' }],
]) test(name + ' uses exact owner-free route/body, session credentials and AbortSignal', async t => {
  const api = service(), signal = new AbortController().signal, calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push({ path, options }); return Response.json(response); });
  assert.deepEqual(await api[name](...args, signal), response);
  assert.equal(calls.length, 1); assert.equal(calls[0].path, url); assert.equal(calls[0].options.method, method);
  assert.equal(calls[0].options.credentials, 'same-origin'); assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].options.signal, signal);
  assert.deepEqual(body && JSON.parse(calls[0].options.body), body); assert.ok(!calls[0].path.includes(owner));
  assert.equal(calls[0].options.headers?.Authorization, undefined);
});
for (const [status, code] of [[400, 'INVALID_INPUT'], [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [409, 'STATE_CHANGED'], [429, 'RATE_LIMITED'], [500, 'UNAVAILABLE'], [502, 'UNAVAILABLE'], [503, 'UNAVAILABLE']]) test('HTTP ' + status + ' normalizes safe error without raw internals', async t => {
  const api = service(); t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'PRIVATE_SQL RPC stack secret', code: 'XX000' } }, { status }));
  await assert.rejects(api.getPulseSettings(), error => error.code === code && !/PRIVATE|RPC|XX000|stack|secret/.test(error.message));
});
test('network failure is safe and distinct from abort', async t => {
  const api = service(); t.mock.method(globalThis, 'fetch', async () => { throw new Error('PRIVATE_DATABASE_HOST'); });
  await assert.rejects(api.getPulseSettings(), error => error.code === 'UNAVAILABLE' && !error.message.includes('PRIVATE'));
});
test('aborted requests remain distinct, including an abort after fetch completes', async t => {
  const api = service(), controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => { controller.abort(); return Response.json(settings()); });
  await assert.rejects(api.getPulseSettings(controller.signal), error => error.code === 'ABORTED');
});
for (const [label, value] of [
  ['unknown nested authority', { ...item(), target: { ...item().target, sourceToken: 'PRIVATE' } }],
  ['unknown root', { ...item(), before_state: {} }], ['invalid revision', item({ rowRevision: 0 })],
  ['invalid content revision', item({ contentRevision: 0 })], ['unknown kind', item({ kind: 'action' })],
  ['unknown state', item({ state: 'completed' })], ['unknown reason', item({ reasonCodes: ['PRIVATE_REASON'] })],
  ['bad boolean', item({ stale: 'false' })], ['bad ID', item({ id: 'bad' })], ['foreign target shape', item({ target: { type: 'secret', id: targetId } })],
  ['normalized calendar date', item({ lastCheckedAt: '2026-02-31T12:00:00Z' })], ['nonUTC time', item({ lastCheckedAt: '2026-10-17T12:00:00+08:00' })],
  ['HTML rejected by canonical DTO', item({ summary: '<script>unsafe</script>' })], ['overlong title', item({ title: '😀'.repeat(121) })],
  ['overlong summary', item({ summary: 'x'.repeat(401) })], ['overlong explanation', item({ explanation: 'x'.repeat(241) })],
]) test('service rejects Inbox DTO ' + label, async t => {
  const api = service(); t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [value], nextCursor: null }));
  await assert.rejects(api.getInboxPage({ state: 'active' }), error => error.code === 'UNAVAILABLE');
});
for (const [label, response] of [
  ['page exceeds20', { items: Array.from({ length: 21 }, () => item()), nextCursor: null }],
  ['cursor object', { items: [], nextCursor: {} }], ['cursor invalid alphabet', { items: [], nextCursor: '<unsafe>' }],
  ['cursor overlong', { items: [], nextCursor: 'a'.repeat(1401) }], ['missing cursor', { items: [] }],
]) test('service rejects malformed page ' + label, async t => {
  const api = service(); t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  await assert.rejects(api.getInboxPage({}), error => error.code === 'UNAVAILABLE');
});
for (const [label, patch] of [
  ['missing context', undefined], ['unknown context field', { ...detail().reviewContext, sourceToken: 'PRIVATE' }],
  ['blank target', { ...detail().reviewContext, targetLabel: ' ' }], ['overlong facts', { ...detail().reviewContext, deterministicSummary: 'x'.repeat(401) }],
  ['incorrect advisory for signal', { ...detail().reviewContext, advisoryIdea: { title: 'x', summary: 'y' } }],
]) test('service rejects review context ' + label, async t => {
  const api = service(); t.mock.method(globalThis, 'fetch', async () => Response.json({ item: item(), ...(patch === undefined ? {} : { reviewContext: patch }) }));
  await assert.rejects(api.getInboxDetail(itemId), error => error.code === 'UNAVAILABLE');
});
for (const [label, patch] of [
  ['mode', { mode: 'all' }], ['revision', { settingsRevision: -1 }], ['consent', { aiConsented: 'yes' }],
  ['timezone', { timezoneReadiness: 'maybe' }], ['scope', { aiProjectIds: ['bad'] }], ['usage', { usage: { ownerPulses: -1, ownerRequests: 0, installationRequests: 0, ownerIdeas: 0 } }],
  ['nested internals', { coverage: { complete: false, unknown: 0, sourceToken: 'PRIVATE' } }],
]) test('service rejects settings ' + label, async t => {
  const api = service(); t.mock.method(globalThis, 'fetch', async () => Response.json(settings(patch)));
  await assert.rejects(api.getPulseSettings(), error => error.code === 'UNAVAILABLE');
});
for (const [label, patch] of [['status', { status: 'done' }], ['outcome', { aiOutcome: 'PRIVATE' }], ['error', { errorCode: 'XX000' }],
  ['bounds', { createdCount: 4 }], ['unknown counts', { checkedCounts: { ...journal().checkedCounts, credentials: 1 } }]]) test('service rejects Journal ' + label, async t => {
  const api = service(); t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [journal(patch)], nextCursor: null }));
  await assert.rejects(api.getPulseJournal({}), error => error.code === 'UNAVAILABLE');
});
for (const [name, args] of [['getInboxPage', { limit: 21 }], ['getPulseJournal', { limit: 0 }],
  ['sendInboxFeedback', { id: itemId, expectedRevision: 3, action: 'snooze', snoozeDays: 2 }],
  ['updatePulseSettings', { expectedRevision: 0, mode: 'workspace_ai', cadence: 'normal', aiProjectIds: [] }],
  ['ackInbox', { items: Array.from({ length: 21 }, () => ({ id: itemId, contentRevision: 2 })), brief: false }]]) test(name + ' validates outgoing exact contract before fetch', async t => {
  const api = service(); t.mock.method(globalThis, 'fetch', () => assert.fail('Invalid request reached HTTP'));
  await assert.rejects(api[name](args), error => error.code === 'INVALID_INPUT');
});

for (const [label, status, pattern] of [
  ['Off', { settings: settings().settings }, /Off/], ['never checked', { settings: settings({ mode: 'workspace', checksConsented: true, checksEnabled: true }).settings }, /No checks recorded|never checked/i],
  ['checking', { settings: settings({ mode: 'workspace' }).settings, latestCheck: journal({ status: 'running' }) }, /Checking/i],
  ['partial', { settings: settings({ mode: 'workspace', lastDeterministicAt: stamp, coverage: { complete: false, unknown: 2 } }).settings }, /partial|unknown/i],
  ['stale', { settings: settings({ mode: 'workspace' }).settings, stale: true }, /stale/i],
  ['budget limited', { settings: settings({ mode: 'workspace' }).settings, latestCheck: journal({ aiOutcome: 'skipped_budget', errorCode: 'BUDGET' }) }, /budget/i],
  ['error', { settings: null, error: 'Agent data is unavailable.' }, /unavailable/i],
  ['paused', { settings: settings({ mode: 'workspace', timezoneReadiness: 'missing', checksEnabled: false }).settings }, /paused|unavailable/i],
]) test('status truthfully renders ' + label, () => {
  const { AgentPulseStatus } = load('components/ai/AgentPulseStatus.tsx');
  const html = renderToStaticMarkup(React.createElement(AgentPulseStatus, { status })); assert.match(html, pattern);
  assert.doesNotMatch(html, /thinking overnight|watching continuously|independently managing/i);
});
test('status distinguishes rolling AI requests from saved ideas and qualifies next check', () => {
  const { AgentPulseStatus } = load('components/ai/AgentPulseStatus.tsx');
  const html = renderToStaticMarkup(React.createElement(AgentPulseStatus, { status: { settings: settings({ nextDueAt: stamp, usage: { ownerPulses: 4, ownerRequests: 2, installationRequests: 2, ownerIdeas: 1 } }).settings } }));
  assert.match(html, /AI requests/); assert.match(html, /Ideas saved/); assert.match(html, /last 24 hours/i); assert.match(html, /approximate|about/i); assert.match(html, /service availability/i);
});

test('Inbox defaults active, renders server order and empty/loading states', async () => {
  const seen = [], wait = pending(), h = inbox({}, { getInboxPage: (params, signal) => { seen.push({ params, signal }); return wait.promise; } });
  await h.flush(); assert.match(text(h.tree), /Loading Inbox/i); assert.equal(seen[0].params.state, 'active'); assert.equal(seen[0].params.limit, 20);
  wait.resolve({ items: [], nextCursor: null }); await h.flush(); assert.match(text(h.tree), /No current Inbox items/i); h.unmount();
});
test('rendered cards use explicit ACK without faking seen state or acknowledging background fetch', async () => {
  const calls = [], h = inbox({}, { getInboxPage: async () => ({ items: [item()], nextCursor: null }), ackInbox: async input => { calls.push(input); return { acknowledged: 0 }; } });
  await h.flush(); assert.equal(calls.length, 1); assert.deepEqual(calls[0], { items: [{ id: itemId, contentRevision: 2 }], brief: false });
  assert.match(text(h.tree), /New|Unseen/i); h.unmount();
});
test('filter aborts obsolete fetch, clears cursor and fences late cross-filter result', async () => {
  const first = pending(), second = pending(), calls = [], h = inbox({}, { getInboxPage: (params, signal) => { calls.push({ params, signal }); return calls.length === 1 ? first.promise : second.promise; } });
  await h.flush(); find(h.tree, 'Inbox filter', 'select').props.onChange(changed('snoozed')); await h.flush();
  assert.equal(calls[0].signal.aborted, true); assert.equal(calls[1].params.state, 'snoozed'); assert.equal(calls[1].params.cursor, null);
  second.resolve({ items: [item({ title: 'Current snoozed', state: 'snoozed' })], nextCursor: null }); await h.flush();
  first.resolve({ items: [item({ title: 'Obsolete active' })], nextCursor: 'old_cursor' }); await h.flush();
  assert.match(text(h.tree), /Current snoozed/); assert.doesNotMatch(text(h.tree), /Obsolete active/); h.unmount();
});
test('pagination keeps opaque cursor and defensive deduplication in server order', async () => {
  const calls = [], h = inbox({}, { getInboxPage: async params => { calls.push(params); return calls.length === 1 ? { items: [item()], nextCursor: 'opaque_cursor' } : { items: [item(), item({ id: other, title: 'Second card' })], nextCursor: null }; } });
  await h.flush(); find(h.tree, 'Load more Inbox items', 'button').props.onClick(); await h.flush();
  assert.equal(calls[1].cursor, 'opaque_cursor'); assert.equal(nodes(h.tree).filter(x => x.type === 'article').length, 2); assert.ok(text(h.tree).indexOf('Canonical task') < text(h.tree).indexOf('Second card')); h.unmount();
});
test('Review fetches current detail, emits exact Task21 draft and no mutation/send/proposal', async () => {
  const emitted = [], reads = [], mutations = [], h = inbox({ onReview: draft => emitted.push(draft) }, { getInboxPage: async () => ({ items: [item()], nextCursor: null }),
    getInboxDetail: async (...args) => { reads.push(args); return detail(); }, sendInboxFeedback: () => mutations.push('feedback') });
  await h.flush(); find(h.tree, 'Review', 'button').props.onClick(); await h.flush();
  const { buildInboxReviewDraft } = load('data/agentInbox.ts'); assert.deepEqual(emitted, [buildInboxReviewDraft(detail())]); assert.equal(reads[0][0], itemId); assert.equal(mutations.length, 0); h.unmount();
});
test('null/stale detail blocks Review handoff and unsafe navigation', async () => {
  const emitted = [], h = inbox({ onReview: value => emitted.push(value), onNavigate: value => emitted.push(value) }, { getInboxPage: async () => ({ items: [item()], nextCursor: null }), getInboxDetail: async () => ({ item: item({ stale: true }), reviewContext: null }) });
  await h.flush(); find(h.tree, 'Review', 'button').props.onClick(); await h.flush(); assert.equal(emitted.length, 0); assert.match(text(h.tree), /unavailable|changed|stale/i); h.unmount();
});
for (const [label, action, days] of [['Dismiss', 'dismiss'], ['Resolve Inbox item', 'resolve'], ['Snooze', 'snooze', 1]]) test(label + ' sends only current revision and blocks duplicate clicks', async () => {
  const wait = pending(), calls = [], h = inbox({}, { getInboxPage: async () => ({ items: [item()], nextCursor: null }), sendInboxFeedback: input => { calls.push(input); return wait.promise; } });
  await h.flush(); const control = find(h.tree, label, 'button'); control.props.onClick(); control.props.onClick(); await h.flush();
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], { id: itemId, expectedRevision: 3, action, ...(days ? { snoozeDays: days } : {}) });
  assert.equal(find(h.tree, label, 'button').props.disabled, true); wait.resolve({ id: itemId, state: action === 'snooze' ? 'snoozed' : action === 'resolve' ? 'resolved' : 'dismissed', rowRevision: 4, contentRevision: 2 }); await h.flush(); h.unmount();
});
test('Snooze options are exactly1/3/7 and Resolve copy is Inbox-only', async () => {
  const h = inbox({}, { getInboxPage: async () => ({ items: [item()], nextCursor: null }) }); await h.flush();
  const choices = find(h.tree, 'Snooze duration', 'select').props.children; assert.deepEqual(choices.map(x => Number(x.props.value)), [1, 3, 7]);
  assert.match(text(h.tree), /Inbox item only/i); assert.doesNotMatch(text(h.tree), /Complete task|Apply suggestion/); h.unmount();
});
test('feedback conflict reloads current authority, preserves bounded error and never auto-retries', async () => {
  let reads = 0, writes = 0; const h = inbox({}, { getInboxPage: async () => ({ items: [item({ rowRevision: ++reads + 2 })], nextCursor: null }), sendInboxFeedback: async () => { writes++; throw Object.assign(new Error('This Inbox item changed. Reload and try again.'), { code: 'STATE_CHANGED' }); } });
  await h.flush(); find(h.tree, 'Dismiss', 'button').props.onClick(); await h.flush(); assert.equal(writes, 1); assert.equal(reads, 2); assert.match(text(h.tree), /changed/i); h.unmount();
});
test('filter replacement aborts pending feedback and prevents its old-filter reload', async () => {
  const wait = pending(), reads = [], writes = [], h = inbox({}, { getInboxPage: async params => { reads.push(params); return { items: [item({ state: params.state })], nextCursor: null }; },
    sendInboxFeedback: (input, signal) => { writes.push(signal); return wait.promise; } });
  await h.flush(); find(h.tree, 'Dismiss', 'button').props.onClick(); await h.flush();
  find(h.tree, 'Inbox filter', 'select').props.onChange(changed('snoozed')); await h.flush(); assert.equal(writes[0].aborted, true);
  wait.resolve({ id: itemId, state: 'dismissed', rowRevision: 4, contentRevision: 2 }); await h.flush();
  assert.deepEqual(reads.map(x => x.state), ['active', 'snoozed']); assert.equal(find(h.tree, 'Review', 'button').props.disabled, false); h.unmount();
});
test('filter replacement cancels current detail and releases its action controls', async () => {
  const wait = pending(), emitted = [], signals = [], h = inbox({ onReview: x => emitted.push(x) }, { getInboxPage: async () => ({ items: [item()], nextCursor: null }),
    getInboxDetail: (id, signal) => { signals.push(signal); return wait.promise; } });
  await h.flush(); find(h.tree, 'Review', 'button').props.onClick(); await h.flush();
  find(h.tree, 'Inbox filter', 'select').props.onChange(changed('all')); await h.flush(); wait.resolve(detail()); await h.flush();
  assert.equal(signals[0].aborted, true); assert.equal(emitted.length, 0); assert.equal(find(h.tree, 'Review', 'button').props.disabled, false); h.unmount();
});
test('late old-owner list completion cannot replace a new owner session', async () => {
  const old = pending(), current = pending(); let reads = 0;
  const h = inbox({}, { getInboxPage: () => ++reads === 1 ? old.promise : current.promise }); await h.flush();
  h.owner({ status: 'authenticated', user: { id: other } }); await h.flush(); current.resolve({ items: [item({ title: 'New owner' })], nextCursor: null }); await h.flush();
  old.resolve({ items: [item({ title: 'Prior owner' })], nextCursor: null }); await h.flush(); assert.match(text(h.tree), /New owner/); assert.doesNotMatch(text(h.tree), /Prior owner/); h.unmount();
});
test('stale ACK cannot mark a newer displayed content revision seen', async () => {
  const old = pending(), calls = []; let reads = 0;
  const h = inbox({}, { getInboxPage: async () => ({ items: [item({ contentRevision: ++reads, title: reads === 1 ? 'Old revision' : 'Current revision' })], nextCursor: null }),
    ackInbox: input => { calls.push(input); return calls.length === 1 ? old.promise : Promise.resolve({ acknowledged: 0 }); } });
  await h.flush(); find(h.tree, 'Refresh Inbox', 'button').props.onClick(); await h.flush(); old.resolve({ acknowledged: 1 }); await h.flush();
  assert.match(text(h.tree), /Current revision/); assert.match(text(h.tree), /New \/ unseen/); assert.deepEqual(calls.map(x => x.items[0].contentRevision), [1, 2]); h.unmount();
});
test('current navigation uses fresh owner-safe target and never provider strings', async () => {
  const targets = [], h = inbox({ onNavigate: x => targets.push(x) }, { getInboxPage: async () => ({ items: [item({ title: 'https://evil.invalid/app' })], nextCursor: null }) });
  await h.flush(); find(h.tree, 'Open current target', 'button').props.onClick(); await h.flush(); assert.deepEqual(targets, [{ type: 'task', id: targetId }]); h.unmount();
});
test('unavailable status read can be retried without a settings mutation', async () => {
  let reads = 0; const h = inbox({}, { getPulseSettings: async () => { if (++reads === 1) throw new Error('Unavailable'); return settings(); } });
  await h.flush(); find(h.tree, 'Retry Agent status', 'button').props.onClick(); await h.flush(); assert.equal(reads, 2); h.unmount();
});
test('unmount aborts list/detail and suppresses late completion', async () => {
  const wait = pending(), calls = [], h = inbox({}, { getInboxPage: (params, signal) => { calls.push(signal); return wait.promise; } }); await h.flush(); h.unmount();
  assert.equal(calls[0].aborted, true); wait.resolve({ items: [item({ title: 'Late' })], nextCursor: null }); await h.flush(); assert.doesNotMatch(text(h.tree), /Late/);
});
test('owner replacement clears prior cards immediately and aborts old owner request', async () => {
  const calls = [], wait = pending(), h = inbox({}, { getInboxPage: (params, signal) => { calls.push(signal); return calls.length === 1 ? Promise.resolve({ items: [item({ title: 'Old owner' })], nextCursor: null }) : wait.promise; } });
  await h.flush(); assert.match(text(h.tree), /Old owner/); h.owner({ status: 'authenticated', user: { id: other } });
  assert.doesNotMatch(text(h.tree), /Old owner/); await h.flush(); assert.equal(calls[0].aborted, true); wait.resolve({ items: [], nextCursor: null }); await h.flush(); h.unmount();
});
test('Journal is secondary, collapses/aborts late results and uses opaque pagination', async () => {
  const wait = pending(), calls = [], h = inbox({}, { getPulseJournal: (params, signal) => { calls.push({ params, signal }); return wait.promise; } });
  await h.flush(); find(h.tree, 'Journal — proactive check history', 'button').props.onClick(); await h.flush(); assert.equal(calls[0].params.limit, 20);
  find(h.tree, 'Journal — proactive check history', 'button').props.onClick(); await h.flush(); assert.equal(calls[0].signal.aborted, true);
  wait.resolve({ items: [journal({ summary: 'Late Journal' })], nextCursor: null }); await h.flush(); assert.doesNotMatch(text(h.tree), /Late Journal/); h.unmount();
});
test('provider/Unicode card text stays literal React text without links or HTML execution', async () => {
  const dangerous = '<script>window.attack=1</script> **markdown** {"tool":"apply"} 😀'.repeat(3);
  const h = inbox({}, { getInboxPage: async () => ({ items: [item({ summary: dangerous })], nextCursor: null }) }); await h.flush();
  assert.ok(text(h.tree).includes(dangerous)); assert.equal(nodes(h.tree).filter(x => x.type === 'script' || x.type === 'a' || x.props?.dangerouslySetInnerHTML).length, 0); h.unmount();
});
test('settings shows separate mode/consent/scope controls and empty-scope/truncation disclosure', async () => {
  const h = settingsUi({ getPulseSettings: async () => ({ ...settings({ mode: 'workspace_ai', aiConsented: false }), projectChoicesTruncated: true }) }); await h.flush();
  assert.equal(find(h.tree, 'Allow proactive AI provider disclosure', 'input').props.checked, false);
  assert.equal(find(h.tree, 'Allow periodic workspace checks', 'input').props.checked, false);
  assert.match(text(h.tree), /no proactive project AI context/i); assert.match(text(h.tree), /first 20|not every project|limited/i);
  assert.deepEqual(find(h.tree, 'Agent checks mode', 'select').props.children.map(x => x.props.value), ['off', 'workspace', 'workspace_ai']); h.unmount();
});
test('settings save uses canonical revision/consent and server response without revision guessing', async () => {
  const calls = [], h = settingsUi({ getPulseSettings: async () => settings({ settingsRevision: 7 }), updatePulseSettings: async input => { calls.push(input); return settings({ settingsRevision: 8, mode: 'workspace', checksConsented: true }); } });
  await h.flush(); find(h.tree, 'Agent checks mode', 'select').props.onChange(changed('workspace')); find(h.tree, 'Allow periodic workspace checks', 'input').props.onChange(changed(true)); await h.flush();
  find(h.tree, 'Save Agent settings', 'button').props.onClick(); await h.flush(); assert.deepEqual(calls[0], { expectedRevision: 7, mode: 'workspace', cadence: 'normal', aiProjectIds: [], checksConsentVersion: 'checks-v1' });
  assert.equal(find(h.tree, 'Agent checks mode', 'select').props.value, 'workspace'); h.unmount();
});
test('Memory Clear is separate explicit confirmation with workspace/accounting/rediscovery disclosures', async () => {
  const calls = [], h = settingsUi({ clearPulseMemory: async input => { calls.push(input); return { cleared: true, settingsRevision: 1 }; } }); await h.flush();
  find(h.tree, 'Clear proactive Agent memory', 'button').props.onClick(); await h.flush(); assert.equal(calls.length, 0);
  assert.match(text(h.tree), /rediscovered/i); assert.match(text(h.tree), /workspace projects.*not deleted/i); assert.match(text(h.tree), /accounting.*survives/i);
  find(h.tree, 'Cancel memory clear', 'button').props.onClick(); await h.flush(); assert.equal(calls.length, 0); h.unmount();
});
test('confirmed clear reloads settings and preserves authoritative usage counters', async () => {
  let reads = 0, clears = 0; const h = settingsUi({ getPulseSettings: async () => { reads++; return settings({ settingsRevision: reads - 1, usage: { ownerPulses: 1, ownerRequests: 2, installationRequests: 2, ownerIdeas: 0 } }); }, clearPulseMemory: async input => { clears++; assert.equal(input.confirmation, 'CLEAR_AGENT_MEMORY'); return { cleared: true, settingsRevision: 1 }; } });
  await h.flush(); find(h.tree, 'Clear proactive Agent memory', 'button').props.onClick(); await h.flush(); find(h.tree, 'Confirm memory clear', 'button').props.onClick(); await h.flush();
  assert.equal(clears, 1); assert.equal(reads, 2); h.unmount();
});
test('settings conflict reloads canonical revision and consent without retrying save', async () => {
  let reads = 0, writes = 0; const h = settingsUi({ getPulseSettings: async () => settings({ settingsRevision: ++reads }),
    updatePulseSettings: async () => { writes++; throw Object.assign(new Error('Settings changed. Reload and try again.'), { code: 'STATE_CHANGED' }); } });
  await h.flush(); find(h.tree, 'Save Agent settings', 'button').props.onClick(); await h.flush();
  assert.equal(writes, 1); assert.equal(reads, 2); assert.match(text(h.tree), /changed/i); assert.equal(find(h.tree, 'Save Agent settings', 'button').props.disabled, false); h.unmount();
});
test('AI scope is explicit and bounded to20 even if events arrive on disabled choices', async () => {
  const choices = Array.from({ length: 21 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: `Project ${i + 1}` }));
  const calls = [], h = settingsUi({ getPulseSettings: async () => ({ ...settings(), projectChoices: choices }), updatePulseSettings: async input => { calls.push(input); return settings({ settingsRevision: 1 }); } });
  await h.flush(); find(h.tree, 'Allow proactive AI provider disclosure', 'input').props.onChange(changed(true)); await h.flush();
  for (const choice of choices) { find(h.tree, `AI scope: ${choice.title}`, 'input').props.onChange(changed(true)); await h.flush(); }
  assert.equal(find(h.tree, 'AI scope: Project 21', 'input').props.disabled, true); find(h.tree, 'Save Agent settings', 'button').props.onClick(); await h.flush(); assert.equal(calls[0].aiProjectIds.length, 20); h.unmount();
});
test('settings unmount aborts pending read and never applies its late data', async () => {
  const wait = pending(), signals = [], h = settingsUi({ getPulseSettings: signal => { signals.push(signal); return wait.promise; } });
  await h.flush(); h.unmount(); assert.equal(signals[0].aborted, true); wait.resolve(settings()); await h.flush(); assert.doesNotMatch(text(h.tree), /Empty selection/);
});
test('settings pending save is disabled and cannot double-submit', async () => {
  const wait = pending(); let writes = 0; const h = settingsUi({ updatePulseSettings: () => { writes++; return wait.promise; } });
  await h.flush(); const control = find(h.tree, 'Save Agent settings', 'button'); control.props.onClick(); control.props.onClick(); await h.flush();
  assert.equal(writes, 1); assert.equal(find(h.tree, 'Save Agent settings', 'button').props.disabled, true); wait.resolve(settings({ settingsRevision: 1 })); await h.flush(); h.unmount();
});
test('Workspace AI selector keeps Chat/Agent/Activity and adds Inbox without sending', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Panel selection sent an Agent request'));
  const previous = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {} }; t.after(() => { globalThis.window = previous; });
  const h = mount('components/ai/WorkspaceAiChat.tsx', 'WorkspaceAiChat', { projects: [], tasks: [], plans: [], open: true, onOpenChange() {} }); await h.flush();
  for (const label of ['Chat', 'Agent', 'Activity', 'Inbox']) find(h.tree, label, 'button');
  assert.equal(find(h.tree, 'Chat', 'button').props['aria-pressed'], true); find(h.tree, 'Inbox', 'button').props.onClick(); await h.flush();
  assert.equal(find(h.tree, 'Inbox', 'button').props['aria-pressed'], true); assert.equal(nodes(h.tree).filter(x => x.type === 'textarea').length, 0);
  find(h.tree, 'Activity', 'button').props.onClick(); await h.flush(); assert.equal(find(h.tree, 'Activity', 'button').props['aria-pressed'], true); h.unmount();
});
test('inboxOpenRequest changes select Inbox once and preserve exact unsent composer Review', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Inbox Review sent a request'));
  const previous = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {} }; t.after(() => { globalThis.window = previous; });
  const h = mount('components/ai/WorkspaceAiChat.tsx', 'WorkspaceAiChat', { projects: [], tasks: [], plans: [], open: true, onOpenChange() {} }); await h.flush();
  h.props({ inboxOpenRequest: 1 }); await h.flush(); assert.equal(find(h.tree, 'Inbox', 'button').props['aria-pressed'], true);
  const child = nodes(h.tree).find(x => x.type?.name === 'AgentInbox'); assert.ok(child); const draft = 'Re-check current workspace state. Fresh proposal for review only.';
  child.props.onReview(draft); await h.flush(); assert.equal(find(h.tree, 'Agent', 'button').props['aria-pressed'], true); assert.equal(find(h.tree, 'Message Workspace AI', 'textarea').props.value, draft);
  h.props({ inboxOpenRequest: 1 }); await h.flush(); assert.equal(find(h.tree, 'Agent', 'button').props['aria-pressed'], true); h.unmount();
});

test('Chat preserves multipart files/context and its draft across Inbox selection', async t => {
  const calls = []; t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return Response.json({ answer: 'Chat reply' }); });
  const previous = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout }; t.after(() => { globalThis.window = previous; });
  const h = mount('components/ai/WorkspaceAiChat.tsx', 'WorkspaceAiChat', { projects: [{ id: targetId, name: 'Project' }], tasks: [], plans: [], open: true, onOpenChange() {} }); await h.flush();
  find(h.tree, 'Workspace item to attach', 'select').props.onChange(changed(targetId)); await h.flush(); find(h.tree, 'Add context', 'button').props.onClick(); await h.flush();
  const file = new File(['local text'], 'notes.txt', { type: 'text/plain', lastModified: 1 });
  nodes(h.tree).find(x => x.type === 'input' && x.props.type === 'file').props.onChange({ target: { files: [file], value: '' } });
  find(h.tree, 'Message Workspace AI', 'textarea').props.onChange(changed('Keep this draft')); await h.flush();
  find(h.tree, 'Inbox', 'button').props.onClick(); await h.flush(); find(h.tree, 'Chat', 'button').props.onClick(); await h.flush();
  assert.equal(find(h.tree, 'Message Workspace AI', 'textarea').props.value, 'Keep this draft'); find(h.tree, 'Remove notes.txt', 'button'); find(h.tree, 'Remove project context', 'button');
  nodes(h.tree).find(x => x.type === 'form').props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/ai/chat'); assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body.get('request')), { message: 'Keep this draft', history: [], workspaceContext: [{ type: 'project', id: targetId }] });
  assert.equal(calls[0].options.body.get('files').name, 'notes.txt'); assert.equal(calls[0].options.headers, undefined); h.unmount();
});

test('manual Agent preserves JSON request, proposal callbacks and existing shared composer', async t => {
  const calls = [], batch = { runId: itemId, actions: [] }, applied = () => {};
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return Response.json({ answer: 'Agent reply', toolActivity: [], proposalBatch: batch }); });
  const previous = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout }; t.after(() => { globalThis.window = previous; });
  const h = mount('components/ai/WorkspaceAiChat.tsx', 'WorkspaceAiChat', { projects: [], tasks: [], plans: [], open: true, onOpenChange() {}, onAgentApplied: applied }); await h.flush();
  find(h.tree, 'Message Workspace AI', 'textarea').props.onChange(changed('Chat draft')); await h.flush(); find(h.tree, 'Agent', 'button').props.onClick(); await h.flush();
  find(h.tree, 'Message Workspace AI', 'textarea').props.onChange(changed('Manual request')); await h.flush(); nodes(h.tree).find(x => x.type === 'form').props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/ai/agent'); assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { message: 'Manual request', history: [], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  const cards = nodes(h.tree).find(x => x.type?.name === 'AgentProposalCards'); assert.deepEqual(cards.props.batch, batch); assert.equal(cards.props.onApplied, applied);
  cards.props.onReview('Review again draft'); await h.flush(); assert.equal(find(h.tree, 'Message Workspace AI', 'textarea').props.value, 'Review again draft'); assert.equal(calls.length, 1);
  find(h.tree, 'Chat', 'button').props.onClick(); await h.flush(); assert.equal(find(h.tree, 'Message Workspace AI', 'textarea').props.value, 'Review again draft'); h.unmount();
});

test('Activity retains existing Apply/navigation props and exact unsent Review semantics', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Activity Review submitted a request'));
  const previous = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {} }; t.after(() => { globalThis.window = previous; });
  const applied = () => {}, navigate = () => {}, h = mount('components/ai/WorkspaceAiChat.tsx', 'WorkspaceAiChat', { projects: [], tasks: [], plans: [], open: true, onOpenChange() {}, onAgentApplied: applied, onActivityNavigate: navigate }); await h.flush();
  find(h.tree, 'Activity', 'button').props.onClick(); await h.flush(); const activity = nodes(h.tree).find(x => x.type?.name === 'AgentActivity');
  assert.equal(activity.props.onApplied, applied); assert.equal(activity.props.onNavigate, navigate); activity.props.onReview('Exact Activity draft'); await h.flush();
  assert.equal(find(h.tree, 'Agent', 'button').props['aria-pressed'], true); assert.equal(find(h.tree, 'Message Workspace AI', 'textarea').props.value, 'Exact Activity draft'); h.unmount();
});

test('Journal append retains server order and opaque cursor without duplicate entries', async () => {
  const calls = [], h = inbox({}, { getPulseJournal: async params => { calls.push(params); return calls.length === 1 ? { items: [journal()], nextCursor: 'opaque_journal' } : { items: [journal(), journal({ id: other, summary: 'Next journal entry' })], nextCursor: null }; } });
  await h.flush(); find(h.tree, 'Journal — proactive check history', 'button').props.onClick(); await h.flush(); find(h.tree, 'Load more Journal entries', 'button').props.onClick(); await h.flush();
  assert.deepEqual(calls[1], { limit: 20, cursor: 'opaque_journal' }); assert.equal(nodes(h.tree).filter(x => x.type === 'article').length, 2); assert.ok(text(h.tree).indexOf('Checked current workspace.') < text(h.tree).indexOf('Next journal entry')); h.unmount();
});

for (const [label, response] of [['overlong Brief', { items: Array.from({ length: 6 }, () => item()), lastCheckedAt: null }], ['bad Brief time', { items: [], lastCheckedAt: 'yesterday' }], ['unknown Brief field', { items: [], lastCheckedAt: null, raw: {} }]]) test('service rejects ' + label, async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(response)); await assert.rejects(service().getPulseBrief(), error => error.code === 'UNAVAILABLE');
});

// Task23: real component callbacks, owner lifetimes and the existing page seam.
const briefDto = items => ({ items, lastCheckedAt: stamp });
const briefUi = (api = {}, props = {}) => mount('components/ai/AgentPulseBrief.tsx', 'AgentPulseBrief', { onOpenInbox() {}, ...props }, apiDefaults({ getPulseBrief: async () => briefDto([item()]), ...api }));
test('Brief preserves server order and deduplicates only exact revisions', async () => {
  const h = briefUi({ getPulseBrief: async () => briefDto([item({ id: other, title: 'Z server first' }), item({ title: 'A server second' }), item(), item({ contentRevision: 3, title: 'New revision' })]) }); await h.flush();
  assert.deepEqual(nodes(h.tree).filter(x => x.type === 'article').map(x => text(x).replace(/\s+/g, ' ')), [
    'Z server first Deadline today. Recorded facts. Workspace check · Last checked: ' + new Date(stamp).toLocaleString(),
    'A server second Deadline today. Recorded facts. Workspace check · Last checked: ' + new Date(stamp).toLocaleString(),
    'New revision Deadline today. Recorded facts. Workspace check · Last checked: ' + new Date(stamp).toLocaleString(),
  ]); h.unmount();
});
for (const patch of [{ stale: true }, { unavailable: true }, { state: 'resolved' }, { seen: true }]) test('Brief suppresses noncurrent ' + JSON.stringify(patch), async () => {
  const h = briefUi({ getPulseBrief: async () => briefDto([item(patch)]) }); await h.flush(); assert.equal(nodes(h.tree).filter(x => x.type === 'article').length, 0); h.unmount();
});
for (const value of ['**literal** [link](https://example.invalid)', '<b>literal</b>', '{"tool":"apply","id":"literal"}', '長いラベル😀'.repeat(15)]) test('Brief renders text without HTML/Markdown/autolinks: ' + value.slice(0, 20), async () => {
  const h = briefUi({ getPulseBrief: async () => briefDto([item({ title: value })]) }); await h.flush(); assert.ok(text(h.tree).includes(value));
  assert.ok(nodes(h.tree).every(x => !x.props?.dangerouslySetInnerHTML && x.type !== 'a')); assert.ok(nodes(h.tree).some(x => x.props?.className?.includes('[overflow-wrap:anywhere]')));
  assert.ok(!renderToStaticMarkup(h.tree).includes('<b>literal</b>')); h.unmount();
});
test('Brief mount GET never acknowledges or opens Inbox', async () => {
  let gets = 0; const h = briefUi({ getPulseBrief: async () => { gets++; return briefDto([item()]); }, ackInbox: () => assert.fail('mount ACK') }, { onOpenInbox: () => assert.fail('automatic open') }); await h.flush(); assert.equal(gets, 1); h.unmount();
});
for (const action of ['Open Inbox', 'Dismiss Brief']) test('Brief explicit ' + action + ' ACKs exact displayed revisions then reads authoritative result', async () => {
  let gets = 0, opens = 0; const calls = [];
  const h = briefUi({ getPulseBrief: async () => { calls.push('GET'); return briefDto(++gets === 1 ? [item()] : []); }, ackInbox: async body => { calls.push(body); return { acknowledged: 1 }; } }, { onOpenInbox: () => { opens++; } });
  await h.flush(); find(h.tree, action, 'button').props.onClick(); await h.flush();
  assert.deepEqual(calls, ['GET', { items: [{ id: itemId, contentRevision: 2 }], brief: true }, 'GET']); assert.equal(opens, action === 'Open Inbox' ? 1 : 0);
  assert.equal(nodes(h.tree).filter(x => x.type === 'article').length, 0); h.unmount();
});
test('Brief max5 sends only current displayed revisions', async () => {
  const items = Array.from({ length: 5 }, (_, i) => item({ id: `00000000-0000-4000-8000-00000000000${i}`, title: 'Item ' + i })); let sent;
  const h = briefUi({ getPulseBrief: async () => briefDto(items), ackInbox: async body => { sent = body; return { acknowledged: 5 }; } }); await h.flush();
  assert.equal(nodes(h.tree).filter(x => x.type === 'article').length, 5); find(h.tree, 'Dismiss Brief', 'button').props.onClick(); await h.flush();
  assert.deepEqual(sent, { items: items.map(({ id, contentRevision }) => ({ id, contentRevision })), brief: true }); h.unmount();
});
test('Brief stale ACK does not hide same ID newer content returned by server', async () => {
  let gets = 0; const h = briefUi({ getPulseBrief: async () => briefDto([item(++gets === 1 ? {} : { title: 'New current revision', contentRevision: 3 })]), ackInbox: async () => ({ acknowledged: 0 }) }); await h.flush();
  find(h.tree, 'Dismiss Brief', 'button').props.onClick(); await h.flush(); assert.ok(text(h.tree).includes('New current revision')); h.unmount();
});
test('Brief timezone/browser clock changes cannot override fresh server suppression', async t => {
  let gets = 0; const h = briefUi({ getPulseBrief: async () => briefDto(++gets === 1 ? [item()] : []) }); await h.flush();
  find(h.tree, 'Dismiss Brief', 'button').props.onClick(); await h.flush(); t.mock.method(Date, 'now', () => 0); h.props({ timeZone: 'Pacific/Honolulu' }); await h.flush();
  assert.equal(nodes(h.tree).filter(x => x.type === 'article').length, 0); assert.equal(gets, 2); h.unmount();
});
for (const status of ['unauthenticated', 'loading']) test('Brief has no owner content or requests when ' + status, async () => {
  const h = mount('components/ai/AgentPulseBrief.tsx', 'AgentPulseBrief', { onOpenInbox() {} }, apiDefaults({ getPulseBrief: () => assert.fail('anonymous read') }), { status, user: null }); await h.flush(); assert.equal(h.tree, null); h.unmount();
});
test('Brief owner switch immediately clears old display and fences old responses', async () => {
  const old = pending(); const signals = []; let gets = 0;
  const h = briefUi({ getPulseBrief: signal => { signals.push(signal); return ++gets === 1 ? old.promise : Promise.resolve(briefDto([item({ title: 'Next owner' })])); } }); await h.flush();
  h.owner({ status: 'authenticated', user: { id: other } }); assert.ok(!text(h.tree).includes('Canonical task')); await h.flush(); assert.equal(signals[0].aborted, true);
  old.resolve(briefDto([item({ title: 'Old owner secret' })])); await h.flush(); assert.ok(!text(h.tree).includes('Old owner secret')); assert.ok(text(h.tree).includes('Next owner')); h.unmount();
});
test('Brief owner switch during ACK cannot open Inbox or suppress next owner', async () => {
  const ack = pending(); let opened = 0, signal; const h = briefUi({ ackInbox: (_body, s) => { signal = s; return ack.promise; } }, { onOpenInbox() { opened++; } }); await h.flush();
  find(h.tree, 'Open Inbox', 'button').props.onClick(); await h.flush(); h.owner({ status: 'authenticated', user: { id: other } }); await h.flush();
  ack.resolve({ acknowledged: 1 }); await h.flush(); assert.equal(signal.aborted, true); assert.equal(opened, 0); assert.ok(text(h.tree).includes('Canonical task')); h.unmount();
});
test('Brief rendered old-owner content is gone before next-owner read completes', async () => {
  const next = pending(); let reads = 0; const h = briefUi({ getPulseBrief: () => ++reads === 1 ? Promise.resolve(briefDto([item({ title: 'Previous owner title' })])) : next.promise });
  await h.flush(); assert.ok(text(h.tree).includes('Previous owner title')); h.owner({ status: 'authenticated', user: { id: other } });
  assert.ok(!text(h.tree).includes('Previous owner title')); await h.flush(); next.resolve(briefDto([item({ title: 'New owner current' })])); await h.flush(); assert.ok(text(h.tree).includes('New owner current')); h.unmount();
});
for (const [label, value] of [['bad revision', item({ contentRevision: 0 })], ['unknown authority', { ...item(), evidence: {} }]]) test('Brief service fails closed for ' + label, async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(briefDto([value]))); await assert.rejects(service().getPulseBrief(), error => error.code === 'UNAVAILABLE');
});
test('Brief safe read failure offers read-only retry and no dashboard blocker', async t => {
  let gets = 0; t.mock.method(globalThis, 'fetch', async () => ++gets === 1 ? Response.json({ message: 'PRIVATE RPC SQL' }, { status: 500 }) : Response.json(briefDto([item()])));
  const h = mount('components/ai/AgentPulseBrief.tsx', 'AgentPulseBrief', { onOpenInbox() {} }); await h.flush();
  assert.ok(!text(h.tree).includes('PRIVATE')); find(h.tree, 'Retry Brief', 'button').props.onClick(); await h.flush(); assert.ok(text(h.tree).includes('Canonical task')); assert.equal(gets, 2); h.unmount();
});
test('Brief failed explicit ACK stays visible and never automatically retries mutation', async t => {
  let posts = 0; t.mock.method(globalThis, 'fetch', async (_url, options) => options.method === 'POST' ? (posts++, Response.json({}, { status: 500 })) : Response.json(briefDto([item()])));
  const h = mount('components/ai/AgentPulseBrief.tsx', 'AgentPulseBrief', { onOpenInbox: () => assert.fail('failed ACK opened') }); await h.flush(); find(h.tree, 'Open Inbox', 'button').props.onClick(); await h.flush();
  assert.equal(posts, 1); assert.ok(text(h.tree).includes('Canonical task')); assert.ok(!text(h.tree).includes('SQL')); h.unmount();
});
test('Brief double activation is single flight and actions disable while ACK pending', async () => {
  const ack = pending(); let posts = 0; const h = briefUi({ ackInbox: () => { posts++; return ack.promise; } }); await h.flush(); const click = find(h.tree, 'Dismiss Brief', 'button').props.onClick;
  click(); click(); await h.flush(); assert.equal(posts, 1); assert.ok(find(h.tree, 'Open Inbox', 'button').props.disabled); ack.resolve({ acknowledged: 1 }); await h.flush(); h.unmount();
});
test('Brief loading is modest, empty is silent, and unmount aborts', async () => {
  const read = pending(); let signal; const h = briefUi({ getPulseBrief: s => { signal = s; return read.promise; } }); await h.flush(); assert.ok(text(h.tree).includes('Loading Brief'));
  h.unmount(); assert.equal(signal.aborted, true); read.resolve(briefDto([])); await h.flush();
  const empty = briefUi({ getPulseBrief: async () => briefDto([]) }); await empty.flush(); assert.equal(empty.tree, null); empty.unmount();
});
test('Brief exposes bounded provenance, semantic landmark and native named controls', async () => {
  const h = briefUi(); await h.flush(); find(h.tree, 'Agent return Brief', 'section'); find(h.tree, 'Open Inbox', 'button'); find(h.tree, 'Dismiss Brief', 'button');
  assert.ok(text(h.tree).includes('Workspace check')); assert.ok(nodes(h.tree).some(x => x.type === 'time' && x.props.dateTime === stamp)); h.unmount();
});
test('Brief uses only existing reads/ACK and has no background, navigation or local suppression authority', () => {
  const file = resolve(root, 'components/ai/AgentPulseBrief.tsx'); assert.ok(existsSync(file), 'Task23 Brief missing'); const code = readFileSync(file, 'utf8');
  assert.doesNotMatch(code, /fetch\(|setInterval|setTimeout|localStorage|sessionStorage|Date\.now|Realtime|\.channel\(|dangerouslySetInnerHTML|router\.|window\.location|sendInboxFeedback|Gemini|send\(/);
  assert.match(code, /agentInboxService\.getPulseBrief/); assert.match(code, /agentInboxService\.ackInbox/);
});

const pageCode = () => readFileSync(resolve(root, 'app/app/page.tsx'), 'utf8');
function briefPageSeam() {
  const source = ts.createSourceFile('page.tsx', pageCode(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let guard, element;
  const visit = node => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'AgentPulseBrief') { element = node; guard = node.parent; } ts.forEachChild(node, visit); }; visit(source);
  assert.ok(element, 'Task23 page Brief integration missing'); assert.ok(ts.isBinaryExpression(guard), 'Brief must be guarded at mount');
  return { source, element, condition: guard.left.getText(source) };
}
for (const [label, authStatus, workspaceStatus, workspaceUserId, user, expected] of [
  ['anonymous/demo', 'unauthenticated', 'mock', null, null, false], ['loading', 'loading', 'checking', owner, { id: owner }, false],
  ['workspace not ready', 'authenticated', 'checking', owner, { id: owner }, false], ['owner mismatch', 'authenticated', 'ready', other, { id: owner }, false],
  ['matching owner', 'authenticated', 'ready', owner, { id: owner }, true],
]) test('page Brief mount: ' + label, () => {
  const { condition } = briefPageSeam(); assert.equal(Boolean(new Function('authStatus', 'workspaceStatus', 'workspaceUserId', 'user', 'return (' + condition + ')')(authStatus, workspaceStatus, workspaceUserId, user)), expected);
});
test('page Brief callback opens existing AI, increments deterministic request and does nothing else', () => {
  const { source, element } = briefPageSeam(); const callback = element.attributes.properties.find(x => x.name?.getText(source) === 'onOpenInbox').initializer.expression;
  const js = ts.transpileModule('const callback=' + callback.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let open = false, request; const run = new Function('setAiOpen', 'setInboxOpenRequest', js + '; return callback;')(v => { open = v; }, fn => { request = fn(request); });
  run(); assert.equal(open, true); assert.equal(request, 1); run(); assert.equal(request, 2);
  assert.doesNotMatch(callback.getText(source), /fetch|send|router|apply|cancel|undo|Date|random/i);
  assert.match(pageCode(), /inboxOpenRequest=\{inboxOpenRequest\}/); assert.match(pageCode(), /useState<number\s*\|\s*undefined>\(undefined\)/);
});
test('page Brief stays immediately below greeting, keyed by owner; existing shell and AI state retained', () => {
  const { source, element } = briefPageSeam(); assert.match(element.getText(source), /key=\{user\.id\}/);
  const code = pageCode(); assert.ok(code.indexOf('<AgentPulseBrief') > code.indexOf('<WorkspaceGreeting')); assert.ok(code.indexOf('<AgentPulseBrief') < code.indexOf('{/* STAT SHEETS'));
  assert.match(code, /sessionKey=\{authStatus/); assert.match(code, /aiOpen=\{aiOpen\} onAiOpenChange=\{setAiOpen\}/);
  assert.doesNotMatch(code, /dispatchEvent|CustomEvent|Brief.*href=/);
});

test('Task24 proactive AI consent explains unpaid provider data use and sensitive-data restrictions', async () => {
  const h = settingsUi();
  try {
    await h.flush();
    const disclosure = text(h.tree);
    assert.match(disclosure, /Google Gemini/i, 'Consent must identify the provider');
    assert.match(disclosure, /minimized.*(?:selected|select).*project|selected.*project.*minimized/i, 'Consent must describe selected minimized scope');
    assert.match(disclosure, /project.*task.*milestone.*titles/i, 'Consent must describe the bounded title scope');
    assert.match(disclosure, /unpaid|free (?:tier|service|quota)/i, 'Consent must identify the intended unpaid provider terms');
    assert.match(disclosure, /improv(?:e|ement)|develop.*(?:model|product)/i, 'Consent must explain provider use of submitted content');
    assert.match(disclosure, /human review|human reviewers/i, 'Consent must explain possible human review');
    assert.match(disclosure, /(?:do not|don.t|must not).*(?:sensitive|confidential|personal)/i, 'Consent must explain restricted content');
    for (const concept of ['sensitive', 'confidential', 'personal']) assert.ok(disclosure.toLowerCase().includes(concept));
    assert.match(disclosure, /(?:off|remov|revok).*future.*send/i, 'Consent must explain stopping future sends');
    assert.match(disclosure, /cannot.*(?:retract|unsend).*already.*(?:sent|transmitted)/i, 'Consent must explain that transmitted data cannot be retracted');
    assert.match(disclosure, /(?:differ|different).*paid|paid.*(?:differ|different)/i, 'Consent must distinguish paid terms');
    assert.match(disclosure, /region/i, 'Consent must distinguish regional terms');
    assert.match(disclosure, /account/i, 'Consent must distinguish account applicability');
  } finally { h.unmount(); }
});

test('Task24 first feedback uses authoritative revision after automatic Inbox ACK', async () => {
  let revision = 3, sent;
  const h = inbox({}, { getInboxPage: async () => ({ items: [item({ rowRevision:revision, seen:revision>3 })], nextCursor:null }),
    getInboxDetail: async () => ({ ...detail(), item:item({ rowRevision:revision, seen:true }) }),
    ackInbox: async () => { revision++; return { acknowledged:1 }; },
    sendInboxFeedback: async body => { sent=body; return { id:itemId,state:'dismissed',rowRevision:revision+1,contentRevision:2 }; } });
  try { await h.flush(); find(h.tree,'Dismiss','button').props.onClick(); await h.flush(); assert.equal(sent.expectedRevision,revision); }
  finally { h.unmount(); }
});

test('Task24 feedback waits for displayed ACK before loading current revision', async () => {
  const ack=pending();let reads=0,posts=0;
  const h=inbox({}, {getInboxPage:async()=>({items:[item()],nextCursor:null}),ackInbox:()=>ack.promise,
    getInboxDetail:async()=>{reads++;return {...detail(),item:item({seen:true,rowRevision:4})};},
    sendInboxFeedback:async body=>{assert.equal(body.expectedRevision,4);posts++;return {id:itemId,state:'dismissed',rowRevision:5,contentRevision:2};}});
  try {
    await h.flush();find(h.tree,'Dismiss','button').props.onClick();await h.flush();
    assert.equal(reads,0);assert.equal(posts,0);
    ack.resolve({acknowledged:1});await h.flush();assert.equal(reads,1);assert.equal(posts,1);
  } finally {h.unmount();}
});
for(const [label,patch] of [['row',{rowRevision:5}],['content',{contentRevision:3}],['state',{state:'snoozed'}],['target',{target:{type:'task',id:other}}]]) {
  test('Task24 feedback preserves conflict guard after intervening '+label+' change',async()=>{
    let posts=0;
    const h=inbox({}, {getInboxPage:async()=>({items:[item()],nextCursor:null}),
      getInboxDetail:async()=>({...detail(),item:item({seen:true,rowRevision:4,...patch})}),sendInboxFeedback:async()=>{posts++;}});
    try {await h.flush();find(h.tree,'Dismiss','button').props.onClick();await h.flush();assert.equal(posts,0);assert.match(text(h.tree),/This Agent item changed\. Reload and try again\./);}
    finally {h.unmount();}
  });
}
test('Task24 owner replacement aborts feedback during current-detail read',async()=>{
  const read=pending();let posts=0,signal;
  const h=inbox({}, {getInboxPage:async()=>({items:[item()],nextCursor:null}),getInboxDetail:(_id,s)=>{signal=s;return read.promise;},sendInboxFeedback:async()=>{posts++;}});
  try {
    await h.flush();find(h.tree,'Dismiss','button').props.onClick();await h.flush();
    h.owner({status:'authenticated',user:{id:other}});await h.flush();assert.equal(signal.aborted,true);
    read.resolve({...detail(),item:item({seen:true,rowRevision:4})});await h.flush();assert.equal(posts,0);
  } finally {h.unmount();}
});
