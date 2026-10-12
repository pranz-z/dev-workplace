import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url),root=new URL('../../../',import.meta.url);
function component(path,seed=[]){let states=[...seed],cursor=0;const refs=[];let refCursor=0;
 const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect(){},useRef(initial){const i=refCursor++;return refs[i]??(refs[i]={current:initial});}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const source=readFileSync(new URL(file,root),'utf8').replace(/import ["']server-only["'];/g,'');new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name.startsWith('@/')){const base=name.slice(2);return load(base+(existsSync(new URL(base+'.ts',root))?'.ts':'.tsx'));}return require(name);},exports);return exports;}
 const fn=Object.values(load(path)).find(v=>typeof v==='function');return {render(props){cursor=0;refCursor=0;return fn(props);},states};
}
function nodes(tree,result=[]){if(!tree||typeof tree!=='object')return result;result.push(tree);for(const child of [tree.props?.children].flat(3))nodes(child,result);return result;}
const text=tree=>nodes(tree).flatMap(n=>[n.props?.children].flat(3)).filter(v=>typeof v==='string').join(' ');
const action={id:'source-action',runId:'source-run',actionType:'update_task',entityId:'task',title:'Task',status:'applied',diff:[],humanSummary:'Update task',entityLabel:'Task',entityState:'available',createdAt:'2026-10-12T01:00Z',approvedAt:null,executedAt:'2026-10-12T01:00Z',undo:{state:'available',reason:'AVAILABLE',explanation:'Safe to prepare'}};
const counts={pending:0,applied:1,cancelled:0,conflict:0,failed:0};
function activity(item=action){const run={id:'source-run',createdAt:action.createdAt,completedAt:null,summary:'Applied',counts,actions:[item]};return component('components/ai/AgentActivity.tsx',[{items:[],nextCursor:null},'','7',0,false,'','source-run',run,null,false,'',0]);}
const props={timeZone:'UTC',entityLabels:new Map(),onReview(){}};
test('selecting the already-expanded run preserves its recovered approval batch',()=>{
 const c=activity();c.states[0]={items:[{id:'source-run',createdAt:action.createdAt,counts,actionCount:1,summary:'Applied',status:'Applied',primaryEntityLabel:'Task'}],nextCursor:null};const batch={runId:'source-run',actions:[]};c.states[8]=batch;
 const tree=c.render(props),button=nodes(tree).find(n=>n.type==='button'&&n.props['aria-expanded']===true);assert.ok(button);button.props.onClick();assert.equal(c.states[8],batch);
});
test('inverse milestone diffs show owned labels while legacy milestone display strings remain readable',()=>{
 const id='55555555-5555-4555-8555-555555555555',c=component('components/ai/AgentProposalCards.tsx');
 const inverse={id:'inverse',type:'update_task',title:'Task',status:'pending',payload:{milestoneId:id},before:{milestoneId:null},diff:[{field:'milestoneId',before:null,after:id}]};
 const tree=c.render({batch:{runId:'run',actions:[inverse]},entityLabels:new Map([['milestone:'+id,'Owned milestone']]),onChange(){},onReview(){}});assert.match(text(tree),/Owned milestone/);assert.doesNotMatch(text(tree),new RegExp(id));
 const legacy=c.render({batch:{runId:'run',actions:[{...inverse,diff:[{field:'milestoneId',before:'Previous name',after:'Legacy name'}]}]},onChange(){},onReview(){}});assert.match(text(legacy),/Legacy name/);
});
test('Activity displays available/unavailable/pending/reversed states and direct inverse lineage',()=>{
 for(const [state,reason,label] of [['available','AVAILABLE','Prepare undo'],['unsafe','HISTORY_INCOMPLETE','Cannot safely reverse'],['unsupported','UNSUPPORTED_ACTION','Cannot safely reverse'],['entity_missing','ENTITY_MISSING','Cannot safely reverse'],['state_changed','STATE_CHANGED','Cannot safely reverse']]){const c=activity({...action,undo:{state,reason,explanation:label==='Prepare undo'?'Review':'Cannot safely reverse'}});assert.match(text(c.render(props)),new RegExp(label));}
 const pending=activity({...action,undo:{...action.undo,reason:'PENDING_INVERSE',existingInverse:{runId:'inverse-run',actionId:'inverse',createdAt:action.createdAt,status:'pending'}}});assert.match(text(pending.render(props)),/Review undo proposal/);
 const reversed=activity({...action,undo:{state:'already_reversed',reason:'ALREADY_REVERSED',explanation:'Reversed'},reversedBy:{runId:'inverse-run',actionId:'inverse',createdAt:action.createdAt},undoOf:{runId:'older-run',actionId:'older',createdAt:action.createdAt}});assert.match(text(reversed.render(props)),/Reversed by/);assert.match(text(reversed.render(props)),/Undo of action from/);
});
test('Activity prepares using source identifiers only, displays canonical inverse, and ignores reply after navigation',async t=>{
 const previous=globalThis.fetch;t.after(()=>globalThis.fetch=previous);const calls=[];let resolve;
 globalThis.fetch=(url,options)=>{calls.push({url,options});return new Promise(r=>resolve=r);};
 const c=activity(),tree=c.render(props),button=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Prepare undo');assert.ok(button);button.props.onClick();await new Promise(r=>setImmediate(r));assert.deepEqual(JSON.parse(calls[0].options.body),{runId:'source-run',actionId:'source-action'});assert.equal(calls[0].url,'/api/ai/agent/activity/undo-proposal');
 // Close details invalidates in-flight identity immediately, even before effects run.
 nodes(c.render(props)).find(n=>n.type==='button'&&n.props.children==='Close details').props.onClick();resolve({ok:true,json:async()=>({eligibility:action.undo,proposalBatch:{runId:'inverse-run',actions:[]}})});await new Promise(r=>setImmediate(r));assert.equal(c.states[8],null);
});
test('inverse cards label source and keep existing Apply/Cancel identifiers and lost-response recovery',async t=>{
 const previous=globalThis.fetch;t.after(()=>globalThis.fetch=previous);const calls=[];let updated;
 const inverse={id:'inverse',type:'update_task',title:'Task',status:'pending',payload:{title:'Before'},before:{title:'After'},diff:[{field:'title',before:'After',after:'Before'}],undoOf:{runId:'source-run',actionId:'source-action',createdAt:action.createdAt}};
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(options.method==='POST')throw Error('Lost');return {ok:true,json:async()=>({proposalBatch:{runId:'inverse-run',actions:[{...inverse,status:'applied'}]}})};};
 const c=component('components/ai/AgentProposalCards.tsx'),tree=c.render({batch:{runId:'inverse-run',actions:[inverse]},onChange:b=>updated=b,onReview(){}});assert.match(text(tree),/Undo proposal/);assert.match(text(tree),/Nothing has changed yet/);
 nodes(tree).find(n=>n.type==='button'&&n.props.children==='Apply selected').props.onClick();await new Promise(r=>setImmediate(r));assert.deepEqual(JSON.parse(calls[0].options.body),{runId:'inverse-run',actionIds:['inverse']});assert.equal(calls.length,2);assert.equal(calls[1].url,'/api/ai/agent/apply?runId=inverse-run');assert.equal(updated.actions[0].status,'applied');assert.ok(updated.actions[0].undoOf);
});
