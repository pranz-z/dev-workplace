import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './phase5d-fixture.mjs';
import { loadPulse } from './phase5d-test-support.mjs';

async function ready(t) {
  const f = await fixture(t), a = await f.pulse(); await f.authorize(a);
  await f.db.query("update public.profiles set time_zone='UTC' where id=$1", [f.owner]);
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'UTC')::date,priority='High' where id=$1", [f.task]);
  await f.db.query("update private.agent_pulse_state set mode='workspace_ai',ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$2::uuid] where user_id=$1", [f.owner, f.project]);
  return { ...f, a };
}
const parent = f => f.one("select id,episode,row_revision,content_revision,seen_content_revision,last_checked_at::text,source_token from private.agent_observations where user_id=$1 and target_id=$2 and kind='signal'", [f.owner, f.task]);
const reference = (s, target) => s.existing.find(item => item.key === `task:${target}:attention`);
const finish = (f, a) => f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [a.userId, a.pulseId, a.leaseToken, a.fence, 'none']);

test('fresh canonical parent reread follows deterministic commit and lifecycle', async t => {
  const f = await ready(t); let a = f.a, step = 0;
  async function next() {
    await finish(f, a);
    const state = await f.one('select fence,settings_revision from private.agent_pulse_state where user_id=$1', [f.owner]);
    a = await f.pulse(f.owner, { slot: new Date(Date.parse(f.a.slot) + (++step) * 14400000).toISOString(), fence: state.fence + 1, settingsRevision: state.settings_revision });
    await f.authorize(a);
    await f.db.query("update private.agent_pulse_state set mode='workspace_ai' where user_id=$1", [f.owner]);
  }
  const before = await f.readSource(a);
  const { scanPulse } = await loadPulse('lib/ai/agent/pulse/scanner.ts'), { PULSE_POLICY } = await loadPulse('lib/ai/agent/pulse/policy.ts');
  const scan = scanPulse(before, before.existing, PULSE_POLICY);
  await t.test('scanner and pre-publication source never invent committed authority', () => {
    assert.equal(reference(before, f.task), undefined);
    for (const d of scan.decisions) for (const key of ['id', 'episode', 'parentId', 'parentEpisode']) assert.equal(Object.hasOwn(d, key), false);
  });
  const commit = await f.publish(a, scan);
  await t.test('fresh service read returns exact canonical id and episode after publication', async () => {
    assert.ok(commit.createdCount > 0);
    const row = await parent(f), fresh = reference(await f.readSource(a), f.task);
    assert.equal(fresh.id, row.id); assert.equal(fresh.episode, row.episode);
    assert.equal(reference(before, f.task), undefined, 'Initial snapshot is never retroactively enriched');
    assert.deepEqual(Object.keys(commit).sort(), ['commitId', 'createdCount', 'partial', 'resolvedCount', 'updatedCount']);
  });
  await t.test('unchanged recheck preserves committed identity and episode', async () => {
    const prior = await parent(f); await next(); await f.publish(a);
    const fresh = reference(await f.readSource(a), f.task);
    assert.equal(fresh.id, prior.id); assert.equal(fresh.episode, prior.episode);
    assert.ok(fresh.rowRevision > prior.row_revision);
  });
  await t.test('material new episode returns same identity and incremented canonical episode', async () => {
    const prior = await parent(f); await next(); await f.db.query("update public.tasks set priority='Critical' where id=$1", [f.task]); await f.publish(a);
    const fresh = reference(await f.readSource(a), f.task);
    assert.equal(fresh.id, prior.id); assert.equal(fresh.episode, prior.episode + 1);
  });
  await t.test('false then true returns canonical new episode, independent of row revision', async () => {
    const prior = await parent(f); await next(); await f.db.query("update public.tasks set due_date=null,priority='Low' where id=$1", [f.task]); await f.publish(a);
    assert.equal((await parent(f)).episode, prior.episode);
    await next(); await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'UTC')::date,priority='Critical' where id=$1", [f.task]); await f.publish(a);
    const row = await parent(f), fresh = reference(await f.readSource(a), f.task);
    assert.equal(fresh.id, prior.id); assert.equal(fresh.episode, prior.episode + 1); assert.notEqual(row.row_revision, row.episode);
  });
  await t.test('two condition identities cannot cross-associate parent metadata', async () => {
    await next(); const otherTask = randomUUID();
    await f.db.query("insert into public.tasks(id,user_id,project_id,title,due_date,priority) values($1,$2,$3,'Other deadline',(clock_timestamp() at time zone 'UTC')::date,'High')", [otherTask, f.owner, f.project]); await f.publish(a);
    const source = await f.readSource(a);
    for (const item of source.existing) {
      const stored = await f.one('select id,episode from private.agent_observations where user_id=$1 and condition_key=$2', [f.owner, item.key]);
      assert.equal(item.id, stored.id); assert.equal(item.episode, stored.episode);
    }
    assert.notEqual(reference(source, f.task).id, reference(source, otherTask).id);
  });
  await t.test('foreign owner references are absent and mismatched authority denies read', async () => {
    const other = await f.pulse(f.other); await f.authorize(other);
    const foreignId = await f.observation(other);
    const source = await f.readSource(a);
    assert.equal(source.existing.some(item => item.id === foreignId), false);
    assert.equal(await f.readSource({ ...a, userId: f.other }), null);
  });
  await t.test('source token change does not make committed metadata current', async () => {
    const before = reference(await f.readSource(a), f.task);
    await f.db.query("update public.tasks set title='Changed after publication' where id=$1", [f.task]);
    const fresh = await f.readSource(a), ref = reference(fresh, f.task);
    assert.equal(ref.id, before.id); assert.equal(ref.episode, before.episode); assert.equal(ref.sourceToken, before.sourceToken);
    assert.notEqual(fresh.tasks.find(item => item.id === f.task).sourceToken, ref.sourceToken);
    assert.equal((await f.sql('select public.agent_pulse_reserve_ai($1,$2,$3,$4,$5,$6,$7) r', [a.userId, a.pulseId, a.leaseToken, a.fence, a.settingsRevision, ref.id, ref.episode])).sendAllowed, false);
  });
  await t.test('deleted observation is absent rather than returning stale authority', async () => {
    const row = await parent(f); await f.db.query('delete from private.agent_observations where id=$1', [row.id]);
    assert.equal(reference(await f.readSource(a), f.task), undefined);
  });
});

test('Task15 consumes committed source metadata without using browser DTO authority', async t => {
  const f = await ready(t); await f.publish(f.a);
  const { buildProactiveContext } = await loadPulse('lib/ai/agent/pulse/privacy.ts'), { scanPulse } = await loadPulse('lib/ai/agent/pulse/scanner.ts'), { PULSE_POLICY } = await loadPulse('lib/ai/agent/pulse/policy.ts');
  async function build() {
    const source = await f.readSource(f.a), scan = scanPulse(source, source.existing, PULSE_POLICY);
    const candidates = scan.decisions.flatMap(d => {
      const committed = source.existing.find(o => o.key === d.key);
      return committed ? [{ ...d, parentId: committed.id, parentEpisode: committed.episode, state: committed.state, seen: committed.seen, lastCheckedAt: committed.lastCheckedAt, sourceToken: committed.sourceToken, evidenceValidUntil: committed.evidenceValidUntil }] : [];
    });
    const settings = await f.sql('select public.agent_pulse_get_settings($1) r', [f.owner]);
    return buildProactiveContext(source, candidates, settings);
  }
  await t.test('fresh unseen committed parent produces minimized context', async () => {
    const result = await build(), row = await parent(f);
    assert.equal(result.ok, true, 'Canonical server read must supply all required Task15 metadata');
    assert.equal(result.context.parentId, row.id); assert.equal(result.context.parentEpisode, row.episode);
    assert.doesNotMatch(result.context.contents, /parentId|parentEpisode|lastCheckedAt|seen|episode/);
    assert.equal(result.context.contents.includes(row.id), false);
  });
  await t.test('canonical seen state prevents context after acknowledgement', async () => {
    const row = await parent(f);
    await f.sql('select public.agent_pulse_ack($1,$2,false) r', [f.owner, JSON.stringify([{ id: row.id, contentRevision: row.content_revision }])]);
    const ref = reference(await f.readSource(f.a), f.task);
    assert.equal(ref.seen, true); assert.equal((await build()).ok, false);
  });
  await t.test('canonical check time is returned exactly, never inferred from current read time', async () => {
    const ref = reference(await f.readSource(f.a), f.task);
    const stored = await f.one('select private.agent_pulse_stamp(last_checked_at) stamp from private.agent_observations where id=$1', [(await parent(f)).id]);
    assert.equal(ref.lastCheckedAt, stored.stamp);
  });
});

test('truncated discovery retains only bounded owner-targeted committed authority', async t => {
  const f = await ready(t); await f.publish(f.a);
  const stored = await parent(f);
  await f.db.query("insert into public.tasks(user_id,project_id,title) select $1,$2,'Generic task '||g from generate_series(1,201) g", [f.owner, f.project]);
  const fresh = await f.readSource(f.a), ref = reference(fresh, f.task);
  assert.equal(fresh.coverage.tasks.complete, false); assert.equal(fresh.tasks.length, 200);
  assert.equal(ref.id, stored.id); assert.equal(ref.episode, stored.episode);
  assert.equal(fresh.targetChecks[ref.key].complete, true); assert.equal(fresh.targetChecks[ref.key].exists, true);
  assert.equal(fresh.taskBlocks[f.task].coverage.complete, true); assert.ok(fresh.tasks.some(item => item.id === f.task));
  assert.ok(fresh.existing.length <= 20);
});

test('parent authority stays absent from browser DTOs and browser grants', async t => {
  const f = await ready(t); await f.publish(f.a); const row = await parent(f);
  const items = [await f.sql('select public.agent_pulse_get_observation($1,$2) r', [f.owner, row.id]),
    await f.sql('select public.agent_pulse_list_inbox($1,$2,null,20) r', [f.owner, 'active']),
    await f.sql('select public.agent_pulse_get_brief($1) r', [f.owner]), await f.sql('select public.agent_pulse_list_journal($1,null,20) r', [f.owner])];
  for (const item of items) assert.doesNotMatch(JSON.stringify(item), /"(?:episode|parentEpisode|parentId|sourceToken|materialFingerprint|latestPulseId|seenContentRevision)":/);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const privileges = await f.one("select has_function_privilege($1,'public.agent_pulse_read_source(uuid,uuid,uuid,bigint)','execute') reader,has_function_privilege($1,'private.agent_pulse_source_projection(uuid,timestamptz,jsonb)','execute') helper,has_table_privilege($1,'private.agent_observations','select') observations", [role]);
    assert.equal(privileges.reader, role === 'service_role'); assert.equal(privileges.helper, false);
    if (role !== 'service_role') assert.equal(privileges.observations, false);
  }
  assert.equal((await f.one("select exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.agent_pulse_read_source(uuid,uuid,uuid,bigint)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') allowed")).allowed, false);
});

test('repository rejects invalid committed authority rather than fabricating it', async t => {
  const f = await ready(t); await f.publish(f.a);
  const source = await f.readSource(f.a), { createPulseRepository } = await loadPulse('lib/ai/agent/pulse/db.ts');
  const repository = data => createPulseRepository({ rpc: async () => ({ data, error: null }) });
  assert.equal(reference(await repository(source).readSource(f.a), f.task).id, (await parent(f)).id);
  for (const edit of [o => { delete o.id; }, o => { o.id = 'bad'; }, o => { delete o.episode; }, o => { o.episode = 0; }, o => { o.episode = 1.5; }, o => { o.episode = '1'; }, o => { delete o.seen; }, o => { o.lastCheckedAt = 'invalid'; }]) {
    const bad = structuredClone(source); edit(bad.existing[0]);
    await assert.rejects(repository(bad).readSource(f.a), /SOURCE_UNAVAILABLE/);
  }
});
