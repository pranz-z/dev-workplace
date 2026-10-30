import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {loadPulse} from './phase5d-test-support.mjs';
const saved={key:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL,fetch:globalThis.fetch};
before(()=>{process.env.GEMINI_API_KEY='fixture-key-never-sent';process.env.GEMINI_MODEL='fixture-model';globalThis.fetch=async()=>assert.fail('Live network forbidden');});
after(()=>{for(const [key,value] of [['GEMINI_API_KEY',saved.key],['GEMINI_MODEL',saved.model]])if(value===undefined)delete process.env[key];else process.env[key]=value;globalThis.fetch=saved.fetch;});
const contents=JSON.stringify({primaryAlias:'P1',signals:[{alias:'P1',type:'project',title:'Authorized project',status:'Testing',priority:'Critical',reasonCodes:['PROJECT_QUIET'],facts:{thresholdDays:14,lastActivityAt:'2026-10-01T00:00:00Z'}}]});
const context={contents,primaryAlias:'P1',aliases:{P1:{type:'project',id:'00000000-0000-4000-8000-000000000001'}},allowedCategories:['review_quiet_project'],
 allowedFacts:new Set(['Testing','Critical','14','2026-10-01T00:00:00Z']),parentId:'00000000-0000-4000-8000-000000000002',parentEpisode:1,sourceToken:'a'.repeat(64),evidenceValidUntil:'2099-01-01T00:00:00Z'};
test('real SDK wire contains exactly one parent, no IDs or excluded sibling facts',async()=>{
 const {generatePulseIdea}=await loadPulse('lib/ai/agent/pulse/gemini.ts');const requests=[];
 const r=await generatePulseIdea(context,{signal:new AbortController().signal,deadlineAt:Date.now()+60_000,expectedProvider:{provider:'gemini',model:'fixture-model'},fetch:async(url,init)=>{
  requests.push(JSON.parse(init.body));return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({sourceAlias:'P1',category:'review_quiet_project',title:'Review project activity',advisoryText:'Consider reviewing recorded project activity.'})}]},finishReason:'STOP'}]}));
 }});assert.equal(r.category,'review_quiet_project');assert.equal(requests.length,1);
 const body=requests[0];const text=body.contents.flatMap(x=>x.parts).map(p=>p.text??'').join('');assert.equal(text,contents);assert.equal(JSON.parse(text).signals.length,1);
 assert.doesNotMatch(text,/00000000|sourceToken|credentials|Sibling|notes|description|objective|repository/);
});
test('bound adapter blocks model mismatch before physical transport',async()=>{
 const {generatePulseIdea}=await loadPulse('lib/ai/agent/pulse/gemini.ts');let sent=0;
 const r=await generatePulseIdea(context,{signal:new AbortController().signal,deadlineAt:Date.now()+60_000,expectedProvider:{provider:'gemini',model:'other'},fetch:async()=>{sent++;throw Error('Forbidden');}});
 assert.equal(r.ok,false);assert.equal(sent,0);
});
test('one-shot repository never grants send for a recovered reservation response',async()=>{
 const {createPulseRepository}=await loadPulse('lib/ai/agent/pulse/db.ts');
 const r=createPulseRepository({rpc:async()=>({data:{reserved:true,sendAllowed:true,recovered:true},error:null})});
 await assert.rejects(r.reserveOneShot({userId:'owner',pulseId:'pulse',leaseToken:'lease',fence:1,settingsRevision:1},{authorizationId:'auth',credential:'a'.repeat(64)},'gemini','fixture-model','b'.repeat(64)),/SOURCE_UNAVAILABLE/);
});
