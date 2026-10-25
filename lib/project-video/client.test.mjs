import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`;
const policy = compile(readFileSync(new URL('./policy.ts',import.meta.url),'utf8'));
const service = await import(compile(readFileSync(new URL('../../data/projectPreviewVideoService.ts',import.meta.url),'utf8').replace('"@/lib/project-video/policy"',JSON.stringify(policy))));
test('10 MB direct-upload contract sends only small JSON to the app and file body only to Blob',async()=>{
  const original = globalThis.fetch, calls=[];
  // File-shaped synthetic contract: no 10 MB buffer allocation needed.
  const file={name:'preview.mp4',type:'video/mp4',size:10485760};
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(calls.length===1?{uploadId:'bound-upload',url:'https://vercel.com/api/blob?signed=put'}:calls.length===2?{}:{video:{fileName:'preview.mp4'}})};
  try {
    const result=await service.uploadProjectPreviewVideo('project',file);
    assert.equal(result.video.fileName,'preview.mp4');assert.equal(calls.length,3);
    assert.deepEqual(JSON.parse(calls[0].options.body),{action:'begin',name:'preview.mp4',type:'video/mp4',size:10485760});
    assert.equal(calls[1].url,'https://vercel.com/api/blob?signed=put');assert.equal(calls[1].options.body,file);assert.equal(calls[1].options.method,'PUT');assert.equal(calls[1].options.credentials,'omit');
    assert.deepEqual(JSON.parse(calls[2].options.body),{action:'finalize',uploadId:'bound-upload'});
    assert.ok(calls[0].options.body.length<512 && calls[2].options.body.length<512);
  }finally{globalThis.fetch=original}
});
test('failed direct PUT never finalizes or replaces the working association',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url)=>{calls.push(url);return calls.length===1?Response.json({url:'https://vercel.com/api/blob',uploadId:'id'}):new Response('',{status:500})};
  try{await assert.rejects(service.uploadProjectPreviewVideo('project',{name:'x.mp4',type:'video/mp4',size:10}),/existing preview is unchanged/);assert.equal(calls.length,2)}finally{globalThis.fetch=original}
});
