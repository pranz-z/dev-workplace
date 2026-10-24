import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './phase5d-fixture.mjs';
import { loadPulse } from './phase5d-test-support.mjs';

test('fixed canonical Phase 5D source projection', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_read_source(uuid,uuid,uuid,bigint)') r")).r, 'source RPC missing');
  const a = await f.pulse(); await f.authorize(a);
  await t.test('only_required_columns_and_one_statement_snapshot', async () => {
    const source = await f.readSource(a);
    assert.equal(source.userId, f.owner); assert.equal(source.timeZone, 'Asia/Manila');
    assert.equal(source.tasks.length, 1); assert.equal(source.projects.length, 1);
    assert.equal(source.tasks[0].id, f.task);
    assert.doesNotMatch(JSON.stringify(source), /description|notes|before_state|payload|agent_actions|prompt|github/i);
    assert.match(source.evaluatedAt, /^\d{4}-\d{2}-\d{2}T/);
    const p = await f.one("select prolang=(select oid from pg_language where lanname='sql') sql,provolatile from pg_proc where oid='private.agent_pulse_source_projection(uuid,timestamptz,jsonb)'::regprocedure");
    assert.deepEqual(p, { sql: true, provolatile: 's' });
  });
  await t.test('owner_parent_isolation_and_targeted_block_absence', async () => {
    const source = await f.readSource(a);
    assert.ok(source.projects.every(row => row.userId === f.owner));
    assert.equal(source.taskBlocks[f.task].coverage.complete, true);
    assert.deepEqual(source.taskBlocks[f.task].blocks, []);
    assert.equal(source.projectActivity[f.project].coverage.complete, true);
  });
  await t.test('new_block_invalidates_hash_without_task_version_change', async () => {
    const before = await f.readSource(a);
    const version = await f.one('select updated_at::text v from public.tasks where id=$1', [f.task]);
    await f.db.query(`insert into public.workspace_time_blocks(user_id,project_id,task_id,title,start_at,end_at) values($1,$2,$3,'Block',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')`, [f.owner, f.project, f.task]);
    const after = await f.readSource(a);
    assert.deepEqual(await f.one('select updated_at::text v from public.tasks where id=$1', [f.task]), version);
    assert.notEqual(after.tasks[0].sourceToken, before.tasks[0].sourceToken);
    assert.equal(after.tasks[0].sourceToken, after.taskBlocks[f.task].sourceToken);
    assert.equal(after.taskBlocks[f.task].blocks.length, 1);
  });
  await t.test('preferences_timezone_and_child_activity_change_canonical_tokens', async () => {
    const before = await f.readSource(a);
    await f.db.query("insert into public.workspace_scheduling_preferences(user_id,workday_start,workday_end,weekdays,focus_minutes,buffer_minutes) values($1,'09:00','17:00',array[1,2,3,4,5],60,5)", [f.owner]);
    const preferences = await f.readSource(a);
    assert.notEqual(preferences.tomorrowSourceToken, before.tomorrowSourceToken);
    await f.db.query("update public.profiles set time_zone='UTC' where id=$1", [f.owner]);
    const zone = await f.readSource(a);
    assert.notEqual(zone.tasks[0].sourceToken, preferences.tasks[0].sourceToken);
    await f.db.query("update public.tasks set completed_at=clock_timestamp()+interval '1 day' where id=$1", [f.task]);
    const changed = await f.readSource(a);
    assert.equal(changed.projectActivity[f.project].invalidActivity, true);
    assert.notEqual(changed.projectActivity[f.project].sourceToken, zone.projectActivity[f.project].sourceToken);
  });
  await t.test('source_adapter_rejects_invalid_authority_and_keeps_timestamp_text', async () => {
    const { createPulseRepository } = await loadPulse('lib/ai/agent/pulse/db.ts');
    const admin = { rpc: async (name, args) => {
      assert.equal(name, 'agent_pulse_read_source');
      return { data: await f.sql('select public.agent_pulse_read_source($1,$2,$3,$4) r', [args.p_user_id, args.p_pulse_id, args.p_lease_token, args.p_fence]), error: null };
    } };
    const repository = createPulseRepository(admin);
    const result = await repository.readSource(a);
    assert.equal(typeof result.tasks[0].updatedAt, 'string');
    await assert.rejects(repository.readSource({ ...a, fence: 99 }), /AUTHORITY_LOST/);
  });
  await t.test('extra_row_marks_truncation_and_independent_targeted_absence_stays_complete', async () => {
    await f.db.query(`insert into public.tasks(user_id,project_id,title) select $1,$2,'Task '||g from generate_series(1,200) g`, [f.owner, f.project]);
    const source = await f.readSource(a);
    assert.equal(source.tasks.length, 200); assert.equal(source.coverage.tasks.complete, false);
    assert.equal(source.taskBlocks[source.tasks[0].id].coverage.complete, true);
  });
  await t.test('service_only_execute_grant_and_private_helper_denial', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const p = await f.one("select has_function_privilege($1,'public.agent_pulse_read_source(uuid,uuid,uuid,bigint)','execute') public,has_function_privilege($1,'private.agent_pulse_source_projection(uuid,timestamptz,jsonb)','execute') helper", [role]);
      assert.equal(p.public, role === 'service_role'); assert.equal(p.helper, false);
    }
  });
  await t.test('project_milestone_and_block_caps_are_explicit_not_silent', async () => {
    await f.db.query("insert into public.projects(user_id,title) select $1,'Project '||g from generate_series(1,50) g", [f.owner]);
    await f.db.query("insert into public.milestones(project_id,title) select $1,'Milestone '||g from generate_series(1,100) g", [f.project]);
    await f.db.query(`insert into public.workspace_time_blocks(user_id,title,kind,start_at,end_at)
      select $1,'Occupancy','custom',clock_timestamp()+interval '3 days'+g*interval '2 minutes',clock_timestamp()+interval '3 days'+g*interval '2 minutes'+interval '1 minute' from generate_series(1,501) g`, [f.owner]);
    const source = await f.readSource(a);
    assert.equal(source.projects.length, 50); assert.equal(source.blocks.length, 500);
    assert.equal(source.coverage.projects.complete, false); assert.equal(source.coverage.milestones.complete, false);
    assert.equal(source.coverage.blocks.complete, false);
    // An observation independently pins the canonical parent beyond discovery caps.
    await f.observation(a);
    const targeted = await f.readSource(a);
    assert.ok(targeted.tasks.some(row => row.id === f.task));
    assert.equal(targeted.taskBlocks[f.task].coverage.complete, true);
    assert.equal(targeted.targetChecks[`task:${f.task}:attention`].exists, true);
  });
  await t.test('missing_or_invalid_profile_does_not_invent_a_zone', async () => {
    await f.db.query("update public.profiles set time_zone='invalid/zone' where id=$1", [f.owner]);
    assert.equal((await f.readSource(a)).timeZone, 'invalid/zone');
    await f.db.query('delete from public.profiles where id=$1', [f.owner]);
    assert.equal((await f.readSource(a)).timeZone, null);
  });
  await t.test('reparented_or_deleted_target_has_complete_owner_loss_proof', async () => {
    await f.db.query('delete from public.workspace_time_blocks where task_id=$1', [f.task]);
    await f.db.query('update public.tasks set project_id=$1 where id=$2', [f.other, f.task]);
    const source = await f.readSource(a);
    assert.ok(!source.tasks.some(row => row.id === f.task));
    assert.deepEqual({ complete: source.targetChecks[`task:${f.task}:attention`].complete, exists: source.targetChecks[`task:${f.task}:attention`].exists }, { complete: true, exists: false });
  });
});
