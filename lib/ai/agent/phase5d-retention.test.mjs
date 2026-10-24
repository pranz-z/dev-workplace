import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './phase5d-fixture.mjs';
import { loadPulse } from './phase5d-test-support.mjs';
import { dispatchTestClock, restoreDispatchTestClock } from './phase5d-freshness-cases.mjs';

test('safe reads, explicit acknowledgement and pagination', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_list_inbox(uuid,text,jsonb,integer)') r")).r, 'Inbox reads missing');
  await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date,priority='High' where id=$1", [f.task]); await f.publish(a);
  const o = await f.one('select id,content_revision from private.agent_observations where target_id=$1', [f.task]);
  const inbox = (owner = f.owner, cursor = null) => f.sql('select public.agent_pulse_list_inbox($1,$2,$3,$4) r', [owner, 'active', cursor ? JSON.stringify(cursor) : null, 20]);
  const digest = async () => f.one(`select private.agent_pulse_hash(jsonb_build_object(
    'state',(select jsonb_agg(to_jsonb(s) order by user_id) from private.agent_pulse_state s),
    'pulses',(select jsonb_agg(to_jsonb(p) order by id) from private.agent_pulses p),
    'observations',(select jsonb_agg(to_jsonb(o) order by id) from private.agent_observations o),
    'ledger',(select jsonb_agg(to_jsonb(e) order by id) from private.agent_pulse_installation_events e))) hash`);
  await t.test('owner_only_safe_dtos_and_no_get_writes', async () => {
    const before = await digest();
    const item = await f.sql('select public.agent_pulse_get_observation($1,$2) r', [f.owner, o.id]);
    assert.equal(item.stale, false); assert.equal(item.seen, false);
    assert.equal(item.watching, false);
    assert.doesNotMatch(JSON.stringify(item), /evidence|sourceToken|fingerprint|lease|fence|nonce|reservation|payload|prompt/i);
    assert.equal(await f.sql('select public.agent_pulse_get_observation($1,$2) r', [f.other, o.id]), null);
    assert.equal((await inbox(f.other)).items.length, 0);
    assert.equal((await f.sql('select public.agent_pulse_get_brief($1) r', [f.owner])).items.length, 1);
    await f.sql('select public.agent_pulse_list_journal($1,null,20) r', [f.owner]); await inbox(); await f.sql('select public.agent_pulse_get_settings($1) r', [f.owner]);
    assert.deepEqual(await digest(), before);
  });
  await t.test('stale_ack_does_not_hide_newer_content_and_brief_ack_is_explicit', async () => {
    await f.db.query('update private.agent_observations set content_revision=content_revision+1,row_revision=row_revision+1 where id=$1', [o.id]);
    const old = await f.sql('select public.agent_pulse_ack($1,$2,true) r', [f.owner, JSON.stringify([{ id: o.id, contentRevision: o.content_revision }])]);
    assert.equal(old.acknowledged, 0); assert.equal((await inbox()).items[0].seen, false);
    await f.sql('select public.agent_pulse_ack($1,$2,true) r', [f.owner, JSON.stringify([{ id: o.id, contentRevision: o.content_revision + 1 }])]);
    assert.equal((await inbox()).items[0].seen, true);
    assert.equal((await f.sql('select public.agent_pulse_get_brief($1) r', [f.owner])).items.length, 0);
  });
  await t.test('source_change_withdraws_text_without_mutating_the_observation', async () => {
    const before = await f.one('select row_revision,summary from private.agent_observations where id=$1', [o.id]);
    await f.db.query("update public.tasks set title='Current title' where id=$1", [f.task]);
    const item = await f.sql('select public.agent_pulse_get_observation($1,$2) r', [f.owner, o.id]);
    assert.equal(item.stale, true); assert.equal(item.summary, '');
    assert.deepEqual(await f.one('select row_revision,summary from private.agent_observations where id=$1', [o.id]), before);
  });
  await t.test('twenty_item_pages_and_owner_filter_bound_cursors', async () => {
    for (let i = 0; i < 24; i++) await f.observation(a, { key: `task:${randomUUID()}:attention`, targetId: randomUUID() });
    const first = await inbox(); assert.equal(first.items.length, 20); assert.ok(first.nextCursor);
    const second = await inbox(f.owner, first.nextCursor); assert.equal(second.items.length, 5);
    await assert.rejects(inbox(f.other, first.nextCursor), /Invalid cursor/);
    await assert.rejects(f.sql('select public.agent_pulse_list_inbox($1,$2,$3,20) r', [f.owner, 'dismissed', JSON.stringify(first.nextCursor)]), /Invalid cursor/);
    const { createPulseRepository } = await loadPulse('lib/ai/agent/pulse/db.ts');
    const repository = createPulseRepository({ rpc: async (name, args) => {
      assert.equal(name, 'agent_pulse_list_inbox');
      return { data: await f.sql('select public.agent_pulse_list_inbox($1,$2,$3,$4) r', [args.p_user_id, args.p_state, args.p_cursor ? JSON.stringify(args.p_cursor) : null, args.p_limit]), error: null };
    } });
    const page = await repository.listInbox(f.owner, 'active', null, 20); assert.equal(typeof page.nextCursor, 'string');
    assert.equal((await repository.listInbox(f.owner, 'active', page.nextCursor, 20)).items.length, 5);
  });
});

test('memory clear preserves uncertain accounting and invalidates old workers', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_clear_memory(uuid,bigint)') r")).r, 'memory clear missing');
  await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update private.agent_pulse_state set mode='workspace_ai',ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$2::uuid] where user_id=$1", [f.owner, f.project]);
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1", [f.task]); await f.publish(a);
  const o = await f.one('select id,episode from private.agent_observations where target_id=$1', [f.task]);
  await f.sql('select public.agent_pulse_reserve_ai($1,$2,$3,$4,$5,$6,$7) r', [f.owner, a.pulseId, a.leaseToken, a.fence, a.settingsRevision, o.id, o.episode]);
  const before = await f.one('select ai_reserved_at::text,installation_reservation_key,ai_parent_episode,ai_attempt_number from private.agent_pulses where id=$1', [a.pulseId]);
  const usageBefore = await f.sql('select private.agent_pulse_usage($1,clock_timestamp()) r',[f.owner]);
  const taskBefore = await f.one('select to_jsonb(t) v from public.tasks t where id=$1', [f.task]);
  const staleScan = await f.scan(a);
  await f.sql('select public.agent_pulse_clear_memory($1,$2) r', [f.owner, a.settingsRevision]);
  assert.deepEqual(await f.one('select ai_reserved_at::text,installation_reservation_key,ai_parent_episode,ai_attempt_number from private.agent_pulses where id=$1', [a.pulseId]), before);
  assert.equal((await f.one('select ai_parent_id from private.agent_pulses where id=$1', [a.pulseId])).ai_parent_id, null);
  assert.equal((await f.one('select count(*)::int n from private.agent_observations')).n, 0);
  assert.equal((await f.one('select count(*)::int n from private.agent_pulse_installation_events')).n, 2);
  assert.deepEqual(await f.sql('select private.agent_pulse_usage($1,clock_timestamp()) r',[f.owner]),usageBefore);
  assert.deepEqual(await f.one('select to_jsonb(t) v from public.tasks t where id=$1', [f.task]), taskBefore);
  assert.equal(await f.readSource(a), null);
  await assert.rejects(f.publish(a, staleScan), /AUTHORITY_LOST/);
});

test('installation retention is owner independent and bounded to twenty old events', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_retain_installation(integer)') r")).r, 'installation retention missing');
  await f.db.exec("insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) select 'provider_reservation',gen_random_uuid(),clock_timestamp()-interval '49 hours' from generate_series(1,25);insert into private.agent_pulse_installation_events(event_kind,reservation_key) select 'provider_reservation',gen_random_uuid() from generate_series(1,2);");
  await f.db.query('delete from auth.users where id in($1,$2)', [f.owner, f.other]);
  assert.equal((await f.sql('select public.agent_pulse_retain_installation(20) r')).deleted, 20);
  assert.equal((await f.one('select count(*)::int n from private.agent_pulse_installation_events')).n, 7);
  assert.equal((await f.sql('select public.agent_pulse_retain_installation(20) r')).deleted, 5);
  assert.equal((await f.one('select count(*)::int n from private.agent_pulse_installation_events')).n, 2);
});

test('pruning_an_earlier_attempt_cannot_authorize_a_third_episode_request', async t => {
  const f = await fixture(t); await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update private.agent_pulse_state set mode='workspace_ai',ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$2::uuid] where user_id=$1", [f.owner, f.project]);
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1", [f.task]); await f.publish(a);
  const o = await f.one('select id,episode from private.agent_observations where target_id=$1', [f.task]);
  for (const attempt of [1, 2]) await f.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,ai_reserved_at,installation_reservation_key,ai_parent_id,ai_parent_episode,ai_attempt_number,ai_outcome)
    values($1,timestamptz '2026-10-01'+$3::integer*interval '4 hours',gen_random_uuid(),'succeeded',clock_timestamp()-interval '72 hours',clock_timestamp()-interval '71 hours',1,gen_random_uuid(),clock_timestamp()-interval '70 hours',1,'pulse-v1',clock_timestamp()-interval '72 hours',gen_random_uuid(),$2,1,$3,'unavailable')`, [f.owner, o.id, attempt]);
  const reserve = () => f.sql('select public.agent_pulse_reserve_ai($1,$2,$3,$4,$5,$6,$7) r', [f.owner, a.pulseId, a.leaseToken, a.fence, a.settingsRevision, o.id, o.episode]);
  await f.db.query("update private.agent_observations set ai_attempt_count=2,ai_last_attempt_at=clock_timestamp()-interval '72 hours' where id=$1", [o.id]);
  assert.equal((await reserve()).sendAllowed, false);
  await f.db.query('delete from private.agent_pulses where user_id=$1 and ai_parent_id=$2 and ai_attempt_number=1', [f.owner, o.id]);
  assert.equal((await reserve()).sendAllowed, false);
});

test('Journal includes material changes, omits quiet checks and projects safe coverage', async t => {
  const f = await fixture(t); await f.enable();
  const a = (await f.claim()).claims[0];
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1", [f.task]);
  await f.publish(a);
  const finish = p => f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, p.pulseId, p.leaseToken, p.fence, 'none']);
  const next = async n => { const p = await f.pulse(f.owner, { slot: new Date(Date.parse(a.slot)+n*14400000).toISOString(), fence: n+1 }); await f.authorize(p); return p; };
  await finish(a);
  const quiet = await next(1); await f.publish(quiet); await finish(quiet);
  const changed = await next(2); await f.db.query("update public.tasks set priority='Critical' where id=$1", [f.task]); await f.publish(changed); await finish(changed);
  const journal = await f.sql('select public.agent_pulse_list_journal($1,null,20) r', [f.owner]);
  assert.deepEqual(journal.items.map(x => x.id), [changed.pulseId, a.pulseId]);
  assert.equal(journal.items[0].coverage.complete, true);
  assert.deepEqual(Object.keys(journal.items[0].checkedCounts).sort(), ['blocks','milestones','projects','tasks']);
  assert.doesNotMatch(JSON.stringify(journal), /sourceToken|evidence|nonce|lease|fence|prompt|ai_attempt/i);
  assert.equal((await f.sql('select public.agent_pulse_list_journal($1,null,20) r', [f.other])).items.length, 0);
});

test('retention bounds text by age and 180 entries, preserves fresh cards and thin provenance', async t => {
  const f = await fixture(t); await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1", [f.task]); await f.publish(a);
  const o = await f.one('select id from private.agent_observations where target_id=$1', [f.task]);
  await f.db.query("update private.agent_observations set first_noticed_at=clock_timestamp()-interval '40 days' where id=$1", [o.id]);
  assert.equal((await f.sql('select public.agent_pulse_get_observation($1,$2) r', [f.owner, o.id])).stale, false, 'a freshly rechecked active card does not expire by creation age');
  await f.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,summary,created_count)
    select $1,timestamptz '2025-01-01'+g*interval '4 hours',gen_random_uuid(),'succeeded',clock_timestamp()-g*interval '1 hour'-interval '49 hours',clock_timestamp()-g*interval '1 hour'-interval '48 hours',1,gen_random_uuid(),clock_timestamp()-g*interval '1 hour'-interval '48 hours',1,'pulse-v1','Safe summary',1 from generate_series(1,182) g`, [f.owner]);
  const journal = async cursor => f.sql('select public.agent_pulse_list_journal($1,$2,20) r', [f.owner, cursor ? JSON.stringify(cursor) : null]);
  let count = 0, cursor = null;
  do { const page = await journal(cursor); count += page.items.length; cursor = page.nextCursor; } while (cursor);
  assert.equal(count, 180);
  // Mark two unreferenced attempt headers old, but keep durable parent authority.
  await f.db.query("update private.agent_observations set ai_attempt_count=2,ai_last_attempt_at=clock_timestamp()-interval '49 hours' where id=$1", [o.id]);
  await f.sql('select public.agent_pulse_retain($1,20) r', [f.owner]);
  assert.equal((await f.one('select count(*)::int n from private.agent_pulses where user_id=$1 and summary is not null', [f.owner])).n, 180);
  assert.ok((await f.one('select title from private.agent_observations where id=$1', [o.id])).title);
  assert.equal((await f.one('select ai_attempt_count from private.agent_observations where id=$1', [o.id])).ai_attempt_count, 2);
  const old = await f.pulse(f.other, { slot: '2025-01-01T00:00:00Z' });
  await f.observation(old);
  // A separate old finished header is referenced and must survive with no aged text.
  const oldId = randomUUID();
  await f.db.query(`insert into private.agent_pulses(id,user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,summary)
    values($1,$2,timestamptz '2025-02-01',gen_random_uuid(),'succeeded',clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days'+interval '60 seconds',1,gen_random_uuid(),clock_timestamp()-interval '31 days'+interval '90 seconds',1,'pulse-v1','Old text')`, [oldId, f.owner]);
  await f.observation({ ...a, pulseId: oldId }, { key: 'task:'+randomUUID()+':attention', targetId: randomUUID() });
  assert.equal((await journal(null)).items.some(x => x.id===oldId), false);
  assert.ok((await f.sql('select public.agent_pulse_retain($1,20) r', [f.owner])).touched <= 20);
  assert.equal((await f.one('select summary from private.agent_pulses where id=$1', [oldId])).summary, null);
  assert.ok(await f.one('select id from private.agent_pulses where id=$1', [oldId]));
});

test('brief ranks current targets, deduplicates and respects absolute acknowledgement interval', async t => {
  const f = await fixture(t); await f.enable(); const a = (await f.claim()).claims[0];
  const tasks = [];
  for (const [i, priority, days] of [[0,'Medium',1],[1,'Low',0],[2,'Critical',0],[3,'High',-1],[4,'High',2],[5,'Medium',3]]) {
    const id = i===0 ? f.task : randomUUID(); tasks.push(id);
    if (i>0) await f.db.query("insert into public.tasks(id,user_id,project_id,title) values($1,$2,$3,'Task')", [id,f.owner,f.project]);
    await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date+$2::integer,priority=$3 where id=$1", [id,days,priority]);
  }
  const { scanPulse } = await loadPulse('lib/ai/agent/pulse/scanner.ts');
  const { PULSE_POLICY } = await loadPulse('lib/ai/agent/pulse/policy.ts');
  const source = await f.readSource(a);
  const decisions = tasks.flatMap(id => scanPulse({ ...source, tasks: source.tasks.filter(task => task.id===id) }, [], PULSE_POLICY).decisions.filter(d => d.target.id===id));
  // Admission remains bounded at three per Pulse. Seed the additional real-source cards for projection-only coverage.
  for (const d of decisions) await f.db.query(`insert into private.agent_observations(user_id,condition_key,family,target_type,target_id,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,importance,rank,origin_pulse_id,latest_pulse_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Task',$11,$12,$13,$13)`, [f.owner,d.key,d.family,d.target.type,d.target.id,d.materialFingerprint,d.sourceToken,d.evidenceValidUntil,d.reasonCodes,JSON.stringify({ ...d.evidence,complete:d.complete }),d.importance,d.rank,a.pulseId]);
  const brief = () => f.sql('select public.agent_pulse_get_brief($1) r', [f.owner]);
  await f.db.query("update private.agent_pulse_state set mode='workspace_ai',ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$2::uuid] where user_id=$1",[f.owner,f.project]);
  await f.db.query(`insert into private.agent_observations(user_id,kind,condition_key,target_type,target_id,parent_observation_id,parent_episode,idea_category,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,rank,origin_pulse_id,latest_pulse_id)
    select user_id,'idea','idea:'||id||':1:review_deadline',target_type,target_id,id,episode,'review_deadline',material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,'Advisory idea',5,origin_pulse_id,latest_pulse_id from private.agent_observations where user_id=$1 and target_id=$2`,[f.owner,tasks[3]]);
  const first = await brief(); assert.equal(first.items.length,5);
  assert.equal(new Set(first.items.map(x=>x.target.type+':'+x.target.id)).size,5);
  assert.equal(first.items.some(x=>x.kind==='idea'),false,'parent and attached idea share a target slot');
  assert.deepEqual(first.items.slice(0,3).map(x=>x.target.id), [tasks[3],tasks[2],tasks[1]], 'deadline then priority precede random ID');
  await f.sql('select public.agent_pulse_ack($1,$2,true) r', [f.owner,JSON.stringify(first.items.map(x=>({id:x.id,contentRevision:x.contentRevision})))]);
  assert.equal((await brief()).items.length,0);
  await f.db.query("update public.profiles set time_zone='UTC' where id=$1", [f.owner]);
  assert.equal((await brief()).items.length,0);
  await f.db.query("update public.profiles set time_zone='Asia/Manila' where id=$1", [f.owner]);
  await f.db.query("update private.agent_pulse_state set last_brief_ack_at=clock_timestamp()-interval '24 hours'+interval '1 second' where user_id=$1", [f.owner]);
  assert.equal((await brief()).items.length,0);
  await f.db.query("update private.agent_pulse_state set last_brief_ack_at=clock_timestamp()-interval '24 hours'-interval '1 second' where user_id=$1", [f.owner]);
  assert.equal((await brief()).items.length,2,'the undisplayed idea and sixth signal remain unseen');
});

test('repository read boundary rejects extra raw fields and malformed safe DTOs', async t => {
  const f = await fixture(t); await f.enable(); const a = (await f.claim()).claims[0];
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1", [f.task]); await f.publish(a);
  const o = await f.one('select id from private.agent_observations where target_id=$1', [f.task]);
  const valid = await f.sql('select public.agent_pulse_get_observation($1,$2) r', [f.owner,o.id]);
  const { createPulseRepository } = await loadPulse('lib/ai/agent/pulse/db.ts');
  const repo = data => createPulseRepository({ rpc: async()=>({data,error:null}) });
  const {reviewContext,...itemOnly}=valid;assert.ok(reviewContext);
  assert.deepEqual(await repo(valid).getObservation(f.owner,o.id),itemOnly);
  assert.equal(await repo(null).getObservation(f.owner,o.id),null);
  for (const item of [{...valid,payload:{secret:true}},{...valid,watching:null},{...valid,title:'😀'.repeat(121)},{...valid,reasonCodes:['ARBITRARY']},{...valid,target:{...valid.target,ownerId:f.other}}]) {
    await assert.rejects(repo(item).getObservation(f.owner,o.id),/SOURCE_UNAVAILABLE/);
    await assert.rejects(repo({items:[item],nextCursor:null}).listInbox(f.owner,'active'),/SOURCE_UNAVAILABLE/);
  }
  await assert.rejects(repo({items:Array(6).fill(valid),lastCheckedAt:null}).getBrief(f.owner),/SOURCE_UNAVAILABLE/);
  await assert.rejects(repo({items:[],nextCursor:null,payload:{}}).listJournal(f.owner),/SOURCE_UNAVAILABLE/);
});

test('780-header bound includes reservations inside the operational window on older Pulses', async t => {
  const f = await fixture(t); await f.state();
  await f.db.exec(`create temporary table test_headers as select g n,gen_random_uuid() id from generate_series(1,600) g;`);
  await f.db.query(`insert into private.agent_pulses(id,user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version)
    select id,$1,timestamptz '2025-01-01'+n*interval '4 hours',gen_random_uuid(),'succeeded',clock_timestamp()-interval '40 days',clock_timestamp()-interval '40 days'+interval '60 seconds',1,gen_random_uuid(),clock_timestamp()-interval '40 days'+interval '90 seconds',1,'pulse-v1' from test_headers`,[f.owner]);
  await f.db.query(`insert into private.agent_observations(user_id,condition_key,family,target_type,target_id,material_fingerprint,source_token,evidence_valid_until,reason_codes,state,origin_pulse_id,latest_pulse_id)
    select $1,'task:'||a.id||':attention','deadline','task',a.id,repeat('a',64),repeat('b',64),clock_timestamp(),array['DEADLINE_TODAY'],'resolved',a.id,b.id from test_headers a join test_headers b on b.n=a.n+1 where a.n%2=1`,[f.owner]);
  await f.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,summary,created_count)
    select $1,timestamptz '2026-01-01'+g*interval '4 hours',gen_random_uuid(),'succeeded',clock_timestamp()-interval '10 days'-g*interval '1 minute',clock_timestamp()-interval '10 days'-g*interval '1 minute'+interval '60 seconds',1,gen_random_uuid(),clock_timestamp()-interval '10 days'-g*interval '1 minute'+interval '90 seconds',1,'pulse-v1','Safe text',1 from generate_series(1,180) g`,[f.owner]);
  const protectedId=randomUUID();
  await f.db.query(`insert into private.agent_pulses(id,user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,ai_reserved_at,installation_reservation_key,ai_parent_episode,ai_attempt_number)
    values($1,$2,timestamptz '2026-09-01',gen_random_uuid(),'succeeded',clock_timestamp()-interval '48 hours 30 seconds',clock_timestamp()-interval '47 hours 59 minutes 20 seconds',1,gen_random_uuid(),clock_timestamp()-interval '47 hours 59 minutes',1,'pulse-v1',clock_timestamp()-interval '47 hours 59 minutes 30 seconds',gen_random_uuid(),1,1)`,[protectedId,f.owner]);
  await f.sql('select public.agent_pulse_retain($1,20) r',[f.owner]);
  assert.ok(await f.one('select id from private.agent_pulses where id=$1',[protectedId]));
  assert.equal((await f.one('select count(*)::int n from private.agent_pulses where user_id=$1',[f.owner])).n,780);
});

test('Task24 persisted tomorrow rollover publishes the next scan and resolves the old dated observation', async t => {
  const f = await fixture(t);
  await f.db.exec(dispatchTestClock);
  try {
    await f.db.query("select set_config('phase5d.test_tick','2026-10-17T10:00:00Z',false)");
    await f.db.query("update public.profiles set time_zone='UTC' where id=$1", [f.owner]);
    await f.db.query("update public.tasks set due_date='2026-10-18' where id=$1", [f.task]);
    for (let i = 0; i < 4; i++) await f.db.query("insert into public.tasks(id,user_id,project_id,title,due_date) values($1,$2,$3,'Tomorrow task','2026-10-18')", [randomUUID(),f.owner,f.project]);
    await f.enable(); const a = (await f.claim()).claims[0], first = await f.scan(a);
    const { evaluateTomorrow } = await loadPulse('lib/ai/agent/pulse/signals.ts');
    // Admission ranks task cards ahead of tomorrow. Publish just the verified
    // tomorrow decision to exercise a previously stored dated observation.
    const tomorrow = evaluateTomorrow(await f.readSource(a))[0]; assert.equal(tomorrow.truth,'true');
    await f.publish(a, { ...first, decisions: [tomorrow], baselinePatches: {} });
    await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [a.userId,a.pulseId,a.leaseToken,a.fence,'none']);
    await f.db.query("select set_config('phase5d.test_tick','2026-10-18T10:00:00Z',false)");
    const next = (await f.claim()).claims[0], scan = await f.scan(next);
    assert.ok(scan.decisions.some(x => x.key === tomorrow.key && x.truth === 'false'));
    await f.publish(next, scan);
    assert.equal((await f.one('select state from private.agent_observations where user_id=$1 and condition_key=$2',[f.owner,tomorrow.key])).state,'resolved');
  } finally { await f.db.exec(restoreDispatchTestClock); }
});
