import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,seedOneShot} from './phase5d-one-shot-fixture.mjs';
async function consumed(f){
 const {auth}=await seedOneShot(f);await f.at('2026-11-01T08:00:01Z');const a=(await f.claim()).claims[0];await f.publish(a);
 const r=await f.sql('select public.agent_pulse_one_shot_consume($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r',
 [a.userId,a.pulseId,a.leaseToken,a.fence,a.settingsRevision,auth.binding.id,a.oneShotAdmission.credential,'gemini','fixture-model',auth.binding.contextFingerprint]);assert.equal(r.sendAllowed,true);
 return {a,auth};
}
const record=(f,a,id,event)=>f.sql('select public.agent_pulse_one_shot_record($1,$2,$3,$4,$5,$6,null) r',[a.userId,a.pulseId,a.leaseToken,a.fence,id,event]);
const publish=(f,a)=>f.sql('select public.agent_pulse_publish_ai($1,$2,$3,$4,$5,$6) r',[a.userId,a.pulseId,a.leaseToken,a.fence,a.settingsRevision,JSON.stringify({category:'review_deadline',title:'Review recorded work',summary:'Consider reviewing this task.'})]);
test('accepted one-shot idea remains visible without persistent consent, after execution expiry and audit pruning',async t=>{
 const f=await fixture(t),{a,auth}=await consumed(f);await record(f,a,auth.binding.id,'output_accepted');
 const r=await publish(f,a);assert.equal(r.accepted,true);
 const read=()=>f.sql('select public.agent_pulse_get_observation($1,$2) r',[f.owner,r.id]);
 const before=await read();assert.equal(before.stale,false);assert.equal(before.summary,'Consider reviewing this task.');
 await f.at('2026-11-01T08:11:00Z');const after=await read();assert.equal(after.stale,false);assert.equal(after.summary,before.summary);
 // Simulate metadata being unavailable after approved pruning; accepted provenance must remain on the idea header.
 await f.db.query('delete from private.agent_pulse_one_shot_authorizations where id=$1',[auth.binding.id]);
 assert.equal((await read()).stale,false);
});
test('memory clear invalidates pending permission without ACK or reservation',async t=>{
 const f=await fixture(t),{auth}=await seedOneShot(f);
 await f.sql('select public.agent_pulse_clear_memory($1,$2) r',[f.owner,auth.binding.settingsRevision]);
 const row=await f.one('select status,terminal_reason,consumed_at from private.agent_pulse_one_shot_authorizations');
 assert.equal(row.status,'blocked');assert.equal(row.terminal_reason,'SOURCE_CLEARED');assert.equal(row.consumed_at,null);
 assert.equal((await f.one('select count(*)::int n from private.agent_observations')).n,0);
});
test('memory clear after consumption cannot refund allowance or permit publication',async t=>{
 const f=await fixture(t),{a,auth}=await consumed(f);
 await f.sql('select public.agent_pulse_clear_memory($1,$2) r',[f.owner,auth.binding.settingsRevision]);
 const row=await f.one('select status,consumed_at,provider_reservation_id from private.agent_pulse_one_shot_authorizations');
 assert.equal(row.status,'failed');assert.ok(row.consumed_at);assert.ok(row.provider_reservation_id);
 await assert.rejects(publish(f,a),/AUTHORITY_LOST/);
});
test('missing dispatch effectively expires without a write and bounded maintenance materializes expiry',async t=>{
 const f=await fixture(t);await seedOneShot(f);await f.at('2026-11-01T08:10:00Z');
 const data=await f.sql('select public.agent_pulse_one_shot_list($1) r',[f.owner]);assert.equal(data.items[0].status,'expired');
 assert.equal((await f.one('select status from private.agent_pulse_one_shot_authorizations')).status,'pending');
 await f.sql('select public.agent_pulse_retain_installation(20) r');
 assert.equal((await f.one('select status from private.agent_pulse_one_shot_authorizations')).status,'expired');
 assert.equal((await f.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n,0);
});

for(const target of ['task','project'])test(`authorization audit hides retained signal text after ${target} deletion`,async t=>{
 const f=await fixture(t);await seedOneShot(f);
 const before=await f.sql('select public.agent_pulse_one_shot_list($1) r',[f.owner]);assert.ok(before.items[0].signalTitle);
 await f.db.query(target==='task'?'delete from public.tasks where id=$1':'delete from public.projects where id=$1',[target==='task'?f.task:f.project]);
 const after=await f.sql('select public.agent_pulse_one_shot_list($1) r',[f.owner]);
 assert.equal(after.items[0].signalTitle,null);
 assert.equal(after.items[0].status,'blocked');
 assert.equal(after.items[0].accounting.allowanceConsumed,false);
 assert.equal((await f.one('select count(*)::int n from private.agent_observations where kind=\'signal\'')).n>0,true);
});
