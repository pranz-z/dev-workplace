import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
Error.stackTraceLimit=0;
const require=createRequire(import.meta.url),root=new URL('../../../',import.meta.url);
function component(path){let states=[],cursor=0;const refs=[];let refCursor=0;
 const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useEffect(){},useRef(initial){const i=refCursor++;return refs[i]??(refs[i]={current:initial});}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const source=readFileSync(new URL(file,root),'utf8').replace(/import ["']server-only["'];/g,'');new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>name==='react'?react:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name.startsWith('@/')?load(name.slice(2)+(existsSync(new URL(name.slice(2)+'.ts',root))?'.ts':'.tsx')):require(name),exports);return exports;}
 const fn=Object.values(load(path)).find(v=>typeof v==='function');return {load,states,render(props){cursor=0;refCursor=0;return fn(props);}};
}
function nodes(tree,result=[]){if(!tree||typeof tree!=='object')return result;result.push(tree);for(const c of [tree.props?.children].flat(4))nodes(c,result);return result;}
const text=tree=>nodes(tree).flatMap(n=>[n.props?.children].flat(4)).filter(v=>typeof v==='string').join(' ');
const project='33333333-3333-4333-8333-333333333333',id='55555555-5555-4555-8555-555555555555';
const create={id,type:'create_milestone',entityId:null,taskId:null,projectId:project,title:'Milestone',payload:{title:'Milestone',description:'',status:'pending',targetDate:null},before:{},diff:[{field:'title',before:null,after:'Milestone'},{field:'description',before:null,after:''},{field:'status',before:null,after:'pending'},{field:'targetDate',before:null,after:null}],status:'pending'};
const props=a=>({batch:{runId:project,actions:[a]},entityLabels:new Map([['project:'+project,'Owned project']]),onChange(){},onReview(){}});
test('milestone_cards_show_create_parent_and_changed_update_fields',()=>{
 const c=component('components/ai/AgentProposalCards.tsx');const tree=c.render(props(create));
 assert.match(text(tree),/Create milestone/);assert.match(text(tree),/Owned project/);assert.match(text(tree),/Pending/);assert.doesNotMatch(text(tree),new RegExp(project));
 const update=c.render(props({...create,type:'update_milestone',payload:{description:'After'},diff:[{field:'description',before:'Before',after:'After'}]}));assert.match(text(update),/Update milestone/);assert.match(text(update),/Before/);assert.match(text(update),/After/);assert.doesNotMatch(text(update),/Target date/);
});
test('unknown_kind_is_display_only_without_task_label_or_apply',()=>{
 const c=component('components/ai/AgentProposalCards.tsx'),tree=c.render(props({...create,type:'future_action',status:'pending'}));assert.match(text(tree),/Unsupported action/);assert.doesNotMatch(text(tree),/Task:/);assert.equal(nodes(tree).some(n=>n.type==='button'&&n.props.children==='Apply selected'),false);assert.equal(nodes(tree).some(n=>n.type==='input'),false);
});
test('milestone_lost_apply_response_recovers_and_refreshes_once',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);const calls=[];let refreshes=0,changed;
 const c=component('components/ai/AgentProposalCards.tsx'),p={...props(create),onApplied:async()=>refreshes++,onChange:b=>changed=b};
 globalThis.fetch=async(url,options)=>{calls.push([url,options]);if(options.method)throw new Error('Lost response');return {ok:true,json:async()=>({proposalBatch:{runId:project,actions:[{...create,status:'applied',entityId:id}]}})};};
 const button=nodes(c.render(p)).find(n=>n.type==='button'&&n.props.children==='Apply selected');button.props.onClick();await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(JSON.parse(calls[0][1].body),{runId:project,actionIds:[id]});assert.equal(calls[1][0],'/api/ai/agent/apply?runId='+project);assert.equal(refreshes,1);assert.equal(changed.actions[0].entityId,id);
});
test('milestone_review_again_uses_correct_parent_or_target_and_labels',()=>{
 const c=component('components/ai/AgentProposalCards.tsx');const {buildAgentReviewPrompt}=c.load('data/agentProposalReview.ts');
 assert.match(buildAgentReviewPrompt(create,'UTC',props(create).entityLabels),/milestone.*Owned project/);
 assert.match(buildAgentReviewPrompt({...create,type:'update_milestone',entityId:id},'UTC'),/milestone/);
 const {actionLabel}=c.load('data/agentActivity.ts');assert.equal(actionLabel('create_milestone'),'Created milestone');assert.equal(actionLabel('update_milestone'),'Updated milestone');
});
test('milestone_activity_resolves_owned_target_and_projects_only_safe_fields',async()=>{
 const c=component('components/ai/AgentProposalCards.tsx'),{getAgentRun}=c.load('lib/ai/agent/activity.ts'),calls=[];
 const row={id,runId:project,actionType:'update_milestone',entityId:id,title:'Milestone',status:'applied',createdAt:'2026-10-13T00:00Z',payload:{secret:'must not leak'},before_state:{secret:'must not leak'},expectedUpdatedAt:'private',diff:[],errorCode:'SQL INTERNAL'};
 const admin={rpc:async name=>{calls.push(name);return {data:{id:project,createdAt:row.createdAt,actions:[row],counts:{applied:1}}};}};
 const filters=[],client={from(table){assert.equal(table,'milestones');return {select(){return this;},eq(k,v){filters.push([k,v]);return this;},async maybeSingle(){return {data:{id,title:'Owned milestone',project_id:project}};}};}};
 const run=await getAgentRun(admin,client,id,project,'UTC');assert.equal(run.actions[0].navigationTarget.type,'milestone');assert.equal(run.actions[0].humanSummary,'Updated milestone');assert.equal(run.actions[0].errorCode,null);assert.ok(filters.some(([k])=>k==='projects.user_id'));
 for(const key of ['payload','before_state','expectedUpdatedAt'])assert.equal(Object.hasOwn(run.actions[0],key),false);
 await getAgentRun(admin,client,id,project,'UTC');assert.deepEqual(calls,['get_agent_activity_run','get_agent_activity_run']);
});
test('existing_onAgentApplied_refreshes_milestones_and_project_progress',async()=>{
 const source=ts.createSourceFile('page.tsx',readFileSync(new URL('app/app/page.tsx',root),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback;
 function visit(node){if(ts.isJsxAttribute(node)&&node.name.getText(source)==='onAgentApplied')callback=node.initializer.expression;ts.forEachChild(node,visit);}visit(source);assert.ok(callback);
 const remote={tasks:[{id:'task'}],projects:[{id:project,progress:100}],milestones:[{id,status:'completed'}]},seen={};
 const invoke=new Function('loadWorkspaceData','setTasks','setProjects','setMilestones',`return (${callback.getText(source)});`)(async()=>remote,v=>seen.tasks=v,v=>seen.projects=v,v=>seen.milestones=v);
 await invoke();assert.deepEqual(seen,remote);
});

test('unknown_failed_and_conflict_activity_is_display_only_without_task_review',async()=>{
 const c=component('components/ai/AgentProposalCards.tsx'),{getAgentRun}=c.load('lib/ai/agent/activity.ts');
 for(const status of ['failed','conflict']){
  const row={id,runId:project,actionType:'future_action',entityId:id,title:'New entity',status,createdAt:'2026-10-13T00:00Z',diff:[]};
  const admin={rpc:async name=>({data:name==='get_agent_proposal_batch'?{runId:project,actions:[{...row,type:row.actionType,payload:{},projectId:null}]}:{id:project,createdAt:row.createdAt,actions:[row],counts:{[status]:1}}})};
  const client={from(){throw new Error('Unsupported action must not load a guessed entity table');}};
  const action=(await getAgentRun(admin,client,id,project,'UTC')).actions[0];
  assert.equal(action.entityState,'unsupported');assert.equal(action.reviewPrompt,undefined);assert.equal(action.navigationTarget,null);
 }
});
