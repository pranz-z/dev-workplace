import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,seedOneShot} from './phase5d-one-shot-fixture.mjs';
import {loadPulse} from './phase5d-test-support.mjs';
const names={agent_pulse_get_settings:['p_user_id'],agent_pulse_read_source:['p_user_id','p_pulse_id','p_lease_token','p_fence'],
 agent_pulse_recover:['p_user_id','p_pulse_id'],agent_pulse_finish:['p_user_id','p_pulse_id','p_lease_token','p_fence','p_ai_outcome'],
 agent_pulse_publish_deterministic:['p_user_id','p_pulse_id','p_lease_token','p_fence','p_settings_revision','p_commit_id','p_scan','p_baseline'],
 agent_pulse_claim_dispatch:['p_slot','p_nonce','p_issued_at','p_processing_enabled'],agent_pulse_retain:['p_user_id','p_limit'],agent_pulse_retain_installation:['p_limit'],
 agent_pulse_one_shot_context:['p_user_id','p_pulse_id','p_lease_token','p_fence','p_authorization_id'],
 agent_pulse_one_shot_consume:['p_user_id','p_pulse_id','p_lease_token','p_fence','p_settings_revision','p_authorization_id','p_credential','p_provider','p_model','p_context_fingerprint'],
 agent_pulse_one_shot_record:['p_user_id','p_pulse_id','p_lease_token','p_fence','p_authorization_id','p_event','p_reason'],
 agent_pulse_publish_ai:['p_user_id','p_pulse_id','p_lease_token','p_fence','p_settings_revision','p_idea']};
async function harness(t){
 const f=await fixture(t),seed=await seedOneShot(f);await f.at('2026-11-01T08:00:01Z');
 const {createPulseRepository}=await loadPulse('lib/ai/agent/pulse/db.ts');let sends=0;const calls=[];
 const repository=createPulseRepository({rpc:async(name,args)=>{calls.push(name);assert.ok(names[name],name);
  const values=names[name].map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]);
  return {data:await f.sql(`select public.${name}(${values.map((_,i)=>'$'+(i+1))}) r`,values),error:null};}});
 const engine=await loadPulse('lib/ai/agent/pulse/engine.ts');
 const deps={repository,signal:new AbortController().signal,clock:{now:()=>Date.parse('2026-11-01T08:00:01Z'),monotonic:()=>0},
  providerMetadata:()=>({configured:true,provider:'gemini',model:'fixture-model'}),
  fetch:async()=>{sends++;return new Response('{}');},
  provider:async(ctx,options)=>{assert.equal(ctx.contents,seed.contents);assert.equal(JSON.parse(ctx.contents).signals.length,1);
   await options.fetch('https://fixture.invalid',{});return {sourceAlias:ctx.primaryAlias,category:ctx.allowedCategories[0],title:'Review the deadline',advisoryText:'Consider reviewing the recorded work.'};}};
 return {...f,...seed,deps,calls,engine,sends:()=>sends,run:()=>engine.runPulseDispatch({scheduledSlot:'2026-11-01T08:00:00Z',nonce:crypto.randomUUID(),issuedAt:Date.parse('2026-11-01T08:00:01Z')/1000,processingEnabled:true},deps)};
}
test('natural exact path sends once without broad consent and publishes an advisory',async t=>{
 const h=await harness(t);const r=await h.run();assert.equal(r.processed,1);assert.equal(h.sends(),1);
 const a=await h.one('select status,consumed_at,publication_completed_at from private.agent_pulse_one_shot_authorizations');assert.equal(a.status,'completed');assert.ok(a.publication_completed_at);
 const s=await h.sql('select public.agent_pulse_get_settings($1) r',[h.owner]);assert.equal(s.mode,'workspace');assert.equal(s.aiConsented,false);assert.deepEqual(s.aiProjectIds,[]);
 assert.equal((await h.one("select count(*)::int n from private.agent_observations where kind='idea'")).n,1);
 await h.run();assert.equal(h.sends(),1);
});
for(const failure of ['model','transport','output'])test('one-shot '+failure+' failure never falls through or retries',async t=>{
 const h=await harness(t);
 if(failure==='model')h.deps.providerMetadata=()=>({configured:true,provider:'gemini',model:'different'});
 else if(failure==='transport')h.deps.provider=async(ctx,options)=>{await options.fetch('https://fixture.invalid',{});throw Error('Synthetic uncertainty');};
 else h.deps.provider=async()=>({ok:false,code:'AI_MALFORMED'});
 await h.run();assert.equal(h.sends(),failure==='transport'?1:0);assert.equal(h.calls.includes('agent_pulse_reserve_ai'),false);
 await h.run();assert.equal(h.sends(),failure==='transport'?1:0);
});
test('a racing replay neither consumes nor terminalizes the original fresh worker',async t=>{
 const h=await harness(t),original=await h.deps.repository.claimDispatch('2026-11-01T08:00:00Z',crypto.randomUUID(),'2026-11-01T08:00:01Z',true);
 await h.run();assert.equal(h.sends(),0);
 assert.equal((await h.one('select status from private.agent_pulses where id=$1',[original.claims[0].pulseId])).status,'running');
 h.deps.repository.claimDispatch=async()=>original;await h.run();assert.equal(h.sends(),1);
});
test('invalidated one-shot owns admission even when persistent AI would otherwise qualify',async t=>{
 const h=await harness(t);await h.at('2026-11-01T07:59:59Z');
 await h.sql('select public.agent_pulse_set_settings($1,$2,$3) r',[h.owner,1,JSON.stringify({mode:'workspace_ai',cadence:'normal',checksConsent:true,aiConsent:true,aiProjectIds:[h.project]})]);
 await h.at('2026-11-01T08:00:01Z');await h.run();assert.equal(h.sends(),0);
 assert.equal(h.calls.includes('agent_pulse_reserve_ai'),false);
 assert.equal((await h.one('select status from private.agent_pulse_one_shot_authorizations')).status,'blocked');
});
test('a terminal accounting receipt never permits physical transport',async t=>{
 const h=await harness(t),original=h.deps.repository.recordOneShot;
 h.deps.repository.recordOneShot=async(a,id,event,reason)=>{
  if(event==='send_attempted')await original(a,id,'failed','SOURCE_CHANGED');
  return original(a,id,event,reason);
 };
 await h.run();assert.equal(h.sends(),0);
 assert.equal((await h.one('select status from private.agent_pulse_one_shot_authorizations')).status,'failed');
});
