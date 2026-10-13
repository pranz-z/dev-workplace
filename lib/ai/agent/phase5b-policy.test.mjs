import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {fixture} from './phase5b-fixture.mjs';
Error.stackTraceLimit=0;
async function source(f,patch){
 const row=await f.one('select title,description,status,target_date::text as "targetDate",updated_at from public.milestones where id=$1',[f.milestone]);
 const before={projectId:f.project,...Object.fromEntries(Object.keys(patch).map(k=>[k,row[k]]))};
 const a={id:randomUUID(),type:'update_milestone',entityId:f.milestone,taskId:null,projectId:f.project,title:row.title,payload:patch,before,expectedUpdatedAt:row.updated_at.toISOString(),diff:Object.entries(patch).map(([field,after])=>({field,before:row[field],after}))};
 const b=(await f.one('select public.save_agent_proposal_batch($1,$2) r',[f.owner,JSON.stringify([a])])).r;
 const result=(await f.one('select public.apply_agent_milestone_action($1,$2,$3) r',[f.owner,b.runId,a.id])).r;assert.equal(result.status,'applied');return {...a,runId:b.runId};
}
const prepare=async(f,a)=>(await f.one('select public.prepare_agent_undo($1,$2,$3) r',[f.owner,a.runId,a.id])).r;
const eligibility=async(f,a)=>(await f.one('select public.get_agent_undo_eligibility($1,$2,$3) r',[f.owner,a.runId,a.id])).r;
const apply=async(f,b)=>(await f.one('select public.apply_agent_inverse_action($1,$2,$3) r',[f.owner,b.runId,b.actions[0].id])).r;
for(const [field,value] of Object.entries({title:'After',description:'After text',status:'completed',targetDate:'2026-11-20'}))test(`milestone_undo_restores_${field}`,async t=>{
 const f=await fixture(t),a=await source(f,{[field]:value});const snapshot=await f.one('select * from private.agent_actions where id=$1',[a.id]);
 const p=await prepare(f,a);assert.equal(p.eligibility.reason,'AVAILABLE');assert.equal(p.proposalBatch.actions[0].type,'update_milestone');assert.equal(p.proposalBatch.actions[0].undoOf.actionId,a.id);
 assert.equal((await apply(f,p.proposalBatch)).status,'applied');assert.equal((await apply(f,p.proposalBatch)).status,'applied');assert.deepEqual(await f.one('select * from private.agent_actions where id=$1',[a.id]),snapshot);
 const inverse=p.proposalBatch.actions[0],redo=await prepare(f,{runId:p.proposalBatch.runId,id:inverse.id});assert.equal(redo.eligibility.reason,'AVAILABLE');assert.equal(redo.proposalBatch.actions[0].undoOf.actionId,inverse.id);
});
test('milestone_undo_grouped_unrelated_edit_and_strict_post_prepare_stale',async t=>{
 const f=await fixture(t),a=await source(f,{title:'After',status:'active',targetDate:'2026-11-20'});
 await f.db.query('update public.milestones set description=$2 where id=$1',[f.milestone,'x'.repeat(5000)]);
 const p=await prepare(f,a);assert.equal(p.eligibility.reason,'AVAILABLE');assert.equal(Object.hasOwn(p.proposalBatch.actions[0].before,'description'),false);
 assert.deepEqual((await prepare(f,a)).proposalBatch,p.proposalBatch);
 await f.db.query('update public.milestones set description=$2 where id=$1',[f.milestone,'Unrelated later']);assert.equal((await apply(f,p.proposalBatch)).errorCode,'STALE_ENTITY');
});
test('milestone_undo_affected_edit_blocks_entire_inverse',async t=>{
 const f=await fixture(t),a=await source(f,{title:'After',status:'active'});await f.db.query('update public.milestones set status=$2 where id=$1',[f.milestone,'completed']);
 assert.equal((await eligibility(f,a)).reason,'STATE_CHANGED');assert.equal((await prepare(f,a)).proposalBatch,undefined);
});
test('milestone_cancelled_inverse_allows_fresh_prepare_and_empty_null_restore',async t=>{
 const f=await fixture(t);await f.db.query('update public.milestones set description=$2,target_date=$3 where id=$1',[f.milestone,'Text','2026-11-20']);
 const a=await source(f,{description:'',targetDate:null}),p=await prepare(f,a);assert.equal(p.eligibility.reason,'AVAILABLE');
 await f.one('select public.cancel_agent_task_actions($1,$2,$3) r',[f.owner,p.proposalBatch.runId,[p.proposalBatch.actions[0].id]]);
 const fresh=await prepare(f,a);assert.notEqual(fresh.proposalBatch.runId,p.proposalBatch.runId);assert.equal((await apply(f,fresh.proposalBatch)).status,'applied');
 const row=await f.one('select description,target_date::text d from public.milestones where id=$1',[f.milestone]);assert.equal(row.description,'Text');assert.equal(row.d,'2026-11-20');
});
test('milestone_incomplete_history_fails_closed',async t=>{
 const f=await fixture(t),a=await source(f,{title:'After'});
 for(const history of [{projectId:f.project},{projectId:f.project,title:null},{projectId:f.project,title:'x'.repeat(180)},{projectId:f.project,title:'Before…'}]){
  // Corrupt history only in a disposable policy fixture to exercise fail-closed behavior.
  await f.db.query('update private.agent_actions set before_state=$2 where id=$1',[a.id,JSON.stringify(history)]);
  assert.equal((await eligibility(f,a)).reason,'HISTORY_INCOMPLETE');
 }
});
