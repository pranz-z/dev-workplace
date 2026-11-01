import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import ts from 'typescript';
const path=new URL('../../../components/ai/AgentOneShotAuthorization.tsx',import.meta.url);
const candidate={parentId:'parent',previewIdentity:'fingerprint',projectTitle:'Selected project',signalTitle:'Selected signal',family:'quiet_project',reasonCodes:['PROJECT_QUIET'],contentRevision:1,
 slot:'2026-11-01T08:00:00Z',expiresAt:'2026-11-01T08:10:00Z',evidenceValidUntil:'2026-11-02T00:00:00Z',provider:'gemini',model:'fixture-model',
 context:'{"primaryAlias":"P1","signals":[{"title":"Selected project","facts":{"thresholdDays":14}}]}',maxProviderRequests:1,billingTreatment:'unknown_free'};
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
const text=t=>t==null||typeof t==='boolean'?'':typeof t!=='object'?String(t):Array.isArray(t)?t.map(text).join(' '):text(t.props?.children);
function host(){
 assert.ok(existsSync(path),'One-shot owner UI missing');
 let tree,cursor=0,states=[],effects=[],created=0,items=[],loads=0;const calls=[];
 const service={list:async()=>{loads++;return {items,candidates:[candidate]};},preview:async id=>{calls.push(['preview',id]);return candidate;},
 create:async input=>{created++;calls.push(['create',input]);items=[{id:'authorization',projectTitle:'Selected project',signalTitle:'Selected signal',status:'pending',slot:candidate.slot,expiresAt:candidate.expiresAt,
  provider:'gemini',model:'fixture-model',reason:null,accounting:{allowanceConsumed:false,sendAttempted:false,transport:'not_started',responseReceived:false,output:'none',publicationCompleted:false}}];return items[0];},
 cancel:async id=>{calls.push(['cancel',id]);items[0]={...items[0],status:'cancelled'};return items[0];}};
 const react={useState:init=>{const i=cursor++;if(!(i in states))states[i]=typeof init==='function'?init():init;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
 useRef:init=>{const i=cursor++;return states[i]??=( {current:init});},useEffect:(fn,deps)=>{const i=cursor++;if(!states[i]||deps.some((x,n)=>x!==states[i][n])){states[i]=deps;effects.push(fn);}},useCallback:fn=>fn};
 const exports={};new Function('require','exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='@/data/agentOneShotService')return {agentOneShotService:service};
  if(name==='@/components/workspace/WorkspaceDialog')return {WorkspaceDialog:()=>null};throw Error('Unexpected UI dependency '+name);
 },exports);
 const render=()=>{cursor=0;tree=exports.AgentOneShotAuthorization({revision:1});};
 const flush=async()=>{for(let i=0;i<5;i++){render();const work=effects;effects=[];for(const fn of work)fn();await new Promise(r=>setImmediate(r));}render();};
 return {flush,service,calls,get tree(){return tree;},created:()=>created,loads:()=>loads,
 click:async label=>{const b=nodes(tree).find(n=>n.type==='button'&&text(n).replace(/\s+/g,' ').trim()===label);assert.ok(b,label);await b.props.onClick();await flush();}};
}
test('non-ACK preview requires explicit confirmation and creates identifiers only',async()=>{
 const h=host();await h.flush();assert.equal(h.created(),0);
 await h.click('Authorize one natural AI trial: Selected signal');assert.equal(h.created(),0);
 for(const value of ['Selected project','Selected signal','fixture-model','Maximum requests: 1','No automatic workspace changes','unpaid/free'])assert.ok(text(h.tree).includes(value),value);
 await h.click('Confirm one natural AI trial');assert.equal(h.created(),1);
 assert.deepEqual(h.calls.find(c=>c[0]==='create')[1],{parentId:'parent',previewIdentity:'fingerprint'});
 assert.doesNotMatch(text(h.tree),/one Gemini request sent/i);
 await h.click('Cancel pending authorization');assert.ok(text(h.tree).includes('cancelled'));
 assert.doesNotMatch(readFileSync(path,'utf8'),/AgentInbox|acknowledge|seenContentRevision\s*=/);
});
test('lost creation response never automatically retries or claims a confirmed send',async()=>{
 const h=host();await h.flush();h.service.create=async()=>{h.calls.push(['uncertain']);throw Error('Lost response');};
 await h.click('Authorize one natural AI trial: Selected signal');await h.click('Confirm one natural AI trial');
 assert.equal(h.calls.filter(c=>c[0]==='uncertain').length,1);assert.ok(text(h.tree).includes('Refresh status'));
 assert.doesNotMatch(text(h.tree),/TRANSPORT CONFIRMED|PROVIDER RESPONSE RECEIVED|one Gemini request sent/);
});
test('audit separates reserved allowance from unknown and confirmed physical requests',async()=>{
 const h=host();await h.flush();const item={id:'audit',projectTitle:'Selected project',signalTitle:'Selected signal',status:'consumed',reason:null,slot:candidate.slot,expiresAt:candidate.expiresAt,
  provider:'gemini',model:'fixture-model',accounting:{allowanceConsumed:true,sendAttempted:true,transport:'unknown',responseReceived:false,output:'none',publicationCompleted:false}};
 h.service.list=async()=>({items:[item],candidates:[]});await h.click('Refresh status');
 assert.ok(text(h.tree).replace(/\s+/g,' ').includes('Provider request count: unknown'));
 item.accounting.responseReceived=true;item.accounting.transport='confirmed';await h.click('Refresh status');
 assert.ok(text(h.tree).replace(/\s+/g,' ').includes('Provider request count: 1 confirmed'));
});
