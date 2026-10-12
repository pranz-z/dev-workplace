import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const root=new URL('../../../',import.meta.url);
function load(path,deps={}){const url=new URL(path,root);const source=existsSync(url)?readFileSync(url,'utf8'):'export {}';const exports={};new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(name=>{if(name==='server-only')return {};if(deps[name])return deps[name];if(name.startsWith('@/'))return load(name.slice(2)+'.ts',deps);throw Error('Unexpected dependency '+name);},exports);return exports;}
class AiError extends Error{constructor(code){super(code);this.code=code;this.status={INVALID_INPUT:400,FORBIDDEN:403,UNAUTHORIZED:401,RATE_LIMITED:429}[code]??502;}}
const errors={'@/lib/ai/errors':{AiError}};
const schema=()=>load('lib/ai/agent/proposal-schema.ts',{...errors,'@/lib/ai/agent/time-block-schema':{timeBlockProposalTools:[],parseTimeBlockTool:()=>{throw Error('unused time proposal');}}});
const runId='11111111-1111-4111-8111-111111111111',actionId='22222222-2222-4222-8222-222222222222';
test('Prepare parser accepts exactly two identifiers and rejects candidate/owner/version data',()=>{
 const s=schema();assert.equal(typeof s.parseUndoSelection,'function');assert.deepEqual(s.parseUndoSelection({runId,actionId}),{runId,actionId});
 for(const value of [null,[],{}, {runId,actionId:'bad'},...['payload','before','after','userId','expectedUpdatedAt','undoOf','actionIds'].map(key=>({runId,actionId,[key]:{}}))])assert.throws(()=>s.parseUndoSelection(value));
 assert.deepEqual(s.parseActionSelection({runId,actionIds:[actionId]}),{runId,actionIds:[actionId]});assert.throws(()=>s.parseActionSelection({runId,actionIds:[actionId],payload:{}}));
});
test('stored inverse lineage selects guarded Apply; ordinary actions retain original dispatch',async()=>{
 const store=load('lib/ai/agent/store.ts',{...errors,'@/lib/ai/agent/contract':{MAX_PROPOSED_ACTIONS_PER_RUN:10}});const calls=[];const admin={rpc:async(name,args)=>{calls.push({name,args});return {data:{id:args.p_action_id,status:'applied'}};}};
 await store.applySelectedActions(admin,'owner',{runId,actions:[{id:actionId,type:'update_task',undoOf:{runId,actionId}}]},[actionId]);assert.equal(calls[0].name,'apply_agent_inverse_action');assert.deepEqual(Object.keys(calls[0].args).sort(),['p_action_id','p_run_id','p_user_id']);
 for(const [type,rpc] of [['update_task','apply_agent_task_action'],['reschedule_project','apply_agent_schedule_action'],['cancel_time_block','apply_agent_time_block_action']]){await store.applySelectedActions(admin,'owner',{runId,actions:[{id:actionId,type}]},[actionId]);assert.equal(calls.at(-1).name,rpc);}
});
function handler({auth=true,allowed=true,lease=true,fail=false}={}){
 const calls=[];const deps={...errors,'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/lib/ai/auth':{requireAuthenticatedAiUser:async()=>{if(!auth)throw new AiError('UNAUTHORIZED');return {id:'owner'};}},'@/lib/supabase/server':{getSupabaseServerClient:async()=>({})},'@/lib/supabase/admin':{getSupabaseAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:allowed};}})},'@/lib/ai/private-concurrency':{acquirePrivateAiLease:async()=>lease?'lease':null,releasePrivateAiLease:async()=>calls.push({released:true})},'@/lib/ai/agent/request':{boundedAgentBody:async request=>{const text=await request.text();if(text.length>32000)throw new AiError('INVALID_INPUT');return JSON.parse(text);}},'@/lib/ai/agent/proposal-schema':schema(),'@/lib/ai/agent/undo':{prepareAgentUndo:async(admin,owner,selection)=>{calls.push({owner,selection});if(fail)throw new AiError('FORBIDDEN');return {eligibility:{state:'available',reason:'PENDING_INVERSE',explanation:'Review'},proposalBatch:{runId,actions:[]}};}}};
 return {calls,handler:load('lib/ai/agent/undo-route.ts',deps).handlePrepareAgentUndo};
}
const request=(body={runId,actionId},headers={})=>new Request('http://localhost/api/ai/agent/activity/undo-proposal',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('undo adapter bounds projections, rejects unknown codes and recovers canonical batch without deriving inverses',async()=>{
 const undo=load('lib/ai/agent/undo.ts',errors);assert.equal(typeof undo.projectUndoEligibility,'function');
 const projected=undo.projectUndoEligibility({state:'available',reason:'AVAILABLE',explanation:'x'.repeat(500),inverseSummary:'y'.repeat(500),payload:{secret:'HIDDEN'}});assert.equal(projected.explanation.length,240);assert.equal(projected.inverseSummary.length,180);assert.doesNotMatch(JSON.stringify(projected),/payload|HIDDEN/);assert.throws(()=>undo.projectUndoEligibility({state:'available',reason:'INVENTED',explanation:'x'}));
 const calls=[];const admin={rpc:async(name,args)=>{calls.push({name,args});return {data:{eligibility:{state:'available',reason:'PENDING_INVERSE',explanation:'Review'},proposalBatch:{runId,actions:[]}}};}};
 const r=await undo.prepareAgentUndo(admin,'owner',{runId,actionId});assert.equal(r.proposalBatch.runId,runId);assert.deepEqual(calls,[{name:'prepare_agent_undo',args:{p_user_id:'owner',p_run_id:runId,p_action_id:actionId}}]);
 await assert.rejects(undo.prepareAgentUndo({rpc:async()=>({data:null})},'owner',{runId,actionId}),e=>e.code==='FORBIDDEN');
});
test('Prepare route authenticates, rate limits, bounds body, releases lease, derives owner and returns no-store canonical recovery',async()=>{
 const h=handler();assert.equal(typeof h.handler,'function');const r=await h.handler(request());assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.body.proposalBatch.runId,runId);assert.deepEqual(h.calls.find(c=>c.selection),{owner:'owner',selection:{runId,actionId}});assert.ok(h.calls.at(-1).released);
 for(const [options,body,headers,status] of [[{auth:false},undefined,{},401],[{allowed:false},undefined,{},429],[{lease:false},undefined,{},429],[{},undefined,{origin:'https://other.example'},403],[{},undefined,{'sec-fetch-site':'cross-site'},403],[{},{runId,actionId,payload:{}},{},400],[{},{runId,actionId,extra:'x'.repeat(32000)},{},400],[{fail:true},undefined,{},403]]){const x=handler(options);const result=await x.handler(request(body,headers));assert.equal(result.status,status);assert.equal(result.headers['Cache-Control'],'no-store');if(options.fail)assert.ok(x.calls.at(-1).released);}
});
