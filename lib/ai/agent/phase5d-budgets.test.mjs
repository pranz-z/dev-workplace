import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './phase5d-fixture.mjs';

async function candidate(f, user = f.owner, project = f.project, task = f.task, days = 0) {
  await f.state(user);
  const previous = await f.one("select id,lease_token,fence,ai_outcome from private.agent_pulses where user_id=$1 and status='running'", [user]);
  if (previous) await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [user, previous.id, previous.lease_token, previous.fence, previous.ai_outcome === 'malformed' ? 'malformed' : previous.ai_outcome === 'none' ? 'none' : 'unavailable']);
  const state = await f.one('select fence,settings_revision from private.agent_pulse_state where user_id=$1', [user]);
  const slot = (await f.one("select coalesce(max(scheduled_slot)+interval '4 hours',timestamptz '2026-10-15T00:00:00Z')::text v from private.agent_pulses where user_id=$1", [user])).v;
  const a = await f.pulse(user, { slot, fence: state.fence + 1, settingsRevision: state.settings_revision });
  await f.authorize(a);
  await f.db.query("update private.agent_pulse_state set mode='workspace_ai',ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$2::uuid] where user_id=$1", [user, project]);
  await f.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'UTC')::date+$2::integer,priority='High' where id=$1", [task, days]);
  await f.publish(a);
  const o = await f.one("select id,episode from private.agent_observations where user_id=$1 and target_id=$2 and kind='signal'", [user, task]);
  return { a, o };
}
const reserve = (f, { a, o }) => f.sql('select public.agent_pulse_reserve_ai($1,$2,$3,$4,$5,$6,$7) r', [a.userId, a.pulseId, a.leaseToken, a.fence, a.settingsRevision, o.id, o.episode]);
const idea = { category: 'review_deadline', title: 'Review deadline', summary: 'Review the recorded task deadline.' };
const publish = (f, { a }, value = idea) => f.sql('select public.agent_pulse_publish_ai($1,$2,$3,$4,$5,$6) r', [a.userId, a.pulseId, a.leaseToken, a.fence, a.settingsRevision, JSON.stringify(value)]);

test('atomic reservations enforce owner and installation budgets across account deletion', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_reserve_ai(uuid,uuid,uuid,bigint,bigint,uuid,bigint)') r")).r, 'reservation missing');
  const otherTask = randomUUID();
  await f.db.query("insert into public.profiles(id,time_zone) values($1,'UTC');", [f.other]);
  await f.db.query("insert into public.tasks(id,user_id,project_id,title) values($1,$2,$2,'Other task')", [otherTask, f.other]);
  const first = await candidate(f);
  await t.test('one_request_per_pulse_recovers_without_a_second_event', async () => {
    const r = await reserve(f, first); assert.equal(r.sendAllowed, true);
    const repeated = await reserve(f, first); assert.equal(repeated.recovered, true); assert.equal(repeated.sendAllowed, false);
    assert.equal((await f.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n, 1);
    const accepted = await publish(f, first); assert.equal(accepted.accepted, true);
    assert.equal((await publish(f, first)).id, accepted.id);
    assert.equal((await f.one('select ai_attempt_count from private.agent_observations where id=$1',[first.o.id])).ai_attempt_count,1);
    assert.deepEqual(await f.one('select ai_attempt_count,ai_last_attempt_at,ai_attempt_terminal from private.agent_observations where id=$1',[accepted.id]),{ai_attempt_count:0,ai_last_attempt_at:null,ai_attempt_terminal:false});
  });
  await t.test('owner_two_request_and_two_accepted_idea_ceilings', async () => {
    const second = await candidate(f, f.owner, f.project, f.task, 1);
    assert.equal((await reserve(f, second)).sendAllowed, true); assert.equal((await publish(f, second)).accepted, true);
    const third = await candidate(f, f.owner, f.project, f.task, 2);
    assert.equal((await reserve(f, third)).reason, 'BUDGET');
    assert.equal((await f.one('select count(*)::int n from private.agent_pulses where user_id=$1 and ai_reserved_at is not null', [f.owner])).n, 2);
    assert.equal((await f.one('select count(*)::int n from private.agent_pulses where user_id=$1 and idea_accepted_at is not null', [f.owner])).n, 2);
  });
  await t.test('four_installation_requests_survive_deleting_both_original_owners', async () => {
    for (const days of [0, 1]) { const item = await candidate(f, f.other, f.other, otherTask, days); assert.equal((await reserve(f, item)).sendAllowed, true); }
    await f.db.query('delete from auth.users where id in ($1,$2)', [f.owner, f.other]);
    assert.equal((await f.one('select count(*)::int n from private.agent_observations')).n,0);
    assert.equal((await f.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n, 4);
    const user = randomUUID(), project = randomUUID(), task = randomUUID();
    await f.db.query('insert into auth.users(id) values($1)', [user]); await f.db.query("insert into public.profiles(id,time_zone) values($1,'UTC')", [user]);
    await f.db.query("insert into public.projects(id,user_id,title) values($1,$2,'New project')", [project, user]);
    await f.db.query("insert into public.tasks(id,user_id,project_id,title) values($1,$2,$3,'New task')", [task, user, project]);
    assert.equal((await reserve(f, await candidate(f, user, project, task))).reason, 'BUDGET');
  });
});
test('reservation event failure rolls back the owner mark and malformed output is terminal', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_publish_ai(uuid,uuid,uuid,bigint,bigint,jsonb)') r")).r, 'idea publication missing');
  const item = await candidate(f);
  await f.db.exec("create function private.test_reservation_failure() returns trigger language plpgsql as $$begin raise exception 'Injected reservation failure';end;$$;create trigger test_reservation_failure before insert on private.agent_pulse_installation_events for each row when(new.event_kind='provider_reservation') execute function private.test_reservation_failure();");
  await assert.rejects(reserve(f, item), /Injected reservation failure/);
  assert.equal((await f.one('select ai_reserved_at from private.agent_pulses where id=$1', [item.a.pulseId])).ai_reserved_at, null);
  assert.deepEqual(await f.one('select ai_attempt_count,ai_last_attempt_at from private.agent_observations where id=$1', [item.o.id]), { ai_attempt_count: 0, ai_last_attempt_at: null });
  assert.equal((await f.one('select count(*)::int n from private.agent_pulse_installation_events')).n, 0);
  await f.db.exec('drop trigger test_reservation_failure on private.agent_pulse_installation_events;');
  await reserve(f, item);
  assert.equal((await publish(f, item, { ...idea, payload: { mutation: true } })).reason, 'AI_MALFORMED');
  assert.equal((await f.one('select ai_outcome from private.agent_pulses where id=$1', [item.a.pulseId])).ai_outcome, 'malformed');
  assert.equal((await f.one('select ai_attempt_terminal from private.agent_observations where id=$1', [item.o.id])).ai_attempt_terminal, true);
  const next = await candidate(f);
  assert.equal((await reserve(f, next)).reason, 'AI_MALFORMED');
});
test('rolling windows exclude the exact lower boundary and future events', async t => {
  const f = await fixture(t); await f.state();
  const anchor = (await f.one('select clock_timestamp()::text v')).v;
  await f.db.query(`insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at)
    select 'provider_reservation',gen_random_uuid(),case g when 1 then $1::timestamptz-interval '24 hours' when 2 then $1::timestamptz-interval '24 hours'+interval '1 microsecond' when 3 then $1::timestamptz else $1::timestamptz+interval '1 microsecond' end from generate_series(1,4) g`, [anchor]);
  await f.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,ai_reserved_at,installation_reservation_key,ai_parent_episode,ai_attempt_number,idea_accepted_at)
    select $1,timestamptz '2026-10-01'+g*interval '4 hours',gen_random_uuid(),'succeeded',at,at+interval '1 second',1,gen_random_uuid(),at+interval '90 seconds',1,'pulse-v1',at,gen_random_uuid(),1,1,case when g=1 then $2::timestamptz-interval '23 hours' end
    from (select g,case g when 1 then $2::timestamptz-interval '24 hours' when 2 then $2::timestamptz-interval '24 hours'+interval '1 microsecond' when 3 then $2::timestamptz else $2::timestamptz+interval '1 microsecond' end at from generate_series(1,4) g) x`, [f.owner, anchor]);
  assert.deepEqual(await f.sql('select private.agent_pulse_usage($1,$2) r', [f.owner, anchor]), { ownerPulses: 2, ownerRequests: 2, installationRequests: 2, ownerIdeas: 1 });
});
test('six_owner_pulses_exhaust_claim_budget', async t => {
  const f = await fixture(t); await f.enable();
  await f.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version)
    select $1,date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')-g*interval '4 hours',gen_random_uuid(),'succeeded',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '59 minutes',1,gen_random_uuid(),clock_timestamp()-interval '58 minutes',1,'pulse-v1' from generate_series(1,6) g`, [f.owner]);
  assert.equal((await f.claim()).claimCount, 0);
});
test('episode retry waits twelve hours and never exceeds two attempts', async t => {
  for (const [ages, expected] of [[[11], false], [[13], true], [[25, 13], false]]) await t.test(`prior_attempt_hours_${ages.join('_')}`, async child => {
    const f = await fixture(child), item = await candidate(f);
    for (let index = 0; index < ages.length; index++) {
      const key = randomUUID();
      await f.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,ai_reserved_at,installation_reservation_key,ai_parent_id,ai_parent_episode,ai_attempt_number,ai_outcome)
        values($1,timestamptz '2026-10-13'+$5::integer*interval '4 hours',gen_random_uuid(),'succeeded',clock_timestamp()-$4::integer*interval '1 hour'-interval '1 second',clock_timestamp()-$4::integer*interval '1 hour'+interval '1 second',1,gen_random_uuid(),clock_timestamp()-$4::integer*interval '1 hour'+interval '90 seconds',1,'pulse-v1',clock_timestamp()-$4::integer*interval '1 hour',$2,$3,1,$5::integer+1,'unavailable')`, [f.owner, key, item.o.id, ages[index], index]);
      await f.db.query("insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) values('provider_reservation',$1,clock_timestamp()-$2::integer*interval '1 hour')", [key, ages[index]]);
    }
    // Seed the authoritative signal state as well as its historical provenance.
    await f.db.query("update private.agent_observations set ai_attempt_count=$2,ai_last_attempt_at=clock_timestamp()-$3::integer*interval '1 hour' where id=$1", [item.o.id, ages.length, ages.at(-1)]);
    assert.equal((await reserve(f, item)).sendAllowed, expected);
  });
});
test('feedback_before_idea_acceptance_withdraws_eligibility_without_refunding_request', async t => {
  const f = await fixture(t), item = await candidate(f); await reserve(f, item);
  const o = await f.one('select row_revision from private.agent_observations where id=$1', [item.o.id]);
  await f.sql('select public.agent_pulse_feedback($1,$2,$3,$4,null) r', [f.owner, item.o.id, o.row_revision, 'dismiss']);
  assert.equal((await publish(f, item)).accepted, false);
  assert.equal((await f.sql('select private.agent_pulse_usage($1,clock_timestamp()) r', [f.owner])).ownerRequests, 1);
});

test('signal episode owns consumed attempts, replay and terminal outcome', async t => {
  const f = await fixture(t), first = await candidate(f);
  const state = () => f.one('select ai_attempt_count,ai_last_attempt_at,ai_attempt_terminal from private.agent_observations where id=$1', [first.o.id]);
  assert.deepEqual(await state(), { ai_attempt_count: 0, ai_last_attempt_at: null, ai_attempt_terminal: false });
  await reserve(f, first);
  assert.equal((await state()).ai_attempt_count, 1);
  assert.ok((await state()).ai_last_attempt_at);
  // Promise.all is serialized by one PGlite engine: replay coverage, not multi-connection proof.
  const replay = await Promise.all([reserve(f, first), reserve(f, first)]);
  assert.ok(replay.every(r => r.recovered && !r.sendAllowed));
  assert.equal((await state()).ai_attempt_count, 1);
  const second = await candidate(f);
  assert.equal((await state()).ai_attempt_count, 1, 'ordinary refresh preserves episode attempts');
  assert.equal((await reserve(f, second)).sendAllowed, false);
  await f.db.query("update private.agent_observations set ai_last_attempt_at=clock_timestamp()-interval '12 hours' where id=$1", [first.o.id]);
  assert.equal((await reserve(f, second)).sendAllowed, true);
  assert.equal((await state()).ai_attempt_count, 2);
  assert.equal((await f.one('select ai_attempt_number from private.agent_pulses where id=$1', [second.a.pulseId])).ai_attempt_number, 2);
  const third = await candidate(f);
  assert.equal((await reserve(f, third)).sendAllowed, false);
  await f.db.query("update public.tasks set due_date=due_date+1 where id=$1", [f.task]);
  const fourth = await candidate(f, f.owner, f.project, f.task, 1);
  assert.equal(fourth.o.episode, first.o.episode + 1);
  assert.deepEqual(await state(), { ai_attempt_count: 0, ai_last_attempt_at: null, ai_attempt_terminal: false });
});

test('attempt state shape, suppression compaction and same-episode metadata', async t => {
  const f = await fixture(t), item = await candidate(f);
  await reserve(f, item);
  const original = await f.one('select ai_attempt_count,ai_last_attempt_at::text,episode from private.agent_observations where id=$1', [item.o.id]);
  for (const [action,days] of [['snooze',1],['dismiss',null],['resolve',null]]) {
    const row = await f.one('select row_revision from private.agent_observations where id=$1',[item.o.id]);
    await f.sql('select public.agent_pulse_feedback($1,$2,$3,$4,$5) r',[f.owner,item.o.id,row.row_revision,action,days]);
    assert.deepEqual(await f.one('select ai_attempt_count,ai_last_attempt_at::text,episode from private.agent_observations where id=$1',[item.o.id]),original);
  }
  for (const clause of ['ai_attempt_count=-1','ai_attempt_count=3','ai_attempt_count=0','ai_last_attempt_at=null']) {
    await assert.rejects(f.db.exec(`update private.agent_observations set ${clause} where id='${item.o.id}'`), { code: '23514' });
  }
  await f.db.query("update private.agent_observations set first_noticed_at=clock_timestamp()-interval '31 days',last_changed_at=clock_timestamp()-interval '31 days',state='dismissed' where id=$1", [item.o.id]);
  await f.sql('select public.agent_pulse_retain($1,20) r', [f.owner]);
  assert.deepEqual(await f.one('select ai_attempt_count,ai_last_attempt_at::text,episode from private.agent_observations where id=$1', [item.o.id]), original);
  assert.equal((await f.one('select evidence from private.agent_observations where id=$1', [item.o.id])).evidence.evaluatedAt, undefined);
  await f.db.query('update private.agent_observations set content_revision=content_revision+1,row_revision=row_revision+1 where id=$1', [item.o.id]);
  assert.deepEqual(await f.one('select ai_attempt_count,ai_last_attempt_at::text,episode from private.agent_observations where id=$1', [item.o.id]), original);
});

test('same-episode wording publication preserves attempt authority', async t => {
  const f = await fixture(t), first = await candidate(f); await reserve(f,first);
  await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r',[f.owner,first.a.pulseId,first.a.leaseToken,first.a.fence,'unknown']);
  const a = await f.pulse(f.owner,{slot:new Date(Date.parse(first.a.slot)+14400000).toISOString(),fence:first.a.fence+1}); await f.authorize(a);
  const scan = await f.scan(a); scan.decisions.find(d=>d.target.id===f.task).evidence.summary='Same facts, different display wording.';
  await f.publish(a,scan);
  const after = await f.one('select episode,ai_attempt_count,summary from private.agent_observations where id=$1',[first.o.id]);
  assert.equal(after.episode,first.o.episode); assert.equal(after.ai_attempt_count,1); assert.equal(after.summary,'Same facts, different display wording.');
});

test('approved unreferenced-header pruning must not reopen a two-attempt episode', async t => {
  const f = await fixture(t), item = await candidate(f);
  await f.db.query("update private.agent_observations set ai_attempt_count=2,ai_last_attempt_at=clock_timestamp()-interval '49 hours' where id=$1", [item.o.id]);
  for (const [attempt, hours] of [[1, 61], [2, 49]]) await f.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,ai_reserved_at,installation_reservation_key,ai_parent_id,ai_parent_episode,ai_attempt_number,ai_outcome)
    values($1,$5::timestamptz-$3::integer*interval '4 hours',gen_random_uuid(),'succeeded',clock_timestamp()-$4::integer*interval '1 hour',clock_timestamp()-$4::integer*interval '1 hour'+interval '60 seconds',1,gen_random_uuid(),clock_timestamp()-$4::integer*interval '1 hour'+interval '90 seconds',1,'pulse-v1',clock_timestamp()-$4::integer*interval '1 hour'+interval '30 seconds',gen_random_uuid(),$2,1,$3,'unavailable')`, [f.owner, item.o.id, attempt, hours, item.a.slot]);
  const history = (await f.db.query(`select p.ai_attempt_number attempt,
    p.scheduled_slot=$3::timestamptz-p.ai_attempt_number*interval '4 hours' anchored,
    p.scheduled_slot<>$3::timestamptz distinct_candidate,
    p.scheduled_slot=date_bin(interval '4 hours',p.scheduled_slot,timestamptz '1970-01-01') aligned,
    p.ai_parent_episode=$4 same_episode,
    p.status='succeeded' and p.completed_at<clock_timestamp()-interval '48 hours'
      and not exists(select 1 from private.agent_observations o where o.origin_pulse_id=p.id or o.latest_pulse_id=p.id) prunable,
    case when p.ai_attempt_number=2 then extract(epoch from p.ai_reserved_at-lag(p.ai_reserved_at) over(order by p.ai_attempt_number))>=43200 else true end spaced
    from private.agent_pulses p where p.user_id=$1 and p.ai_parent_id=$2 order by p.ai_attempt_number`, [f.owner,item.o.id,item.a.slot,item.o.episode])).rows;
  assert.deepEqual(history, [1,2].map(attempt=>({attempt,anchored:true,distinct_candidate:true,aligned:true,same_episode:true,prunable:true,spaced:true})));
  assert.equal((await f.one('select count(distinct scheduled_slot)::int n from private.agent_pulses where user_id=$1 and ai_parent_id=$2',[f.owner,item.o.id])).n,2);
  assert.equal((await f.one("select $1::timestamptz=date_bin(interval '4 hours',$1::timestamptz,timestamptz '1970-01-01') aligned",[item.a.slot])).aligned,true);
  const state = () => f.one('select episode,ai_attempt_count,ai_attempt_terminal,ai_last_attempt_at::text last_attempt from private.agent_observations where id=$1',[item.o.id]);
  const before = await state(); assert.equal(before.episode,item.o.episode); assert.equal(before.ai_attempt_count,2);
  assert.equal((await f.one(`select ai_last_attempt_at<clock_timestamp()-interval '49 hours' and ai_last_attempt_at>clock_timestamp()-interval '50 hours'
    and abs(extract(epoch from ai_last_attempt_at-(select ai_reserved_at from private.agent_pulses where user_id=$2 and ai_parent_id=$1 and ai_attempt_number=2)))<60 matches_second
    from private.agent_observations where id=$1`,[item.o.id,f.owner])).matches_second,true);
  assert.equal((await reserve(f, item)).sendAllowed, false);
  assert.equal((await f.sql('select public.agent_pulse_retain($1,20) r',[f.owner])).touched,2);
  assert.equal((await f.one('select count(*)::int n from private.agent_pulses where user_id=$1 and ai_parent_id=$2',[f.owner,item.o.id])).n,0);
  assert.deepEqual(await state(),before,'Pruning preserves the same episode, consumed attempts, terminal state and last-attempt timestamp');
  assert.equal((await reserve(f, item)).sendAllowed, false, 'Pruning must not authorize a third request for the same unchanged episode');
  await f.db.query("update private.agent_observations set ai_attempt_count=1,ai_attempt_terminal=true where id=$1", [item.o.id]);
  assert.equal((await reserve(f, item)).reason, 'AI_MALFORMED', 'terminal policy survives missing provenance');
});
