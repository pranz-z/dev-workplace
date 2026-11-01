import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './phase5d-one-shot-fixture.mjs';
const slot='2026-11-01T08:00:00Z',model='fixture-model';
export async function prepared(f){
 await f.at('2026-11-01T07:59:00Z');await f.db.query("update public.profiles set time_zone='UTC' where id=$1",[f.owner]);
 await f.db.query("update public.tasks set status='Todo',due_date='2026-11-01' where id=$1",[f.task]);
 await f.enable();const first=(await f.claim()).claims[0];await f.publish(first);
 await f.sql("select public.agent_pulse_finish($1,$2,$3,$4,'none') r",[first.userId,first.pulseId,first.leaseToken,first.fence]);
 const o=await f.one("select * from private.agent_observations where user_id=$1 and target_id=$2 and family='deadline'",[f.owner,f.task]);assert.ok(o);
 const v=await f.sql('select public.agent_pulse_one_shot_preview($1,$2) r',[f.owner,o.id]);
 const auth=await f.sql('select public.agent_pulse_one_shot_create($1,$2,$3,$4,$5,$6,$7,$8) r',[f.owner,o.id,o.content_revision,slot,model,o.source_token,'a'.repeat(64),JSON.stringify({...v.binding,model,contextFingerprint:'a'.repeat(64)})]);
 return {o,auth};
}
export const consume=(f,a,auth,changes={})=>f.sql('select public.agent_pulse_one_shot_consume($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r',
 [a.userId,a.pulseId,a.leaseToken,a.fence,a.settingsRevision,auth.binding.id,changes.credential??a.oneShotAdmission?.credential,
 changes.provider??'gemini',changes.model??model,changes.fingerprint??'a'.repeat(64)]);
test('only fresh claim receives admission; replay racing original cannot consume',async t=>{
 const f=await fixture(t),{auth}=await prepared(f);await f.at('2026-11-01T08:00:01Z');
 const batch=await f.claim(),a=batch.claims[0];assert.ok(a.oneShotAdmission?.credential,'fresh credential required');
 assert.equal(a.oneShotAdmission.authorizationId,auth.binding.id);
 const replay=await f.claim();assert.equal(replay.replay,true);assert.equal(replay.claims[0].oneShotAdmission,undefined);
 const stored=await f.one('select admission_hash from private.agent_pulse_one_shot_authorizations');assert.notEqual(stored.admission_hash,a.oneShotAdmission.credential);
 await f.publish(a);
 const denied=await consume(f,replay.claims[0],auth,{credential:'0'.repeat(64)});assert.equal(denied.sendAllowed,false);
 const r=await consume(f,a,auth);assert.equal(r.sendAllowed,true);assert.equal(r.reserved,true);
 assert.equal((await consume(f,a,auth)).sendAllowed,false);
 assert.equal((await f.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n,1);
 const s=await f.sql('select public.agent_pulse_get_settings($1) r',[f.owner]);assert.equal(s.aiConsented,false);assert.deepEqual(s.aiProjectIds,[]);
});
for(const [name,change] of [
 ['model',async()=>({model:'changed-model'})],
 ['seen',async(f,a,auth)=>{await f.db.query('update private.agent_observations set seen_content_revision=content_revision where id=$1',[auth.binding.parentId]);return {};}],
 ['revision',async(f,a,auth)=>{await f.db.query('update private.agent_observations set content_revision=content_revision+1 where id=$1',[auth.binding.parentId]);return {};}],
 ['expiry equality',async f=>{await f.at('2026-11-01T08:10:00Z');return {};}],
])test('consume blocks '+name+' without reservation',async t=>{
 const f=await fixture(t),{auth}=await prepared(f);await f.at('2026-11-01T08:00:01Z');const a=(await f.claim()).claims[0];await f.publish(a);
 const changes=await change(f,a,auth);const r=await consume(f,a,auth,changes);assert.equal(r.sendAllowed,false);
 assert.equal((await f.one("select count(*)::int n from private.agent_pulse_installation_events where event_kind='provider_reservation'")).n,0);
});
