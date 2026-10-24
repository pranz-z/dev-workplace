import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './phase5d-fixture.mjs';
const input = { mode: 'workspace', cadence: 'normal', checksConsent: true, aiConsent: false, aiProjectIds: [] };
test('settings are explicit consent authority and reads never initialize rows', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_set_settings(uuid,bigint,jsonb)') r")).r, 'settings missing');
  const get = () => f.sql('select public.agent_pulse_get_settings($1) r', [f.owner]);
  const set = (revision, value) => f.sql('select public.agent_pulse_set_settings($1,$2,$3) r', [f.owner, revision, JSON.stringify(value)]);
  await t.test('absence_is_off_and_never_checked_without_insert', async () => {
    const result = await get(); assert.equal(result.mode, 'off'); assert.equal(result.settingsRevision, 0);
    assert.equal(result.lastDeterministicAt, null); assert.deepEqual(result.aiProjectIds, []);
    assert.equal((await f.one('select count(*)::int n from private.agent_pulse_state')).n, 0);
  });
  await t.test('strict_keys_null_and_separate_consent', async () => {
    for (const value of [{ ...input, timeZone: 'UTC' }, { ...input, mode: 'workspace_ai' }, { ...input, mode: null }, { ...input, cadence: null }, { ...input, checksConsent: null }, { ...input, aiProjectIds: null }]) await assert.rejects(set(0, value), /Invalid settings/);
    const omitted = { ...input }; delete omitted.aiConsent; await assert.rejects(set(0, omitted), /Invalid settings/);
    const result = await set(0, input); assert.equal(result.mode, 'workspace'); assert.equal(result.aiConsented, false); assert.equal(result.settingsRevision, 1);
  });
  await t.test('owned_explicit_scope_only_and_stale_revision', async () => {
    await assert.rejects(set(1, { ...input, mode: 'workspace_ai', aiConsent: true, aiProjectIds: [f.other] }), /Invalid scope/);
    await assert.rejects(set(1, { ...input, mode: 'workspace_ai', aiConsent: true, aiProjectIds: Array(21).fill(f.project) }), /Invalid scope/);
    const result = await set(1, { ...input, mode: 'workspace_ai', aiConsent: true, aiProjectIds: [f.project] });
    assert.equal(result.aiEligible, true); assert.equal(result.settingsRevision, 2);
    await assert.rejects(set(1, input), /STATE_CHANGED/);
  });
  await t.test('changes_invalidate_authority_without_erasing_history', async () => {
    const a = await f.pulse(f.owner, { settingsRevision: 2, fence: 3 }); await f.authorize(a);
    await set(2, { ...input, cadence: 'quiet' });
    assert.equal(await f.readSource(a), null);
    assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n, 1);
    const result = await get(); assert.equal(result.cadence, 'quiet');
    const current = await f.one("select next_due_at>clock_timestamp() future,mod(extract(epoch from next_due_at),14400)=0 aligned from private.agent_pulse_state where user_id=$1", [f.owner]);
    assert.deepEqual(current, { future: true, aligned: true });
  });
  await t.test('disclosure_revision_disables_ai_until_renewed', async () => {
    await set(3, { ...input, mode: 'workspace_ai', aiConsent: true, aiProjectIds: [f.project] });
    await f.db.query("update private.agent_pulse_state set ai_consent_version='ai-old' where user_id=$1", [f.owner]);
    const result = await get(); assert.equal(result.aiConsented, false); assert.equal(result.aiEligible, false);
  });
  await t.test('exact_twenty_owned_scope_and_empty_scope_never_mean_all_projects', async () => {
    await f.db.query("insert into public.projects(user_id,title) select $1,'Scope '||g from generate_series(1,19) g", [f.owner]);
    const ids = (await f.db.query('select id from public.projects where user_id=$1 order by id', [f.owner])).rows.map(row => row.id);
    const result = await set(4, { ...input, mode: 'workspace_ai', aiConsent: true, aiProjectIds: ids });
    assert.equal(result.aiProjectIds.length, 20); assert.equal(result.aiEligible, true);
    const empty = await set(5, { ...input, mode: 'workspace_ai', aiConsent: true });
    assert.equal(empty.aiEligible, false); assert.deepEqual(empty.aiProjectIds, []);
  });
});
