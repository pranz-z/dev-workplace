import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
Error.stackTraceLimit=0;
const cache=new Map();
function load(path){if(cache.has(path))return cache.get(path);let s=readFileSync(new URL('../../../'+path+'.ts',import.meta.url),'utf8').replace(/import "server-only";/g,'');s=ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/"@\/([^"\n]+)"/g,(_,p)=>JSON.stringify(load(p)));const u='data:text/javascript;base64,'+Buffer.from(s).toString('base64');cache.set(path,u);return u;}
const {applySelectedActions}=await import(load('lib/ai/agent/store'));
const {parseActionSelection,parseUndoSelection}=await import(load('lib/ai/agent/proposal-schema'));
const id='11111111-1111-4111-8111-111111111111';
test('milestone_apply_uses_canonical_identifiers_only_and_guard_for_inverse',async()=>{
 for(const type of ['create_milestone','update_milestone'])for(const inverse of [false,true]){
  const calls=[],a={id,type,...(inverse?{undoOf:{actionId:id}}:{})};
  await applySelectedActions({rpc:async(name,args)=>{calls.push([name,args]);return {data:{id,status:'applied'}};}},id,{runId:id,actions:[a]},[id]);
  assert.equal(calls[0][0],inverse?'apply_agent_inverse_action':'apply_agent_milestone_action');assert.deepEqual(calls[0][1],{p_user_id:id,p_run_id:id,p_action_id:id});
 }
});
test('unknown_kind_never_dispatches_as_task',async()=>{
 const calls=[];await assert.rejects(applySelectedActions({rpc:async(...a)=>{calls.push(a);return {data:{id,status:'applied'}};}},id,{runId:id,actions:[{id,type:'future_action'}]},[id]));assert.equal(calls.length,0);
});
test('approval_and_prepare_accept_only_identifiers',()=>{
 for(const key of ['payload','changes','userId','expectedUpdatedAt','undoOf']){
  assert.throws(()=>parseActionSelection({runId:id,actionIds:[id],[key]:{}}));assert.throws(()=>parseUndoSelection({runId:id,actionId:id,[key]:{}}));
 }
 for(const file of ['store','action-route','undo','undo-route'])assert.doesNotMatch(readFileSync(new URL('./'+file+'.ts',import.meta.url),'utf8'),/from .*gemini|runAgentLoop/);
});
