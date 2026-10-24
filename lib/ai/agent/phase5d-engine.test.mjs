import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { getEventListeners } from 'node:events';
import { fixture } from './phase5d-fixture.mjs';
import { loadPulse } from './phase5d-test-support.mjs';

let engineModule;
const engine = () => engineModule ??= loadPulse('lib/ai/agent/pulse/engine.ts');
const rpcArgs = {
  agent_pulse_get_settings: ['p_user_id'], agent_pulse_read_source: ['p_user_id', 'p_pulse_id', 'p_lease_token', 'p_fence'],
  agent_pulse_recover: ['p_user_id', 'p_pulse_id'], agent_pulse_finish: ['p_user_id', 'p_pulse_id', 'p_lease_token', 'p_fence', 'p_ai_outcome'],
  agent_pulse_publish_deterministic: ['p_user_id', 'p_pulse_id', 'p_lease_token', 'p_fence', 'p_settings_revision', 'p_commit_id', 'p_scan', 'p_baseline'],
  agent_pulse_reserve_ai: ['p_user_id', 'p_pulse_id', 'p_lease_token', 'p_fence', 'p_settings_revision', 'p_parent_id', 'p_episode'],
  agent_pulse_publish_ai: ['p_user_id', 'p_pulse_id', 'p_lease_token', 'p_fence', 'p_settings_revision', 'p_idea'],
  agent_pulse_claim_dispatch: ['p_slot', 'p_nonce', 'p_issued_at', 'p_processing_enabled'],
  agent_pulse_retain: ['p_user_id', 'p_limit'], agent_pulse_retain_installation: ['p_limit'],
};
const normalized = ctx => ({ sourceAlias: ctx.primaryAlias, category: ctx.allowedCategories[0], title: 'Review recorded work', advisoryText: 'Consider reviewing the recorded task.' });
async function harness(t, mode = 'workspace_ai') {
  await engine();
  const f = await fixture(t), a = await f.pulse(); await f.authorize(a);
  await f.db.query("update public.profiles set time_zone='UTC' where id=$1", [f.owner]);
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'UTC')::date,priority='High' where id=$1", [f.task]);
  await f.db.query("update private.agent_pulse_state set mode=$2,ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$3::uuid] where user_id=$1", [f.owner, mode, f.project]);
  a.leaseExpiresAt = (await f.one('select private.agent_pulse_stamp(lease_expires_at) v from private.agent_pulses where id=$1', [a.pulseId])).v;
  const { createPulseRepository } = await loadPulse('lib/ai/agent/pulse/db.ts');
  const events = [], logs = [], hooks = { before: null, after: null }; let inRpc = false, elapsed = 0, providerCalls = 0;
  const start = Date.now();
  const repository = createPulseRepository({ rpc: async (name, args) => {
    assert.ok(rpcArgs[name], `Unexpected engine SQL capability: ${name}`);
    const call = rpcArgs[name].map(key => typeof args[key] === 'object' && args[key] !== null ? JSON.stringify(args[key]) : args[key]);
    events.push({ name, args: structuredClone(args) });
    if (hooks.before) await hooks.before(name, args);
    inRpc = true;
    try {
      const data = await f.sql(`select public.${name}(${call.map((_x, i) => '$' + (i + 1)).join(',')}) r`, call);
      if (hooks.after) return { data: await hooks.after(name, data, args), error: null };
      return { data, error: null };
    } finally { inRpc = false; }
  } });
  const controller = new AbortController();
  const deps = { repository, signal: controller.signal, clock: { now: () => start + elapsed, monotonic: () => elapsed },
    fetch: async () => assert.fail('No live provider transport allowed'), log: fields => logs.push(fields),
    provider: async (ctx, options) => {
      providerCalls++; events.push({ name: 'provider' }); assert.equal(inRpc, false);
      const state = await f.one('select deterministic_commit_id,ai_reserved_at from private.agent_pulses where id=$1', [a.pulseId]);
      assert.ok(state.deterministic_commit_id); assert.ok(state.ai_reserved_at);
      assert.ok(options.deadlineAt - deps.clock.now() > 15_000);
      return normalized(ctx);
    },
  };
  return { ...f, a, deps, repository, events, logs, hooks, controller, advance: ms => { elapsed += ms; }, providerCalls: () => providerCalls,
    run: () => engine().then(api => api.runClaimedPulse(a, deps)),
    stored: () => f.one('select status,ai_outcome,deterministic_commit_id,ai_reserved_at,idea_accepted_at,coverage from private.agent_pulses where id=$1', [a.pulseId]),
    parent: () => f.one("select * from private.agent_observations where user_id=$1 and target_id=$2 and kind='signal'", [f.owner, f.task]),
    countIdeas: () => f.one("select count(*)::int n from private.agent_observations where user_id=$1 and kind='idea'", [f.owner]),
  };
}
const calls = (h, name) => h.events.filter(e => e.name === name);
const reservation = h => calls(h, 'agent_pulse_reserve_ai')[0]?.args;
const finishFixture = h => h.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [h.a.userId, h.a.pulseId, h.a.leaseToken, h.a.fence, 'none']);
async function nextPulse(h) {
  if ((await h.stored()).status === 'running') await finishFixture(h);
  const state = await h.one('select fence,settings_revision from private.agent_pulse_state where user_id=$1', [h.owner]);
  h.a = Object.assign(h.a, await h.pulse(h.owner, { slot: new Date(Date.parse(h.a.slot) + 14400000).toISOString(), fence: state.fence + 1, settingsRevision: state.settings_revision }));
  await h.authorize(h.a); await h.db.query("update private.agent_pulse_state set mode='workspace_ai' where user_id=$1", [h.owner]);
  h.a.leaseExpiresAt = (await h.one('select private.agent_pulse_stamp(lease_expires_at) v from private.agent_pulses where id=$1', [h.a.pulseId])).v;
}

test('deterministic commit precedes fresh canonical parent join, reservation and one idea', async t => {
  const h = await harness(t), initial = await h.readSource(h.a); assert.equal(initial.existing.length, 0);
  const result = await h.run(); assert.equal(result.status, 'succeeded'); assert.equal(result.aiOutcome, 'accepted');
  const names = h.events.map(e => e.name), publication = names.indexOf('agent_pulse_publish_deterministic'), reserve = names.indexOf('agent_pulse_reserve_ai'), provider = names.indexOf('provider'), idea = names.indexOf('agent_pulse_publish_ai');
  assert.ok(publication >= 0 && publication < reserve && reserve < provider && provider < idea && idea < names.lastIndexOf('agent_pulse_finish'));
  assert.ok(names.slice(publication + 1, reserve).includes('agent_pulse_read_source'));
  assert.ok(names.slice(provider + 1, idea).includes('agent_pulse_read_source'));
  const parent = await h.parent(); assert.equal(reservation(h).p_parent_id, parent.id); assert.equal(reservation(h).p_episode, parent.episode);
  assert.equal(h.providerCalls(), 1); assert.equal((await h.countIdeas()).n, 1);
});
test('existing committed parent identity and new semantic episode come from fresh SQL read', async t => {
  const h = await harness(t); await h.publish(h.a); const old = await h.parent(); await nextPulse(h);
  await h.db.query("update public.tasks set priority='Critical' where id=$1", [h.task]);
  assert.equal((await h.run()).status, 'succeeded');
  const fresh = await h.parent(); assert.equal(fresh.id, old.id); assert.equal(fresh.episode, old.episode + 1);
  assert.equal(reservation(h).p_parent_id, fresh.id); assert.equal(reservation(h).p_episode, fresh.episode);
});
test('off mode reads only settings and performs no owner work', async t => {
  const h = await harness(t, 'off'); assert.equal((await h.run()).status, 'skipped');
  assert.deepEqual(h.events.map(e => e.name), ['agent_pulse_get_settings']); assert.equal(h.providerCalls(), 0);
});
test('workspace mode commits deterministic only without privacy or provider', async t => {
  const h = await harness(t, 'workspace'); h.deps.buildContext = () => assert.fail('No AI context in workspace mode');
  assert.equal((await h.run()).status, 'succeeded'); assert.ok((await h.stored()).deterministic_commit_id);
  assert.equal(calls(h, 'agent_pulse_reserve_ai').length, 0); assert.equal(h.providerCalls(), 0);
});
for (const kind of ['empty scope', 'no eligible parent', 'seen', 'old check', 'expired evidence', 'privacy denied']) test(`${kind} gives zero reservation/provider calls`, async t => {
  const h = await harness(t);
  if (kind === 'empty scope') await h.db.query("update private.agent_pulse_state set ai_project_ids='{}' where user_id=$1", [h.owner]);
  if (kind === 'no eligible parent') await h.db.query("update public.tasks set due_date=null,priority='Low' where id=$1", [h.task]);
  if (kind === 'privacy denied') h.deps.buildContext = () => ({ ok: false, reason: 'NO_ELIGIBLE_SIGNAL' });
  h.hooks.after = async (name, data) => {
    if (name === 'agent_pulse_publish_deterministic') {
      if (kind === 'seen') await h.db.query('update private.agent_observations set seen_content_revision=content_revision where user_id=$1', [h.owner]);
      if (kind === 'old check') await h.db.query("update private.agent_observations set last_checked_at=clock_timestamp()-interval '25 hours' where user_id=$1", [h.owner]);
      if (kind === 'expired evidence') await h.db.query("update private.agent_observations set evidence_valid_until=clock_timestamp()-interval '1 second' where user_id=$1", [h.owner]);
    }
    return data;
  };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal(calls(h, 'agent_pulse_reserve_ai').length, 0); assert.equal(h.providerCalls(), 0);
});
for (const [code, outcome] of [['AI_UNAVAILABLE', 'unavailable'], ['AI_TIMEOUT', 'timeout'], ['ABORTED', 'unknown'], ['AI_MALFORMED', 'malformed']]) test(`${code} preserves deterministic commit and consumed attempt`, async t => {
  const h = await harness(t); let count = 0; h.deps.provider = async () => { count++; return { ok: false, code }; };
  const result = await h.run(), state = await h.stored(), parent = await h.parent();
  assert.equal(result.status, 'succeeded'); assert.equal(state.status, 'succeeded'); assert.equal(state.ai_outcome, outcome);
  assert.ok(state.deterministic_commit_id); assert.ok(state.ai_reserved_at); assert.equal(parent.ai_attempt_count, 1);
  assert.equal(parent.ai_attempt_terminal, code === 'AI_MALFORMED'); assert.equal((await h.countIdeas()).n, 0); assert.equal(count, 1);
  if (code === 'AI_MALFORMED') {
    await nextPulse(h); await h.publish(h.a); const p = await h.parent();
    assert.equal((await h.sql('select public.agent_pulse_reserve_ai($1,$2,$3,$4,$5,$6,$7) r', [h.owner, h.a.pulseId, h.a.leaseToken, h.a.fence, h.a.settingsRevision, p.id, p.episode])).reason, 'AI_MALFORMED');
  }
});
test('unexpected provider exception is safe, consumes once and never retries', async t => {
  const h = await harness(t); let count = 0; h.deps.provider = async () => { count++; throw new Error('PRIVATE_PROVIDER_STACK'); };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal((await h.stored()).ai_outcome, 'unknown'); assert.equal(count, 1);
  assert.equal((await h.parent()).ai_attempt_count, 1); assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_PROVIDER/);
});
test('stale source before reservation makes zero calls', async t => {
  const h = await harness(t); h.hooks.after = async (name, data) => {
    if (name === 'agent_pulse_publish_deterministic') await h.db.query("update public.tasks set title='Changed after deterministic commit' where id=$1", [h.task]); return data;
  };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal(calls(h, 'agent_pulse_reserve_ai').length, 0); assert.equal(h.providerCalls(), 0);
});
test('settings disable before reservation makes zero provider calls', async t => {
  const h = await harness(t); h.hooks.after = async (name, data) => {
    if (name === 'agent_pulse_publish_deterministic') await h.sql('select public.agent_pulse_set_settings($1,$2,$3) r', [h.owner, 1, JSON.stringify({ mode: 'off', cadence: 'normal', checksConsent: false, aiConsent: false, aiProjectIds: [] })]); return data;
  };
  await h.run(); assert.equal(h.providerCalls(), 0); assert.equal(calls(h, 'agent_pulse_reserve_ai').length, 0); assert.ok((await h.stored()).deterministic_commit_id);
});
for (const change of ['source', 'disable', 'scope', 'delete owner', 'clear memory', 'new episode']) test(`${change} during provider work discards idea without refund`, async t => {
  const h = await harness(t); h.deps.provider = async ctx => {
    if (change === 'source') await h.db.query("update public.tasks set title='Different current source' where id=$1", [h.task]);
    if (change === 'disable' || change === 'scope') await h.sql('select public.agent_pulse_set_settings($1,$2,$3) r', [h.owner, 1, JSON.stringify({ mode: change === 'disable' ? 'off' : 'workspace_ai', cadence: 'normal', checksConsent: true, aiConsent: true, aiProjectIds: [] })]);
    if (change === 'delete owner') await h.db.query('delete from auth.users where id=$1', [h.owner]);
    if (change === 'clear memory') await h.sql('select public.agent_pulse_clear_memory($1,$2) r', [h.owner, 1]);
    if (change === 'new episode') await h.db.query('update private.agent_observations set episode=episode+1 where user_id=$1', [h.owner]);
    return normalized(ctx);
  };
  const result = await h.run(); assert.equal((await h.countIdeas()).n, 0);
  assert.equal((await h.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n, 1);
  if (!['delete owner', 'clear memory'].includes(change)) assert.equal((await h.parent()).ai_attempt_count, 1);
  if (change === 'source' || change === 'new episode') assert.equal(result.status, 'succeeded');
  if (change === 'clear memory') assert.equal((await h.one('select count(*)::int n from private.agent_observations where user_id=$1', [h.owner])).n, 0);
});
for (const reason of ['BUDGET', 'AI_MALFORMED', 'SOURCE_CHANGED']) test(`reservation denial ${reason} never invokes provider`, async t => {
  const h = await harness(t); h.deps.repository = { ...h.repository, reserveAi: async () => ({ reserved: false, sendAllowed: false, reason }) };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal(h.providerCalls(), 0); assert.equal((await h.stored()).ai_reserved_at, null);
});
test('actual attempt ceiling and retry-spacing denial remain database authority', async t => {
  const h = await harness(t); h.hooks.after = async (name, data) => {
    if (name === 'agent_pulse_publish_deterministic') await h.db.query('update private.agent_observations set ai_attempt_count=1,ai_last_attempt_at=clock_timestamp() where user_id=$1', [h.owner]); return data;
  };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal(h.providerCalls(), 0); assert.equal((await h.parent()).ai_attempt_count, 1);
});
for (const [elapsed, allowed] of [[5000, false], [4999, true], [20_000, false]]) test(`owner clock advances ${elapsed}ms: strict start/budget gate`, async t => {
  const h = await harness(t); let count = 0; h.deps.provider = async ctx => { count++; return normalized(ctx); };
  h.hooks.after = async (name, data) => { if (name === 'agent_pulse_publish_deterministic') h.advance(elapsed); return data; };
  const result = await h.run();
  assert.equal(result.status, elapsed === 20_000 ? 'running' : 'succeeded'); assert.equal(count, allowed ? 1 : 0); assert.ok((await h.stored()).deterministic_commit_id);
});
test('monotonic budget does not expand when wall clock moves backward', async t => {
  const h = await harness(t); const now = h.deps.clock.now; h.deps.clock.now = () => now() - 600_000;
  h.hooks.after = async (name, data) => { if (name === 'agent_pulse_publish_deterministic') h.advance(5000); return data; };
  await h.run(); assert.equal(h.providerCalls(), 0);
});
test('time consumed inside reservation skips transmission and keeps consumed attempt', async t => {
  const h = await harness(t); h.hooks.after = async (name, data) => { if (name === 'agent_pulse_reserve_ai') h.advance(5000); return data; };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal(h.providerCalls(), 0); assert.equal((await h.parent()).ai_attempt_count, 1);
});
test('lost deterministic publication response recovers canonical commit without another batch', async t => {
  const h = await harness(t); let lost = false; h.hooks.after = async (name, data) => {
    if (name === 'agent_pulse_publish_deterministic' && !lost) { lost = true; throw new Error('PRIVATE_LOST_RESPONSE'); } return data;
  };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal(calls(h, 'agent_pulse_publish_deterministic').length, 1); assert.equal(h.providerCalls(), 1);
  assert.equal((await h.one("select count(*)::int n from private.agent_observations where kind='signal' and user_id=$1", [h.owner])).n, 1);
});
test('crash after deterministic commit resumes from stored commit without re-publication', async t => {
  const h = await harness(t); await h.publish(h.a); const old = await h.parent(); await h.run();
  assert.equal(calls(h, 'agent_pulse_publish_deterministic').length, 0); assert.equal(reservation(h).p_parent_id, old.id); assert.equal(h.providerCalls(), 1);
});
test('lost reservation response is recovered, consumed, and never transmitted or retried', async t => {
  const h = await harness(t); h.hooks.after = async (name, data) => { if (name === 'agent_pulse_reserve_ai') throw new Error('PRIVATE_RESERVATION_RESPONSE'); return data; };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal(calls(h, 'agent_pulse_reserve_ai').length, 1); assert.equal(h.providerCalls(), 0);
  assert.equal((await h.parent()).ai_attempt_count, 1); assert.equal((await h.stored()).ai_outcome, 'unknown');
  await h.run(); assert.equal(h.providerCalls(), 0);
});
test('crash after reservation or uncertain transmission never retransmits', async t => {
  const h = await harness(t); await h.publish(h.a); const p = await h.parent();
  await h.sql('select public.agent_pulse_reserve_ai($1,$2,$3,$4,$5,$6,$7) r', [h.owner, h.a.pulseId, h.a.leaseToken, h.a.fence, 1, p.id, p.episode]);
  await h.run(); assert.equal(h.providerCalls(), 0); assert.equal(calls(h, 'agent_pulse_reserve_ai').length, 0); assert.equal((await h.parent()).ai_attempt_count, 1);
});
test('lost idea publication response recovers accepted canonical state without duplicate', async t => {
  const h = await harness(t); h.hooks.after = async (name, data) => { if (name === 'agent_pulse_publish_ai') throw new Error('PRIVATE_IDEA_RESPONSE'); return data; };
  const result = await h.run(); assert.equal(result.status, 'succeeded'); assert.equal(result.aiOutcome, 'accepted');
  assert.equal((await h.countIdeas()).n, 1); assert.equal(h.providerCalls(), 1); assert.equal(calls(h, 'agent_pulse_publish_ai').length, 1);
  await h.run(); assert.equal(h.providerCalls(), 1); assert.equal((await h.countIdeas()).n, 1);
});
test('lost finish response recovers stored final result', async t => {
  const h = await harness(t, 'workspace'); h.hooks.after = async (name, data) => { if (name === 'agent_pulse_finish') throw new Error('PRIVATE_FINISH_RESPONSE'); return data; };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal((await h.stored()).status, 'succeeded');
});
test('stale fence cannot finalize or clear newer authority', async t => {
  const h = await harness(t, 'workspace'); h.hooks.after = async (name, data) => {
    if (name === 'agent_pulse_publish_deterministic') await h.db.query('update private.agent_pulse_state set fence=fence+1 where user_id=$1', [h.owner]); return data;
  };
  const result = await h.run(); assert.notEqual(result.status, 'succeeded'); assert.equal((await h.stored()).status, 'running');
  assert.equal((await h.one('select fence from private.agent_pulse_state where user_id=$1', [h.owner])).fence, 2);
});
test('finalization derives stored partial coverage rather than returned publication flags', async t => {
  const h = await harness(t, 'workspace'); h.hooks.before = async (name) => {
    if (name === 'agent_pulse_finish') await h.db.query("update private.agent_pulses set coverage=jsonb_set(coverage,'{complete}','false') where id=$1", [h.a.pulseId]);
  };
  assert.equal((await h.run()).status, 'partial'); assert.equal((await h.stored()).status, 'partial');
});
test('provider executes after standalone SQL RPCs complete, never inside their transaction port', async t => {
  const h = await harness(t); assert.equal((await h.run()).status, 'succeeded'); assert.equal(h.providerCalls(), 1);
  assert.ok(h.events.findIndex(e => e.name === 'provider') > h.events.findIndex(e => e.name === 'agent_pulse_reserve_ai'));
});
test('safe logs never contain identifiers, context, model text or exception material', async t => {
  const h = await harness(t); h.deps.provider = async () => { throw new Error('PRIVATE_SDK_BODY'); }; await h.run();
  assert.ok(h.logs.length > 0); const logs = JSON.stringify(h.logs);
  assert.doesNotMatch(logs, /PRIVATE|Task|Review|parent|sourceToken|contents|11111111-|44444444-|prompt|response|secret/i);
  for (const entry of h.logs) assert.ok(Object.keys(entry).every(key => ['status', 'aiOutcome', 'code', 'createdCount', 'updatedCount', 'resolvedCount', 'durationMs'].includes(key)));
});
for (const failed of [false, true]) test(`${failed ? 'failed' : 'successful'} optional AI leaves all core/manual audit rows unchanged`, async t => {
  const h = await harness(t);
  const source = readFileSync(new URL('../../../supabase/migrations/20261001153933_phase4b_accountability_goals_reports.sql', import.meta.url), 'utf8');
  await h.db.exec(source.match(/create table if not exists public\.accountability_snapshots \([\s\S]*?\n\);/)[0]);
  await h.db.query("insert into public.accountability_snapshots(user_id,project_id,snapshot_date,health,github_status) values($1,$2,current_date,'Active','not-connected')", [h.owner, h.project]);
  await h.db.query('insert into private.agent_runs(id,user_id) values($1,$2)', [randomUUID(), h.owner]);
  await h.sql('select public.save_agent_proposal_batch($1,$2) r', [h.owner, JSON.stringify([{ id: randomUUID(), type: 'create_task', entityId: null, taskId: null, projectId: h.project, title: 'Manual preserved', payload: { title: 'Manual preserved' }, before: {}, expectedUpdatedAt: null, diff: [{ field: 'title', before: null, after: 'Manual preserved' }] }])]);
  const tables = ['public.projects', 'public.tasks', 'public.milestones', 'public.plans', 'public.project_plan_items', 'public.workspace_time_blocks', 'public.accountability_snapshots', 'private.agent_runs', 'private.agent_actions'];
  async function hashes() { const result = {}; for (const table of tables) result[table] = createHash('sha256').update(JSON.stringify((await h.db.query(`select to_jsonb(x) r from ${table} x order by id`)).rows)).digest('hex'); return result; }
  const before = await hashes(); if (failed) h.deps.provider = async () => ({ ok: false, code: 'AI_UNAVAILABLE' });
  await h.run(); assert.deepEqual(await hashes(), before);
});
test('real Task16 adapter integrates through injected SDK fetch with no live provider call', async t => {
  const h = await harness(t); delete h.deps.provider;
  const originalKey = process.env.GEMINI_API_KEY, originalModel = process.env.GEMINI_MODEL; let count = 0;
  process.env.GEMINI_API_KEY = 'fixture-key-never-sent'; process.env.GEMINI_MODEL = 'fixture-model';
  h.deps.fetch = async (_url, init) => {
    count++; const body = JSON.parse(init.body), ctx = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(body.generationConfig.maxOutputTokens, 800); assert.equal(body.tools, undefined);
    assert.doesNotMatch(init.body, /11111111-|parentId|parentEpisode|sourceToken/);
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ sourceAlias: ctx.primaryAlias, category: 'review_deadline', title: 'Review recorded work', advisoryText: 'Consider reviewing the recorded task.' }) }] }, finishReason: 'STOP' }] }));
  };
  try { assert.equal((await h.run()).aiOutcome, 'accepted'); assert.equal(count, 1); }
  finally { if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey; if (originalModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = originalModel; }
});
test('dispatch claims only one SQL batch, max two owners, processed sequentially', async t => {
  const h = await harness(t, 'workspace'); await finishFixture(h);
  await h.enable(h.owner); await h.enable(h.other);
  const events = [], repository = {};
  for (const key of ['getSettings', 'readSource', 'recover', 'publishDeterministic', 'finish', 'reserveAi', 'publishAi', 'claimDispatch', 'retain', 'retainInstallation']) repository[key] = async (...args) => { events.push([key, typeof args[0] === 'string' ? args[0] : args[0]?.userId]); return h.repository[key](...args); };
  const slot = (await h.one("select private.agent_pulse_stamp(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')) s")).s;
  const result = await (await engine()).runPulseDispatch({ version: 1, scheduledSlot: slot, nonce: randomUUID(), issuedAt: Math.floor(Date.now() / 1000), processingEnabled: true }, { ...h.deps, repository });
  assert.equal(result.claimed, 2); assert.equal(result.processed, 2); assert.equal(events.filter(e => e[0] === 'claimDispatch').length, 1);
  assert.equal(calls(h, 'agent_pulse_claim_dispatch')[0].args.p_processing_enabled, true);
  const first = events.find(e => e[0] === 'getSettings')[1], second = events.filter(e => e[0] === 'getSettings').find(e => e[1] !== first)[1];
  assert.ok(events.findIndex(e => e[0] === 'finish' && e[1] === first) < events.findIndex(e => e[0] === 'getSettings' && e[1] === second));
  assert.equal(h.providerCalls(), 0);
});

for (const initial of ['disabled', 'empty', 'claimed']) test(`disabled installation decision establishes or recovers ${initial} without owner execution`, async t => {
  const f = await fixture(t);
  const nonce = randomUUID();
  if (initial === 'disabled' || initial === 'claimed') { await f.enable(); await f.enable(f.other); }
  if (initial !== 'disabled') await f.sql("select public.agent_pulse_claim_dispatch(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01'),$1,date_trunc('second',clock_timestamp()),true) r", [nonce]);
  const { createPulseRepository } = await loadPulse('lib/ai/agent/pulse/db.ts');
  const calls = [], repository = createPulseRepository({ rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'agent_pulse_retain_installation') {
      assert.deepEqual(args, { p_limit:20 });
      return { data:await f.sql('select public.agent_pulse_retain_installation($1) r',[args.p_limit]),error:null };
    }
    assert.equal(name, 'agent_pulse_claim_dispatch', 'Disabled processing must never run owner capabilities');
    assert.deepEqual(Object.keys(args).sort(), ['p_slot','p_nonce','p_issued_at','p_processing_enabled'].sort());
    return { data: await f.sql('select public.agent_pulse_claim_dispatch($1,$2,$3,$4) r', [args.p_slot,args.p_nonce,args.p_issued_at,args.p_processing_enabled]), error: null };
  } });
  const before = (await f.one('select coalesce(jsonb_agg(to_jsonb(s) order by user_id),\'[]\') rows from private.agent_pulse_state s')).rows;
  const slot = (await f.one("select private.agent_pulse_stamp(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')) s")).s;
  const deps = { repository, signal: new AbortController().signal, fetch: async () => assert.fail('No provider fetch'),
    scan: () => assert.fail('No owner scanner'), buildContext: () => assert.fail('No context'), provider: async () => assert.fail('No provider') };
  const input = { scheduledSlot: slot, nonce, issuedAt: Math.floor(Date.now() / 1000), processingEnabled: false };
  const first = await (await engine()).runPulseDispatch(input, deps);
  assert.deepEqual(first, { outcome: initial === 'disabled' ? 'disabled' : 'recovered', claimed: initial === 'claimed' ? 2 : 0, processed: 0, succeeded: 0, partial: 0, failed: 0, skipped: 0 });
  const replay = await (await engine()).runPulseDispatch({ ...input, nonce: randomUUID() }, deps);
  assert.deepEqual(replay, { ...first, outcome: 'recovered' });
  assert.equal(calls.length, 4); assert.ok(calls.filter(c=>c.name==='agent_pulse_claim_dispatch').every(c => c.args.p_processing_enabled === false));
  assert.equal(calls.filter(c=>c.name==='agent_pulse_retain_installation').length,2);
  if (initial === 'disabled') {
    assert.deepEqual(await (await engine()).runPulseDispatch({ ...input, nonce: randomUUID(), processingEnabled: true }, deps), { ...first, outcome: 'recovered' });
    assert.equal(calls.filter(c=>c.name==='agent_pulse_claim_dispatch')[2].args.p_processing_enabled, true);
  }
  assert.deepEqual((await f.one('select coalesce(jsonb_agg(to_jsonb(s) order by user_id),\'[]\') rows from private.agent_pulse_state s')).rows, before);
});

test('missing or invalid internal processing decision fails before any dispatch capability', async () => {
  const { runPulseDispatch } = await engine(), { createPulseRepository } = await loadPulse('lib/ai/agent/pulse/db.ts');
  let effects = 0;
  const repository = createPulseRepository({ rpc: async () => { effects++; assert.fail('Invalid processing decision cannot reach SQL'); } });
  const input = { scheduledSlot: new Date().toISOString(), nonce: randomUUID(), issuedAt: Math.floor(Date.now() / 1000) };
  for (const processingEnabled of [undefined,null,'false',0]) {
    await assert.rejects(repository.claimDispatch(input.scheduledSlot,input.nonce,new Date().toISOString(),processingEnabled), /SOURCE_UNAVAILABLE/);
    const result = await runPulseDispatch({ ...input, processingEnabled }, { repository, signal: new AbortController().signal, fetch: async () => assert.fail('No provider') });
    assert.equal(result.outcome, 'failed'); assert.equal(result.processed, 0);
  }
  assert.equal(effects, 0);
});

test('internal processing decision is required by actual TypeScript engine and repository contracts', () => {
  const root = resolve(import.meta.dirname, '../../..'), file = resolve(root, 'phase5d-flag-contract.ts');
  const config = ts.readConfigFile(resolve(root,'tsconfig.json'),ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config,ts.sys,root);
  const source = `import { runPulseDispatch, type PulseEngineDeps } from './lib/ai/agent/pulse/engine';
    import type { PulseRepository } from './lib/ai/agent/pulse/db';
    declare const deps: PulseEngineDeps; declare const repo: PulseRepository;
    const identity = {scheduledSlot:'2026-10-16T08:00:00.000Z',nonce:'11111111-1111-4111-8111-111111111111',issuedAt:1};
    runPulseDispatch({...identity,processingEnabled:true},deps);
    repo.claimDispatch(identity.scheduledSlot,identity.nonce,'2026-10-16T08:00:00.000Z',false);
    // @ts-expect-error Internal processing state may never be omitted.
    runPulseDispatch(identity,deps);
    // @ts-expect-error The repository requires an explicit fourth argument.
    repo.claimDispatch(identity.scheduledSlot,identity.nonce,'2026-10-16T08:00:00.000Z');`;
  const options = { ...parsed.options, incremental: false, noEmit: true };
  function compile(text) {
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => resolve(name) === file ? ts.createSourceFile(name,text,languageVersion,true) : original(name,languageVersion,onError,shouldCreateNewSourceFile);
    const program = ts.createProgram([file],options,host);
    assert.equal(program.getSourceFile(file)?.text, text, 'The virtual contract must actually be compiled');
    return ts.getPreEmitDiagnostics(program);
  }
  assert.deepEqual(compile(source).map(d => ts.flattenDiagnosticMessageText(d.messageText,' ')), []);
  const missing = compile(source.replaceAll(/\/\/ @ts-expect-error[^\n]*/g,''));
  assert.deepEqual(missing.map(d => d.code).sort(), [2345,2554]);
});
test('dispatch rejects oversized supplied batch without owner discovery or processing', async () => {
  const { runPulseDispatch } = await engine(); let claims = 0, owners = 0;
  const repository = { retainInstallation:async()=>({deleted:0}),claimDispatch: async () => { claims++; return { claims: [{}, {}, {}], claimCount: 3, replay: false, outcome: 'claimed' }; }, getSettings: async () => { owners++; assert.fail('No owner expansion'); } };
  const result = await runPulseDispatch({ scheduledSlot: new Date().toISOString(), nonce: randomUUID(), issuedAt: Date.now() / 1000, processingEnabled: true }, { repository, signal: new AbortController().signal, fetch: async () => assert.fail('No fetch') });
  assert.equal(result.processed, 0); assert.equal(claims, 1); assert.equal(owners, 0);
});
test('45s dispatch clock stops starting additional owners', async () => {
  const { runPulseDispatch } = await engine(); let elapsed = 0, owners = 0;
  const claims = [1, 2].map(n => ({ userId: randomUUID(), pulseId: randomUUID(), leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(), slot: new Date().toISOString(), fence: n, settingsRevision: 1, policyVersion: 'pulse-v1' }));
  const repository = { retainInstallation:async()=>({deleted:0}),claimDispatch: async () => ({ claims, claimCount: 2, replay: false, outcome: 'claimed' }), getSettings: async () => { owners++; elapsed = 45_000; return { mode: 'off' }; } };
  const result = await runPulseDispatch({ scheduledSlot: claims[0].slot, nonce: randomUUID(), issuedAt: Date.now() / 1000, processingEnabled: true }, { repository, signal: new AbortController().signal, clock: { now: () => Date.now(), monotonic: () => elapsed }, fetch: async () => assert.fail('No fetch') });
  assert.equal(result.processed, 1); assert.equal(owners, 1);
});
test('worker runtime closure cannot reach prohibited mutation or generic database capabilities', async () => {
  await engine(); const root = resolve(import.meta.dirname, '../../..'), seen = new Set();
  function walk(file) {
    if (seen.has(file)) return; seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
      const name = node.moduleSpecifier.text;
      assert.doesNotMatch(name, /executor|registry|proposal|gemini-transport|supabase|snapshot|github|drive|scheduler|actions|context/);
      if (name.startsWith('.') || name.startsWith('@/')) walk(name.startsWith('@/') ? resolve(root, name.slice(2) + '.ts') : resolve(dirname(file), name + '.ts'));
      else assert.ok(['server-only', '@google/genai', 'node:crypto'].includes(name), `Unexpected external capability: ${name}`);
    }
    if (file.endsWith('engine.ts')) {
      function inspect(node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source).endsWith('repository')) assert.ok(['getSettings', 'readSource', 'recover', 'publishDeterministic', 'reserveAi', 'publishAi', 'finish', 'claimDispatch', 'retain', 'retainInstallation'].includes(node.expression.name.text));
        ts.forEachChild(node, inspect);
      }
      inspect(source);
    }
  }
  walk(resolve(root, 'lib/ai/agent/pulse/engine.ts'));
});

test('20s owner deadline bounds a nonresponding RPC and cleans caller listener', async t => {
  const { runClaimedPulse } = await engine(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers(), controller = new AbortController();
  const a = { userId: randomUUID(), pulseId: randomUUID(), leaseExpiresAt: new Date(Date.now() + 90_000).toISOString() };
  const pending = runClaimedPulse(a, { signal: controller.signal, repository: { getSettings: () => { started.resolve(); return new Promise(() => {}); } }, fetch: async () => assert.fail('No fetch') });
  await started.promise; t.mock.timers.tick(20_000); assert.equal((await pending).code, 'AUTHORITY_LOST');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test('caller cancellation stops a waiting owner without another RPC or provider send', async () => {
  const { runClaimedPulse } = await engine(), controller = new AbortController(), started = Promise.withResolvers(); let calls = 0;
  const pending = runClaimedPulse({ userId: randomUUID(), leaseExpiresAt: new Date(Date.now() + 90_000).toISOString() }, { signal: controller.signal,
    repository: { getSettings: () => { calls++; started.resolve(); return new Promise(() => {}); } }, fetch: async () => assert.fail('No fetch') });
  await started.promise; controller.abort(); assert.equal((await pending).code, 'AUTHORITY_LOST'); assert.equal(calls, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test('deadline during provider wait retains confirmed canonical reservation in result', async t => {
  const h = await harness(t), started = Promise.withResolvers();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.deps.provider = () => { started.resolve(); return new Promise(() => {}); };
  const pending = h.run(); await started.promise; t.mock.timers.tick(20_000);
  const result = await pending; assert.equal(result.status, 'running'); assert.equal(result.aiOutcome, 'reserved');
  assert.ok((await h.stored()).ai_reserved_at); assert.equal((await h.parent()).ai_attempt_count, 1);
});
test('lost finish response returns recovered final status without a false authority error', async t => {
  const h = await harness(t, 'workspace'); h.hooks.after = async (name, data) => { if (name === 'agent_pulse_finish') throw new Error('lost fixture response'); return data; };
  const result = await h.run(); assert.equal(result.status, 'succeeded'); assert.equal(result.code, null);
});
test('source changes immediately before guarded reservation: no transmission', async t => {
  const h = await harness(t); h.hooks.before = async name => { if (name === 'agent_pulse_reserve_ai') await h.db.query("update public.tasks set title='Changed at reserve boundary' where id=$1", [h.task]); };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal(h.providerCalls(), 0); assert.equal((await h.stored()).ai_reserved_at, null);
});
test('malformed provider outcome cannot mark a different episode terminal', async t => {
  const h = await harness(t); h.deps.provider = async () => {
    await h.db.query('update private.agent_observations set episode=episode+1 where user_id=$1', [h.owner]); return { ok: false, code: 'AI_MALFORMED' };
  };
  await h.run(); assert.equal((await h.parent()).ai_attempt_terminal, false);
});
test('provider alias cannot replace the pinned canonical parent', async t => {
  const h = await harness(t); h.deps.provider = async ctx => ({ ...normalized(ctx), sourceAlias: 'T2' });
  await h.run(); assert.equal((await h.countIdeas()).n, 0); assert.equal((await h.parent()).ai_attempt_count, 1);
});
test('repository recovery and reservation DTOs fail closed on malformed authority', async () => {
  await engine(); const { createPulseRepository } = await loadPulse('lib/ai/agent/pulse/db.ts');
  const a = { userId: randomUUID(), pulseId: randomUUID(), leaseToken: randomUUID(), fence: 1, settingsRevision: 1 };
  const state = { id: a.pulseId, status: 'running', commitId: null, reserved: false, ideaAccepted: false, aiOutcome: 'none', createdCount: 0, updatedCount: 0, resolvedCount: 0 };
  for (const value of [{ ...state, id: randomUUID() }, { ...state, rawPayload: 'PRIVATE' }, { ...state, aiOutcome: 'PRIVATE' }, { ...state, createdCount: 4 }]) {
    await assert.rejects(createPulseRepository({ rpc: async () => ({ data: value, error: null }) }).recover(a), /SOURCE_UNAVAILABLE/);
  }
  await assert.rejects(createPulseRepository({ rpc: async () => ({ data: { reserved: true, recovered: true, sendAllowed: true }, error: null }) }).reserveAi(a, randomUUID(), 1), /SOURCE_UNAVAILABLE/);
});
test('changed supporting signal invalidates provider result even when pinned parent remains current', async t => {
  const h = await harness(t), support = '99999999-9999-4999-8999-999999999999';
  await h.db.query("insert into public.tasks(id,user_id,project_id,title,due_date,priority) values($1,$2,$3,'Supporting task',(clock_timestamp() at time zone 'UTC')::date,'High')", [support, h.owner, h.project]);
  h.deps.provider = async ctx => {
    assert.equal(ctx.aliases[ctx.primaryAlias].id, h.task); assert.equal(JSON.parse(ctx.contents).signals.length, 2);
    await h.db.query("update public.tasks set title='Changed supporting facts' where id=$1", [support]); return normalized(ctx);
  };
  assert.equal((await h.run()).status, 'succeeded'); assert.equal((await h.countIdeas()).n, 0);
});
test('insufficient remaining publication budget skips new deterministic work and safely finalizes', async t => {
  const h = await harness(t); h.hooks.after = async (name, data) => { if (name === 'agent_pulse_read_source') h.advance(15_000); return data; };
  const result = await h.run(); assert.equal(calls(h, 'agent_pulse_publish_deterministic').length, 0); assert.equal(h.providerCalls(), 0);
  assert.equal(result.status, 'failed'); assert.equal((await h.stored()).deterministic_commit_id, null);
});

test('Task24 disabled operational dispatch prunes old installation events without owner processing', async t => {
  const h = await harness(t, 'workspace');
  await h.db.query("insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) values('provider_reservation',gen_random_uuid(),clock_timestamp()-interval '49 hours')");
  const now = await h.one("select private.agent_pulse_stamp(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')) slot,floor(extract(epoch from clock_timestamp()))::bigint issued");
  const result = await (await engine()).runPulseDispatch({ scheduledSlot:now.slot,issuedAt:Number(now.issued),nonce:randomUUID(),processingEnabled:false }, h.deps);
  assert.equal(result.outcome,'disabled'); assert.equal(result.processed,0);
  assert.equal((await h.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n,0);
  assert.equal(h.providerCalls(),0); assert.equal(calls(h,'agent_pulse_retain').length,0);
});
test('Task24 eligible owner processing prunes obsolete unreferenced headers through its fixed repository', async t => {
  const h = await harness(t,'workspace'), id = randomUUID();
  await h.db.query("insert into private.agent_pulses(id,user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version) values($1,$2,date_bin(interval '4 hours',clock_timestamp()-interval '31 days',timestamptz '1970-01-01'),gen_random_uuid(),'succeeded',clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days'+interval '1 hour',1,gen_random_uuid(),clock_timestamp()-interval '31 days'+interval '1 hour',1,'pulse-v1')",[id,h.owner]);
  await h.run(); assert.ok(!await h.one('select id from private.agent_pulses where id=$1',[id])); assert.equal(h.providerCalls(),0);
});

for (const change of ['off','scope','source','owner deletion']) test('Task24 outbound recheck blocks '+change+' after committed reservation',async t=>{
  const h=await harness(t);let physicalSends=0;
  h.deps.fetch=async()=>{physicalSends++;return new Response('{}');};
  h.deps.provider=async(ctx,options)=>{await options.fetch('https://provider.invalid');return normalized(ctx);};
  h.hooks.after=async(name,data)=>{
    if(name==='agent_pulse_reserve_ai') {
      assert.equal(data.sendAllowed,true);
      if(change==='off') await h.sql('select public.agent_pulse_set_settings($1,$2,$3) r',[h.owner,1,JSON.stringify({mode:'off',cadence:'normal',checksConsent:false,aiConsent:false,aiProjectIds:[]})]);
      if(change==='scope') await h.sql('select public.agent_pulse_set_settings($1,$2,$3) r',[h.owner,1,JSON.stringify({mode:'workspace_ai',cadence:'normal',checksConsent:true,aiConsent:true,aiProjectIds:[]})]);
      if(change==='source') await h.db.query("update public.tasks set title='Changed after reservation' where id=$1",[h.task]);
      if(change==='owner deletion') await h.db.query('delete from auth.users where id=$1',[h.owner]);
    }
    return data;
  };
  await h.run();assert.equal(physicalSends,0);
  assert.equal((await h.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n,1);
  if(change==='owner deletion') assert.equal((await h.one('select count(*)::int n from private.agent_pulse_state where user_id=$1',[h.owner])).n,0);
  else {assert.ok((await h.stored()).ai_reserved_at);assert.equal((await h.parent()).ai_attempt_count,1);}
});
for (const boundary of ['abort','deadline','provider abort']) test('Task24 outbound recheck revalidates '+boundary+' after canonical read',async t=>{
  const h=await harness(t),transport=new AbortController();let reads=0,sends=0;
  h.deps.fetch=async()=>{sends++;return new Response('{}');};
  h.deps.provider=async(ctx,options)=>{await options.fetch('https://provider.invalid',{signal:transport.signal});return normalized(ctx);};
  h.hooks.after=async(name,data)=>{
    if(name==='agent_pulse_read_source' && ++reads===3) {
      if(boundary==='abort') h.controller.abort();
      if(boundary==='deadline') h.advance(5000);
      if(boundary==='provider abort') transport.abort();
    }
    return data;
  };
  await h.run();assert.equal(reads,3);assert.equal(sends,0);
  assert.ok((await h.stored()).ai_reserved_at);assert.equal((await h.parent()).ai_attempt_count,1);
});