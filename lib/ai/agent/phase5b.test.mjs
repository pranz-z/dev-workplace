import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
Error.stackTraceLimit=0;
const cache=new Map();
function load(path){if(cache.has(path))return cache.get(path);let source=readFileSync(new URL('../../../'+path+'.ts',import.meta.url),'utf8').replace(/import "server-only";/g,'');source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/"@\/([^"\n]+)"/g,(_,dep)=>JSON.stringify(load(dep)));const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');cache.set(path,url);return url;}
const {parseProposalTool,proposalTools}=await import(load('lib/ai/agent/proposal-schema'));
const {collectProposal}=await import(load('lib/ai/agent/proposals'));
const {executeReadTool}=await import(load('lib/ai/agent/tools'));
const {isBlockMoveRequest}=await import(load('lib/ai/agent/block-resolution'));
const owner='11111111-1111-4111-8111-111111111111',project='33333333-3333-4333-8333-333333333333',id='55555555-5555-4555-8555-555555555555';
const original={id,project_id:project,title:'Milestone',description:'Before',status:'pending',target_date:'2026-11-01',updated_at:'2026-10-13T00:00:00Z',projects:{id:project,user_id:owner,title:'Project'}};
function context(overrides={}){const calls=[];const rows={milestones:[{...original,...overrides}],projects:[{id:project,user_id:owner,title:'Project'}]};return {calls,userId:owner,timeZone:'Asia/Manila',now:new Date(),signal:new AbortController().signal,supabase:{from(table){const filters=[];return {select(){return this;},order(){return this;},eq(k,v){filters.push([k,v]);return this;},abortSignal(){return this;},async maybeSingle(){calls.push(table);return {data:rows[table]?.find(r=>filters.every(([k,v])=>k.includes('.')?r.projects?.[k.split('.')[1]]===v:r[k]===v))??null};},async range(){const result=await this.maybeSingle();return {data:result.data?[result.data]:[]};}};}}};}
test('milestone_tool_contracts_are_strict',()=>{
 assert.ok(proposalTools.some(t=>t.name==='propose_create_milestone'));
 assert.deepEqual(parseProposalTool('propose_create_milestone',{projectId:project,title:' A '}),{milestoneAction:'create',projectId:project,title:'A'});
 for(const extra of ['status','order','entityId','userId','before','expectedUpdatedAt','undoOf'])assert.throws(()=>parseProposalTool('propose_create_milestone',{projectId:project,title:'A',[extra]:'bad'}));
 for(const changes of [{},{title:' '},{title:null},{description:null},{status:'Backlog'},{status:'scheduled'},{targetDate:'2026-02-30'},{projectId:project},{description:'x'.repeat(4001)},{title:'x'.repeat(181)}])assert.throws(()=>parseProposalTool('propose_update_milestone',{milestoneId:id,changes}));
 for(const status of ['pending','active','completed'])assert.equal(parseProposalTool('propose_update_milestone',{milestoneId:id,changes:{status}}).changes.status,status);
 assert.throws(()=>parseProposalTool('propose_create_milestone',{projectId:'bad',title:'A'}));
 assert.equal(parseProposalTool('propose_create_milestone',{projectId:project,title:'界'.repeat(180),description:'界'.repeat(4000)}).description.length,4000);
});
test('milestone_missing_null_empty_are_distinct',()=>{
 const p=parseProposalTool('propose_update_milestone',{milestoneId:id,changes:{description:'',targetDate:null}});
 assert.deepEqual(p.changes,{description:'',targetDate:null});assert.equal(Object.hasOwn(p.changes,'title'),false);
});
test('milestone_read_is_owned_bounded_and_non_authoritative',async()=>{
 const detail=await executeReadTool('get_milestone',{milestoneId:id},context({description:'x'.repeat(4001)}));
 assert.equal(detail.milestoneId,id);assert.equal(detail.description.length,4000);assert.equal(detail.descriptionTruncated,true);
 for(const k of ['updated_at','updatedAt','expectedUpdatedAt','userId','before_state','payload'])assert.equal(Object.hasOwn(detail,k),false);
 await assert.rejects(executeReadTool('get_milestone',{milestoneId:id},context({projects:{user_id:project}})));
});
test('create_milestone_collects_defaults_without_mutation',async()=>{
 const ctx=context(),drafts=[];await collectProposal('propose_create_milestone',{projectId:project,title:' New '},ctx,drafts);
 assert.deepEqual(drafts[0].payload,{title:'New',description:'',status:'pending',targetDate:null});assert.equal(drafts[0].entityId,null);assert.equal(drafts[0].expectedUpdatedAt,null);assert.deepEqual(ctx.calls,['projects']);
});
test('update_milestone_collects_exact_affected_history_and_noops',async()=>{
 const ctx=context(),drafts=[];await collectProposal('propose_update_milestone',{milestoneId:id,changes:{description:'After',targetDate:null}},ctx,drafts);
 assert.equal(drafts.length,1);assert.deepEqual(drafts[0].before,{projectId:project,description:'Before',targetDate:'2026-11-01'});assert.equal(drafts[0].expectedUpdatedAt,original.updated_at);
 await collectProposal('propose_update_milestone',{milestoneId:id,changes:{description:'Before',targetDate:'2026-11-01'}},ctx,drafts);assert.equal(drafts.length,0);
 await collectProposal('propose_update_milestone',{milestoneId:id,changes:{title:'Milestone'}},ctx,drafts);assert.equal(drafts.length,0);
});
test('oversized_manual_history_is_not_truncated',async()=>{
 const ctx=context({description:'x'.repeat(4001)}),drafts=[];
 await collectProposal('propose_update_milestone',{milestoneId:id,changes:{status:'active'}},ctx,drafts);assert.equal(Object.hasOwn(drafts[0].before,'description'),false);
 await assert.rejects(collectProposal('propose_update_milestone',{milestoneId:id,changes:{description:'Replace'}},context({description:'x'.repeat(4001)}),[]));
});
test('milestone_mixed_calls_reject_both_orders',async()=>{
 const newCall=['propose_update_milestone',{milestoneId:id,changes:{description:'After'}}];
 for(const oldCall of [['propose_reschedule_milestone',{milestoneId:id,targetDate:null}],['propose_create_task',{projectId:project,title:'Task'}],['propose_create_milestone',{projectId:project,title:'Another'}]]){
  for(const pair of [[newCall,oldCall],[oldCall,newCall]]){const drafts=[],ctx=context();await collectProposal(...pair[0],ctx,drafts);await assert.rejects(collectProposal(...pair[1],ctx,drafts));}
 }
});
test('explicit_milestone_reschedule_is_not_intercepted_as_a_time_block',()=>{
 assert.equal(isBlockMoveRequest('Reschedule this milestone to November 20'),false);
 assert.equal(isBlockMoveRequest('Move this time block to 3 PM'),true);
 assert.equal(isBlockMoveRequest('Reschedule it to 3 PM'),true);
});
