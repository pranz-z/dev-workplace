import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './phase5d-one-shot-fixture.mjs';
export async function candidate(f){
 await f.db.query("update public.profiles set time_zone='UTC' where id=$1",[f.owner]);
 await f.db.query("update public.tasks set status='Todo',due_date=clock_timestamp()::date where id=$1",[f.task]);
 await f.enable();const batch=await f.claim(),a=batch.claims[0];assert.ok(a);
 await f.publish(a);await f.sql('select public.agent_pulse_finish($1,$2,$3,$4,\'none\') r',[a.userId,a.pulseId,a.leaseToken,a.fence]);
 const o=await f.one("select * from private.agent_observations where user_id=$1 and target_id=$2 and family='deadline'",[f.owner,f.task]);assert.ok(o);
 return {a,o,preview:await f.sql('select public.agent_pulse_one_shot_preview($1,$2) r',[f.owner,o.id])};
}
export const create=(f,o,v,changes={})=>f.sql('select public.agent_pulse_one_shot_create($1,$2,$3,$4,$5,$6,$7,$8) r',
 [f.owner,o.id,changes.revision??o.content_revision,changes.slot??v.binding.slot,changes.model??'fixture-model',changes.sourceToken??o.source_token,changes.fingerprint??'a'.repeat(64),
 JSON.stringify({...v.binding,model:changes.model??'fixture-model',contextFingerprint:changes.fingerprint??'a'.repeat(64)})]);
test('preview is read only, next slot is canonical, create does not broaden consent or ACK',async t=>{
 const f=await fixture(t),{o,preview:v}=await candidate(f);
 assert.equal(v.binding.parentId,o.id);assert.equal(v.binding.contentRevision,1);
 assert.equal((await f.one('select count(*)::int n from private.agent_pulse_one_shot_authorizations')).n,0);
 const r=await create(f,o,v);assert.equal(r.status,'pending');assert.equal(r.binding.slot,v.binding.slot);
 const s=await f.sql('select public.agent_pulse_get_settings($1) r',[f.owner]);
 assert.equal(s.mode,'workspace');assert.equal(s.aiConsented,false);assert.deepEqual(s.aiProjectIds,[]);
 assert.deepEqual(await f.one('select content_revision,seen_content_revision from private.agent_observations where id=$1',[o.id]),{content_revision:1,seen_content_revision:0});
 await assert.rejects(create(f,o,v),/pending|CAPACITY|existing/i);
 await f.sql('select public.agent_pulse_one_shot_cancel($1,$2) r',[f.owner,r.binding.id]);
 assert.equal((await f.one('select status from private.agent_pulse_one_shot_authorizations')).status,'cancelled');
 await assert.rejects(f.db.query("update private.agent_pulse_one_shot_authorizations set status='pending'"),/transition|immutable/i);
});
test('owner, revision, slot and source mismatches fail closed',async t=>{
 const f=await fixture(t),{o,preview:v}=await candidate(f);
 assert.equal(await f.sql('select public.agent_pulse_one_shot_preview($1,$2) r',[f.other,o.id]),null);
 for(const changes of [{revision:2},{slot:new Date(Date.parse(v.binding.slot)+14_400_000).toISOString()},{sourceToken:'b'.repeat(64)}])
  await assert.rejects(create(f,o,v,changes),/changed|invalid|SOURCE|SLOT/i);
 await f.db.query('update private.agent_observations set seen_content_revision=content_revision where id=$1',[o.id]);
 assert.equal(await f.sql('select public.agent_pulse_one_shot_preview($1,$2) r',[f.owner,o.id]),null);
});
test('locked create rejects a settings change after canonical preview was reviewed',async t=>{
 const f=await fixture(t),{o,preview:v}=await candidate(f);
 await f.db.query('update private.agent_pulse_state set settings_revision=settings_revision+1 where user_id=$1',[f.owner]);
 await assert.rejects(create(f,o,v),/CHANGED|changed/);
});
