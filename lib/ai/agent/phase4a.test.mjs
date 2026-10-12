import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const cache=new Map();function load(path){if(cache.has(path))return cache.get(path);const file=new URL(`../../../${path}.ts`,import.meta.url);let s=existsSync(file)?readFileSync(file,'utf8').replace(/import "server-only";/g,''):'export {}';s=ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/["']@\/([^"'\n]+)["']/g,(_,dep)=>JSON.stringify(load(dep)));const u=`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;cache.set(path,u);return u;}
const domain=await import(load('data/agentActivity'));
test('activity filters strictly validate bounds, dates, cursors and unknown input',()=>{
 assert.equal(typeof domain.parseActivityQuery,'function');assert.equal(domain.parseActivityQuery(new URLSearchParams()).limit,20);
 for(const query of ['limit=31','limit=0','limit=1.5','status=bad','from=bad','cursor=bad','userId=foreign','from=2026-10-13T00:00:00Z&to=2026-10-12T00:00:00Z'])assert.throws(()=>domain.parseActivityQuery(new URLSearchParams(query)));
});
for(const [type,label] of Object.entries({create_task:'Create task',update_task:'Update task',reschedule_milestone:'Reschedule milestone',reschedule_project:'Reschedule project',create_time_block:'Create time block',update_time_block:'Update time block',cancel_time_block:'Cancel time block',unknown:'Historical action'}))test(`history renders ${type} without raw data`,()=>{assert.equal(domain.actionLabel?.(type),label);});
test('mixed statuses produce honest counts and readable summaries',()=>{assert.equal(domain.runStatus?.({pending:1,applied:2,cancelled:1,conflict:1,failed:0}),'Pending approval');assert.equal(domain.runStatus({pending:0,applied:2,cancelled:1,conflict:0,failed:0}),'Mixed outcomes');});
test('time filters use profile timezone and half-open day boundaries',()=>{assert.deepEqual(domain.activityDateRange?.('today','Asia/Manila',new Date('2026-10-12T01:00Z')),{from:'2026-10-11T16:00:00.000Z',to:'2026-10-12T16:00:00.000Z'});});
test('timestamp filters accept offset boundaries, reject invalid calendar dates and preserve cursor precision',()=>{
 assert.doesNotThrow(()=>domain.parseActivityQuery(new URLSearchParams('from=2026-10-12T00:00:00%2B08:00')));
 assert.throws(()=>domain.parseActivityQuery(new URLSearchParams('from=2026-02-30T00:00:00Z')));
 const cursor={id:'33333333-3333-4333-8333-333333333333',createdAt:'2026-10-12T00:00:00.123456+00:00'};
 assert.deepEqual(domain.parseActivityQuery(new URLSearchParams(domain.activityQueryString({limit:20,cursor}))).cursor,cursor);
});
test('late pagination replies are aborted when Activity unmounts',()=>{const source=readFileSync(new URL('../../../components/ai/AgentActivity.tsx',import.meta.url),'utf8');assert.match(source,/return\(\)=>\{controller.abort\(\);listAbort.current\?\.abort\(\);\}/);});
test('Activity UI reuses canonical approval cards and does not implement mutation requests',()=>{const file=new URL('../../../components/ai/AgentActivity.tsx',import.meta.url);assert.ok(existsSync(file));const source=readFileSync(file,'utf8');assert.match(source,/AgentProposalCards/);assert.match(source,/Refresh status/);assert.doesNotMatch(source,/method:\s*["']POST|JSON\.stringify|generateAgentResponse|localStorage/);});
test('Activity is reachable in Workspace AI and routes review to Agent composer without sending',()=>{const source=readFileSync(new URL('../../../components/ai/WorkspaceAiChat.tsx',import.meta.url),'utf8');assert.match(source,/<AgentActivity/);assert.match(source,/setMode\("agent"\);\s*setMessage\(prompt\)/);});
test('Activity navigation reuses entity openers and Calendar selects persisted block date',()=>{const app=readFileSync(new URL('../../../app/app/page.tsx',import.meta.url),'utf8');assert.match(app,/onActivityNavigate=/);assert.match(app,/activityTarget=\{activityCalendarTarget\}/);const calendar=readFileSync(new URL('../../../components/calendar/WorkspaceCalendar.tsx',import.meta.url),'utf8');assert.match(calendar,/activityTarget/);});
test('read service scopes RPCs to authenticated owner and projects away payloads',async()=>{
 const service=await import(load('lib/ai/agent/activity'));assert.equal(typeof service.listAgentRuns,'function');
 const calls=[];const admin={async rpc(name,args){calls.push({name,args});return {data:{items:[{id:'run',createdAt:'2026-10-12T09:00Z',completedAt:null,counts:{pending:1,applied:0,cancelled:0,conflict:0,failed:0},actionCount:1,primaryEntityLabel:'Task',payload:{secret:'HIDDEN'}}],nextCursor:null},error:null};}};
 const page=await service.listAgentRuns(admin,'owner',{limit:20});assert.equal(calls[0].args.p_user_id,'owner');assert.equal(page.items[0].status,'Pending approval');assert.doesNotMatch(JSON.stringify(page),/payload|HIDDEN/);
});
test('unknown or deleted navigation is non-navigable; foreign run detail denied',async()=>{
 const service=await import(load('lib/ai/agent/activity'));assert.equal(typeof service.getAgentRun,'function');
 await assert.rejects(service.getAgentRun({rpc:async()=>({data:null,error:null})},{},'owner','foreign','UTC'));
 const raw={id:'run',createdAt:'2026-10-12T09:00Z',counts:{pending:0,applied:1,cancelled:0,conflict:0,failed:0},actionCount:1,actions:[{id:'action',runId:'run',actionType:'update_task',entityId:'deleted',title:'Deleted task',status:'applied',createdAt:'2026-10-12T09:00Z',diff:[],payload:{secret:'HIDDEN'}}]};
 const queries=[];const scoped={from(table){const q={select(){return q;},eq(k,v){queries.push([table,k,v]);return q;},async maybeSingle(){return {data:null,error:null};}};return q;}};
 const result=await service.getAgentRun({rpc:async()=>({data:raw,error:null})},scoped,'owner','run','UTC');assert.equal(result.actions[0].entityState,'missing');assert.equal(result.actions[0].navigationTarget,null);assert.ok(queries.some(q=>q[1]==='user_id'&&q[2]==='owner'));assert.doesNotMatch(JSON.stringify(result),/payload|HIDDEN/);
});

test('historical action families resolve only owned entity targets, including milestones and time blocks',async()=>{
 const service=await import(load('lib/ai/agent/activity'));
 const types=['create_task','update_task','reschedule_milestone','reschedule_project','create_time_block','update_time_block','cancel_time_block','future_action'];
 const actions=types.map((actionType,i)=>({id:`a${i}`,actionType,entityId:`entity${i}`,title:'History',status:'applied',createdAt:'2026-10-12T01:00Z',diff:[]}));
 const queries=[];const scoped={from(table){const filters=[];const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},async maybeSingle(){queries.push({table,filters});return {data:{id:'entity',title:'Owned item',project_id:'project',start_at:'2026-10-12T20:00:00Z'},error:null};}};return q;}};
 const result=await service.getAgentRun({rpc:async()=>({data:{id:'run',counts:{applied:8},actions},error:null})},scoped,'owner','run','Asia/Manila');
 assert.deepEqual(result.actions.map(a=>a.navigationTarget?.type??null),['task','task','milestone','project','time_block','time_block','time_block',null]);assert.equal(result.actions[4].navigationTarget.date,'2026-10-13');assert.equal(result.actions[7].entityState,'unsupported');assert.ok(queries.every(q=>q.filters.some(([key,value])=>['user_id','projects.user_id'].includes(key)&&value==='owner')));
});
for(const status of ['conflict','failed'])test(`${status} history uses existing safe time-block review with owned names and no UUID leakage`,async()=>{
 const service=await import(load('lib/ai/agent/activity')),taskId='11111111-1111-4111-8111-111111111111',projectId='22222222-2222-4222-8222-222222222222';
 const draft={id:'action',type:'create_time_block',title:'Focus',entityId:null,projectId,payload:{taskId,projectId,startAt:'2026-10-13T01:00:00Z',endAt:'2026-10-13T01:50:00Z'},before:{},status};
 const admin={rpc:async name=>({data:name==='get_agent_proposal_batch'?{runId:'run',actions:[draft]}:{id:'run',counts:{[status]:1},actions:[{...draft,actionType:draft.type,createdAt:'2026-10-12T01:00Z',diff:[]}]},error:null})};
 const scoped={from(table){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{title:table==='tasks'?'gmail':'dev-workplace'},error:null})};return q;}};
 const result=await service.getAgentRun(admin,scoped,'owner','run','Asia/Manila'),prompt=result.actions[0].reviewPrompt;assert.match(prompt,/50-minute slot on 2026-10-13 for gmail in dev-workplace/);assert.ok(!prompt.includes(taskId)&&!prompt.includes(projectId));
});
