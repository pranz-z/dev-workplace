import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,seedOneShot} from './phase5d-one-shot-fixture.mjs';
async function reviewed(f){const data=await seedOneShot(f);await f.sql('select public.agent_pulse_one_shot_cancel($1,$2) r',[f.owner,data.auth.binding.id]);return data;}
async function again(f,auth){const preview=await f.sql('select public.agent_pulse_one_shot_preview($1,$2) r',[f.owner,auth.binding.parentId]);
 const expected={...preview.binding,model:auth.binding.model,contextFingerprint:auth.binding.contextFingerprint};
 return f.sql('select public.agent_pulse_one_shot_create($1,$2,$3,$4,$5,$6,$7,$8) r',[f.owner,auth.binding.parentId,auth.binding.contentRevision,auth.binding.slot,auth.binding.model,auth.binding.sourceToken,auth.binding.contextFingerprint,JSON.stringify(expected)]);
}
const copies=(f,auth,old)=>f.db.query(`insert into private.agent_pulse_one_shot_authorizations(user_id,project_id,observation_id,content_revision,episode,family,source_token,context_fingerprint,natural_slot,provider,model,settings_revision,expires_at,status,created_at,terminal_at,terminal_reason)
 select user_id,project_id,observation_id,content_revision,episode,family,source_token,context_fingerprint,
 ${old?"natural_slot-interval '32 days'":"natural_slot"},provider,model,settings_revision,${old?"expires_at-interval '32 days'":"expires_at"},'cancelled',
 ${old?"created_at-interval '32 days'":"created_at"},${old?"terminal_at-interval '32 days'":"terminal_at"},'CANCELLED'
 from private.agent_pulse_one_shot_authorizations cross join generate_series(1,199) where id=$1`,[auth.binding.id]);
test('fresh terminal accounting is never pruned merely to admit another authorization',async t=>{
 const f=await fixture(t),{auth}=await reviewed(f);await copies(f,auth,false);
 await assert.rejects(again(f,auth),/CAPACITY/);
 assert.equal((await f.one('select count(*)::int n from private.agent_pulse_one_shot_authorizations')).n,200);
});
test('expired terminal metadata is safely pruned before capacity rejection',async t=>{
 const f=await fixture(t),{auth}=await reviewed(f);await copies(f,auth,true);
 const next=await again(f,auth);assert.equal(next.status,'pending');assert.notEqual(next.binding.id,auth.binding.id);
 assert.equal((await f.one('select count(*)::int n from private.agent_pulse_one_shot_authorizations')).n,2);
 assert.equal((await f.one('select status from private.agent_pulse_one_shot_authorizations where id=$1',[auth.binding.id])).status,'cancelled');
});
test('owner scheduling ambiguity prevents preview instead of silently choosing a later slot',async t=>{
 const f=await fixture(t),{auth}=await reviewed(f);
 for(const due of ['2026-11-01T04:00:00Z','2026-11-01T12:00:00Z']){
  await f.db.query('update private.agent_pulse_state set next_due_at=$1 where user_id=$2',[due,f.owner]);
  assert.equal(await f.sql('select public.agent_pulse_one_shot_preview($1,$2) r',[f.owner,auth.binding.parentId]),null);
 }
});
