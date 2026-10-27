import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {createHarness as rawHarness} from './browser-harness.mjs';const createHarness=(a)=>rawHarness(a,{embeddedFonts:true});
import { fontMetadata, settle } from './phase7-utils.mjs';
const output=process.argv[2],phase=process.argv.includes('--before')?'before':'after';
await mkdir(resolve(output,phase),{recursive:true});
let saved=[];try{saved=JSON.parse(await readFile(resolve(output,`${phase}-checkpoint.json`),'utf8'));}catch{}
const harness=await createHarness(resolve(output,`${phase}-assets`),{embeddedFonts:true}),captures=[...saved];
const scenarios=[['baseline-hero','public','baseline'],['baseline-projects','public','baseline','#projects'],['baseline-case','case-study','baseline'],['hero','public','rich'],['projects','public','rich','#projects'],['about','public','rich','#about'],['experience','public','rich','#experience'],['skills','public','rich','#skills'],['education','public','rich','#education'],['contact','public','rich','#contact'],['empty','public','empty','#projects'],['source-error','public','error'],['case','case-study','rich'],['gallery','case-study','rich','#project-gallery-title'],['case-video','case-study','rich','[aria-label="Project video"]'],['case-missing','case-study','notfound'],['case-error','case-study','error'],['case-loading','case-study','loading'],['concierge-empty','public','rich'],['concierge-populated','public','rich'],['concierge-error','public','ai-error']];
const wait=async page=>{await settle(page);await page.evaluate(async()=>{await Promise.race([Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))),new Promise(r=>setTimeout(r,700))]);});};
try{
for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light'])for(const auth of ['owner','anonymous']){
 for(const [name,surface,variant,selector] of scenarios){
  if(captures.some(r=>r.filename===`${name}--${auth}--${theme}--${width}x${height}.png`))continue;
  const {context,page,errors}=await harness.session('unseen',{width,height},theme,{surface,variant,contextOptions:{anonymous:auth==='anonymous'}});
  page.setDefaultTimeout(12000);
  try{
   if(surface==='public')await page.locator('#projects').waitFor();
   else if(['notfound','error'].includes(variant))await page.getByRole('heading',{name:variant==='notfound'?'Project not found':'Project unavailable',exact:true}).waitFor();
   else if(variant==='loading')await page.getByText('Loading project…',{exact:true}).waitFor();
   else await page.locator('#project-gallery-title').waitFor();
   if(selector)await page.locator(selector).scrollIntoViewIfNeeded();
   if(name.startsWith('concierge')){
    await page.getByRole('button',{name:'Ask AI about Franz',exact:true}).click();
    if(name!=='concierge-empty'){
     await page.getByLabel('Question about the developer',{exact:true}).fill('Synthetic public-context question');
     await page.getByRole('button',{name:'Send question',exact:true}).click();
     await page.getByText(name==='concierge-error'?'Synthetic public assistant failure.':'Synthetic answer from public fixture context only.',{exact:true}).waitFor();
    }
   }
   await wait(page);await page.mouse.move(0,0);
   const fixture=await page.evaluate(()=>window.matrixFixture);assert.deepEqual(fixture.unexpected,[]);
   // The error fixture logs the deliberate public source failure; no uncaught page errors.
   assert.deepEqual(errors,[]);
   assert.equal(await page.getByText('Synthetic private project',{exact:true}).count(),0);
   const geometry=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
   if(phase==='after')assert.ok(geometry.scroll<=width,`${name}/${auth}/${theme}/${width} overflow ${geometry.scroll}`);
   const targets=await page.evaluate(()=>[...document.querySelectorAll('button,a,input,textarea,select,summary')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]')).map(e=>{const b=e.getBoundingClientRect();return{component:e.closest('.public-ai-concierge')?'Public concierge':e.closest('header')?'Public navigation':e.closest('.portfolio-project')?'Public project card':e.closest('dialog')?'Screenshot lightbox':e.closest('section')?.id||'Public content',selector:`${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`,label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,90),width:b.width,height:b.height};}));
   const text=await page.locator('main').innerText();
   const filename=`${name}--${auth}--${theme}--${width}x${height}.png`;
   await page.screenshot({path:resolve(output,phase,filename)});
   captures.push({name,surface,variant,selector,auth,theme,viewport:{width,height},filename,geometry,fonts:await fontMetadata(page),targets,text,calls:fixture.calls});
  }finally{await context.close();}
 }
 await writeFile(resolve(output,`${phase}-checkpoint.json`),JSON.stringify(captures));
 console.log(`${phase}: ${width} ${theme} ${auth}: ${scenarios.length} captures`);
}
assert.equal(harness.requestLog.filter(e=>e.disposition.startsWith('denied')).length,0);
await writeFile(resolve(output,`${phase}-manifest.json`),JSON.stringify({fixtureVersion:'phase6-v1; baseline scenarios phase0b-v1',fixedTime:'2026-10-26T02:00:00.000Z',timezone:'Asia/Manila',browser:harness.browser.version(),build:JSON.parse(await readFile(resolve(output,`${phase}-assets/build-manifest.json`),'utf8')),captures},null,2));
}finally{await writeFile(resolve(output,`${phase}-request-log.json`),JSON.stringify(harness.requestLog,null,2));await harness.close();}
