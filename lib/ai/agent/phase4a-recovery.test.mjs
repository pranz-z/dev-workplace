import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const data=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const cache=new Map();
function load(path){if(cache.has(path))return cache.get(path);let source=readFileSync(new URL(`../../../${path}`,import.meta.url),'utf8').replace(/import "server-only";/g,'');source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/["']@\/([^"'\n]+)["']/g,(_,dep)=>JSON.stringify(load(`${dep}.ts`))).replace(/"react"/g,JSON.stringify(data('export const useRef=x=>({current:x});export const useState=x=>[typeof x==="function"?x():x,()=>{}];'))).replace(/"react\/jsx-runtime"/g,JSON.stringify(data('export const jsx=(type,props)=>({type,props});export const jsxs=jsx;')));const u=data(source);cache.set(path,u);return u;}
const {AgentProposalCards}=await import(load('components/ai/AgentProposalCards.tsx'));
const action={id:'action',type:'create_time_block',entityId:null,taskId:null,projectId:null,title:'Focus',payload:{startAt:'2026-10-13T01:00:00Z',endAt:'2026-10-13T01:50:00Z'},before:{},diff:[{field:'startAt',before:null,after:'2026-10-13T01:00:00Z'}],status:'pending',expectedUpdatedAt:null};
function buttons(node,result=[]){if(!node||typeof node!=='object')return result;if(node.type==='button')result.push(node);const children=node.props?.children;for(const child of Array.isArray(children)?children:[children]){if(Array.isArray(child))child.forEach(n=>buttons(n,result));else buttons(child,result);}return result;}
for(const operation of ['apply','cancel'])test(`recovered pending ${operation} uses existing identifier-only endpoint`,async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);const calls=[];let current,refreshed=0;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({proposalBatch:{runId:'run',actions:[{...action,status:operation==='apply'?'applied':'cancelled'}]}})};};
 const tree=AgentProposalCards({batch:{runId:'run',actions:[action]},onChange:value=>current=value,onReview:()=>{},onApplied:async()=>{refreshed++;}});
 const button=buttons(tree).find(b=>b.props.children===(operation==='apply'?'Apply selected':'Cancel'));await button.props.onClick();
 // The click handler intentionally starts its async operation without returning it.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);assert.equal(calls[0].url,`/api/ai/agent/${operation}`);assert.deepEqual(JSON.parse(calls[0].options.body),{runId:'run',actionIds:['action']});assert.equal(current.actions[0].status,operation==='apply'?'applied':'cancelled');assert.equal(refreshed,operation==='apply'?1:0);
});
test('lost Apply response recovers applied status with GET and never replays the POST',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);const calls=[];let current;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(options.method==='POST')throw new Error('Transport lost');return {ok:true,json:async()=>({proposalBatch:{runId:'run',actions:[{...action,status:'applied',entityId:'created'}]}})};};
 const tree=AgentProposalCards({batch:{runId:'run',actions:[action]},onChange:value=>current=value,onReview:()=>{}});buttons(tree).find(b=>b.props.children==='Apply selected').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(current.actions[0].status,'applied');assert.equal(calls.filter(c=>c.options.method==='POST').length,1);assert.equal(calls[1].url,'/api/ai/agent/apply?runId=run');assert.equal(calls[1].options.method,undefined);
});
test('already-applied recovered actions have no approval controls',()=>{const tree=AgentProposalCards({batch:{runId:'run',actions:[{...action,status:'applied'}]},onChange:()=>{},onReview:()=>{}});assert.ok(!buttons(tree).some(b=>b.props.children==='Apply selected'));});
