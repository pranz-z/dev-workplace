import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const url = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`;
const policyUrl = url(read('./policy.ts'));
const sdkUrl = url(`export const issueSignedToken=async o=>{globalThis.videoTest.scopes.push(o);return{validUntil:o.validUntil,delegationToken:'scoped',clientSigningToken:'ADMIN-SIGNING-SECRET'}};
export const presignUrl=async(t,o)=>{globalThis.videoTest.signs.push(o);return{presignedUrl:'https://example.private.blob.vercel-storage.com/'+o.pathname+'?signature=temporary'}};
export const head=async p=>{globalThis.videoTest.heads.push(p);if(globalThis.videoTest.headError)throw Error('head');return globalThis.videoTest.head};
export const del=async p=>{globalThis.videoTest.deleted.push(p);if(globalThis.videoTest.deleteError)throw Error('delete')};`);
const blobUrl = url(read('./blob.ts').replace('import "server-only";', '').replace('"@vercel/blob"',JSON.stringify(sdkUrl)).replace('"./policy"',JSON.stringify(policyUrl)));
const supabaseUrl = url('export const getSupabaseServerClient=async()=>globalThis.videoTest.supabase;');
const adminUrl = url('export const getSupabaseAdminClient=()=>({rpc:async(name,args)=>{globalThis.videoTest.operations.push(args);return globalThis.videoTest.manage(args)}});');
const uuidUrl = url(`export const isUuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);`);
const slugUrl = url(read('../slug.ts'));
const serverUrl = url(read('./server.ts').replace('import "server-only";', '').replace('"@/lib/supabase/server"',JSON.stringify(supabaseUrl)).replace('"@/lib/supabase/admin"',JSON.stringify(adminUrl)).replace('"@/data/context"',JSON.stringify(uuidUrl)).replace('"@/lib/slug"',JSON.stringify(slugUrl)).replace('"./blob"',JSON.stringify(blobUrl)).replace('"./policy"',JSON.stringify(policyUrl)));
const { ownerPreviewRequest, publicPreviewRequest } = await import(serverUrl);
const blob = await import(blobUrl);
const project='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', uploadId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pathname='portfolio-previews/'+'1'.repeat(48)+'.mp4';
const row={blob_pathname:pathname,file_name:'preview.mp4',mime_type:'video/mp4',size_bytes:10485760,enabled:false,updated_at:'2026-10-25'};
function fixture(overrides={}) {
  const state={scopes:[],signs:[],heads:[],deleted:[],operations:[],head:{pathname,size:10485760,contentType:'video/mp4'},owned:true,user:true,publicRows:[{project_slug:'demo',blob_pathname:pathname,mime_type:'video/mp4'}],...overrides};
  state.supabase={auth:{getUser:async()=>({data:{user:state.user?{id:'owner'}:null}})},from:table=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:table==='projects'?(state.owned?{id:project}:null):row})}),rpc:async()=>({data:state.publicRows})};
  state.manage=async args=>({data:args.p_action==='begin'?{uploadId}:args.p_action==='intent'?{...row}:args.p_action==='remove'?{oldPath:pathname}:{video:row,oldPath:'portfolio-previews/'+'2'.repeat(48)+'.mp4'}});
  globalThis.videoTest=state; return state;
}
const request=(method,input,headers={})=>new Request(`https://workspace.test/api/projects/${project}/preview-video`,{method,...(input?{body:JSON.stringify(input),headers:{'content-type':'application/json',...headers}}:{headers})});
test('owner authorization rejects unauthenticated, foreign and missing projects before signing',async()=>{
  for(const options of [{user:false},{owned:false}]) {const state=fixture(options);const response=await ownerPreviewRequest(request('POST',{action:'begin',name:'preview.mp4',type:'video/mp4',size:10485760}),project);assert.equal(response.status,options.user===false?401:404);assert.equal(state.scopes.length,0);}
  fixture(); assert.equal((await ownerPreviewRequest(request('GET'),'bad')).status,404);
});
test('synthetic 10 MB contract returns only pathname-scoped PUT authority; application receives metadata',async()=>{
  const state=fixture();const response=await ownerPreviewRequest(request('POST',{action:'begin',name:'preview.mp4',type:'video/mp4',size:10485760}),project);
  assert.equal(response.status,201);const result=await response.json();assert.equal(result.uploadId,uploadId);assert.match(result.url,/signature=temporary/);
  const scope=state.scopes[0];assert.deepEqual(scope.operations,['put']);assert.equal(scope.maximumSizeInBytes,15728640);assert.deepEqual(scope.allowedContentTypes,['video/mp4']);assert.match(scope.pathname,/^portfolio-previews\/[a-f0-9]{48}\.mp4$/);assert.ok(scope.validUntil<=Date.now()+600000);
  assert.equal(state.signs[0].allowOverwrite,false);assert.equal(state.signs[0].access,'private');assert.doesNotMatch(JSON.stringify(result),/ADMIN-SIGNING-SECRET|clientSigningToken|owner|project_id/);
  assert.equal((await ownerPreviewRequest(request('POST',{action:'begin'},{'content-length':'10485760'}),project)).status,413);
  assert.equal((await ownerPreviewRequest(new Request('https://workspace.test',{method:'POST',body:new ReadableStream({start(c){c.enqueue(new Uint8Array(4097));c.close()}}),duplex:'half',headers:{'content-type':'application/json'}}),project)).status,413);
});
test('HEAD verifies actual size, MIME and path before finalizing; cleanup failure keeps new association',async()=>{
  for(const head of [{pathname,size:1,contentType:'video/mp4'},{pathname,size:10485760,contentType:'text/html'},{pathname:'wrong',size:10485760,contentType:'video/mp4'}]){const s=fixture({head});const response=await ownerPreviewRequest(request('POST',{action:'finalize',uploadId}),project);assert.equal(response.status,503);assert.deepEqual(s.operations.map(x=>x.p_action),['intent']);assert.equal(s.deleted.length,0);}
  const s=fixture({deleteError:true});const response=await ownerPreviewRequest(request('POST',{action:'finalize',uploadId}),project);assert.equal(response.status,200);const result=await response.json();assert.equal(result.video.fileName,'preview.mp4');assert.match(result.warning,/private video/);assert.deepEqual(s.operations.map(x=>x.p_action),['intent','finalize']);assert.equal(s.heads.length,1);assert.equal(s.deleted.length,1);
});
test('public projection controls signing, returns only temporary URL DTO and no-store',async()=>{
  for(const publicRows of [[],null]){const s=fixture({publicRows});assert.equal((await publicPreviewRequest('demo')).status,404);assert.equal(s.scopes.length,0);}
  const s=fixture();assert.equal((await publicPreviewRequest('../bad')).status,404);assert.equal(s.scopes.length,0);
  const response=await publicPreviewRequest('demo');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');const result=await response.json();assert.deepEqual(Object.keys(result).sort(),['url','mimeType','expiresAt'].sort());assert.deepEqual(s.scopes[0].operations,['get']);assert.equal(s.signs[0].access,'private');assert.ok(result.expiresAt<=Date.now()+900000);assert.doesNotMatch(JSON.stringify(result),/ADMIN-SIGNING-SECRET|clientSigningToken|user_id|project_id/);
});
test('owner can sign a private disabled preview; remove commits association before cleanup',async()=>{
  let s=fixture();assert.equal((await ownerPreviewRequest(request('POST',{action:'preview'}),project)).status,200);assert.deepEqual(s.scopes[0].operations,['get']);
  s=fixture({deleteError:true});const response=await ownerPreviewRequest(request('DELETE'),project);assert.equal(response.status,200);assert.equal((await response.json()).video,null);assert.equal(s.operations[0].p_action,'remove');assert.equal(s.deleted.length,1);
  s=fixture();assert.equal((await ownerPreviewRequest(request('PATCH',{enabled:'true'}),project)).status,400);assert.equal(s.operations.length,0);
  assert.equal((await ownerPreviewRequest(request('POST',{action:'preview'},{origin:'https://foreign.test'}),project)).status,403);
});
test('Blob adapter rejects arbitrary paths before issuing any authority',async()=>{const s=fixture();await assert.rejects(blob.signPreviewRead('owner/project.mp4','video/mp4'));assert.equal(s.scopes.length,0)});
