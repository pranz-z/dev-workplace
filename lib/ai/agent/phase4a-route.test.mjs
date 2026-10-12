import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync(new URL('../../../app/api/ai/agent/activity/route.ts',import.meta.url),'utf8');
function route({authenticated=true}={}){
 const calls=[];
 class AiError extends Error{constructor(code){super(code);this.code=code;this.status={FORBIDDEN:403,INVALID_INPUT:400,UNAUTHORIZED:401}[code]??502;}}
 const client={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{time_zone:'Asia/Manila'}})})};
 const deps={'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/lib/ai/errors':{AiError},'@/lib/ai/auth':{requireAuthenticatedAiUser:async()=>{if(!authenticated)throw new AiError('UNAUTHORIZED');return {id:'owner'};}},'@/lib/supabase/server':{getSupabaseServerClient:async()=>client},'@/lib/supabase/admin':{getSupabaseAdminClient:()=>({})},'@/lib/ai/agent/activity':{listAgentRuns:async(admin,owner,query)=>{calls.push({owner,query});return {items:[],nextCursor:null};},getAgentRun:async(admin,scoped,owner,id,zone)=>{calls.push({owner,id,zone});return {id};}},'@/data/agentActivity':{parseActivityQuery:params=>{if(params.has('userId'))throw Error();return {limit:20};}},'@/lib/ai/agent/proposal-schema':{requireUuid:id=>{if(!/^[0-9a-f-]{36}$/i.test(id))throw new AiError('INVALID_INPUT');}},'@/lib/ai/agent/schemas':{validTimeZone:()=>true}};
 const exports={};new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(name=>{assert.ok(deps[name],`Unexpected dependency ${name}`);return deps[name];},exports);return {exports,calls};
}
test('history route authenticates before reading and rejects browser-supplied owner and cross-site reads',async()=>{
 const denied=route({authenticated:false});assert.equal((await denied.exports.GET(new Request('http://localhost/api/ai/agent/activity'))).status,401);assert.equal(denied.calls.length,0);
 for(const [url,headers] of [['?userId=foreign',{}],['',{'sec-fetch-site':'cross-site'}],['',{origin:'https://foreign.example'}]]){const r=route();const result=await r.exports.GET(new Request(`http://localhost/api/ai/agent/activity${url}`,{headers}));assert.ok(result.status>=400);assert.equal(r.calls.length,0);assert.equal(result.headers['Cache-Control'],'no-store');}
});
test('history route is GET-only, no-store, owner-derived and uses profile timezone for detail',async()=>{
 const r=route();assert.equal(r.exports.POST,undefined);const list=await r.exports.GET(new Request('http://localhost/api/ai/agent/activity'));assert.equal(list.headers['Cache-Control'],'no-store');assert.equal(r.calls[0].owner,'owner');
 await r.exports.GET(new Request('http://localhost/api/ai/agent/activity?runId=33333333-3333-4333-8333-333333333333'));assert.equal(r.calls[1].zone,'Asia/Manila');assert.doesNotMatch(source,/Gemini|generateAgent|applySelected|cancelSelected/);
});
