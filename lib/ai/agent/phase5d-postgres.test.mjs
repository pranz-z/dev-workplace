import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { withPostgresFixture, lit, json, rpc } from './phase5d-postgres-fixture.mjs';
import { dispatchTestClock, restoreDispatchTestClock, dispatchFreshnessCases } from './phase5d-freshness-cases.mjs';
import { reviewContextCases } from './phase5d-review-context-cases.mjs';
import { loadPulse } from './phase5d-test-support.mjs';

const pgtest=(name,fn)=>test(name,{timeout:90000},t=>withPostgresFixture(t,fn));
const count=(f,where="event_kind='provider_reservation'")=>f.one('select count(*)::int n from private.agent_pulse_installation_events where '+where);
const state=(f,id)=>f.one('select ai_attempt_count,ai_last_attempt_at,episode from private.agent_observations where id='+lit(id));
const seedEvents=(f,n,age='1 hour')=>f.o.q(`insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) select 'provider_reservation',gen_random_uuid(),clock_timestamp()-interval ${lit(age)} from generate_series(1,${n})`);
const feedback=(user,parent,action)=>action==='ack'
  ?`select public.agent_pulse_ack(${lit(user.id)},${json([{id:parent.id,contentRevision:parent.content_revision}])},false) r`
  :rpc('agent_pulse_feedback',user.id,parent.id,parent.row_revision,action,action==='snooze'?1:null);
const engineDeps=repository=>({repository,signal:new AbortController().signal,fetch:()=>assert.fail('Live provider transport forbidden'),provider:()=>assert.fail('Unexpected provider boundary')});
async function activeOverlap(f,label) {
  const row=await f.one(`select count(*)::int n from pg_stat_activity where pid in(${f.a.pid},${f.b.pid}) and xact_start is not null`);
  assert.equal(row.n,2);f.evidence.races.push({label,pids:[f.a.pid,f.b.pid],activeTransactions:2,barrier:{wait_event_type:'MVCC',wait_event:'uncommitted deletion'},sqlstates:['00000','00000']});
}

if(process.env.AGENT_TEST_POSTGRES_REVIEW_CONTEXT==='1') {
  test('E4a genuine PostgreSQL review-context contract',{timeout:90000},t=>withPostgresFixture(t,async f=>{
    const user=await f.owner(),other=await f.owner();
    await f.o.q(`update public.tasks set title='Canonical target Alpha' where id=${lit(user.task)}`);
    const {p}=await f.candidate(user);
    await reviewContextCases(t,{owner:user.id,task:user.task,project:user.project,other:other.id,otherProject:other.project,authority:p,
      q:sql=>f.o.q(sql),one:sql=>f.one(sql),value:sql=>f.value(sql),rows:async sql=>(await f.value('select coalesce(jsonb_agg(x),\'[]\'::jsonb) r from ('+sql+') x'))});
  }));
} else if(process.env.AGENT_TEST_POSTGRES_NEGATIVE_CONTROL==='1') {
  pgtest('RED missing installation reservation lock permits a fifth request',async f=>{
    const users=[await f.owner(),await f.owner()];
    const items=[];for(const user of users)items.push(await f.candidate(user));await seedEvents(f,3);
    const definition=(await f.one("select pg_get_functiondef('public.agent_pulse_reserve_ai(uuid,uuid,uuid,bigint,bigint,uuid,bigint)'::regprocedure) definition")).definition;
    assert.ok(definition.includes('perform pg_catalog.pg_advisory_xact_lock(505,5);'));
    // Negative control modifies ONLY this newly created disposable database, never the migration file.
    await f.o.q(definition.replace('perform pg_catalog.pg_advisory_xact_lock(505,5);',''));
    await f.a.q('begin');await f.b.q('begin');
    assert.equal((await f.a.one(f.reserve(items[0]))).r.sendAllowed,true);
    assert.equal((await f.b.one(f.reserve(items[1]))).r.sendAllowed,true);
    await f.a.q('commit');await f.b.q('commit');
    const final=await count(f);console.log(JSON.stringify({negativeControl:true,pids:f.evidence.backends,installationReservations:final.n}));
    assert.equal(final.n,4,'A missing installation lock must be caught as an overspent budget');
  });
} else {
  pgtest('01 same owner simultaneous claim has one canonical authority',async f=>{
    const u=await f.owner();await f.enableDue(u);const nonce=randomUUID(),hash=await f.digest();
    const [x,y]=await f.race('same-owner claim',f.claim(nonce,true),f.claim(nonce,true));
    assert.equal(x.r.claimCount,1);assert.equal(y.r.replay,true);assert.deepEqual(x.r.claims,y.r.claims);
    const rows=await f.one(`select count(*)::int n,max(fence)::int fence from private.agent_pulses where user_id=${lit(u.id)} and status='running'`);
    assert.deepEqual(rows,{n:1,fence:2});assert.equal(await f.digest(),hash);f.evidence.final=rows;
  });
  pgtest('02 installation slot ceiling survives concurrent changed and repeated nonce',async f=>{
    for(let i=0;i<4;i++){const u=await f.owner();await f.enableDue(u);}
    const nonce=randomUUID(),hash=await f.digest();const [x,y]=await f.race('two-owner ceiling',f.claim(nonce,true),f.claim(randomUUID(),true));
    assert.equal(x.r.claimCount,2);assert.equal(y.r.claimCount,2);assert.equal(y.r.replay,true);
    assert.equal((await f.value(f.claim(nonce,true))).claimCount,2);assert.equal((await f.value(f.claim(randomUUID(),true))).claimCount,2);
    assert.equal((await count(f,"event_kind='dispatch_slot'")).n,1);assert.equal((await f.one("select count(*)::int n from private.agent_pulses")).n,2);assert.equal(await f.digest(),hash);f.evidence.final={claims:2,slots:1};
  });
  pgtest('03 expired worker loses publication finalization and feedback authority',async f=>{
    const u=await f.owner(),id=randomUUID(),token=randomUUID();await f.enableDue(u);
    await f.o.q(`insert into private.agent_pulses(id,user_id,scheduled_slot,dispatch_nonce,started_at,fence,lease_token,lease_expires_at,settings_revision,policy_version)
      values(${lit(id)},${lit(u.id)},date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')-interval '4 hours',gen_random_uuid(),clock_timestamp()-interval '100 seconds',2,${lit(token)},clock_timestamp()-interval '10 seconds',1,'pulse-v1');
      update private.agent_pulse_state set fence=2,lease_token=${lit(token)},lease_expires_at=clock_timestamp()-interval '10 seconds' where user_id=${lit(u.id)}`);
    const old={userId:u.id,pulseId:id,leaseToken:token,fence:2,settingsRevision:1};
    const [x]=await f.race('takeover versus stale publication',f.claim(randomUUID(),true),f.publication(old,{decisions:[],coverage:{},baselinePatches:{}}),{secondCode:'40001'});
    const fresh=x.r.claims[0];assert.equal(fresh.fence,3);
    await assert.rejects(f.b.one(f.finish(old)),{code:'40001'});
    await f.value(f.publication(fresh,await f.scan(fresh)));
    const o=await f.one('select id,row_revision from private.agent_observations where user_id='+lit(u.id));await f.value(feedback(u,o,'dismiss'));
    await assert.rejects(f.b.one(f.publication(old,{decisions:[],coverage:{},baselinePatches:{}})),{code:'40001'});
    assert.equal((await f.one('select state from private.agent_observations where id='+lit(o.id))).state,'dismissed');f.evidence.final={fence:3,staleSQLSTATE:'40001'};
  });
  pgtest('04 owner request ceiling and duplicate reservation recovery',async f=>{
    const u=await f.owner(),item=await f.candidate(u),key=randomUUID();
    await f.o.q(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,ai_reserved_at,installation_reservation_key,ai_parent_episode,ai_attempt_number)
      values(${lit(u.id)},${lit(item.p.slot)}::timestamptz-interval '4 hours',gen_random_uuid(),'succeeded',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '119 minutes',1,gen_random_uuid(),clock_timestamp()-interval '118 minutes',1,'pulse-v1',clock_timestamp()-interval '2 hours',${lit(key)},1,1);
      insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) values('provider_reservation',${lit(key)},clock_timestamp()-interval '2 hours')`);
    const hash=await f.digest();const [x,y]=await f.race('owner duplicate reserve',f.reserve(item),f.reserve(item));
    assert.equal(x.r.sendAllowed,true);assert.equal(y.r.recovered,true);assert.equal(y.r.sendAllowed,false);assert.equal((await state(f,item.parent.id)).ai_attempt_count,1);
    await f.o.q(`update private.agent_observations set ai_last_attempt_at=clock_timestamp()-interval '13 hours' where id=${lit(item.parent.id)}`);
    const next=await f.candidate(u);assert.equal((await f.value(f.reserve(next))).reason,'BUDGET');
    assert.equal((await f.value(`select private.agent_pulse_usage(${lit(u.id)},clock_timestamp()) r`)).ownerRequests,2);assert.equal(await f.digest(),hash);f.evidence.final={ownerRequests:2,episodeAttempts:1};
  });
  pgtest('05 different owners cannot overspend installation budget',async f=>{
    const u=await f.owner(),v=await f.owner(),first=await f.candidate(u),second=await f.candidate(v);await seedEvents(f,3);const hash=await f.digest();
    const [x,y]=await f.race('installation reserve',f.reserve(first),f.reserve(second));assert.equal(x.r.sendAllowed,true);assert.equal(y.r.reason,'BUDGET');
    assert.equal((await count(f)).n,4);assert.equal((await state(f,first.parent.id)).ai_attempt_count,1);assert.equal((await state(f,second.parent.id)).ai_attempt_count,0);
    assert.equal((await f.one('select ai_reserved_at from private.agent_pulses where id='+lit(second.p.pulseId))).ai_reserved_at,null);assert.equal(await f.digest(),hash);f.evidence.final={installationRequests:4,winnerAttempts:1,loserAttempts:0};
  });
  pgtest('06 account deletion contends with reservation without refunding global budget',async f=>{
    const u=await f.owner(),v=await f.owner(),first=await f.candidate(u),second=await f.candidate(v);await seedEvents(f,3);const hash=await f.digest([u.id]);
    await f.race('reservation versus Auth cascade',f.reserve(first),`delete from auth.users where id=${lit(u.id)} returning id`,{coreExclude:[u.id]});
    for(const table of ['agent_pulse_state','agent_pulses','agent_observations'])assert.equal((await f.one(`select count(*)::int n from private.${table} where user_id=${lit(u.id)}`)).n,0);
    assert.equal((await count(f)).n,4);assert.equal((await f.value(f.reserve(second))).reason,'BUDGET');assert.equal(await f.digest([u.id]),hash);f.evidence.final={deletedOwnerRows:0,installationRequests:4};
  });
  pgtest('07 established dispatch survives deletion and both nonce replays',async f=>{
    const owners=[];for(let i=0;i<4;i++){const u=await f.owner();owners.push(u);await f.enableDue(u);}
    const nonce=randomUUID(),slot=await f.value(f.claim(nonce,true)),deleted=slot.claims.map(p=>p.userId),hash=await f.digest(deleted);
    await f.a.q('begin');await f.b.q('begin');await f.a.q('delete from auth.users where id in('+deleted.map(lit).join(',')+')');
    const concurrent=await f.b.one(f.claim(randomUUID(),true));assert.equal(concurrent.r.claimCount,2);assert.equal(concurrent.r.replay,true);
    const tx=await f.one(`select count(*)::int n from pg_stat_activity where pid in(${f.a.pid},${f.b.pid}) and xact_start is not null`);assert.equal(tx.n,2);
    f.evidence.races.push({label:'MVCC deletion/dispatch overlap',pids:[f.a.pid,f.b.pid],activeTransactions:tx.n,sqlstates:['00000','00000']});
    await f.a.q('commit');await f.b.q('commit');
    for(const n of [nonce,randomUUID()]){const r=await f.value(f.claim(n,true));assert.equal(r.claimCount,2);assert.deepEqual(r.claims,[]);}
    assert.equal((await count(f,"event_kind='dispatch_slot'")).n,1);assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n,0);assert.equal(await f.digest(deleted),hash);f.evidence.final={originalClaims:2,survivingClaims:0,slots:1};
  });
  pgtest('08 feedback and acknowledgement preserve revisions in both publication orderings',async f=>{
    for(const action of ['dismiss','snooze','resolve','ack'])for(const firstFeedback of [true,false]) {
      const u=await f.owner(),initial=await f.candidate(u),worker=await f.candidate(u,false);
      await f.o.q(`update public.tasks set priority='Critical' where id=${lit(u.task)}`);
      const scan=await f.scan(worker.p),pub=f.publication(worker.p,scan),feedbackSql=feedback(u,initial.parent,action),hash=await f.digest();
      if(firstFeedback){await f.race(action+' before publication',feedbackSql,pub);const row=await f.one('select state,episode,seen_content_revision,content_revision from private.agent_observations where id='+lit(initial.parent.id));assert.equal(row.episode,1);assert.equal(row.state,action==='ack'?'active':action==='dismiss'?'dismissed':action==='resolve'?'resolved':'snoozed');if(action==='ack')assert.equal(row.seen_content_revision,row.content_revision);}
      else {const [,y]=await f.race('publication before '+action,pub,feedbackSql,{secondCode:action==='ack'?null:'40001'});if(action==='ack')assert.equal(y.r.acknowledged,0);const row=await f.one('select episode,content_revision,seen_content_revision from private.agent_observations where id='+lit(initial.parent.id));assert.equal(row.episode,2);assert.ok(row.content_revision>row.seen_content_revision);}
      assert.equal((await f.one('select count(*)::int n from private.agent_observations where user_id='+lit(u.id))).n,1);assert.equal(await f.digest(),hash);
    }
    f.evidence.final={feedbackOrderings:8,duplicateObservations:0};
  });
  pgtest('09 disable and reservation have consistent outcomes in both orders',async f=>{
    for(const disableFirst of [true,false]){const u=await f.owner(),item=await f.candidate(u),disable=f.settings(u,item.p.settingsRevision),hash=await f.digest();
      if(disableFirst)await f.race('disable before reserve',disable,f.reserve(item),{secondCode:'40001'});else await f.race('reserve before disable',f.reserve(item),disable);
      assert.equal((await state(f,item.parent.id)).ai_attempt_count,disableFirst?0:1);await assert.rejects(f.b.one(f.reserve(item)),{code:'40001'});assert.equal((await f.one('select mode from private.agent_pulse_state where user_id='+lit(u.id))).mode,'off');assert.equal(await f.digest(),hash);
    }f.evidence.final={orderings:2,postDisableAuthorization:false};
  });
  pgtest('10 disable versus finalization preserves canonical state and observations',async f=>{
    for(const disableFirst of [true,false]){const u=await f.owner(),item=await f.candidate(u),disable=f.settings(u,item.p.settingsRevision),hash=await f.digest();
      if(disableFirst)await f.race('disable before finish',disable,f.finish(item.p),{secondCode:'40001'});else await f.race('finish before disable',f.finish(item.p),disable);
      const row=await f.one('select mode,next_due_at,settings_revision,fence from private.agent_pulse_state where user_id='+lit(u.id));assert.equal(row.mode,'off');assert.equal(row.next_due_at,null);assert.equal(row.settings_revision,2);assert.ok(row.fence>item.p.fence);assert.equal((await f.one('select count(*)::int n from private.agent_observations where user_id='+lit(u.id))).n,1);assert.equal(await f.digest(),hash);
    }f.evidence.final={orderings:2,observationsPreserved:true};
  });
  pgtest('11 retention cannot prune recent provider accounting in either order',async f=>{
    for(const retainFirst of [true,false]){const u=await f.owner(),item=await f.candidate(u);await seedEvents(f,1,'49 hours');
      const retain='select public.agent_pulse_retain_installation(20) r';await f.race(retainFirst?'retain before reserve':'reserve before retain',retainFirst?retain:f.reserve(item),retainFirst?f.reserve(item):retain);
      assert.equal((await f.one("select count(*)::int n from private.agent_pulse_installation_events where created_at<clock_timestamp()-interval '48 hours'")).n,0);
      assert.equal((await state(f,item.parent.id)).ai_attempt_count,1);
    }assert.equal((await count(f)).n,2);f.evidence.final={recentReservations:2,agedEvents:0};
  });
  pgtest('12 retention preserves current dispatch identity in either order',async f=>{
    const u=await f.owner();await f.enableDue(u);await seedEvents(f,1,'49 hours');const nonce=randomUUID(),retain='select public.agent_pulse_retain_installation(20) r';
    await f.race('retention before dispatch',retain,f.claim(nonce,true));await f.race('dispatch replay before retention',f.claim(randomUUID(),true),retain);
    const replay=await f.value(f.claim(nonce,true));assert.equal(replay.replay,true);assert.equal(replay.claimCount,1);assert.equal((await count(f,"event_kind='dispatch_slot'")).n,1);f.evidence.final={slots:1,claims:1};
  });
  pgtest('13 duplicate episode reservations increment once and pruning never permits a third',async f=>{
    const u=await f.owner(),first=await f.candidate(u);await f.race('first episode reserve/replay',f.reserve(first),f.reserve(first));assert.equal((await state(f,first.parent.id)).ai_attempt_count,1);
    await f.o.q(`update private.agent_observations set ai_last_attempt_at=clock_timestamp()-interval '12 hours' where id=${lit(first.parent.id)}`);
    const second=await f.candidate(u);await f.race('second episode reserve/replay',f.reserve(second),f.reserve(second));assert.equal((await state(f,first.parent.id)).ai_attempt_count,2);
    const third=await f.candidate(u);const [x,y]=await f.race('third episode denied twice',f.reserve(third),f.reserve(third));assert.equal(x.r.sendAllowed,false);assert.equal(y.r.sendAllowed,false);
    const v=await f.owner(),old=await f.candidate(v);await f.o.q(`update private.agent_observations set ai_attempt_count=2,ai_last_attempt_at=clock_timestamp()-interval '49 hours' where id=${lit(old.parent.id)}`);
    for(const [attempt,hours] of [[1,61],[2,49]])await f.o.q(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,ai_reserved_at,installation_reservation_key,ai_parent_id,ai_parent_episode,ai_attempt_number)
      values(${lit(v.id)},date_bin(interval '4 hours',clock_timestamp()-interval '${hours} hours',timestamptz '1970-01-01'),gen_random_uuid(),'succeeded',clock_timestamp()-interval '${hours} hours',clock_timestamp()-interval '${hours} hours'+interval '60 seconds',1,gen_random_uuid(),clock_timestamp()-interval '${hours} hours'+interval '90 seconds',1,'pulse-v1',clock_timestamp()-interval '${hours} hours',gen_random_uuid(),${lit(old.parent.id)},1,${attempt})`);
    assert.equal((await f.value(rpc('agent_pulse_retain',v.id,20))).touched,2);const [p,q]=await f.race('pruned episode denied twice',f.reserve(old),f.reserve(old));assert.equal(p.r.reason,'BUDGET');assert.equal(q.r.reason,'BUDGET');assert.equal((await state(f,old.parent.id)).ai_attempt_count,2);assert.equal((await count(f)).n,2);f.evidence.final={liveAttempts:2,prunedAttempts:2,providerEvents:2};
  });
  pgtest('14 forced failure rolls back every reservation component during contention',async f=>{
    const u=await f.owner(),item=await f.candidate(u),hash=await f.digest();
    await f.o.q("create function private.test_failure() returns trigger language plpgsql as $$begin raise exception 'controlled failure' using errcode='P0001';end;$$;create trigger test_failure before insert on private.agent_pulse_installation_events for each row when(new.event_kind='provider_reservation') execute function private.test_failure()");
    await f.a.q('begin');await f.b.q('begin');await f.a.q('select pg_advisory_xact_lock(505,5)');const pending=f.b.one(f.reserve(item)).then(value=>({value}),error=>({error}));const barrier=await f.waitForBlock();
    await assert.rejects(f.a.one(f.reserve(item)),{code:'P0001'});await f.a.q('rollback');const loser=await pending;assert.equal(loser.error.code,'P0001');await f.b.q('rollback');
    assert.equal((await count(f)).n,0);assert.equal((await state(f,item.parent.id)).ai_attempt_count,0);assert.equal((await f.one('select ai_reserved_at from private.agent_pulses where id='+lit(item.p.pulseId))).ai_reserved_at,null);
    await f.o.q('drop trigger test_failure on private.agent_pulse_installation_events');assert.equal((await f.value(f.reserve(item))).sendAllowed,true);assert.equal((await count(f)).n,1);assert.equal((await state(f,item.parent.id)).ai_attempt_count,1);assert.equal(await f.digest(),hash);
    f.evidence.races.push({label:'failure under contention',pids:[f.a.pid,f.b.pid],barrier,sqlstates:['P0001','P0001']});f.evidence.final={failedAttemptComponents:0,recoveredReservationComponents:3};
  });
  pgtest('15 accepted idea publication is idempotent under independent connection contention',async f=>{
    const u=await f.owner(),item=await f.candidate(u);await f.value(f.reserve(item));const hash=await f.digest();
    const historical=async(user,slot,hours,acceptedAge)=>f.o.q(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,ai_reserved_at,installation_reservation_key,ai_parent_episode,ai_attempt_number,idea_accepted_at)
      values(${lit(user.id)},${lit(slot)},gen_random_uuid(),'succeeded',clock_timestamp()-interval '${hours}',clock_timestamp()-interval '${hours}'+interval '60 seconds',1,gen_random_uuid(),clock_timestamp()-interval '${hours}'+interval '90 seconds',1,'pulse-v1',clock_timestamp()-interval '${hours}'+interval '10 seconds',gen_random_uuid(),1,1,clock_timestamp()-interval '${acceptedAge}');
      insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) select 'provider_reservation',installation_reservation_key,ai_reserved_at from private.agent_pulses where user_id=${lit(user.id)} and scheduled_slot=${lit(slot)}`);
    await historical(u,'2026-01-01T00:00:00Z','2 hours','1 hour 59 minutes 30 seconds');
    const sql=`select public.agent_pulse_publish_ai(${[item.p.userId,item.p.pulseId,item.p.leaseToken,item.p.fence,item.p.settingsRevision].map(lit).join(',')},${json({category:'review_deadline',title:'Review deadline',summary:'Review the recorded deadline.'})}) r`;
    const [x,y]=await f.race('accepted idea replay',sql,sql);assert.equal(x.r.accepted,true);assert.equal(y.r.accepted,true);assert.equal(x.r.id,y.r.id);
    assert.equal((await f.one("select count(*)::int n from private.agent_observations where kind='idea'")).n,1);assert.equal((await f.value(`select private.agent_pulse_usage(${lit(u.id)},clock_timestamp()) r`)).ownerIdeas,2);assert.equal(await f.digest(),hash);
    const v=await f.owner(),delayed=await f.candidate(v);
    await historical(v,'2026-01-01T04:00:00Z','24 hours 30 seconds','23 hours 59 minutes 30 seconds');
    await historical(v,'2026-01-01T08:00:00Z','2 hours','1 hour 59 minutes 30 seconds');
    assert.equal((await f.value(f.reserve(delayed))).sendAllowed,true);
    const blocked=`select public.agent_pulse_publish_ai(${[delayed.p.userId,delayed.p.pulseId,delayed.p.leaseToken,delayed.p.fence,delayed.p.settingsRevision].map(lit).join(',')},${json({category:'review_deadline',title:'Review deadline',summary:'Review the recorded deadline.'})}) r`;
    const [p,q]=await f.race('accepted idea rolling-window ceiling',blocked,blocked);assert.equal(p.r.reason,'BUDGET');assert.equal(q.r.reason,'BUDGET');
    assert.equal((await f.value(`select private.agent_pulse_usage(${lit(v.id)},clock_timestamp()) r`)).ownerIdeas,2);f.evidence.final={savedIdeas:1,winnerAcceptedTimestamps:2,delayedOwnerAcceptedTimestamps:2,thirdIdeaDenied:true};
  });

  pgtest('16 disabled wins installation authority against enabled contender',async f=>{
    for(let i=0;i<3;i++){const u=await f.owner();await f.enableDue(u);}
    const before=await f.one('select jsonb_agg(to_jsonb(s) order by user_id) states from private.agent_pulse_state s');
    const [x,y]=await f.race('disabled before enabled',f.claim(randomUUID(),false),f.claim(randomUUID(),true));
    assert.equal(x.r.outcome,'disabled');assert.equal(x.r.replay,false);assert.deepEqual(y.r,{...x.r,replay:true});
    assert.equal(x.r.claimCount,0);assert.deepEqual(x.r.claims,[]);
    assert.equal((await count(f,"event_kind='dispatch_slot'")).n,1);assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n,0);
    assert.deepEqual(await f.one('select jsonb_agg(to_jsonb(s) order by user_id) states from private.agent_pulse_state s'),before);
    f.evidence.final={outcome:'disabled',claims:0,pulses:0,slots:1,ownerStateUnchanged:true};
  });
  pgtest('17 enabled wins installation authority against disabled contender',async f=>{
    for(let i=0;i<3;i++){const u=await f.owner();await f.enableDue(u);}
    const [x,y]=await f.race('enabled before disabled',f.claim(randomUUID(),true),f.claim(randomUUID(),false));
    assert.equal(x.r.outcome,'claimed');assert.equal(x.r.claimCount,2);assert.deepEqual(y.r,{...x.r,replay:true});
    assert.equal((await count(f,"event_kind='dispatch_slot'")).n,1);assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n,2);
    f.evidence.final={outcome:'claimed',claims:2,pulses:2,slots:1};
  });
  pgtest('18 two disabled contenders with different nonces establish one zero-claim slot',async f=>{
    const u=await f.owner();await f.enableDue(u);
    const [x,y]=await f.race('disabled before disabled changed nonce',f.claim(randomUUID(),false),f.claim(randomUUID(),false));
    assert.equal(x.r.outcome,'disabled');assert.equal(x.r.claimCount,0);assert.deepEqual(x.r.claims,[]);assert.deepEqual(y.r,{...x.r,replay:true});
    assert.equal((await count(f,"event_kind='dispatch_slot'")).n,1);assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n,0);
    f.evidence.final={outcome:'disabled',claims:0,pulses:0,slots:1};
  });
  pgtest('19 disabled authority permits owner deletion and serialized opt-in cannot reopen slot',async f=>{
    const deleted=await f.owner(),replacement=await f.owner();await f.enableDue(deleted);
    await f.value(f.settings(replacement,1));
    const hash=await f.digest([deleted.id]),nonce=randomUUID();
    await f.a.q('begin');await f.b.q('begin');const x=await f.a.one(f.claim(nonce,false));
    // Auth deletion completes while dispatch is uncommitted: disabled dispatch has not locked owner state.
    await f.b.q(`delete from auth.users where id=${lit(deleted.id)}`);
    // The existing settings RPC intentionally takes the installation lock before owner state.
    const optIn=f.b.one(`select public.agent_pulse_set_settings(${lit(replacement.id)},2,${json({mode:'workspace',cadence:'normal',checksConsent:true,aiConsent:false,aiProjectIds:[]})}) r`);
    const barrier=await f.waitForBlock();await f.a.q('commit');await optIn;
    await f.b.q(`update private.agent_pulse_state set next_due_at=date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01') where user_id=${lit(replacement.id)}`);
    const y=await f.b.one(f.claim(randomUUID(),true));await f.b.q('commit');
    assert.equal(x.r.outcome,'disabled');assert.deepEqual(y.r,{...x.r,replay:true});
    for(const enabled of [true,false]){const replay=await f.value(f.claim(randomUUID(),enabled));assert.deepEqual(replay,{...x.r,replay:true});}
    assert.equal((await count(f,"event_kind='dispatch_slot'")).n,1);assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n,0);
    assert.equal((await f.one('select count(*)::int n from private.agent_pulse_state where user_id='+lit(deleted.id))).n,0);assert.equal(await f.digest([deleted.id]),hash);
    f.evidence.races.push({label:'disabled establishment with owner deletion and opt-in',pids:[f.a.pid,f.b.pid],barrier,sqlstates:['00000','00000'],coreAuditUnchanged:true});
    f.evidence.final={outcome:'disabled',claims:0,pulses:0,slots:1,deletedOwnerRows:0,replacementAdmitted:false};
  });
  pgtest('Task24 real catalogs preserve private ownership grants overloads and default Off',async f=>{
    const tables=await f.value("select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'ownerCascade',(select count(*) from pg_constraint k where k.conrelid=c.oid and k.confrelid='auth.users'::regclass and k.contype='f' and k.confdeltype='c')) order by c.relname) r from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('agent_pulse_state','agent_pulses','agent_observations','agent_pulse_installation_events')");
    assert.equal(tables.length,4);assert.ok(tables.every(x=>x.rls));for(const row of tables)assert.equal(row.ownerCascade,row.name==='agent_pulse_installation_events'?0:1);
    const functions=await f.value("select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,'definer',p.prosecdef,'config',p.proconfig,'public',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),'anon',has_function_privilege('anon',p.oid,'execute'),'browser',has_function_privilege('authenticated',p.oid,'execute'),'service',has_function_privilege('service_role',p.oid,'execute')) order by n.nspname,p.proname) r from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'agent_pulse_%'");
    const migration=readFileSync(new URL('../../../supabase/migrations/20261015132608_workspace_agent_pulse.sql',import.meta.url),'utf8');
    const expected=[...migration.matchAll(/create function public\.(agent_pulse_\w+)\(/g)].map(x=>x[1]).sort();
    assert.deepEqual(functions.filter(x=>x.schema==='public').map(x=>x.name).sort(),expected);
    for(const row of functions){assert.equal(row.public,false,row.signature);assert.equal(row.anon,false,row.signature);assert.equal(row.browser,false,row.signature);assert.equal(row.service,row.schema==='public',row.signature);if(row.definer)assert.ok(row.config.includes('search_path=""'),row.signature);if(row.schema==='public')assert.equal(row.definer,true,row.signature);}
    const tableNames=tables.map(x=>x.name);
    for(const role of ['anon','authenticated','service_role']){await f.o.q('set role '+role);try{for(const name of tableNames)await assert.rejects(f.o.q('select * from private.'+name),{code:'42501'});}finally{await f.o.q('reset role');}}
    const writers=await f.value("select jsonb_agg(p.proname order by p.proname) r from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'agent_pulse_%' and pg_get_functiondef(p.oid) ~* '(insert into|delete from|update) private[.]agent_pulse_installation_events'");
    assert.deepEqual(writers,['agent_pulse_claim_dispatch','agent_pulse_reserve_ai','agent_pulse_retain_installation']);
    const owner=randomUUID();await f.o.q(`insert into auth.users values(${lit(owner)});insert into public.profiles(id,time_zone) values(${lit(owner)},'UTC')`);
    const settings=await f.value(rpc('agent_pulse_get_settings',owner));assert.equal(settings.mode,'off');assert.equal(settings.aiConsented,false);assert.deepEqual(settings.aiProjectIds,[]);
    await f.value(rpc('agent_pulse_get_brief',owner));assert.equal((await f.one('select count(*)::int n from private.agent_pulse_state')).n,0);
    assert.equal((await f.one("select count(*)::int n from pg_extension where extname in ('pg_cron','pg_net')")).n,0);
    f.evidence.final={tables,functions,installationWriters:writers,defaultOffReadOnly:true,ledger:await f.ledgerInvariant()};
  });
  pgtest('Task24 uncertain committed reservation survives deletion without refund or retransmission',async f=>{
    const {runClaimedPulse}=await loadPulse('lib/ai/agent/pulse/engine.ts');
    const u=await f.owner(),v=await f.owner(),item=await f.candidate(u),other=await f.candidate(v);await seedEvents(f,3);
    const base=await f.repository(f.b),p=await f.authority(item.p);let reserveCalls=0;
    const repository={...base,reserveAi:async(...args)=>{reserveCalls++;const r=await base.reserveAi(...args);assert.equal(r.sendAllowed,true);assert.equal((await count(f)).n,4);throw new Error('Untrusted committed reservation response');}};
    await runClaimedPulse(p,engineDeps(repository));assert.equal(reserveCalls,1);
    const stored=await f.one(`select ai_reserved_at is not null reserved,installation_reservation_key key,ai_outcome from private.agent_pulses where id=${lit(p.pulseId)}`);
    assert.equal(stored.reserved,true);assert.equal(stored.ai_outcome,'unknown');assert.equal((await state(f,item.parent.id)).ai_attempt_count,1);
    const hash=await f.digest([u.id]);await f.a.q('begin');await f.a.q('delete from auth.users where id='+lit(u.id));await f.b.q('begin');
    assert.equal((await f.b.one(f.reserve(other))).r.reason,'BUDGET');await activeOverlap(f,'uncertain reservation deletion versus another-owner ceiling');await f.a.q('commit');await f.b.q('commit');
    for(const table of ['agent_pulse_state','agent_pulses','agent_observations'])assert.equal((await f.one(`select count(*)::int n from private.${table} where user_id=${lit(u.id)}`)).n,0);
    assert.equal((await f.one('select count(*)::int n from private.agent_pulse_installation_events where reservation_key='+lit(stored.key))).n,1);
    await runClaimedPulse(p,engineDeps(await f.repository(f.a)));assert.equal((await count(f)).n,4);assert.equal(await f.digest([u.id]),hash);
    f.evidence.final={uncertainConsumed:true,reserveCalls,providerCalls:0,deletedOwnerRows:0,ledger:await f.ledgerInvariant()};
  });
  pgtest('Task24 actual dispatch engine cannot replace deleted original batch owners',async f=>{
    const {runPulseDispatch}=await loadPulse('lib/ai/agent/pulse/engine.ts');const owners=[];
    for(let i=0;i<4;i++){const u=await f.owner();owners.push(u);await f.enableDue(u);}
    const clock=await f.one("select private.agent_pulse_stamp(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')) slot,floor(extract(epoch from clock_timestamp()))::bigint issued");
    const input={scheduledSlot:clock.slot,issuedAt:Number(clock.issued),nonce:randomUUID(),processingEnabled:true},base=await f.repository(f.b);
    let sourceReads=0,ownerMaintenance=0;const repository={...base,readSource:async(...args)=>{sourceReads++;return base.readSource(...args);},retain:async(...args)=>{ownerMaintenance++;return base.retain(...args);}};
    const deps={...engineDeps(repository),buildContext:()=>({ok:false,code:'NO_CONTEXT'})};
    const first=await runPulseDispatch(input,deps);assert.equal(first.claimed,2);assert.equal(first.processed,2);
    const deleted=await f.value('select jsonb_agg(user_id) r from private.agent_pulses');assert.equal(deleted.length,2);const hash=await f.digest(deleted);
    await f.a.q('begin');await f.a.q('delete from auth.users where id in('+deleted.map(lit).join(',')+')');await f.b.q('begin');
    const readsBeforeReplay=sourceReads;
    const maintenanceBeforeReplay=ownerMaintenance;
    // Uncommitted deletion leaves the original finished authorities visible to MVCC.
    // Visiting those canonical results is permitted; reading source or admitting replacements is not.
    const during=await runPulseDispatch({...input,nonce:randomUUID()},deps);assert.equal(during.outcome,'recovered');assert.equal(during.claimed,2);assert.equal(during.processed,2);assert.equal(sourceReads,readsBeforeReplay);assert.equal(ownerMaintenance,maintenanceBeforeReplay);
    await activeOverlap(f,'engine dispatch replay during original batch cascade');await f.a.q('commit');await f.b.q('commit');
    for(const nonce of [input.nonce,randomUUID()]){const r=await runPulseDispatch({...input,nonce},deps);assert.equal(r.outcome,'recovered');assert.equal(r.claimed,2);assert.equal(r.processed,0);assert.deepEqual(Object.keys(r).sort(),['claimed','failed','outcome','partial','processed','skipped','succeeded']);}
    assert.equal((await count(f,"event_kind='dispatch_slot'")).n,1);assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n,0);assert.equal(await f.digest(deleted),hash);
    f.evidence.final={sourceFreeReplay:true,replacementOwnersAdmitted:0,slotIdentities:1,providerCalls:0,ledger:await f.ledgerInvariant()};
  });
  pgtest('Task24 owner-free pruning remains bounded with all owners Off or deleted',async f=>{
    const off=await f.owner(),deleted=await f.owner();await f.value(f.settings(off,1));await f.o.q('delete from auth.users where id='+lit(deleted.id));
    await f.value(f.claim(randomUUID(),false));await seedEvents(f,27,'49 hours');await seedEvents(f,1,'47 hours 59 minutes');await seedEvents(f,1,'23 hours');
    const before=await f.digest(),settings=await f.value('select jsonb_agg(to_jsonb(s) order by user_id) r from private.agent_pulse_state s');
    const [a,b]=await f.race('owner-free concurrent operational pruning','select public.agent_pulse_retain_installation(20) r','select public.agent_pulse_retain_installation(20) r');
    assert.equal(a.r.deleted,20);assert.equal(b.r.deleted,7);assert.equal((await f.value('select public.agent_pulse_retain_installation(20) r')).deleted,0);
    const {runPulseDispatch}=await loadPulse('lib/ai/agent/pulse/engine.ts');
    const clock=await f.one("select private.agent_pulse_stamp(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')) slot,floor(extract(epoch from clock_timestamp()))::bigint issued");
    const input={scheduledSlot:clock.slot,issuedAt:Number(clock.issued),nonce:randomUUID(),processingEnabled:false};
    await seedEvents(f,21,'49 hours');
    for(const remaining of [1,0]) {
      const result=await runPulseDispatch(input,engineDeps(await f.repository(f.b)));
      assert.equal(result.processed,0);assert.equal(result.outcome,'recovered');
      assert.equal((await count(f,"event_kind='provider_reservation' and created_at<clock_timestamp()-interval '48 hours'")).n,remaining);
    }
    assert.equal((await count(f,"event_kind='provider_reservation'")).n,2);assert.equal((await count(f,"event_kind='dispatch_slot'")).n,1);
    assert.deepEqual(await f.value('select jsonb_agg(to_jsonb(s) order by user_id) r from private.agent_pulse_state s'),settings);assert.equal(await f.digest(),before);
    f.evidence.final={removed:[20,7,0],engineRemoved:[20,1],retainedRecent:3,mode:'off',providerCalls:0,ledger:await f.ledgerInvariant()};
  });
  pgtest('Task24 engine safely recovers owner-to-ledger insertion fault rollback',async f=>{
    const {runClaimedPulse}=await loadPulse('lib/ai/agent/pulse/engine.ts');const u=await f.owner(),item=await f.candidate(u),p=await f.authority(item.p),base=await f.repository(f.b),hash=await f.digest();
    await f.o.q("create function test_harness.reservation_fault() returns trigger language plpgsql as $$begin if not exists(select 1 from private.agent_pulses where installation_reservation_key=new.reservation_key and ai_reserved_at is not null) then raise exception 'Fixture did not reach staged owner reservation';end if;raise exception 'Injected ledger insertion failure' using errcode='P0001';end;$$;create trigger reservation_fault before insert on private.agent_pulse_installation_events for each row when(new.event_kind='provider_reservation') execute function test_harness.reservation_fault()");
    let calls=0;
    const repository={...base,reserveAi:async(...args)=>{calls++;await f.a.q('begin');await f.a.q('select pg_advisory_xact_lock(505,5)');const pending=base.reserveAi(...args).then(value=>({value}),error=>({error}));const barrier=await f.waitForBlock();await assert.rejects(f.a.one(f.reserve(item)),{code:'P0001'});await f.a.q('rollback');const outcome=await pending;assert.ok(outcome.error);f.evidence.races.push({label:'engine reservation ledger fault under overlap',pids:[f.a.pid,f.b.pid],barrier,sqlstates:['P0001','P0001']});throw outcome.error;}};
    await runClaimedPulse(p,engineDeps(repository));assert.equal(calls,1);assert.equal((await count(f)).n,0);assert.equal((await state(f,item.parent.id)).ai_attempt_count,0);
    assert.deepEqual(await f.one(`select ai_reserved_at,installation_reservation_key,ai_parent_id,ai_parent_episode,ai_attempt_number from private.agent_pulses where id=${lit(p.pulseId)}`),{ai_reserved_at:null,installation_reservation_key:null,ai_parent_id:null,ai_parent_episode:null,ai_attempt_number:null});
    await f.o.q('drop trigger reservation_fault on private.agent_pulse_installation_events;drop function test_harness.reservation_fault()');
    const fresh=await f.candidate(u);assert.equal((await f.value(f.reserve(fresh))).sendAllowed,true);assert.equal((await count(f)).n,1);assert.equal(await f.digest(),hash);
    f.evidence.final={failedReservationComponents:0,normalReservationAfterFault:true,providerCalls:0,ledger:await f.ledgerInvariant()};
  });
  pgtest('Task24 engine fails closed on real Auth cascade lock-timeout abort',async f=>{
    const {runClaimedPulse}=await loadPulse('lib/ai/agent/pulse/engine.ts');const u=await f.owner(),other=await f.owner(),item=await f.candidate(u),p=await f.authority(item.p),base=await f.repository(f.b),hash=await f.digest([u.id]);
    let calls=0;await f.b.q("set lock_timeout='1500ms'");
    const repository={...base,reserveAi:async(...args)=>{calls++;await f.a.q('begin');await f.a.q('delete from auth.users where id='+lit(u.id));const pending=base.reserveAi(...args).then(value=>({value}),error=>({error}));const barrier=await f.waitForBlock();const result=await pending;assert.ok(result.error);assert.equal(f.evidence.rpcErrors.at(-1).sqlstate,'55P03');await f.a.q('commit');f.evidence.races.push({label:'Auth deletion versus engine reservation abort',pids:[f.a.pid,f.b.pid],barrier,sqlstates:['00000','55P03']});throw result.error;}};
    await runClaimedPulse(p,engineDeps(repository));assert.equal(calls,1);assert.equal((await count(f)).n,0);
    for(const table of ['agent_pulse_state','agent_pulses','agent_observations'])assert.equal((await f.one(`select count(*)::int n from private.${table} where user_id=${lit(u.id)}`)).n,0);
    assert.equal((await f.one('select count(*)::int n from auth.users where id='+lit(other.id))).n,1);assert.equal(await f.digest([u.id]),hash);
    f.evidence.final={expectedSQLSTATE:'55P03',abortedReservations:1,providerCalls:0,recreatedOwners:0,ledger:await f.ledgerInvariant()};
  });
  pgtest('Task24 outbound transport rechecks committed revocation and Auth deletion in independent sessions',async f=>{
    const {runClaimedPulse}=await loadPulse('lib/ai/agent/pulse/engine.ts');
    for(const change of ['off','deleted']) {
      const u=await f.owner(),item=await f.candidate(u),p=await f.authority(item.p),base=await f.repository(f.b);let sends=0;
      const repository={...base,reserveAi:async(...args)=>{
        const reservation=await base.reserveAi(...args);assert.equal(reservation.sendAllowed,true);
        await f.a.q('begin');
        if(change==='off')await f.a.one(f.settings(u,1));else await f.a.q('delete from auth.users where id='+lit(u.id));
        await f.a.q('commit');
        f.evidence.preSendBarriers??=[];f.evidence.preSendBarriers.push({change,reservationBackend:f.b.pid,authorityChangeBackend:f.a.pid,committedBeforeTransport:true});
        return reservation;
      }};
      await runClaimedPulse(p,{...engineDeps(repository),fetch:async()=>{sends++;return new Response('{}');},provider:async(ctx,options)=>{
        await options.fetch('https://provider.invalid');return {sourceAlias:ctx.primaryAlias,category:ctx.allowedCategories[0],title:'Review recorded work',advisoryText:'Consider reviewing recorded work.'};
      }});
      assert.equal(sends,0);
      if(change==='deleted')assert.equal((await f.one('select count(*)::int n from private.agent_pulse_state where user_id='+lit(u.id))).n,0);
    }
    assert.equal((await count(f)).n,2);
    f.evidence.final={physicalProviderCalls:0,consumedReservations:2,ledger:await f.ledgerInvariant(),proof:'Two independent backends; explicit commits precede transport. Sequential authority barriers, not extra simultaneous overlap claims.'};
  });
  pgtest('20 actual PostgreSQL dispatch freshness integer boundaries and fractional issued rejection',async f=>{
    const originalClock=(await f.one("select pg_get_functiondef('pg_catalog.clock_timestamp()'::regprocedure) definition")).definition;
    const dispatch=(await f.one("select pg_get_functiondef('public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean)'::regprocedure) definition")).definition;
    const cases=[];let events=0;
    await f.o.q(dispatchTestClock);
    try {
      for(const item of dispatchFreshnessCases()) {
        await f.o.q("select set_config('phase5d.test_tick',"+lit(item.tick)+",false)");
        assert.equal((await f.one('select clock_timestamp()='+lit(item.tick)+'::timestamptz exact')).exact,true);
        const sql=`select public.agent_pulse_claim_dispatch(${lit(item.slot)},${lit(randomUUID())},${lit(item.issued)},false) r`;
        if(item.accepted){assert.deepEqual(await f.value(sql),{slot:item.slot.replace('.000Z','.000000Z'),replay:false,outcome:'disabled',claimCount:0,claims:[]});events++;}
        else await assert.rejects(f.value(sql),{code:'22023'});
        assert.deepEqual(await f.one(`select (select count(*)::int from private.agent_pulse_installation_events) events,
          (select count(*)::int from private.agent_pulses) pulses,(select count(*)::int from private.agent_pulse_state) owners`),{events,pulses:0,owners:0});
        cases.push({name:item.name,tick:item.tick,accepted:item.accepted,sqlstate:item.accepted?'00000':'22023'});
      }
      assert.equal((await f.one("select pg_get_functiondef('public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean)'::regprocedure) definition")).definition,dispatch);
    } finally {await f.o.q(restoreDispatchTestClock);}
    assert.equal((await f.one("select pg_get_functiondef('pg_catalog.clock_timestamp()'::regprocedure) definition")).definition,originalClock);
    f.evidence.final={freshnessCases:cases,events,ownerEffects:0,clockRestored:true,dispatchDefinitionUnchanged:true};
  });
}
