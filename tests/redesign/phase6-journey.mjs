import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
import {settle,fontMetadata} from './matrix-utils.mjs';
const output=process.argv[2],h=await createHarness(resolve(output,'after-assets'),{embeddedFonts:true}),records=[];
await mkdir(resolve(output,'journeys'),{recursive:true});
const focus=page=>page.evaluate(()=>{const e=document.activeElement,b=e.getBoundingClientRect(),s=getComputedStyle(e);return{tag:e.tagName,label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,120),x:b.x,y:b.y,width:b.width,height:b.height,visible:b.bottom>0&&b.top<innerHeight&&b.right>0&&b.left<innerWidth,outline:s.outlineStyle,outlineWidth:s.outlineWidth,covered:(()=>{const q=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,b.x+b.width/2)),Math.max(0,Math.min(innerHeight-1,b.y+b.height/2)));return q&&!e.contains(q)&&!q.contains(e);})()};});
async function save(page,key){await settle(page);const filename=`${key}.png`;await page.screenshot({path:resolve(output,'journeys',filename)});return{filename,fonts:await fontMetadata(page),targets:await page.evaluate(()=>[...document.querySelectorAll('button,a,textarea,summary')].filter(e=>e.getClientRects().length&&(!document.querySelector('dialog[open]')||e.closest('dialog[open]'))).map(e=>{const r=e.getBoundingClientRect();return{component:e.closest('dialog')?'Screenshot lightbox':e.closest('.public-ai-concierge')?'Public concierge':'Public content',selector:`${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`,label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,90),width:r.width,height:r.height};}))};}
try{
for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light'])for(const auth of ['owner','anonymous']){
 const key=`${auth}--${theme}--${width}x${height}`,journey=[];
 const {context,page,errors}=await h.session('unseen',{width,height},theme,{surface:'public',variant:'rich',contextOptions:{anonymous:auth==='anonymous'}});
 try{
 await page.locator('#projects').waitFor();await page.mouse.move(0,0);
 // Traverse the actual rendered tab order, including every enabled anchor/control.
 const seen=new Set();
 for(let n=0;n<110;n++){
  await page.keyboard.press('Tab');await page.waitForFunction(()=>{const e=document.activeElement;if(e?.tagName==='BODY')return true;const b=e.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight&&b.right>0&&b.left<innerWidth;});await settle(page);
  const f=await focus(page);if(f.tag==='BODY')continue;
  const id=JSON.stringify([f.tag,f.label]);if(seen.has(id)&&f.label==='Toggle chalkboard or paper theme')break;seen.add(id);
  assert.ok(f.visible,`Fully hidden keyboard focus ${key}/${f.label}`);assert.notEqual(f.outline,'none',`Focus ring ${key}/${f.label}`);assert.equal(f.covered,false,`Obscured focus ${key}/${f.label}`);journey.push(f);
 }
 for(const name of ['Projects','About','Experience','Skills','Education','Contact'])assert.ok(journey.some(f=>f.label===name),`Destination ${name}`);
 for(const name of ['Projects','About','Experience','Skills','Education','Contact']){const nav=page.getByRole('navigation',{name:'Portfolio'}).getByRole('link',{name,exact:true});await nav.focus();await page.keyboard.press('Enter');assert.equal(new URL(page.url()).hash,'#'+name.toLowerCase());}
 const skill=page.getByRole('button',{name:'Languages',exact:true});await skill.focus();await page.keyboard.press('Space');assert.equal(await skill.getAttribute('aria-pressed'),'true');await page.keyboard.press('Space');assert.equal(await skill.getAttribute('aria-pressed'),'false');
 for(const type of ['Web','All']){const button=page.getByRole('button',{name:type,exact:true});await button.focus();await page.keyboard.press('Space');assert.equal(await button.getAttribute('aria-pressed'),'true');}
 const card=page.getByRole('link',{name:/^View case study:/}).first();
 await card.evaluate(e=>e.addEventListener('click',ev=>{ev.preventDefault();window.phase6Navigation=e.getAttribute('href');},{once:true}));await card.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.phase6Navigation),'/projects/synthetic-project');
 assert.equal(await page.locator('a[download][href="/resume/Franz_Michael_Cayanan_Resume.pdf"]').count(),1);
 assert.equal(await page.locator('a[href="/app"]').count(),auth==='owner'?2:0);
 const launcher=page.getByRole('button',{name:'Ask AI about Franz',exact:true});await launcher.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement?.id==='public-ai-question');
 const disclosure=await page.locator('#public-ai-disclosure').evaluate(e=>({text:e.textContent,font:getComputedStyle(e).fontFamily,size:parseFloat(getComputedStyle(e).fontSize)}));assert.ok(disclosure.font.includes('Geist'));assert.ok(disclosure.size>=14);
 const openFrame=await save(page,`concierge-keyboard--${key}`);const f=await focus(page);assert.ok(f.visible);assert.equal(f.covered,false);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Ask AI about Franz');
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.matrixFixture.unexpected),[]);
 records.push({key,allSixAnchorsActivated:true,skillsFilterToggles:true,journey,disclosure,openFrame,conciergeEscapeReturnsFocus:true,cardDestination:'/projects/synthetic-project'});
 }finally{await context.close();}
 const c=await h.session('unseen',{width,height},theme,{surface:'case-study',variant:'rich',contextOptions:{anonymous:auth==='anonymous'}});
 try{
 const image=c.page.getByRole('button',{name:/^View screenshot:/}).first();await image.waitFor();await image.focus();await c.page.keyboard.press('Enter');await c.page.getByRole('dialog',{name:'Screenshot viewer'}).waitFor();await settle(c.page);
 const frame=await save(c.page,`lightbox--${key}`);const start=await focus(c.page);assert.ok(start.visible);assert.equal(start.covered,false);
 await c.page.keyboard.press('Tab');if(await c.page.evaluate(()=>document.activeElement?.tagName==='BODY'))await c.page.keyboard.press('Tab');assert.equal(await c.page.evaluate(()=>!!document.activeElement?.closest('dialog[open]')),true);
 await c.page.keyboard.press('Escape');await c.page.waitForFunction(()=>!document.querySelector('dialog[open]'));await c.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')?.startsWith('View screenshot:'));
 assert.equal(await c.page.locator('a[href="/"]').count(),2);assert.deepEqual(c.errors,[]);
 records.at(-1).lightbox={...frame,escapeReturnsFocus:true};
 }finally{await c.context.close();}
 console.log(`Public keyboard + lightbox: ${key}`);
}
assert.equal(h.requestLog.filter(e=>e.disposition.startsWith('denied')).length,0);
await writeFile(resolve(output,'keyboard-journeys.json'),JSON.stringify({records,routeBoundary:'Keyboard card click records the unchanged href in the fixture; real case-study component mounted in separate isolated session. No route/API server or external navigation.'},null,2));
}finally{await writeFile(resolve(output,'keyboard-request-log.json'),JSON.stringify(h.requestLog,null,2));await h.close();}
