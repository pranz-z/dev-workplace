import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
Error.stackTraceLimit=0;
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`,cache=new Map();
function load(path){if(cache.has(path))return cache.get(path);const file=new URL(`../../../${path}.ts`,import.meta.url);let source=existsSync(file)?readFileSync(file,'utf8').replace(/import "server-only";/g,''):'export {}';source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/["']@\/([^"'\n]+)["']/g,(_,dep)=>JSON.stringify(load(dep)));const value=url(source);cache.set(path,value);return value;}
const {parseProposalTool}=await import(load('lib/ai/agent/proposal-schema'));
const {parseToolArguments}=await import(load('lib/ai/agent/schemas'));
const {collectProposal}=await import(load('lib/ai/agent/proposals'));
const {executeReadTool}=await import(load('lib/ai/agent/tools'));
const {runAgentLoop}=await import(load('lib/ai/agent/executor'));
const resolution=await import(load('lib/ai/agent/block-resolution'));
const normalization=await import(load('lib/ai/agent/model-arguments'));
const review=await import(load('data/agentProposalReview'));
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',task='33333333-3333-4333-8333-333333333333',blockId='44444444-4444-4444-8444-444444444444';
function context(extra={}){
 const rows={projects:[{id:project,user_id:owner,title:'Workspace',target_date:'2026-10-14'}],tasks:[{id:task,user_id:owner,project_id:project,title:'Urgent task',status:'Backlog',priority:'High',due_date:'2026-10-10',projects:{user_id:owner}}],milestones:[],workspace_time_blocks:[],workspace_scheduling_preferences:[{user_id:owner,workday_start:'09:00:00',workday_end:'17:00:00',weekdays:[1,2,3,4,5],focus_minutes:50,buffer_minutes:10}],...extra};
 const calls=[];return {calls,userId:owner,timeZone:'Asia/Manila',now:new Date('2026-10-11T00:00:00Z'),signal:new AbortController().signal,supabase:{from(table){const filters=[];const q={select(){return this;},eq(k,v){filters.push(r=>k.includes('.')?r.projects?.[k.split('.')[1]]===v:r[k]===v);return this;},lt(k,v){filters.push(r=>r[k]<v);return this;},gt(k,v){filters.push(r=>r[k]>v);return this;},neq(k,v){filters.push(r=>r[k]!==v);return this;},order(){return this;},abortSignal(){return this;},limit(){return this;},range(){return this;},async maybeSingle(){return {data:rows[table]?.filter(r=>filters.every(f=>f(r)))[0]??null,error:null};},then(resolve,reject){calls.push(table);return Promise.resolve({data:(rows[table]??[]).filter(r=>filters.every(f=>f(r))),error:null}).then(resolve,reject);}};return q;}}};
}
test('time-block tool schemas reject arbitrary fields and invalid durations',()=>{
 assert.doesNotThrow(()=>parseProposalTool('propose_create_time_block',{title:'Focus',startAt:'2026-10-12T09:00',endAt:'2026-10-12T10:00'}));
 assert.throws(()=>parseProposalTool('propose_create_time_block',{title:'Focus',startAt:'x',endAt:'y',userId:owner}));
 assert.throws(()=>parseProposalTool('propose_create_time_block',{title:'Focus',startAt:'2026-10-12T09:00:00Z',endAt:'2026-10-12T10:00:00Z'}));
 assert.doesNotThrow(()=>parseToolArguments('find_free_time',{date:'2026-10-12',durationMinutes:90}));
 assert.throws(()=>parseToolArguments('find_free_time',{date:'2026-10-12',durationMinutes:721}));
});
test('create proposal canonicalizes local instants without workspace writes',async()=>{
 const ctx=context(),drafts=[];
 await collectProposal('propose_create_time_block',{title:' Focus ',startAt:'2026-10-12T09:00',endAt:'2026-10-12T10:00',taskId:task},ctx,drafts);
 assert.equal(drafts.length,1);assert.equal(drafts[0].payload.startAt,'2026-10-12T01:00:00.000Z');assert.equal(drafts[0].projectId,project);assert.equal(drafts[0].type,'create_time_block');
});
test('server planning ranks tasks and allocates verified gaps without Gemini arithmetic',async()=>{
 const ctx=context({workspace_time_blocks:[{id:blockId,user_id:owner,title:'Existing',start_at:'2026-10-12T01:00:00.000Z',end_at:'2026-10-12T02:00:00.000Z',status:'scheduled'}]}),drafts=[];
 const result=await collectProposal('propose_plan_day',{date:'2026-10-12'},ctx,drafts);
 assert.equal(drafts[0].payload.taskId,task);assert.equal(drafts[0].payload.startAt,'2026-10-12T02:10:00.000Z');assert.equal(result.count,1);
});
test('find time exposes verified slots and missing hours cannot silently plan',async()=>{
 const result=await executeReadTool('find_free_time',{date:'2026-10-12',durationMinutes:90},context());
 assert.equal(result.items[0].startAt,'2026-10-12T01:00:00.000Z');
 const drafts=[];const missing=await collectProposal('propose_plan_day',{date:'2026-10-12'},context({workspace_scheduling_preferences:[]}),drafts);assert.equal(missing.requiresPreferences,true);assert.equal(drafts.length,0);
});
test('update before/version are canonical and overlapping proposals are rejected',async()=>{
 const row={id:blockId,user_id:owner,title:'Actual',project_id:null,task_id:null,start_at:'2026-10-12T01:00:00.000Z',end_at:'2026-10-12T02:00:00.000Z',kind:'focus',status:'scheduled',updated_at:'2026-10-11T00:00:00Z'};
 const ctx=context({workspace_time_blocks:[row]}),drafts=[];
 await collectProposal('propose_update_time_block',{timeBlockId:blockId,changes:{title:'New'}},ctx,drafts);
 assert.equal(drafts[0].before.title,'Actual');assert.equal(drafts[0].expectedUpdatedAt,row.updated_at);
 await assert.rejects(collectProposal('propose_create_time_block',{title:'Overlap',startAt:'2026-10-12T09:30',endAt:'2026-10-12T10:30'},ctx,drafts));
});
test('find time produces no proposal when the whole workday is occupied',async()=>{
 const ctx=context({workspace_time_blocks:[{id:blockId,user_id:owner,start_at:'2026-10-12T01:00:00.000Z',end_at:'2026-10-12T09:00:00.000Z',status:'scheduled'}]}),drafts=[];
 const result=await collectProposal('propose_find_time',{date:'2026-10-12',durationMinutes:90,taskId:task},ctx,drafts);assert.equal(result.count,0);assert.equal(drafts.length,0);
});
test('cancel persisted block produces only a canonical cancellation patch',async()=>{
 const row={id:blockId,user_id:owner,title:'Focus',project_id:null,task_id:null,start_at:'2026-10-12T01:00:00.000Z',end_at:'2026-10-12T02:00:00.000Z',kind:'focus',status:'scheduled',updated_at:'2026-10-11T00:00:00Z'},drafts=[];
 await collectProposal('propose_cancel_time_block',{timeBlockId:blockId},context({workspace_time_blocks:[row]}),drafts);assert.deepEqual(drafts[0].payload,{status:'cancelled'});assert.equal(drafts[0].before.status,'scheduled');
});
test('truncated block reads fail closed for availability and planning',async()=>{
 const rows=Array.from({length:501},(_,i)=>({id:String(i),user_id:owner,start_at:'2026-10-12T01:00:00.000Z',end_at:'2026-10-12T02:00:00.000Z',status:'scheduled'}));
 const result=await executeReadTool('find_free_time',{date:'2026-10-12',durationMinutes:90},context({workspace_time_blocks:rows}));assert.equal(result.truncated,true);assert.deepEqual(result.items,[]);
 await assert.rejects(collectProposal('propose_plan_day',{date:'2026-10-12'},context({workspace_time_blocks:rows}),[]));
});
test('proposed blocks reserve time within a batch',async()=>{
 const ctx=context(),drafts=[];
 await collectProposal('propose_create_time_block',{title:'First',startAt:'2026-10-12T09:00',endAt:'2026-10-12T10:00'},ctx,drafts);
 await assert.rejects(collectProposal('propose_create_time_block',{title:'Second',startAt:'2026-10-12T09:30',endAt:'2026-10-12T10:30'},ctx,drafts));
 await collectProposal('propose_find_time',{taskId:task,date:'2026-10-12',durationMinutes:90},ctx,drafts);assert.equal(drafts[1].payload.startAt,'2026-10-12T02:10:00.000Z');
});
test('time-block Apply dispatches only canonical identifiers to dedicated RPC',async()=>{
 const {applySelectedActions}=await import(load('lib/ai/agent/store'));const calls=[];const batch={runId:project,actions:[{id:blockId,type:'create_time_block',payload:{title:'Unsafe browser payload irrelevant'}}]};
 await applySelectedActions({rpc:async(name,args)=>{calls.push({name,args});return {data:{id:blockId,status:'applied'},error:null};}},owner,batch,[blockId]);
 assert.deepEqual(calls,[{name:'apply_agent_time_block_action',args:{p_user_id:owner,p_run_id:project,p_action_id:blockId}}]);
});

test('adjacent-day buffer and candidate truncation are preserved',async()=>{
 const ctx=context({workspace_scheduling_preferences:[{user_id:owner,workday_start:'00:00:00',workday_end:'23:00:00',weekdays:[1],focus_minutes:50,buffer_minutes:10}],workspace_time_blocks:[{id:blockId,user_id:owner,start_at:'2026-10-11T23:00:00.000Z',end_at:'2026-10-11T23:55:00.000Z',status:'scheduled'}]});ctx.timeZone='UTC';
 const result=await executeReadTool('find_free_time',{date:'2026-10-12',durationMinutes:50},ctx);
 assert.equal(result.items[0].startAt,'2026-10-12T00:05:00.000Z');assert.equal(result.truncated,true);
});
test('deadline cap reports partial day context',async()=>{
 const tasks=Array.from({length:101},(_,i)=>({id:String(i),title:'Due',user_id:owner,project_id:project,status:'Backlog',due_date:'2026-10-12',projects:{user_id:owner}}));
 const result=await executeReadTool('get_day_schedule',{date:'2026-10-12'},context({tasks}));assert.equal(result.deadlines.length,100);assert.equal(result.truncated,true);
});
test('missing scheduling preferences ends inspection with a canonical clarification',async()=>{
 let rounds=0;
 const result=await runAgentLoop({message:'Plan my day tomorrow.',history:[],timeZone:'Asia/Manila'},context({workspace_scheduling_preferences:[]}),async()=>{rounds++;return {parts:[{functionCall:{name:'propose_plan_day',args:{date:'2026-10-12'}}}]};});
 assert.equal(rounds,1);assert.match(result.answer,/working hours|scheduling preferences/i);assert.equal(result.drafts,undefined);
});

const existingBlock=(id=blockId,title='Phase3B Agent block A',extra={})=>({id,user_id:owner,title,project_id:project,task_id:task,start_at:'2026-10-12T03:00:00.000Z',end_at:'2026-10-12T04:30:00.000Z',kind:'focus',status:'scheduled',updated_at:'2026-10-11T00:00:00Z',...extra});
const secondBlock=()=>existingBlock('55555555-5555-4555-8555-555555555555','Phase3B Agent block B',{start_at:'2026-10-12T05:00:00.000Z',end_at:'2026-10-12T06:00:00.000Z'});
test('ambiguous block request returns candidates without consulting model or proposing',async()=>{
 let called=false;const result=await runAgentLoop({message:'Move my Agent block to 3 PM tomorrow.',history:[],timeZone:'Asia/Manila'},context({workspace_time_blocks:[existingBlock(),secondBlock()]}),async()=>{called=true;return {parts:[{text:'Guess A'}]};});
 assert.equal(called,false);assert.equal(result.drafts,undefined);assert.match(result.answer,/block A/);assert.match(result.answer,/block B/);assert.match(result.answer,/which/i);
});
for(const [name,message,rows,selected] of [
 ['unique title','Move Phase3B Agent block A to 3 PM tomorrow.',[existingBlock(),secondBlock()],blockId],
 ['exact ID',`Move time block ${blockId} to 3 PM tomorrow.`,[existingBlock(),secondBlock()],blockId],
 ['cancelled excluded','Move my Agent block to 3 PM tomorrow.',[existingBlock(),{...secondBlock(),status:'cancelled'}],blockId],
 ['cancelled explicitly included','Review cancelled Phase3B Agent block A tomorrow.',[existingBlock(blockId,'Phase3B Agent block A',{status:'cancelled'})],blockId],
 ['owner boundary','Move my Agent block to 3 PM tomorrow.',[existingBlock(),{...secondBlock(),user_id:project}],blockId],
 ['source time','Move my Agent block from 11 AM to 3 PM tomorrow.',[existingBlock(),secondBlock()],blockId],
 ['local date','Move my Agent block to 3 PM tomorrow.',[existingBlock(),{...secondBlock(),start_at:'2026-10-13T05:00:00Z',end_at:'2026-10-13T06:00:00Z'}],blockId],
 ['linked task','Move the time block for Urgent task to 3 PM tomorrow.',[existingBlock(),{...secondBlock(),task_id:null}],blockId],
])test(`deterministic resolution: ${name}`,async()=>{const result=await resolution.resolveTimeBlockCandidates(message,context({workspace_time_blocks:rows}));assert.equal(result.selectedId,selected);});
test('candidate clarification stays bounded and truncated scans cannot select',async()=>{
 const rows=Array.from({length:501},(_,i)=>existingBlock(String(i),`Agent block ${i}`));const result=await resolution.resolveTimeBlockCandidates('Move my Agent block to 3 PM tomorrow.',context({workspace_time_blocks:rows}));assert.ok(result.candidates.length<=5);assert.equal(result.selectedId,undefined);assert.match(result.answer,/narrow|more|which/i);
});
for(const [name,message,changes,end] of [
 ['start only','Move Phase3B Agent block A to 3 PM tomorrow.',{startAt:'2026-10-12T15:00',endAt:'2026-10-12T16:00'},'2026-10-12T08:30:00.000Z'],
 ['date and start','Move Phase3B Agent block A from 2026-10-12 to 2026-10-13 at 3 PM.',{startAt:'2026-10-13T15:00',endAt:'2026-10-13T16:00'},'2026-10-13T08:30:00.000Z'],
 ['explicit duration','Move Phase3B Agent block A to 3 PM tomorrow for 60 minutes.',{startAt:'2026-10-12T15:00',endAt:'2026-10-12T17:00'},'2026-10-12T08:00:00.000Z'],
 ['explicit end','Move Phase3B Agent block A tomorrow to 3 PM until 5 PM.',{startAt:'2026-10-12T15:00',endAt:'2026-10-12T17:00'},'2026-10-12T09:00:00.000Z'],
])test(`canonical move duration: ${name}`,async()=>{const drafts=[];await collectProposal('propose_update_time_block',{timeBlockId:blockId,changes},{...context({workspace_time_blocks:[existingBlock()]}),requestMessage:message},drafts);assert.equal(drafts[0].payload.endAt,end);});
test('duration comes from fresh DB state and model-selected wrong identity cannot propose',async()=>{
 const ctx={...context({workspace_time_blocks:[existingBlock(blockId,'Phase3B Agent block A',{end_at:'2026-10-12T05:00:00Z'}),secondBlock()]}),requestMessage:'Move Phase3B Agent block A to 3 PM tomorrow.'},drafts=[];
 await collectProposal('propose_update_time_block',{timeBlockId:blockId,changes:{startAt:'2026-10-12T15:00',endAt:'2026-10-12T16:00'}},ctx,drafts);assert.equal(drafts[0].payload.endAt,'2026-10-12T09:00:00.000Z');
 await assert.rejects(collectProposal('propose_update_time_block',{timeBlockId:secondBlock().id,changes:{startAt:'2026-10-12T15:00'}},ctx,[]));
});
const reviewAction=(type='create_time_block')=>({id:blockId,type,entityId:type==='create_time_block'?null:blockId,projectId:project,taskId:null,title:'gmail',payload:{title:'gmail',taskId:task,projectId:project,startAt:'2026-10-12T01:00:00Z',endAt:'2026-10-12T02:30:00Z'},before:{title:'gmail',startAt:'2026-10-12T03:00:00Z',endAt:'2026-10-12T04:30:00Z'},diff:[],status:'conflict'});
test('conflicted create review is human-readable, requests new availability and never substitutes UUIDs',()=>{
 const text=review.buildAgentReviewPrompt(reviewAction(),'Asia/Manila',new Map([[`task:${task}`,'gmail'],[`project:${project}`,'dev-workplace']]));assert.match(text,/gmail/);assert.match(text,/dev-workplace/);assert.match(text,/90/);assert.match(text,/2026-10-12/);assert.match(text,/09:00/);assert.match(text,/another|available/i);assert.doesNotMatch(text,/[0-9a-f]{8}-[0-9a-f-]{27}/i);
});
for(const type of ['update_time_block','cancel_time_block'])test(`${type} review refers to persisted human identity without UUID`,()=>{const text=review.buildAgentReviewPrompt(reviewAction(type),'Asia/Manila');assert.match(text,/gmail/);assert.match(text,/2026-10-12/);assert.match(text,type==='update_time_block'?/15:00|09:00/:/cancel/i);assert.doesNotMatch(text,new RegExp(blockId));});
for(const [value,expected] of [['9:00','09:00'],['9 AM','09:00'],['3:00 PM','15:00']])test(`narrow wall-clock normalization ${value}`,()=>{assert.equal(normalization.normalizeSchedulingArguments('propose_find_time',{earliestTime:value}).earliestTime,expected);});
for(const [name,args] of [
 ['malformed time',{date:'2026-10-12',taskId:task,durationMinutes:90,earliestTime:'later',latestTime:'17:00'}],
 ['ambiguous time',{date:'2026-10-12',taskId:task,durationMinutes:90,earliestTime:'3',latestTime:'17:00'}],
 ['unexpected field',{date:'2026-10-12',taskId:task,durationMinutes:90,owner}],
 ['invalid date',{date:'2026-02-30',taskId:task,durationMinutes:90}],
])test(`invalid provider arguments recover safely: ${name}`,async()=>{
 const result=await runAgentLoop({message:'Find 90 minutes tomorrow for my task.',history:[],timeZone:'Asia/Manila'},context(),async()=>({parts:[{functionCall:{name:'propose_find_time',args}}]}));assert.equal(result.drafts,undefined);assert.match(result.answer,/safely|specify|clarif/i);assert.doesNotMatch(result.answer,/INVALID_INPUT|schema|owner|stack/);
});
test('vague move cannot invent target or time',async()=>{const result=await runAgentLoop({message:'Move it sometime later.',history:[],timeZone:'Asia/Manila'},context({workspace_time_blocks:[existingBlock()]}),async()=>({parts:[{functionCall:{name:'propose_update_time_block',args:{timeBlockId:blockId,changes:{startAt:'2026-10-12T15:00'}}}}]}));assert.equal(result.drafts,undefined);assert.match(result.answer,/which|time|specify/i);});
test('linked project narrows duplicate strong titles',async()=>{const ctx=context({workspace_time_blocks:[existingBlock(blockId,'Agent block'),{...secondBlock(),title:'Agent block',project_id:null}]});const result=await resolution.resolveTimeBlockCandidates('Move my Agent block in Workspace to 3 PM tomorrow.',ctx);assert.equal(result.selectedId,blockId);});
test('end-only model patch cannot silently resize a move',async()=>{await assert.rejects(collectProposal('propose_update_time_block',{timeBlockId:blockId,changes:{endAt:'2026-10-12T16:00'}},{...context({workspace_time_blocks:[existingBlock()]}),requestMessage:'Move Phase3B Agent block A to 3 PM tomorrow.'},[]));});
test('DST fold remains recoverable and creates no proposal',async()=>{const ctx=context();ctx.timeZone='America/New_York';const result=await runAgentLoop({message:'Block 1:30 AM to 2:30 AM on 2026-11-01.',history:[],timeZone:ctx.timeZone},ctx,async()=>({parts:[{functionCall:{name:'propose_create_time_block',args:{title:'Fold',startAt:'2026-11-01T01:30',endAt:'2026-11-01T02:30'}}}]}));assert.equal(result.drafts,undefined);assert.match(result.answer,/safely/);});
test('human month date and bounded requested date range constrain candidates',async()=>{
 const ctx=context({workspace_time_blocks:[existingBlock(),{...secondBlock(),start_at:'2026-10-13T05:00:00Z',end_at:'2026-10-13T06:00:00Z'}]});
 assert.equal((await resolution.resolveTimeBlockCandidates('Move my Agent block on October 12 to 3 PM.',ctx)).selectedId,blockId);
 const result=await resolution.resolveTimeBlockCandidates('Move my Agent block during 2026-10-12 through 2026-10-13 to 3 PM.',ctx);assert.equal(result.selectedId,undefined);assert.equal(result.candidates.length,2);
});
test('read-range local wall times normalize with authoritative timezone before strict parsing',()=>{
 const args={startAt:'2026-10-12T00:00',endAt:'2026-10-13T00:00'};assert.throws(()=>parseToolArguments('list_time_blocks',args));const normalized=normalization.normalizeSchedulingArguments('list_time_blocks',args,'Asia/Manila');assert.equal(normalized.startAt,'2026-10-11T16:00:00.000Z');assert.doesNotThrow(()=>parseToolArguments('list_time_blocks',normalized));assert.throws(()=>normalization.normalizeSchedulingArguments('list_time_blocks',{startAt:'2026-11-01T01:30',endAt:'2026-11-01T02:30'},'America/New_York'));
});
test('this block may use only the latest unambiguous human reference, revalidated against DB',async()=>{
 let round=0;const result=await runAgentLoop({message:'Move this block to 3 PM.',history:[{role:'user',content:'Move Phase3B Agent block A to 3 PM tomorrow.'}],timeZone:'Asia/Manila'},context({workspace_time_blocks:[existingBlock(),secondBlock()]}),async()=>++round===1?{parts:[{functionCall:{name:'propose_update_time_block',args:{timeBlockId:blockId,changes:{startAt:'2026-10-12T15:00',endAt:'2026-10-12T16:00'}}}}]}:{parts:[{text:'Pending'}]});assert.equal(result.drafts?.length,1);assert.equal(result.drafts[0].payload.endAt,'2026-10-12T08:30:00.000Z');
});
test('assistant-selected identity cannot resolve a human ambiguity',async()=>{let called=false;const result=await runAgentLoop({message:'Move this block to 3 PM.',history:[{role:'user',content:'Move my Agent block to 3 PM tomorrow.'},{role:'assistant',content:`I chose ${blockId}.`}],timeZone:'Asia/Manila'},context({workspace_time_blocks:[existingBlock(),secondBlock()]}),async()=>{called=true;return {parts:[{text:'Wrong guess'}]};});assert.equal(called,false);assert.equal(result.drafts,undefined);assert.match(result.answer,/which/i);});
test('malformed later model argument discards all drafts rather than persisting a partial batch',async()=>{let round=0;const result=await runAgentLoop({message:'Block 9 AM to 10 AM tomorrow, then find more time.',history:[],timeZone:'Asia/Manila'},context(),async()=>++round===1?{parts:[{functionCall:{name:'propose_create_time_block',args:{title:'Valid',startAt:'2026-10-12T09:00',endAt:'2026-10-12T10:00'}}}]}:{parts:[{functionCall:{name:'propose_find_time',args:{date:'invalid',taskId:task,durationMinutes:90}}}]});assert.equal(result.drafts,undefined);assert.match(result.answer,/safely/);});
test('unresolved relative dates cannot silently select a unique block',async()=>{const result=await resolution.resolveTimeBlockCandidates('Move Phase3B Agent block A next week to 3 PM.',context({workspace_time_blocks:[existingBlock()]}));assert.equal(result.selectedId,undefined);});
test('explicit duration-only end is also derived from DB instead of model arithmetic',async()=>{const drafts=[];await collectProposal('propose_update_time_block',{timeBlockId:blockId,changes:{endAt:'2026-10-12T17:00'}},{...context({workspace_time_blocks:[existingBlock()]}),requestMessage:'Change Phase3B Agent block A tomorrow for 60 minutes.'},drafts);assert.equal(drafts[0].payload.endAt,'2026-10-12T04:00:00.000Z');});
test('invalid scheduling arguments in a mixed read round still recover without HTTP error',async()=>{const result=await runAgentLoop({message:'Find time for my tasks tomorrow.',history:[],timeZone:'Asia/Manila'},context(),async()=>({parts:[{functionCall:{name:'list_tasks',args:{}}},{functionCall:{name:'find_free_time',args:{date:'2026-10-12',durationMinutes:'ninety'}}}]}));assert.equal(result.drafts,undefined);assert.match(result.answer,/safely/);});
test('failed create review does not invent an overlap diagnosis',()=>{const text=review.buildAgentReviewPrompt({...reviewAction(),status:'failed'},'Asia/Manila');assert.doesNotMatch(text,/no longer available|occupied/i);assert.match(text,/could not|couldn't/i);});
for(const reference of ['Phase3B Agent block A',`time block ${blockId}`])test(`unique human reference permits canonical proposal: ${reference}`,async()=>{let round=0;const result=await runAgentLoop({message:`Move ${reference} to 3 PM tomorrow.`,history:[],timeZone:'Asia/Manila'},context({workspace_time_blocks:[existingBlock(),secondBlock()]}),async()=>++round===1?{parts:[{functionCall:{name:'propose_update_time_block',args:{timeBlockId:blockId,changes:{startAt:'2026-10-12T15:00'}}}}]}:{parts:[{text:'Pending'}]});assert.equal(result.drafts?.length,1);});
test('linked project narrows partial title matches and unknown project fails closed',async()=>{
 const ctx=context({workspace_time_blocks:[existingBlock(),{...secondBlock(),project_id:null}]});assert.equal((await resolution.resolveTimeBlockCandidates('Move my Agent block in Workspace to 3 PM tomorrow.',ctx)).selectedId,blockId);assert.equal((await resolution.resolveTimeBlockCandidates('Move Phase3B Agent block A in MissingProject to 3 PM tomorrow.',ctx)).selectedId,undefined);
});
test('unbounded explicit duration recovers before date arithmetic overflows',async()=>{const result=await runAgentLoop({message:'Move Phase3B Agent block A to 3 PM tomorrow for 999999999999999999999 minutes.',history:[],timeZone:'Asia/Manila'},context({workspace_time_blocks:[existingBlock()]}),async()=>({parts:[{functionCall:{name:'propose_update_time_block',args:{timeBlockId:blockId,changes:{startAt:'2026-10-12T15:00'}}}}]}));assert.equal(result.drafts,undefined);assert.match(result.answer,/safely/);});
test('a block crossing local midnight remains a plausible requested-day candidate',async()=>{const overnight=existingBlock(blockId,'Agent block A',{start_at:'2026-10-11T15:00:00Z',end_at:'2026-10-11T17:00:00Z'});const result=await resolution.resolveTimeBlockCandidates('Move my Agent block to 3 PM tomorrow.',context({workspace_time_blocks:[overnight,secondBlock()]}));assert.equal(result.selectedId,undefined);assert.equal(result.candidates.length,2);});
test('move ignores invented model end time even across a DST fold',async()=>{const drafts=[];const ctx={...context({workspace_time_blocks:[existingBlock()]}),timeZone:'America/New_York',requestMessage:`Move time block ${blockId} to 00:30 on 2026-11-01.`};await collectProposal('propose_update_time_block',{timeBlockId:blockId,changes:{startAt:'2026-11-01T00:30',endAt:'2026-11-01T01:30'}},ctx,drafts);assert.equal(drafts[0].payload.endAt,'2026-11-01T06:00:00.000Z');});
