import assert from 'node:assert/strict';
import test from 'node:test';
import {withPostgresFixture,lit,rpc,json} from './phase5d-one-shot-postgres-fixture.mjs';
import {loadPulse} from './phase5d-test-support.mjs';
const model='fixture-model';
async function clock(f){
 await f.o.q("create table private.one_shot_test_time(at timestamptz);insert into private.one_shot_test_time values('2026-11-01T07:59:00Z');create function private.one_shot_test_clock() returns timestamptz language sql stable as $$select at from private.one_shot_test_time$$");
 const definitions=JSON.parse(await f.o.q("select json_agg(pg_get_functiondef(oid)) from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) and proname like 'agent_pulse%'"));
 for(const definition of definitions)await f.o.q(definition.replaceAll('clock_timestamp()','private.one_shot_test_clock()'));
 await f.o.q("alter table private.agent_observations alter first_noticed_at set default private.one_shot_test_clock(),alter last_checked_at set default private.one_shot_test_clock(),alter last_changed_at set default private.one_shot_test_clock();alter table private.agent_pulse_one_shot_authorizations alter created_at set default private.one_shot_test_clock();alter table private.agent_pulse_installation_events alter created_at set default private.one_shot_test_clock()");
}
const at=(f,time)=>f.o.q('update private.one_shot_test_time set at='+lit(time));
async function prepare(f){
 const user=await f.owner();await f.o.q(`update public.tasks set due_date='2026-11-01' where id=${lit(user.task)}`);
 await f.o.q(`update private.agent_pulse_state set next_due_at='2026-11-01T04:00:00Z' where user_id=${lit(user.id)}`);
 const batch=await f.value(`select public.agent_pulse_claim_dispatch('2026-11-01T04:00:00Z',gen_random_uuid(),'2026-11-01T07:59:00Z',true) r`),first=batch.claims.find(p=>p.userId===user.id);assert.ok(first);
 await f.value(f.publication(first,await f.scan(first)));await f.value(f.finish(first));
 const parent=await f.one(`select id from private.agent_observations where user_id=${lit(user.id)} and target_id=${lit(user.task)} and family='deadline'`);
 const preview=await f.value(rpc('agent_pulse_one_shot_preview',user.id,parent.id));assert.ok(preview);
 const domain=await loadPulse('lib/ai/agent/pulse/one-shot.ts'),binding={...preview.binding,model,contextFingerprint:''};
 const context=domain.buildOneShotContext(preview.source,domain.oneShotParents(preview.source,binding),binding,{configured:true,provider:'gemini',model},'preview');assert.equal(context.ok,true);
 const fingerprint=domain.oneShotFingerprint(context.context.contents);
 const grant=await f.value(rpc('agent_pulse_one_shot_create',user.id,parent.id,binding.contentRevision,binding.slot,model,binding.sourceToken,fingerprint,JSON.stringify({...binding,contextFingerprint:fingerprint})));
 await at(f,'2026-11-01T08:00:01Z');
 const next=await f.value("select public.agent_pulse_claim_dispatch('2026-11-01T08:00:00Z',gen_random_uuid(),'2026-11-01T08:00:01Z',true) r"),p=next.claims.find(x=>x.userId===user.id);assert.ok(p?.oneShotAdmission);
 await f.value(f.publication(p,await f.scan(p)));
 const consume=rpc('agent_pulse_one_shot_consume',user.id,p.pulseId,p.leaseToken,p.fence,p.settingsRevision,grant.binding.id,p.oneShotAdmission.credential,'gemini',model,fingerprint);
 return {user,parent,grant,p,consume};
}
test('true PostgreSQL duplicate consume and cancel-versus-consume serialize with no second allowance',async t=>withPostgresFixture(t,async f=>{
 await clock(f);const x=await prepare(f);
 const [first,second]=await f.race('duplicate exact consume',x.consume,x.consume);
 assert.equal(first.r.sendAllowed,true);assert.equal(second.r.sendAllowed,false);
 assert.equal((await f.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n,1);
 const cancelled=await f.value(rpc('agent_pulse_one_shot_cancel',x.user.id,x.grant.binding.id));assert.equal(cancelled.status,'consumed');
}));
test('true PostgreSQL cancellation wins before consume',async t=>withPostgresFixture(t,async f=>{
 await clock(f);const x=await prepare(f);
 const [cancel,consume]=await f.race('cancel versus consume',rpc('agent_pulse_one_shot_cancel',x.user.id,x.grant.binding.id),x.consume);
 assert.equal(cancel.r.status,'cancelled');assert.equal(consume.r.sendAllowed,false);
}));
test('true PostgreSQL expiry wins before consume',async t=>withPostgresFixture(t,async f=>{
 await clock(f);const x=await prepare(f);await at(f,'2026-11-01T08:10:00Z');
 const [expiry,consume]=await f.race('expiry versus consume',"select public.agent_pulse_retain_installation(20) r",x.consume);
 assert.ok(expiry.r);assert.equal(consume.r.sendAllowed,false);
}));
test('true PostgreSQL replay racing original has no admission and cannot spend allowance',async t=>withPostgresFixture(t,async f=>{
 await clock(f);const x=await prepare(f);
 const replay=await f.value("select public.agent_pulse_claim_dispatch('2026-11-01T08:00:00Z',gen_random_uuid(),'2026-11-01T08:00:01Z',true) r");
 assert.equal(replay.replay,true);assert.equal(replay.claims[0].oneShotAdmission,undefined);
 const without=rpc('agent_pulse_one_shot_consume',x.user.id,x.p.pulseId,x.p.leaseToken,x.p.fence,x.p.settingsRevision,x.grant.binding.id,null,'gemini',model,x.grant.binding.contextFingerprint);
 const [denied,allowed]=await f.race('replay without credential versus original',without,x.consume);
 assert.equal(denied.r.sendAllowed,false);assert.equal(allowed.r.sendAllowed,true);
}));
test('true PostgreSQL normal and one-shot share the installation budget',async t=>withPostgresFixture(t,async f=>{
 await clock(f);const x=await prepare(f),normal=await f.owner();
 f.evidence.step='normal settings';
 const settings=await f.value(`select public.agent_pulse_set_settings(${lit(normal.id)},1,${json({mode:'workspace_ai',cadence:'normal',checksConsent:true,aiConsent:true,aiProjectIds:[normal.project]})}) r`);
 const state=await f.one('select fence from private.agent_pulse_state where user_id='+lit(normal.id));
 const p={userId:normal.id,pulseId:crypto.randomUUID(),leaseToken:crypto.randomUUID(),fence:state.fence+1,settingsRevision:settings.settingsRevision,slot:'2026-11-01T08:00:00Z'};
 f.evidence.step='normal Pulse insert';
 await f.o.q(`insert into private.agent_pulses(id,user_id,scheduled_slot,dispatch_nonce,started_at,fence,lease_token,lease_expires_at,settings_revision,policy_version)
  values(${lit(p.pulseId)},${lit(p.userId)},${lit(p.slot)},gen_random_uuid(),private.one_shot_test_clock(),${p.fence},${lit(p.leaseToken)},private.one_shot_test_clock()+interval '90 seconds',${p.settingsRevision},'pulse-v1');
  update private.agent_pulse_state set fence=${p.fence},lease_token=${lit(p.leaseToken)},lease_expires_at=private.one_shot_test_clock()+interval '90 seconds' where user_id=${lit(p.userId)}`);
 f.evidence.step='normal deterministic publication';await f.value(f.publication(p,await f.scan(p)));
 const parent=await f.one(`select id,episode from private.agent_observations where user_id=${lit(normal.id)} and target_id=${lit(normal.task)} and family='deadline'`);assert.ok(parent);
 f.evidence.step='seed installation budget';for(let i=0;i<3;i++)await f.o.q("insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) values('provider_reservation',gen_random_uuid(),private.one_shot_test_clock())");
 f.evidence.step='budget race';
 const [allowed,denied]=await f.race('normal versus one-shot last installation allowance',rpc('agent_pulse_reserve_ai',p.userId,p.pulseId,p.leaseToken,p.fence,p.settingsRevision,parent.id,parent.episode),x.consume);
 assert.equal(allowed.r.sendAllowed,true);assert.equal(denied.r.sendAllowed,false);
 assert.equal((await f.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n,4);
}));
test('true PostgreSQL source invalidation prevents publication and never refunds consumption',async t=>withPostgresFixture(t,async f=>{
 await clock(f);const x=await prepare(f);assert.equal((await f.value(x.consume)).sendAllowed,true);
 await f.value(rpc('agent_pulse_one_shot_record',x.user.id,x.p.pulseId,x.p.leaseToken,x.p.fence,x.grant.binding.id,'output_accepted',null));
 const publication=`select public.agent_pulse_publish_ai(${[x.p.userId,x.p.pulseId,x.p.leaseToken,x.p.fence,x.p.settingsRevision].map(lit).join(',')},${json({category:'review_deadline',title:'Review work',summary:'Consider reviewing this task.'})}) r`;
 await f.race('memory/source invalidation versus publication',rpc('agent_pulse_clear_memory',x.user.id,x.p.settingsRevision),publication,{secondCode:'40001'});
 const row=await f.one('select status,consumed_at,provider_reservation_id from private.agent_pulse_one_shot_authorizations');assert.equal(row.status,'failed');assert.ok(row.consumed_at);assert.ok(row.provider_reservation_id);
 assert.equal((await f.one("select count(*)::int n from private.agent_observations where kind='idea'")).n,0);
}));
