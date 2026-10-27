import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness as rawHarness} from './browser-harness.mjs';const createHarness=(a)=>rawHarness(a,{embeddedFonts:true});
import {settle,fontMetadata} from './phase7-utils.mjs';
const o=process.argv[2],records=[];
await mkdir(resolve(o,'media'),{recursive:true});
const state=page=>page.evaluate(()=>{const v=document.querySelector('article video');return{paused:v.paused,time:v.currentTime,readyState:v.readyState,decoded:v.getVideoPlaybackQuality().totalVideoFrames,width:v.videoWidth,height:v.videoHeight,source:v.getAttribute('src')?.slice(0,22)??null,reads:window.matrixFixture.calls.filter(c=>c.name.includes('preview-video')).length,coarse:matchMedia('(pointer:coarse)').matches,hover:matchMedia('(hover:hover)').matches,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches};});
for(const phase of ['before','after']){
 const h=await createHarness(resolve(o,`${phase}-assets`),{embeddedFonts:true});
 try{
 for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light'])for(const auth of ['owner','anonymous']){
  const key=`${auth}--${theme}--${width}x${height}--${phase}`;
  const save=async(page,name)=>{await settle(page);const filename=`${name}--${key}.png`,s=await state(page);await page.screenshot({path:resolve(o,'media',filename)});records.push({phase,auth,theme,viewport:{width,height},name,filename,state:s,fonts:await fontMetadata(page)});};
  const {context,page,errors}=await h.session('unseen',{width,height},theme,{surface:'public',variant:'preview',contextOptions:{anonymous:auth==='anonymous'}});
  try{
   page.setDefaultTimeout(12000);await page.locator('#projects').scrollIntoViewIfNeeded();await page.mouse.move(0,0);await settle(page);
   const initial=await state(page);assert.equal(initial.reads,0);assert.equal(initial.source,null);assert.equal(initial.paused,true);await save(page,'before-hover');
   await page.locator('article').first().hover();await page.waitForFunction(()=>{const v=document.querySelector('article video');return!v.paused&&v.currentTime>.15&&v.getVideoPlaybackQuality().totalVideoFrames>0;});
   const playing=await state(page);assert.equal(playing.width,640);assert.equal(playing.height,360);assert.equal(playing.reads,1);await save(page,'during-native-playback');
   await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>{const v=document.querySelector('article video');return v.paused&&!v.hasAttribute('src')&&v.currentTime===0;});await save(page,'reduced-motion-interruption');
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
  for(const mode of ['touch','reduced']){
   const s=await h.session('unseen',{width,height},theme,{surface:'public',variant:'preview',contextOptions:{anonymous:auth==='anonymous',...(mode==='touch'?{hasTouch:true,isMobile:true}:{reducedMotion:'reduce'})}});
   try{
    await s.page.locator('#projects').scrollIntoViewIfNeeded();
    if(mode==='touch')await s.page.locator('article').first().tap();else await s.page.locator('article').first().hover();
    await settle(s.page);const current=await state(s.page);assert.equal(current.reads,0);assert.equal(current.source,null);assert.equal(current.paused,true);if(mode==='touch'){assert.equal(current.coarse,true);assert.equal(current.hover,false);}await save(s.page,mode==='touch'?'touch-static':'initial-reduced-static');assert.deepEqual(s.errors,[]);
   }finally{await s.context.close();}
  }
  console.log(`Native preview ${key}`);
 }
 assert.equal(h.requestLog.filter(e=>e.disposition.startsWith('denied')).length,0);
 await writeFile(resolve(o,`media-${phase}-request-log.json`),JSON.stringify(h.requestLog,null,2));
 }finally{await h.close();}
}
await writeFile(resolve(o,'media-manifest.json'),JSON.stringify({records,builds:{before:JSON.parse(await readFile(resolve(o,'before-assets/build-manifest.json'),'utf8')),after:JSON.parse(await readFile(resolve(o,'after-assets/build-manifest.json'),'utf8'))},fixedTime:'2026-10-26T02:00:00.000Z',timezone:'Asia/Manila',fixtureVersion:'phase6-v1; original phase0b-v1 public preview data',playback:'Native HTMLMediaElement play/pause/load/decoding, no media method mocks',delivery:'Existing fixture alias embeds previously prepared synthetic MP4; no real signed URL or hosted media request',limitations:['Coarse pointer/touch is Chromium emulation, not a physical device.','Production CSP and signed delivery not exercised; source hashes and policy tests verify unchanged architecture.']},null,2));
