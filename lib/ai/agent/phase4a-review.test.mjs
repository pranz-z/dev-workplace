import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
function callback(path,predicate,scope){const source=ts.createSourceFile(path,readFileSync(new URL(`../../../${path}`,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let match;function visit(node){if(ts.isCallExpression(node)&&predicate(node))match=node.arguments[0];ts.forEachChild(node,visit);}visit(source);assert.ok(match);const exports={};new Function(...Object.keys(scope),'exports',ts.transpileModule(`exports.callback=${match.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(...Object.values(scope),exports);return exports.callback;}
test('Calendar consumes Activity navigation once even when block list refreshes',async()=>{
 const block={id:'block'},activityTarget={id:'block',date:'2026-10-13',request:1};let opened=0,handled=0;
 const effect=callback('components/calendar/WorkspaceCalendar.tsx',node=>node.expression.getText()==='useEffect'&&node.arguments[0].getText().includes('setEditingBlock'),{activityTarget,blockLoading:false,blocks:[block],setEditingBlock:()=>opened++,onActivityTargetHandled:()=>handled++,handledActivityRequest:{current:null}});
 effect();await Promise.resolve();effect();await Promise.resolve();assert.equal(opened,1);assert.equal(handled,1);
 const app=readFileSync(new URL('../../../app/app/page.tsx',import.meta.url),'utf8');assert.match(app,/onActivityTargetHandled=\{\(\)=>setActivityCalendarTarget\(null\)\}/);
});
test('closing details clears busy state after the in-flight read is aborted',async()=>{
 let busy=true;const effect=callback('components/ai/AgentActivity.tsx',node=>node.expression.getText()==='useEffect'&&node.arguments[0].getText().includes('setDetailBusy'),{runId:null,setDetailBusy:value=>busy=value,setDetail:()=>{},setBatch:()=>{},setDetailError:()=>{}});effect();await Promise.resolve();assert.equal(busy,false);
});
test('Workspace AI resolves existing owned milestone labels for history diffs',()=>{
 const labels=callback('components/ai/WorkspaceAiChat.tsx',node=>node.expression.getText()==='useMemo'&&node.arguments[0].getText().includes('new Map'),{projects:[],tasks:[],plans:[],milestones:[{id:'m1',title:'Alpha'},{id:'m2',title:'Beta'}]})();assert.equal(labels.get('milestone:m1'),'Alpha');assert.equal(labels.get('milestone:m2'),'Beta');
});
