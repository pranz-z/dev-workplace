import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const url = (s) => `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  let source = readFileSync(new URL(`../../../${path}.ts`, import.meta.url), "utf8").replace(/import "server-only";/g, "");
  source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/"@\/([^"\n]+)"/g, (_, dep) => JSON.stringify(load(dep)));
  const value = url(source); cache.set(path, value); return value;
}
const validation = await import(load("lib/ai/agent/proposal-schema"));
const proposals = await import(load("lib/ai/agent/proposals"));
const owner = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const taskId = "33333333-3333-4333-8333-333333333333";
const milestoneId = "44444444-4444-4444-8444-444444444444";
const task = { id: taskId, user_id: owner, project_id: projectId, title: "Actual title", description: "", status: "Backlog", priority: "Low", due_date: null, milestone_id: null, updated_at: "2026-10-08T00:00:00Z", projects: { id: projectId, user_id: owner, title: "Workspace" } };
function database(rows) {
  const calls = [];
  return { calls, from(table) {
    const filters = [];
    const query = { select() { return this; }, eq(k,v) { filters.push([k,v]); return this; }, abortSignal() { return this; }, async maybeSingle() {
      calls.push(table);
      return { data: (rows[table] ?? []).find(row => filters.every(([k,v]) => k.includes(".") ? row.projects?.[k.split(".")[1]] === v : row[k] === v)) ?? null, error: null };
    } }; return query;
  } };
}
const ctx = (rows = {}) => ({ supabase: database({ tasks: [task], projects: [{ id: projectId, user_id: owner, title: "Workspace" }], ...rows }), userId: owner, timeZone: "Asia/Manila", now: new Date(), signal: new AbortController().signal });

const { executeReadTool } = await import(load("lib/ai/agent/tools"));
const { parseToolArguments } = await import(load("lib/ai/agent/schemas"));
const { runAgentLoop } = await import(load("lib/ai/agent/executor"));
const { proposalSummary } = await import(load("lib/ai/agent/schedule-summary"));
const { localCalendarDate } = await import(load("data/workspaceCalendar"));
const { applySelectedActions } = await import(load("lib/ai/agent/store"));
test("proposal cards label cleared dates as Unscheduled", async () => {
  let source = readFileSync(new URL("../../../components/ai/AgentProposalCards.tsx", import.meta.url), "utf8").split("interface Props")[0].replace(/import \{ useRef, useState \} from "react";/, "");
  source = ts.transpileModule(`${source}\nexport { display };`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/"@\/([^"\n]+)"/g, (_, dep) => JSON.stringify(load(dep)));
  const { display } = await import(url(source));
  assert.equal(display("dueDate", null), "Unscheduled");
  assert.equal(display("targetDate", null), "Unscheduled");
  assert.equal(display("description", null), "None");
});
for (const entity of ["milestone", "project"]) {
  const id = entity === "project" ? projectId : milestoneId;
  const name = `propose_reschedule_${entity}`;
  const input = targetDate => ({ [`${entity}Id`]: id, targetDate });
  const row = { id, user_id: owner, project_id: projectId, title: "Authoritative title", target_date: "2026-10-10", updated_at: task.updated_at, projects: { user_id: owner } };
  const context = () => ctx({ [entity === "project" ? "projects" : "milestones"]: [row] });
  test(`${entity}: strict date-only schema accepts null and valid leap dates`, () => {
    assert.equal(validation.parseProposalTool(name,input(null)).targetDate,null);
    assert.equal(validation.parseProposalTool(name,input("2028-02-29")).targetDate,"2028-02-29");
    for(const targetDate of [undefined,"tomorrow","Friday","2026-02-29","2026-04-31","2026-10-10T00:00:00Z",42,{},"2026-1-01"]) assert.throws(()=>validation.parseProposalTool(name,input(targetDate)));
    for(const extra of [{title:"Forged"},{userId:owner},{before:{targetDate:null}},{status:"Completed"},{projectId:taskId}]) {
      if (entity === "project" && Object.hasOwn(extra,"projectId")) continue;
      assert.throws(()=>validation.parseProposalTool(name,{...input(null),...extra}));
    }
  });
  test(`${entity}: proposal-only, authoritative identity/version, merge and clear`,async()=>{
    const c=context(), drafts=[];
    await proposals.collectProposal(name,input("2026-10-20"),c,drafts);
    assert.equal(row.target_date,"2026-10-10");
    assert.equal(drafts[0].title,row.title);assert.equal(drafts[0].entityId,id);
    assert.equal(drafts[0].expectedUpdatedAt,row.updated_at);
    assert.deepEqual(drafts[0].diff,[{field:"targetDate",before:"2026-10-10",after:"2026-10-20"}]);
    await proposals.collectProposal(name,input(null),c,drafts);
    assert.equal(drafts.length,1);assert.equal(drafts[0].payload.targetDate,null);
    await assert.rejects(proposals.collectProposal(name,input("2026-10-10"),c,[]));
  });
  test(`${entity}: ownership, parent ownership, cap and changed version rejected`,async()=>{
    const table=entity==="project"?"projects":"milestones";
    for(const bad of [{...row,user_id:taskId,projects:{user_id:taskId}},undefined]) await assert.rejects(proposals.collectProposal(name,input(null),ctx({[table]:bad?[bad]:[]}),[]));
    await assert.rejects(proposals.collectProposal(name,input(null),context(),Array.from({length:10},()=>({type:"create_task"}))));
    const drafts=[];await proposals.collectProposal(name,input(null),context(),drafts);
    drafts[0].expectedUpdatedAt="old";await assert.rejects(proposals.collectProposal(name,input(null),context(),drafts));
  });
}
test("task dates null/date/clear stay proposal-only with canonical Calendar semantics",async()=>{
  for(const [before,after] of [[null,"2026-10-12"],["2026-10-08","2026-10-12"],["2026-10-08",null]]){
    const drafts=[];const c=ctx({tasks:[{...task,due_date:before}]});
    await proposals.collectProposal("propose_update_task",{taskId,changes:{dueDate:after}},c,drafts);
    assert.deepEqual(drafts[0].diff,[{field:"dueDate",before,after}]);assert.deepEqual(c.supabase.calls,["tasks"]);
  }
});
test("date load validates inclusive maximum 31 days, project UUID and whitelist",()=>{
  assert.ok(parseToolArguments("get_calendar_load",{startDate:"2026-10-01",endDate:"2026-10-31"}));
  for(const input of [{startDate:"2026-10-01",endDate:"2026-11-01"},{startDate:"2026-10-10",endDate:"2026-10-01"},{startDate:"2026-02-30",endDate:"2026-03-01"},{startDate:"2026-10-01",endDate:"2026-10-02",includeCompleted:true}]) assert.throws(()=>parseToolArguments("get_calendar_load",input));
});
function scanDatabase(rows) {
  return {from(table){const filters=[];return {select(){return this;},order(){return this;},abortSignal(){return this;},eq(k,v){filters.push([k,v]);return this;},async range(start,end){return {data:(rows[table]??[]).filter(row=>filters.every(([k,v])=>k.includes(".")?row.projects?.user_id===v:row[k]===v)).slice(start,end+1),error:null};}};}};
}
test("calendar load counts incomplete entities and zero days without leaking records",async()=>{
  const c=ctx();c.supabase=scanDatabase({projects:[{id:projectId,user_id:owner,title:"Private project",target_date:"2026-10-12",status:"In Progress"}],tasks:[task,{...task,id:milestoneId,due_date:"2026-10-12"},{...task,id:owner,due_date:"2026-10-12",status:"Completed"}],milestones:[{id:milestoneId,project_id:projectId,projects:{user_id:owner},target_date:"2026-10-12",status:"active"}]});
  const result=await executeReadTool("get_calendar_load",{startDate:"2026-10-12",endDate:"2026-10-13"},c);
  assert.deepEqual(result.items,[{date:"2026-10-12",incompleteTasks:1,milestones:1,projects:1},{date:"2026-10-13",incompleteTasks:0,milestones:0,projects:0}]);
  assert.equal(result.truncated,false);assert.ok(!JSON.stringify(result).includes("Private project"));
});
test("calendar load scan cap explicitly reports partial counts",async()=>{
  const c=ctx();c.supabase=scanDatabase({projects:[{id:projectId,user_id:owner}],tasks:Array.from({length:1001},()=>({...task,due_date:"2026-10-12"}))});
  const result=await executeReadTool("get_calendar_load",{startDate:"2026-10-12",endDate:"2026-10-12"},c);
  assert.equal(result.items[0].incompleteTasks,1000);assert.equal(result.truncated,true);
});
test("milestone-scoped task read excludes other milestones and completed tasks",async()=>{
  const c=ctx();c.supabase=scanDatabase({projects:[{id:projectId,user_id:owner}],tasks:[{...task,milestone_id:milestoneId},{...task,id:owner,milestone_id:projectId},{...task,id:milestoneId,milestone_id:milestoneId,status:"Completed"}]});
  const result=await executeReadTool("list_tasks",{projectId,milestoneId},c);assert.equal(result.items.length,1);assert.equal(result.items[0].id,taskId);
});
test("workspace local today and tomorrow cross UTC boundary correctly",()=>{
  const now=new Date("2026-10-08T23:30:00Z");
  assert.equal(localCalendarDate(now,"Asia/Manila"),"2026-10-09");
  const tomorrow=new Date(Date.parse(localCalendarDate(now,"Asia/Manila"))+86400000).toISOString().slice(0,10);assert.equal(tomorrow,"2026-10-10");
  assert.equal(localCalendarDate(now,"America/Los_Angeles"),"2026-10-08");
  const gemini=readFileSync(new URL("./gemini.ts",import.meta.url),"utf8");assert.match(gemini,/localCalendarDate\(context.now, context.timeZone\)/);
});
test("plan loop reads workload and produces grouped mixed pending proposals with warnings",async()=>{
  const c=ctx({projects:[{id:projectId,user_id:owner,title:"Project",target_date:null,updated_at:task.updated_at}],milestones:[{id:milestoneId,project_id:projectId,projects:{user_id:owner},title:"Milestone",target_date:null,updated_at:task.updated_at}]});
  let round=0;
  const result=await runAgentLoop({message:"Plan next week",history:[],timeZone:c.timeZone},c,async()=>{
    round++;if(round===1)return {parts:[{functionCall:{name:"get_calendar_load",args:{startDate:"2026-10-12",endDate:"2026-10-16"}}}]};
    if(round===2)return {parts:[{functionCall:{name:"propose_update_task",args:{taskId,changes:{dueDate:"2026-10-12"}}}},{functionCall:{name:"propose_reschedule_milestone",args:{milestoneId,targetDate:"2026-10-13"}}},{functionCall:{name:"propose_reschedule_project",args:{projectId,targetDate:"2026-10-16"}}}]};
    return {parts:[{text:"I scheduled your whole week!"}]};
  },async()=>({items:[{date:"2026-10-12",incompleteTasks:4,milestones:1,projects:0}],truncated:true}));
  assert.equal(result.drafts.length,3);assert.match(result.answer,/Monday/);assert.match(result.answer,/Existing load: 4/);assert.match(result.answer,/Partial results/);assert.match(result.answer,/Only the listed actions/);assert.doesNotMatch(result.answer,/scheduled your whole week/);
});
test("mixed Apply dispatches only canonical identifiers and no model",async()=>{
  const actions=[{id:taskId,type:"update_task"},{id:milestoneId,type:"reschedule_milestone"},{id:projectId,type:"reschedule_project"}],calls=[];
  await applySelectedActions({rpc:async(name,args)=>{calls.push([name,args]);return {data:{id:args.p_action_id,status:"applied"}};}},owner,{runId:owner,actions},actions.map(a=>a.id));
  assert.deepEqual(calls.map(c=>c[0]),["apply_agent_task_action","apply_agent_schedule_action","apply_agent_schedule_action"]);assert.ok(calls.every(c=>Object.keys(c[1]).length===3));
});
test("summary can disclose dependency targets without hard conflicts",()=>{
  const drafts=[{title:"Project",type:"reschedule_project",projectId,payload:{targetDate:"2026-10-12"},diff:[{field:"targetDate",before:null,after:"2026-10-12"}]},{title:"Task",type:"update_task",projectId,payload:{dueDate:"2026-10-13"},diff:[{field:"dueDate",before:null,after:"2026-10-13"}]}];
  assert.match(proposalSummary(drafts,[],false),/Check dependencies/);
});

test("planning prompt batches discovery and reserves rounds within existing caps",()=>{
 const prompt=readFileSync(new URL("./prompt.ts",import.meta.url),"utf8");
 assert.match(prompt,/single response/);assert.match(prompt,/Do not chain/);assert.match(prompt,/six model rounds/);assert.match(prompt,/reserve.*proposal/);
});
