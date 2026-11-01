import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import ts from 'typescript';
import {fixture,seedOneShot} from './phase5d-one-shot-fixture.mjs';
const root=resolve(import.meta.dirname,'../../..'),require=createRequire(import.meta.url);
const args={agent_pulse_one_shot_list:['p_user_id'],agent_pulse_one_shot_preview:['p_user_id','p_parent_id'],
 agent_pulse_one_shot_create:['p_user_id','p_parent_id','p_revision','p_slot','p_model','p_source_token','p_context_fingerprint','p_expected_binding'],agent_pulse_one_shot_cancel:['p_user_id','p_id']};
async function setup(t){
 const f=await fixture(t);await seedOneShot(f);await f.db.exec('delete from private.agent_pulse_one_shot_authorizations');
 const calls=[],cache=new Map();const state={owner:f.owner,model:'fixture-model'};
 function load(file){if(cache.has(file))return cache.get(file);assert.ok(existsSync(file),'Missing one-shot route implementation: '+file);
  const exports={};cache.set(file,exports);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',code)(name=>{
   if(name==='server-only')return {};
   if(name==='@/lib/supabase/server')return {getSupabaseServerClient:async()=>({})};
   if(name==='@/lib/ai/auth')return {requireAuthenticatedAiUser:async()=>{if(!state.owner)throw new (load(resolve(root,'lib/ai/errors.ts')).AiError)('UNAUTHENTICATED');return {id:state.owner};}};
   if(name==='@/lib/ai/config')return {getGeminiConfiguration:()=>({configured:true,model:state.model})};
   if(name==='@/lib/supabase/admin')return {getSupabaseAdminClient:()=>({rpc:async(name,input)=>{
    assert.ok(args[name],name);assert.equal(input.p_user_id,state.owner);calls.push(name);
    try{return {data:await f.sql(`select public.${name}(${args[name].map((_,i)=>'$'+(i+1))}) r`,args[name].map(k=>typeof input[k]==='object'&&input[k]!==null?JSON.stringify(input[k]):input[k])),error:null};}
    catch(error){return {data:null,error};}
   }})};
   if(name.startsWith('@/'))return load(resolve(root,name.slice(2)+'.ts'));
   if(name.startsWith('.'))return load(resolve(dirname(file),name+'.ts'));
   return require(name);
  },exports);return exports;}
 const api=load(resolve(root,'lib/ai/agent/pulse/one-shot-routes.ts'));
 return {...f,state,calls,api};
}
const req=(path='',body,method=body===undefined?'GET':'POST')=>new Request('https://fixture.invalid/api/ai/agent/one-shot'+path,{method,headers:body===undefined?{}:{'content-type':'application/json',origin:'https://fixture.invalid'},body:body===undefined?undefined:JSON.stringify(body)});
test('owner confirms identifier-only preview; no source payload/credential or ACK escapes',async t=>{
 const h=await setup(t),list=await h.api.handleOneShot(req());assert.equal(list.status,200);const data=await list.json();assert.equal(data.candidates.length,1);
 const p=data.candidates[0];assert.equal(p.maxProviderRequests,1);assert.equal(JSON.parse(p.context).signals.length,1);
 assert.doesNotMatch(JSON.stringify(data),/sourceToken|admission_hash|credential|ownerId|leaseToken|sourceTokens/);
 const result=await h.api.handleOneShot(req('',{parentId:p.parentId,previewIdentity:p.previewIdentity}));assert.equal(result.status,200);
 const current=await result.json();assert.equal(current.status,'pending');
 assert.equal(h.calls.some(x=>/ack|reserve|publish/.test(x)),false);
 const cancel=await h.api.handleOneShotCancel(req('/cancel',{authorizationId:current.id}));assert.equal(cancel.status,200);assert.equal((await cancel.json()).status,'cancelled');
});
test('unknown fields, model override, stale preview, cross-origin and unauthenticated requests fail closed',async t=>{
 const h=await setup(t),p=(await (await h.api.handleOneShot(req())).json()).candidates[0];
 for(const extra of [{ownerId:h.other},{model:'override'},{context:'evil'},{slot:'2027-01-01T00:00:00Z'},{maxProviderRequests:2}]){
  assert.equal((await h.api.handleOneShot(req('',{parentId:p.parentId,previewIdentity:p.previewIdentity,...extra}))).status,400);
 }
 for(const malformed of [null,[],'bad',1])assert.equal((await h.api.handleOneShot(req('',malformed))).status,400);
 h.state.model='different';assert.equal((await h.api.handleOneShot(req('',{parentId:p.parentId,previewIdentity:p.previewIdentity}))).status,409);
 const cross=req('',{parentId:p.parentId,previewIdentity:p.previewIdentity});cross.headers.set('origin','https://evil.invalid');
 assert.equal((await h.api.handleOneShot(cross)).status,403);
 h.state.owner=null;assert.equal((await h.api.handleOneShot(req())).status,401);
});
