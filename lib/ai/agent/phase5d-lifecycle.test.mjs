import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './phase5d-fixture.mjs';

test('atomic deterministic publication and observation lifecycle', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_publish_deterministic(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,jsonb)') r")).r, 'publication missing');
  await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date,priority='High' where id=$1", [f.task]);
  const row = () => f.one('select * from private.agent_observations where user_id=$1 and target_id=$2', [f.owner, f.task]);
  const feedback = async (action, days = null, revision = null) => { const o = await row(); return f.sql('select public.agent_pulse_feedback($1,$2,$3,$4,$5) r', [f.owner, o.id, revision ?? o.row_revision, action, days]); };
  await t.test('first_creation_and_lost_response_recovery', async () => {
    const value = await f.scan(a), commit = randomUUID();
    const first = await f.publish(a, value, commit), repeated = await f.publish(a, value, commit);
    assert.deepEqual(first, repeated); assert.equal(first.createdCount, 1);
    const o = await row(); assert.equal(o.state, 'active'); assert.equal(o.episode, 1); assert.equal(o.content_revision, 1); assert.equal(o.seen_content_revision, 0);
    assert.equal((await f.sql('select public.agent_pulse_recover($1,$2) r', [f.owner, a.pulseId])).commitId, commit);
  });
  // Each later scanner check uses a distinct disposable Pulse, preserving immutable committed headers.
  const next = async () => {
    await f.db.query("update private.agent_pulses set status='succeeded',completed_at=clock_timestamp() where id=$1 and status='running'", [a.pulseId]);
    const s = await f.one('select fence,settings_revision from private.agent_pulse_state where user_id=$1', [f.owner]);
    const p = await f.pulse(f.owner, { slot: new Date(Date.parse(a.slot) + (++next.index) * 14400000).toISOString(), fence: s.fence + 1, settingsRevision: s.settings_revision });
    await f.authorize(p); next.current = p; return p;
  };
  next.index = 0;
  await t.test('unchanged_recheck_keeps_content_revision', async () => {
    const p = await next(), before = await row(); await f.publish(p);
    const after = await row(); assert.equal(after.content_revision, before.content_revision); assert.ok(after.row_revision > before.row_revision);
    await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, p.pulseId, p.leaseToken, p.fence, 'none']);
  });
  await t.test('dismissed_age_and_wording_do_not_resurface_but_material_change_does', async () => {
    await feedback('dismiss');
    const p = await next(); await f.publish(p); assert.equal((await row()).state, 'dismissed');
    await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, p.pulseId, p.leaseToken, p.fence, 'none']);
    await f.db.query("update public.tasks set priority='Critical' where id=$1", [f.task]);
    const changed = await next(); await f.publish(changed);
    assert.equal((await row()).state, 'active'); assert.equal((await row()).episode, 2);
    await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, changed.pulseId, changed.leaseToken, changed.fence, 'none']);
  });
  await t.test('unknown_recheck_keeps_state_and_covered_baseline_only', async () => {
    const p = await next(), value = await f.scan(p), before = await row();
    value.decisions[0].truth = 'unknown'; value.decisions[0].complete = false; value.decisions[0].sourceToken = null; value.baselinePatches = {};
    value.coverage.complete = false; value.coverage.unknown = 1;
    await f.publish(p, value); const after = await row();
    assert.equal(after.state, before.state); assert.equal(after.content_revision, before.content_revision);
    assert.ok(Date.parse(after.evidence_valid_until) <= Date.now());
    await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, p.pulseId, p.leaseToken, p.fence, 'none']);
  });
  await t.test('feedback_version_wins_over_prepared_scan', async () => {
    const p = await next(), value = await f.scan(p), before = await row();
    await feedback('resolve'); await f.publish(p, value);
    assert.equal((await row()).state, 'resolved'); assert.equal((await row()).resolution_code, 'USER');
    await assert.rejects(feedback('dismiss', null, before.row_revision), /STATE_CHANGED/);
    await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, p.pulseId, p.leaseToken, p.fence, 'none']);
  });
  await t.test('proven_false_then_true_starts_new_episode', async () => {
    await f.db.query("update private.agent_observations set ai_attempt_count=2,ai_last_attempt_at=clock_timestamp()-interval '13 hours',ai_attempt_terminal=true where target_id=$1", [f.task]);
    await f.db.query('update public.tasks set due_date=null where id=$1', [f.task]);
    const p = await next(); await f.publish(p); assert.equal((await row()).resolution_code, 'PROVEN_FALSE');
    assert.equal((await row()).ai_attempt_count, 2);
    await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, p.pulseId, p.leaseToken, p.fence, 'none']);
    await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1", [f.task]);
    const changed = await next(); await f.publish(changed); assert.equal((await row()).state, 'active'); assert.equal((await row()).episode, 3);
    const reset = await row(); assert.equal(reset.ai_attempt_count,0); assert.equal(reset.ai_last_attempt_at,null); assert.equal(reset.ai_attempt_terminal,false);
  });
  await t.test('snooze_uses_saved_zone_and_strict_gap_fold_rules', async () => {
    await feedback('snooze', 1); assert.equal((await row()).state, 'snoozed');
    await assert.rejects(feedback('snooze', 2), /Invalid feedback/);
    for (const local of ['2026-03-08T02:30:00', '2026-11-01T01:30:00']) await assert.rejects(f.sql('select private.agent_pulse_wall_time($1,$2) r', [local, 'America/New_York']), /SNOOZE_TIME_INVALID/);
  });
  await t.test('current_relationship_hash_rejects_stale_work_absence', async () => {
    const current = next.current;
    await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, current.pulseId, current.leaseToken, current.fence, 'none']);
    const p = await next(), value = await f.scan(p), before = await row();
    await f.db.query("insert into public.workspace_time_blocks(user_id,project_id,task_id,title,start_at,end_at) values($1,$2,$3,'New',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')", [f.owner, f.project, f.task]);
    const result = await f.publish(p, value);
    assert.equal(result.partial, true); assert.equal((await row()).source_token, before.source_token);
  });
});

test('capacity never blocks suppression feedback or deletes history', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_feedback(uuid,uuid,bigint,text,integer)') r")).r, 'feedback missing');
  await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date,priority='High' where id=$1", [f.task]);
  await f.db.query(`insert into private.agent_observations(user_id,condition_key,family,target_type,target_id,material_fingerprint,source_token,evidence_valid_until,reason_codes,state,origin_pulse_id,latest_pulse_id)
    select $1,'task:'||id||':attention','deadline','task',id,repeat('a',64),repeat('b',64),clock_timestamp()+interval '1 day',array['DEADLINE_TODAY'],case when g<=100 then 'active' else 'dismissed' end,$2,$2
    from (select g,gen_random_uuid() id from generate_series(1,300) g) x`, [f.owner, a.pulseId]);
  const value = await f.scan(a); value.decisions = value.decisions.filter(d => d.target.id === f.task);
  value.baselinePatches = Object.fromEntries(Object.entries(value.baselinePatches).filter(([key]) => key.startsWith(`task:${f.task}:attention`)));
  const result = await f.publish(a, value);
  assert.equal(result.createdCount, 0); assert.equal(result.partial, true);
  const suppressed = await f.one("select id,row_revision from private.agent_observations where user_id=$1 and state='dismissed' limit 1", [f.owner]);
  await assert.rejects(f.sql('select public.agent_pulse_feedback($1,$2,$3,$4,1) r', [f.owner, suppressed.id, suppressed.row_revision, 'snooze']), /CAPACITY/);
  const o = await f.one("select id,row_revision from private.agent_observations where user_id=$1 and state='active' limit 1", [f.owner]);
  assert.equal((await f.sql('select public.agent_pulse_feedback($1,$2,$3,$4,null) r', [f.owner, o.id, o.row_revision, 'dismiss'])).state, 'dismissed');
  const current = await f.one('select row_revision from private.agent_observations where id=$1', [o.id]);
  assert.equal((await f.sql('select public.agent_pulse_feedback($1,$2,$3,$4,null) r', [f.owner, o.id, current.row_revision, 'resolve'])).state, 'resolved');
  assert.equal((await f.one('select count(*)::int n from private.agent_observations')).n, 300);
});

test('publication rejects arbitrary payload and cannot advance arbitrary baselines', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_publish_deterministic(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,jsonb)') r")).r, 'publication missing');
  await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1", [f.task]);
  const source = await f.scan(a);
  const arbitrary = structuredClone(source); arbitrary.decisions[0].payload = { mutation: true };
  await assert.rejects(f.publish(a, arbitrary), /Invalid scan/);
  const baseline = structuredClone(source); baseline.baselinePatches.secret = 'a'.repeat(64);
  await assert.rejects(f.publish(a, baseline), /Invalid baseline/);
  assert.equal((await f.one('select count(*)::int n from private.agent_observations')).n, 0);
});
test('target_loss_is_proven_without_a_timezone_and_withdraws_copied_text', async t => {
  const f = await fixture(t); await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1", [f.task]);
  await f.publish(a);
  await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, a.pulseId, a.leaseToken, a.fence, 'none']);
  const p = await f.pulse(f.owner, { slot: new Date(Date.parse(a.slot) + 14400000).toISOString(), fence: 2 }); await f.authorize(p);
  await f.db.query('delete from public.tasks where id=$1', [f.task]);
  await f.db.query('update public.profiles set time_zone=null where id=$1', [f.owner]);
  await f.publish(p);
  const o = await f.one('select state,resolution_code,title,summary,explanation from private.agent_observations where target_id=$1', [f.task]);
  assert.deepEqual(o, { state: 'resolved', resolution_code: 'SOURCE_UNAVAILABLE', title: '', summary: '', explanation: '' });
});
test('active_material_change_starts_a_new_episode_for_idea_authority', async t => {
  const f = await fixture(t); await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date,priority='High' where id=$1", [f.task]);
  await f.publish(a);
  await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, a.pulseId, a.leaseToken, a.fence, 'none']);
  const p = await f.pulse(f.owner, { slot: new Date(Date.parse(a.slot) + 14400000).toISOString(), fence: 2 }); await f.authorize(p);
  await f.db.query("update public.tasks set priority='Critical' where id=$1", [f.task]);
  await f.publish(p);
  assert.equal((await f.one('select episode from private.agent_observations where target_id=$1', [f.task])).episode, 2);
});
