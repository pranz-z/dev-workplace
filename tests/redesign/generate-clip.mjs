import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createHarness } from './browser-harness.mjs';
const output=process.argv[2];
await mkdir(output,{recursive:true});
const harness=await createHarness(resolve(output,'../phase-0b/assets'));
try{
  const {context,page}=await harness.session('unseen',{width:640,height:480},'dark',{surface:'public'});
  try{
    const result=await page.evaluate(async()=>{
      const candidates=['video/mp4;codecs=avc1.42001E','video/mp4;codecs=avc1.42E01E','video/mp4'];
      const mimeType=candidates.find(value=>MediaRecorder.isTypeSupported(value));
      if(!mimeType)throw new Error('Local Chromium MP4 recording is unavailable; no mislabeled WebM fallback');
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const ctx=canvas.getContext('2d');const stream=canvas.captureStream(12);
      const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:350000});
      const chunks=[];const stopped=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=resolve;recorder.onerror=reject;});
      recorder.start();
      for(let frame=0;frame<24;frame++){
        ctx.fillStyle='#193e54';ctx.fillRect(0,0,640,360);ctx.fillStyle='#ffcb65';ctx.fillRect(20+frame*20,155,80,80);
        ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('SYNTHETIC LOCAL PREVIEW',30,60);ctx.fillText(`Frame ${frame}`,30,110);
        await new Promise(resolve=>setTimeout(resolve,85));
      }
      recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
      const blob=new Blob(chunks,{type:recorder.mimeType});return {mimeType:recorder.mimeType,bytes:[...new Uint8Array(await blob.arrayBuffer())]};
    });
    const bytes=Buffer.from(result.bytes);
    if(bytes.toString('ascii',4,8)!=='ftyp')throw new Error('Recorded media is not an MP4 container');
    await writeFile(resolve(output,'synthetic-preview.mp4'),bytes);
    await writeFile(resolve(output,'clip-manifest.json'),JSON.stringify({mimeType:result.mimeType,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),source:'Locally generated canvas animation recorded by native Chromium MediaRecorder; no external media',browser:harness.browser.version()},null,2));
    console.log(`Local synthetic MP4 generated: ${bytes.length} bytes, ${result.mimeType}`);
  }finally{await context.close();}
}finally{await writeFile(resolve(output,'clip-generation-requests.json'),JSON.stringify(harness.requestLog,null,2));await harness.close();}
