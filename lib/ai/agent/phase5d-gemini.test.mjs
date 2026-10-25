import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { loadPulse } from './phase5d-test-support.mjs';

// Only the physical transport is replaced. Request construction, response parsing,
// and retry handling run through the installed GoogleGenAI implementation.
const root = resolve(import.meta.dirname, '../../..');
const adapterPath = 'lib/ai/agent/pulse/gemini.ts';
const saved = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL, fetch: globalThis.fetch };
let escapedFetches = 0;
before(() => {
  process.env.GEMINI_API_KEY = 'fixture-key-never-sent';
  process.env.GEMINI_MODEL = 'fixture-model';
  globalThis.fetch = async () => { escapedFetches++; throw new Error('Real network forbidden'); };
});
after(() => {
  for (const [name, value] of [['GEMINI_API_KEY', saved.key], ['GEMINI_MODEL', saved.model]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  globalThis.fetch = saved.fetch;
  assert.equal(escapedFetches, 0, 'Every SDK request must use the bounded injected fetch');
});
let modulePromise;
const api = () => modulePromise ??= loadPulse(adapterPath);
const idea = (changes = {}) => ({ sourceAlias: 'T1', category: 'review_deadline', title: 'Review parser deadline', advisoryText: 'Consider reviewing this task.', ...changes });
const context = (changes = {}) => ({
  contents: JSON.stringify({ primaryAlias: 'T1', signals: [{ alias: 'T1', type: 'task', title: 'Parser', date: '2026-10-16', priority: 'High', status: 'Todo', reasonCodes: ['DEADLINE_TODAY'], facts: {} }] }),
  primaryAlias: 'T1', aliases: { T1: { type: 'task', id: '00000000-0000-4000-8000-000000000001' }, T2: { type: 'task', id: '00000000-0000-4000-8000-000000000002' } },
  allowedCategories: ['review_deadline'], allowedFacts: new Set(['2026-10-16', 'High', 'Todo']),
  parentId: '00000000-0000-4000-8000-000000000003', parentEpisode: 7,
  sourceToken: 'a'.repeat(64), evidenceValidUntil: '2099-01-01T00:00:00Z', ...changes,
});
const envelope = (text = JSON.stringify(idea())) => JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] });
function fixture(response = () => new Response(envelope()), controller = new AbortController()) {
  const calls = [];
  const options = { signal: controller.signal, deadlineAt: Date.now() + 60_000, fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    return response(url, init);
  } };
  return { calls, options, controller };
}
async function run(f, ctx = context()) { return (await api()).generatePulseIdea(ctx, f.options); }
const failure = (value, code) => assert.deepEqual(value, { ok: false, code });
function streamed(chunks, status = 200) {
  let offset = 0, cancelled = false, reads = 0;
  const stream = new ReadableStream({
    pull(controller) { reads++; if (offset < chunks.length) controller.enqueue(chunks[offset++]); else controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { response: new Response(stream, { status }), cancelled: () => cancelled, reads: () => reads };
}

test('success makes one physical SDK fetch and returns only four normalized fields', async () => {
  const f = fixture(() => new Response(envelope(JSON.stringify(idea({ title: '  Review parser deadline  ', advisoryText: '  Consider reviewing this task.  ' })))));
  assert.deepEqual(await run(f), idea());
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /models\/fixture-model:generateContent/);
});
for (const status of [408, 429, 503]) test(`HTTP ${status} makes one physical request without retries or raw errors`, async () => {
  const f = fixture(() => new Response(JSON.stringify({ error: { code: status, message: 'PRIVATE_PROVIDER_BODY' } }), { status }));
  failure(await run(f), 'AI_UNAVAILABLE'); assert.equal(f.calls.length, 1);
});
test('network exception makes one physical request and returns a bounded code', async () => {
  const f = fixture(() => { throw new Error('PRIVATE_NETWORK_EXCEPTION'); });
  failure(await run(f), 'AI_UNAVAILABLE'); assert.equal(f.calls.length, 1);
});
test('actual request has no tools and sets JSON schema and 800 output tokens', async () => {
  const f = fixture(); assert.deepEqual(await run(f), idea());
  const body = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['contents', 'generationConfig', 'systemInstruction']);
  assert.equal(body.generationConfig.maxOutputTokens, 800);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
  assert.deepEqual(body.generationConfig.responseJsonSchema.required.sort(), ['advisoryText', 'category', 'sourceAlias', 'title']);
  assert.doesNotMatch(f.calls[0].init.body, /functionDeclarations|toolConfig|codeExecution|googleSearch|retrieval/);
});
test('SDK retry configuration explicitly uses attempts one', () => {
  const source = ts.createSourceFile(adapterPath, readFileSync(resolve(root, adapterPath), 'utf8'), ts.ScriptTarget.Latest, true);
  let found = false;
  function walk(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'retryOptions' && ts.isObjectLiteralExpression(node.initializer)) {
      found = node.initializer.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'attempts' && p.initializer.getText(source) === '1');
    }
    ts.forEachChild(node, walk);
  }
  walk(source); assert.equal(found, true);
});
test('fetch forbids redirects that could cause a second physical request', async () => {
  const f = fixture(); await run(f); assert.equal(f.calls[0].init.redirect, 'error');
});
test('oversized full UTF-8 input fails before physical fetch', async () => {
  const f = fixture(); failure(await run(f, context({ contents: 'é'.repeat(6144) })), 'INPUT_TOO_LARGE'); assert.equal(f.calls.length, 0);
});
test('complete actual SDK wire body permits exactly 12288 bytes and denies 12289', async () => {
  const probe = fixture(); await run(probe);
  const bytes = Buffer.byteLength(probe.calls[0].init.body, 'utf8');
  const ctx = context({ contents: context().contents + ' '.repeat(12288 - bytes) });
  const exact = fixture(); assert.deepEqual(await run(exact, ctx), idea());
  assert.equal(Buffer.byteLength(exact.calls[0].init.body, 'utf8'), 12288);
  const over = fixture(); failure(await run(over, { ...ctx, contents: ctx.contents + ' ' }), 'INPUT_TOO_LARGE'); assert.equal(over.calls.length, 0);
});
test('request may start with 15001 ms remaining', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000 });
  const f = fixture(); f.options.deadlineAt = 16_001; assert.deepEqual(await run(f), idea()); assert.equal(f.calls.length, 1);
});
test('exactly 15000 ms remaining denies start with zero fetches', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000 });
  const f = fixture(); f.options.deadlineAt = 16_000; failure(await run(f), 'AUTHORITY_LOST'); assert.equal(f.calls.length, 0);
});
test('deadline is rechecked immediately before physical transport', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000 });
  const { generatePulseIdea } = await api(), f = fixture(); f.options.deadlineAt = 16_001;
  const pending = generatePulseIdea(context(), f.options); t.mock.timers.setTime(1_001);
  failure(await pending, 'AUTHORITY_LOST'); assert.equal(f.calls.length, 0);
});
test('already aborted caller makes zero physical requests', async () => {
  const f = fixture(); f.controller.abort(); failure(await run(f), 'ABORTED'); assert.equal(f.calls.length, 0);
});
test('caller aborted before asynchronous SDK transport makes zero requests', async () => {
  const { generatePulseIdea } = await api(), f = fixture();
  const pending = generatePulseIdea(context(), f.options); f.controller.abort();
  failure(await pending, 'ABORTED'); assert.equal(f.calls.length, 0);
});
test('caller abort during fetch reaches underlying signal with no second request', async () => {
  const started = Promise.withResolvers(); let aborted = false;
  const f = fixture((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('fixture abort')); }, { once: true }); started.resolve();
  }));
  const pending = run(f); await started.promise; f.controller.abort();
  failure(await pending, 'ABORTED'); assert.equal(aborted, true); assert.equal(f.calls.length, 1);
  assert.equal(getEventListeners(f.controller.signal, 'abort').length, 0);
});
test('12000 ms timeout aborts physical request and clears caller listener', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const started = Promise.withResolvers(); let aborted = false;
  const f = fixture((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('fixture timeout')); }, { once: true }); started.resolve();
  }));
  const pending = run(f); await started.promise; t.mock.timers.tick(11_999); assert.equal(aborted, false); t.mock.timers.tick(1);
  failure(await pending, 'AI_TIMEOUT'); assert.equal(aborted, true); assert.equal(f.calls.length, 1);
  assert.equal(getEventListeners(f.controller.signal, 'abort').length, 0);
});
test('successful request clears timeout and caller listener', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const f = fixture(); assert.deepEqual(await run(f), idea());
  t.mock.timers.tick(12_000); assert.equal(f.calls[0].init.signal.aborted, false);
  assert.equal(getEventListeners(f.controller.signal, 'abort').length, 0);
});
test('valid JSON envelope padded to exactly 8192 raw bytes is accepted', async () => {
  const json = envelope(), raw = Buffer.from(json + ' '.repeat(8192 - Buffer.byteLength(json)));
  const s = streamed([raw]), f = fixture(() => s.response);
  assert.deepEqual(await run(f), idea()); assert.equal(s.cancelled(), false); assert.equal(f.calls.length, 1);
});
test('8193 raw bytes cancel stream before SDK parsing, even for HTTP errors', async () => {
  for (const status of [200, 503]) {
    const s = streamed([Buffer.alloc(8193, 32), Buffer.from('PRIVATE_TAIL')], status), f = fixture(() => s.response);
    // This Response must never be parsed directly by the SDK.
    s.response.json = () => { throw new Error('SDK parsed original stream'); };
    failure(await run(f), 'AI_MALFORMED'); assert.equal(s.cancelled(), true); assert.equal(s.reads(), 1); assert.equal(f.calls.length, 1);
  }
});
test('chunk crossing byte ceiling cancels without consuming remaining chunks', async () => {
  const s = streamed([Buffer.alloc(8192, 32), Buffer.from('x'), Buffer.from('unread')]), f = fixture(() => s.response);
  failure(await run(f), 'AI_MALFORMED'); assert.equal(s.cancelled(), true); assert.equal(s.reads(), 2);
});
test('multibyte UTF-8 split across chunks is decoded safely', async () => {
  const raw = Buffer.from(envelope(JSON.stringify(idea({ title: 'Review 🦕 parser' }))));
  const split = raw.indexOf(Buffer.from('🦕')) + 1;
  const s = streamed([raw.subarray(0, split), raw.subarray(split)]), f = fixture(() => s.response);
  assert.deepEqual(await run(f), idea({ title: 'Review 🦕 parser' }));
});
test('multibyte raw bytes count toward limit, not character count', async () => {
  const s = streamed([Buffer.from('🦕'.repeat(2049))]), f = fixture(() => s.response);
  failure(await run(f), 'AI_MALFORMED'); assert.equal(s.cancelled(), true);
});
test('invalid UTF-8 and incomplete UTF-8 fail safely without retries', async () => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0xf0, 0x9f])]) {
    const s = streamed([bytes]), f = fixture(() => s.response);
    failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1);
  }
});
test('caller abort while response reader waits cancels the stream', async () => {
  const waiting = Promise.withResolvers(); let cancelled = false;
  const response = new Response(new ReadableStream({ pull() { waiting.resolve(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 }));
  const f = fixture(() => response), pending = run(f); await waiting.promise; f.controller.abort();
  failure(await pending, 'ABORTED'); assert.equal(cancelled, true); assert.equal(f.calls.length, 1);
});
for (const [name, value] of [
  ['unknown alias', idea({ sourceAlias: 'T99' })], ['supporting alias', idea({ sourceAlias: 'T2' })], ['malformed alias', idea({ sourceAlias: '../T1' })],
  ['incompatible category', idea({ category: 'review_tomorrow' })], ['unknown category', idea({ category: 'execute_task' })],
  ['121 code point title', idea({ title: '🦕'.repeat(121) })], ['401 code point advisory', idea({ advisoryText: '🦕'.repeat(401) })],
  ['unknown key', { ...idea(), action: 'apply' }], ['missing field', { sourceAlias: 'T1', category: 'review_deadline', title: 'Review' }],
  ['null field', idea({ title: null })], ['wrong type', idea({ title: 1 })], ['nested value', idea({ advisoryText: { text: 'Review' } })],
  ['array', [idea()]], ['null object', null], ['empty text', idea({ title: '  ' })], ['control text', idea({ title: 'Review\u0000' })],
]) test(`${name} produces terminal malformed classification`, async () => {
  const f = fixture(() => new Response(envelope(JSON.stringify(value)))); failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1);
});
test('multiple JSON objects are rejected without partial acceptance', async () => {
  const f = fixture(() => new Response(envelope(JSON.stringify(idea()) + JSON.stringify(idea())))); failure(await run(f), 'AI_MALFORMED');
});
test('Unicode limits accept exactly 120 and 400 code points', async () => {
  const value = idea({ title: '🦕'.repeat(120), advisoryText: '🦕'.repeat(400) });
  const f = fixture(() => new Response(envelope(JSON.stringify(value)))); assert.deepEqual(await run(f), value);
});
for (const text of ['Review on 2026-10-17.', 'The occupancy is 86%.', 'Review 4 tasks.', 'Review at 09:30.', 'Review from 09:00–10:00.', 'This is Low priority.', 'Status is Completed.', 'Review four tasks.', 'Review October 17, 2026.']) {
  test(`unsupported factual literal is rejected: ${text}`, async () => {
    const f = fixture(() => new Response(envelope(JSON.stringify(idea({ advisoryText: text }))))); failure(await run(f), 'AI_MALFORMED');
  });
}
test('allowed dates, counts, percentage, time, priority and status literals are accepted', async () => {
  const value = idea({ advisoryText: 'Review 3 tasks on 2026-10-16 at 09:00; occupancy 85%. High priority, Todo status.' });
  const f = fixture(() => new Response(envelope(JSON.stringify(value))));
  assert.deepEqual(await run(f, context({ allowedFacts: new Set(['3', '2026-10-16', '09:00', '85', 'High', 'Todo']) })), value);
});
test('title factual literals are also validated', async () => {
  const f = fixture(() => new Response(envelope(JSON.stringify(idea({ title: 'Review 99 tasks' }))))); failure(await run(f), 'AI_MALFORMED');
});

for (const text of ['Git remains useful for this project.', 'Node remains useful for this project.']) {
  test(`sentence-initial technology regression accepts: ${text}`, async () => {
    for (const field of ['title', 'advisoryText']) {
      const value = idea({ [field]: text }), f = fixture(() => new Response(envelope(JSON.stringify(value))));
      assert.deepEqual(await run(f), value);
      assert.equal(f.calls.length, 1);
    }
  });
}

test('discovered executable advisory Run DELETE /api/tasks is malformed', async () => {
  const f = fixture(() => new Response(envelope(JSON.stringify(idea({ advisoryText: 'Run DELETE /api/tasks' })))));
  failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1);
});

for (const text of [
  'Git integration may need review.', 'Git activity is not part of this signal.',
  'Node support may need review.', 'Node is used by the project.',
  'Python remains part of the project.', 'Python support may need review.',
  'npm remains part of the build setup.', 'Vercel remains the deployment platform.',
  'Supabase remains the backend.', 'Use Git for version control.', 'Use Node for this project.',
  'run', 'git', 'node', 'python', 'npm', 'vercel', 'supabase',
  'Ｇｉｔ　remains useful for this project.', 'Ｎｏｄｅ　support may need review.',
]) test(`technology prose is not an invocation: ${text}`, async () => {
  for (const field of ['title', 'advisoryText']) {
    const value = idea({ [field]: text }), f = fixture(() => new Response(envelope(JSON.stringify(value))));
    assert.deepEqual(await run(f), value);
    assert.equal(f.calls.length, 1);
  }
});

for (const [safe, blocked] of [
  ['Git remains useful for this project.', 'git status'],
  ['Node remains useful for this project.', 'node script.js'],
  ['Python remains part of the project.', 'python script.py'],
  ['npm remains part of the build setup.', 'npm install package-name'],
  ['Vercel remains the deployment platform.', 'vercel deploy'],
  ['Supabase remains the backend.', 'supabase db push'],
]) test(`technology/command boundary: ${blocked}`, async () => {
  for (const field of ['title', 'advisoryText']) {
    const value = idea({ [field]: safe }), accepted = fixture(() => new Response(envelope(JSON.stringify(value))));
    assert.deepEqual(await run(accepted), value); assert.equal(accepted.calls.length, 1);
    const rejected = fixture(() => new Response(envelope(JSON.stringify(idea({ [field]: blocked })))));
    failure(await run(rejected), 'AI_MALFORMED'); assert.equal(rejected.calls.length, 1);
  }
});

for (const text of [
  'GET /api/tasks', 'curl https://example.com/api/tasks', "UPDATE tasks SET status='done'",
  'npm run build', "Call fetch('/api/tasks')", "fetch('/api/tasks')", 'rm -rf /tmp/example',
  'sudo rm -rf /tmp/example', 'git push origin main', 'git reset --hard',
  'node ./script.js', 'node ../script.js', 'node -e inspect', 'node --inspect script.js',
  'python ./script.py', 'python -m module', 'python -c inspect', 'python3 script.py',
  'npm i package-name', 'npm exec inspect', 'npm test', 'npm start', 'npm publish', 'npm uninstall package-name',
  'vercel --prod', 'supabase status', 'git   status', 'gIt PuSh origin main',
  'ｇｉｔ　ｓｔａｔｕｓ', 'ｎｐｍ　ｒｕｎ　ｂｕｉｌｄ', 'Review this; git status',
]) test(`recognized invocation remains malformed in both fields: ${text}`, async () => {
  for (const field of ['title', 'advisoryText']) {
    const f = fixture(() => new Response(envelope(JSON.stringify(idea({ [field]: text })))));
    failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1);
  }
});

for (const text of [
  'GET /tasks', 'POST /api/tasks', 'PUT /api/tasks/123', 'PATCH /api/tasks/123', 'DELETE /api/tasks/123',
  '/api/projects/123', 'https://example.com', 'http://example.com', 'Use curl https://example.com/api/tasks',
  'Run rm -rf /tmp/example', 'Execute DROP TABLE tasks', 'DELETE FROM tasks', 'TRUNCATE tasks',
  'ALTER TABLE tasks', 'INSERT INTO tasks', "UPDATE tasks SET status = 'Todo'", 'Run npm install something',
  "Call fetch('/tasks')", 'exec(command)', 'system(command)', '```sh rm -rf /tmp/example```', '~~~code~~~',
  'pOsT   /tasks', 'ＧＥＴ　／ａｐｉ／ｔａｓｋｓ', 'Ｒｕｎ　ｎｐｍ　ｉｎｓｔａｌｌ　something',
]) test(`technical instruction syntax is rejected in both output fields: ${text}`, async () => {
  for (const field of ['title', 'advisoryText']) {
    const f = fixture(() => new Response(envelope(JSON.stringify(idea({ [field]: text })))));
    failure(await run(f, context({ allowedFacts: new Set([...context().allowedFacts, '123']) })), 'AI_MALFORMED');
    assert.equal(f.calls.length, 1);
  }
});

test('command execution families are rejected without banning ordinary advisory verbs', async () => {
  for (const command of ['curl -I example.com', 'wget -q example.com', 'powershell -Command inspect', 'pwsh -Command inspect', 'cmd.exe /c inspect', 'bash -c inspect', 'sh -c inspect', 'npm run build', 'npx --yes inspect', 'node script.js', 'python script.py', 'python3 script.py', 'pip install package-name', 'git status', 'supabase db push', 'vercel deploy', 'psql -c inspect', 'sudo rm -rf ./example', 'chmod +x script.sh', 'Invoke-WebRequest -Uri example.com']) {
    const f = fixture(() => new Response(envelope(JSON.stringify(idea({ advisoryText: `Run ${command}` })))));
    failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1);
  }
});

test('standalone shell commands and whitespace-obfuscated invocation are rejected', async () => {
  for (const text of ['npm install something', 'sh -c inspect', 'node script.js', 'Run   pwsh   -Command inspect', 'Run chmod +x script.sh']) {
    const f = fixture(() => new Response(envelope(JSON.stringify(idea({ advisoryText: text })))));
    failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1);
  }
});

for (const text of [
  'Review the dev-workplace deadline.', 'Consider reviewing the recorded quiet period.',
  'The project deadline is approaching.', 'Check whether the deadline still reflects your plan.',
  'You may want to review this project.', 'The feature is in Testing.', 'The project remains in Testing.',
  'Review the latest test run.', 'Review the Git integration.', 'The Node project needs attention.',
]) test(`ordinary advisory prose remains accepted: ${text}`, async () => {
  for (const field of ['title', 'advisoryText']) {
    const value = idea({ [field]: text }), f = fixture(() => new Response(envelope(JSON.stringify(value))));
    assert.deepEqual(await run(f, context({ allowedFacts: new Set([...context().allowedFacts, 'Testing']) })), value);
    assert.equal(f.calls.length, 1);
  }
});
test('actual outbound body excludes all server metadata and source UUIDs', async () => {
  const ctx = context();
  for (const key of ['userId', 'fingerprint', 'lease', 'fence', 'reservationKey', 'installationLedger', 'auth', 'serviceRole', 'manualAudit', 'notes', 'files', 'code', 'githubText', 'description', 'objective', 'rawEvidence']) ctx[key] = `PRIVATE_${key}`;
  const f = fixture(); assert.deepEqual(await run(f, ctx), idea());
  const body = f.calls[0].init.body;
  assert.doesNotMatch(body, /PRIVATE_|00000000-0000|parentId|parentEpisode|sourceToken|allowedFacts|evidenceValidUntil|aliases|a{64}/);
  assert.equal(JSON.parse(body).contents[0].parts[0].text, ctx.contents);
});
test('malformed JSON is terminal, raw response and reasoning never returned or logged', async t => {
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, name, () => assert.fail('Adapter must not log provider material'));
  const f = fixture(() => new Response(envelope('PRIVATE_RAW_RESPONSE { invalid JSON')));
  failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1);
});
test('provider tool call, multiple candidates, thoughts and non-STOP finishes are rejected', async () => {
  const candidate = { content: { role: 'model', parts: [{ text: JSON.stringify(idea()) }] }, finishReason: 'STOP' };
  for (const raw of [
    { candidates: [{ ...candidate, content: { role: 'model', parts: [{ functionCall: { name: 'mutate', args: {} } }] } }] },
    { candidates: [candidate, candidate] },
    { candidates: [{ ...candidate, content: { role: 'model', parts: [{ text: 'private thought', thought: true }, ...candidate.content.parts] } }] },
    { candidates: [{ ...candidate, finishReason: 'MAX_TOKENS' }] },
    { promptFeedback: { blockReason: 'SAFETY' }, candidates: [candidate] },
  ]) { const f = fixture(() => new Response(JSON.stringify(raw))); failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1); }
});
test('invalid outer JSON and failed stream read return safe terminal errors', async () => {
  const responses = [new Response('PRIVATE_BAD_JSON'), new Response(new ReadableStream({ start(c) { c.error(new Error('PRIVATE_STREAM_ERROR')); } }))];
  for (const response of responses) { const f = fixture(() => response); failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1); }
});
test('unconfigured provider returns safely with zero fetches', async () => {
  const key = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  try { const f = fixture(); failure(await run(f), 'AI_UNAVAILABLE'); assert.equal(f.calls.length, 0); }
  finally { process.env.GEMINI_API_KEY = key; }
});
test('runtime import closure has no database, tools, retry, CRUD or scheduler capabilities', () => {
  const seen = new Set(), allowed = new Set(['server-only', '@google/genai', '@/lib/ai/config', './privacy', './types']);
  function visit(file, entry = false) {
    if (seen.has(file)) return; seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node)) continue;
      const name = node.moduleSpecifier.text;
      if (entry) assert.equal(allowed.has(name), true, `Unexpected adapter dependency: ${name}`);
      if (node.importClause?.isTypeOnly) continue;
      assert.doesNotMatch(name, /executor|tools|gemini-transport|supabase|pulse\/db|scheduler|actions|github|drive|context/);
      if (name.startsWith('.') || name.startsWith('@/')) visit(name.startsWith('@/') ? resolve(root, name.slice(2) + '.ts') : resolve(dirname(file), name + '.ts'));
      else assert.equal(['server-only', '@google/genai', 'node:crypto'].includes(name), true, `Unexpected runtime capability: ${name}`);
    }
  }
  visit(resolve(root, adapterPath), true);
});

test('range claims cannot be synthesized from separately allowed endpoints', async () => {
  for (const text of ['Review 3–4 tasks.', 'Review from 09:00 to 10:00.', 'Review from 2026-10-16 to 2026-10-17.']) {
    const f = fixture(() => new Response(envelope(JSON.stringify(idea({ advisoryText: text })))));
    failure(await run(f, context({ allowedFacts: new Set(['3', '4', '09:00', '10:00', '2026-10-16', '2026-10-17']) })), 'AI_MALFORMED');
  }
});
test('compound number words cannot be synthesized from allowed individual counts', async () => {
  const f = fixture(() => new Response(envelope(JSON.stringify(idea({ advisoryText: 'Review two hundred tasks.' })))));
  failure(await run(f, context({ allowedFacts: new Set(['2', '100', 'hundred']) })), 'AI_MALFORMED');
});
test('malformed successful SDK envelopes always classify as terminal malformed', async () => {
  for (const value of [null, { candidates: 'private' }, { candidates: [null] }, { candidates: [{ content: { parts: 'private' } }] }]) {
    const f = fixture(() => new Response(JSON.stringify(value))); failure(await run(f), 'AI_MALFORMED'); assert.equal(f.calls.length, 1);
  }
});
test('invalid Unicode scalar in generated JSON text is rejected', async () => {
  const f = fixture(() => new Response(envelope(JSON.stringify(idea({ title: 'Review\ud800' }))))); failure(await run(f), 'AI_MALFORMED');
});
test('12000 ms timeout also cancels an unfinished response stream', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const waiting = Promise.withResolvers(); let cancelled = false;
  const response = new Response(new ReadableStream({ pull() { waiting.resolve(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 }));
  const f = fixture(() => response), pending = run(f); await waiting.promise; t.mock.timers.tick(12_000);
  failure(await pending, 'AI_TIMEOUT'); assert.equal(cancelled, true); assert.equal(f.calls.length, 1);
  assert.equal(getEventListeners(f.controller.signal, 'abort').length, 0);
});

test('all four approved primary-compatible categories are accepted', async () => {
  for (const [sourceAlias, category] of [['T1', 'review_deadline'], ['T1', 'consider_scheduling'], ['P1', 'review_quiet_project'], ['W1', 'review_tomorrow']]) {
    const value = idea({ sourceAlias, category }), f = fixture(() => new Response(envelope(JSON.stringify(value))));
    assert.deepEqual(await run(f, context({ primaryAlias: sourceAlias, allowedCategories: [category], aliases: { [sourceAlias]: { type: sourceAlias === 'T1' ? 'task' : sourceAlias === 'P1' ? 'project' : 'workspace_day', id: '00000000-0000-4000-8000-000000000001' } } })), value);
  }
});
test('HTTP failure clears timer and caller listener without retaining provider material', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const f = fixture(() => new Response(JSON.stringify({ error: { code: 503, message: 'PRIVATE' } }), { status: 503 }));
  failure(await run(f), 'AI_UNAVAILABLE'); t.mock.timers.tick(12_000);
  assert.equal(f.calls[0].init.signal.aborted, false); assert.equal(getEventListeners(f.controller.signal, 'abort').length, 0);
});
test('adapter does not mutate frozen server context or alias authority', async () => {
  const ctx = context(); Object.values(ctx.aliases).forEach(Object.freeze); Object.freeze(ctx.aliases); Object.freeze(ctx.allowedCategories); Object.freeze(ctx);
  const before = JSON.stringify({ ...ctx, allowedFacts: [...ctx.allowedFacts] }), f = fixture(); assert.deepEqual(await run(f, ctx), idea());
  assert.equal(JSON.stringify({ ...ctx, allowedFacts: [...ctx.allowedFacts] }), before);
});
test('signed, scientific and ordinal claims cannot reuse an allowed component number', async () => {
  for (const literal of ['-3', '−3', '1e3', '3rd']) {
    const f = fixture(() => new Response(envelope(JSON.stringify(idea({ advisoryText: `Review ${literal} tasks.` })))));
    failure(await run(f, context({ allowedFacts: new Set(['1', '3']) })), 'AI_MALFORMED');
  }
});
