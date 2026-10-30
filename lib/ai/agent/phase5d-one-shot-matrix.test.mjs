import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,seedOneShot} from './phase5d-one-shot-fixture.mjs';
const consume=(f,a,auth,override={})=>f.sql('select public.agent_pulse_one_shot_consume($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r',
 [override.owner??a.userId,override.pulse??a.pulseId,override.lease??a.leaseToken,override.fence??a.fence,a.settingsRevision,override.id??auth.binding.id,
 override.credential??a.oneShotAdmission.credential,override.provider??'gemini',override.model??'fixture-model',override.fingerprint??auth.binding.contextFingerprint]);
test('exact capability denial matrix and immutable identity',async t=>{
 const f=await fixture(t),{auth}=await seedOneShot(f);await f.at('2026-11-01T08:00:01Z');const a=(await f.claim()).claims[0];await f.publish(a);
 const mutateIdentity=async(field,value)=>{await f.db.exec('alter table private.agent_pulse_one_shot_authorizations disable trigger agent_pulse_one_shot_guard');
  await f.db.query(`update private.agent_pulse_one_shot_authorizations set ${field}=$1 where id=$2`,[value,auth.binding.id]);
  await f.db.exec('alter table private.agent_pulse_one_shot_authorizations enable trigger agent_pulse_one_shot_guard');};
 const cases=[
  ['wrong owner',async()=>({owner:f.other})],['wrong pulse',async()=>({pulse:crypto.randomUUID()})],
  ['wrong lease',async()=>({lease:crypto.randomUUID()})],['wrong fence',async()=>({fence:a.fence+1})],
  ['wrong authorization',async()=>({id:crypto.randomUUID()})],['credential cannot be reconstructed',async()=>({credential:'0'.repeat(64)})],
  ['wrong provider',async()=>({provider:'other'})],['wrong model',async()=>({model:'other'})],
  ['wrong context fingerprint',async()=>({fingerprint:'f'.repeat(64)})],
  ['wrong project binding',async()=>{await mutateIdentity('project_id',f.other);return {};}],
  ['wrong parent binding',async()=>{await mutateIdentity('observation_id',crypto.randomUUID());return {};}],
  ['wrong revision binding',async()=>{await mutateIdentity('content_revision',2);return {};}],
  ['wrong episode binding',async()=>{await mutateIdentity('episode',2);return {};}],
  ['wrong family binding',async()=>{await mutateIdentity('family','quiet_project');return {};}],
  ['pre-slot',async()=>{await f.at('2026-11-01T07:59:59Z');return {};}],
  ['later slot',async()=>{await f.at('2026-11-01T12:00:00Z');return {};}],
  ['parent seen',async()=>{await f.db.query('update private.agent_observations set seen_content_revision=content_revision where id=$1',[auth.binding.parentId]);return {};}],
  ['parent resolved',async()=>{await f.db.query("update private.agent_observations set state='resolved' where id=$1",[auth.binding.parentId]);return {};}],
  ['parent deleted',async()=>{await f.db.query('delete from private.agent_observations where id=$1',[auth.binding.parentId]);return {};}],
  ['project deleted',async()=>{await f.db.query('delete from public.projects where id=$1',[f.project]);return {};}],
  ['source changed',async()=>{await f.db.query("update public.tasks set title='Changed source' where id=$1",[f.task]);return {};}],
  ['evidence expiry equality',async()=>{await f.db.query('update private.agent_observations set evidence_valid_until=private.one_shot_test_clock() where id=$1',[auth.binding.parentId]);return {};}],
  ['attempt terminal',async()=>{await f.db.query('update private.agent_observations set ai_attempt_count=1,ai_last_attempt_at=private.one_shot_test_clock(),ai_attempt_terminal=true where id=$1',[auth.binding.parentId]);return {};}],
  ['attempt limit',async()=>{await f.db.query('update private.agent_observations set ai_attempt_count=2,ai_last_attempt_at=private.one_shot_test_clock() where id=$1',[auth.binding.parentId]);return {};}],
  ['attempt cooldown',async()=>{await f.db.query('update private.agent_observations set ai_attempt_count=1,ai_last_attempt_at=private.one_shot_test_clock() where id=$1',[auth.binding.parentId]);return {};}],
  ['installation budget',async()=>{for(let i=0;i<4;i++)await f.db.exec("insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) values('provider_reservation',gen_random_uuid(),private.one_shot_test_clock())");return {};}],
  ...['owner request budget','owner idea budget'].map(name=>[name,async()=>{
   for(let i=0;i<2;i++)await f.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,ai_reserved_at,installation_reservation_key,ai_parent_id,ai_parent_episode,ai_attempt_number,idea_accepted_at)
    values($1,timestamptz '2026-11-01T08:00:00Z'-($2::integer+3)*interval '4 hours',gen_random_uuid(),'succeeded',private.one_shot_test_clock()-interval '25 hours',private.one_shot_test_clock()-interval '24 hours',1,gen_random_uuid(),private.one_shot_test_clock()-interval '25 hours'+interval '90 seconds',1,'pulse-v1',
    case when $3 then private.one_shot_test_clock()-interval '25 hours' else private.one_shot_test_clock() end,gen_random_uuid(),$4,1,1,case when $3 then private.one_shot_test_clock() end)`,[f.owner,i,name==='owner idea budget',auth.binding.parentId]);return {};
  }]),
 ];
 for(const [name,change] of cases)await t.test(name,async()=>{await f.db.exec('begin');try{const override=await change();const r=await consume(f,a,auth,override);assert.equal(r.sendAllowed,false);
  assert.equal((await f.one('select ai_reserved_at from private.agent_pulses where id=$1',[a.pulseId])).ai_reserved_at,null);
 }finally{await f.db.exec('rollback');}});
 for(const field of ['project_id','observation_id','content_revision','episode','natural_slot','model','max_provider_requests','context_fingerprint'])await t.test('immutable '+field,async()=>{
  const values={project_id:f.other,observation_id:f.other,content_revision:2,episode:2,natural_slot:'2026-11-01T12:00:00Z',model:'other',max_provider_requests:2,context_fingerprint:'f'.repeat(64)};
  await assert.rejects(f.db.query(`update private.agent_pulse_one_shot_authorizations set ${field}=$1`,[values[field]]),/Immutable|check constraint/);
 });
});
