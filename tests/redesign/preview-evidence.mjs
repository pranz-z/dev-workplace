import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';
import { selectSurface,settle,fontMetadata } from './matrix-utils.mjs';
const output=process.argv[2];await mkdir(resolve(output,'preview'),{recursive:true});
const harness=await createHarness(resolve(output,process.argv[3]==='--anonymous'?'anonymous-assets':'assets'));const records=[];
const state=page=>page.evaluate(()=>{
  const v=document.querySelector('article video');
  return {paused:v.paused,currentTime:v.currentTime,readyState:v.readyState,width:v.videoWidth,height:v.videoHeight,
    decodedFrames:v.getVideoPlaybackQuality().totalVideoFrames,srcPrefix:v.getAttribute('src')?.slice(0,22)??null,error:v.error?.message??null,
    reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
    previewReads:window.matrixFixture.calls.filter(value=>value.name.includes('preview-video')).length};
});
const save=async(page,name)=>{await settle(page);const record={name,state:await state(page),fonts:await fontMetadata(page)};await page.screenshot({path:resolve(output,'preview',`${name}.png`)});records.push(record);};
try{
  const {context,page,errors}=await harness.session('unseen',{width:1440,height:1000},'dark',{surface:'public',variant:'preview'});
  page.setDefaultTimeout(10000);
  try{
    await selectSurface(page,'public-projects');await page.mouse.move(0,0);await settle(page);
    const before=await state(page);assert.equal(before.previewReads,0);assert.equal(before.srcPrefix,null);assert.equal(before.paused,true);
    await save(page,'before-hover');
    await page.getByRole('article').first().hover();
    await page.waitForFunction(()=>{const v=document.querySelector('article video');return !v.paused&&v.currentTime>0.15&&v.getVideoPlaybackQuality().totalVideoFrames>0;});
    await save(page,'during-native-playback');
    const playing=await state(page);assert.equal(playing.error,null);assert.equal(playing.width,640);assert.equal(playing.height,360);assert.equal(playing.previewReads,1);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>{const v=document.querySelector('article video');return v.paused&&!v.hasAttribute('src')&&v.currentTime===0;});
    await save(page,'reduced-motion-interrupted-playback');
    await page.mouse.move(0,0);await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('article').first().hover();
    await page.waitForFunction(()=>{const v=document.querySelector('article video');return !v.paused&&v.currentTime>0.1;});
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>{const v=document.querySelector('article video');return v.paused&&v.currentTime===0;});
    records.push({name:'pointer-leave-pauses-and-resets',state:await state(page)});
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
  const reduced=await harness.session('unseen',{width:1440,height:1000},'dark',{surface:'public',variant:'preview',contextOptions:{reducedMotion:'reduce'}});
  try{
    await selectSurface(reduced.page,'public-projects');await reduced.page.getByRole('article').first().hover();await settle(reduced.page);
    const current=await state(reduced.page);assert.equal(current.previewReads,0);assert.equal(current.paused,true);assert.equal(current.srcPrefix,null);
    await save(reduced.page,'initial-reduced-motion-no-preview');assert.deepEqual(reduced.errors,[]);
  }finally{await reduced.context.close();}
  assert.equal(harness.requestLog.filter(e=>e.disposition.startsWith('denied')).length,0);
  assert.equal(harness.requestLog.filter(e=>e.layer==='server'&&e.path.startsWith('/api/')).length,0);
  await writeFile(resolve(output,'preview-evidence.json'),JSON.stringify({fixtureVersion:'phase0b-v1',variant:'anonymous, local synthetic preview enabled',browser:harness.browser.version(),viewport:{width:1440,height:1000},theme:'dark',
    playback:'Native HTMLMediaElement decoding/playback; play/pause/load/currentTime not mocked',delivery:'Locally generated embedded MP4 data URI through existing in-memory preview projection; no media HTTP route or request-policy changes',
    clip:JSON.parse(await readFile(resolve(output,'clip-manifest.json'),'utf8')),records,limitations:['Does not test production CSP, signed URL service, Blob delivery or real user media.']},null,2));
  console.log('Native preview decoded/played; reduced motion interrupted playback and suppressed initial requests.');
}finally{await writeFile(resolve(output,'preview-request-log.json'),JSON.stringify(harness.requestLog,null,2));await harness.close();}
