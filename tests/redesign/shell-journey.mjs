import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
import {ready,settle,fontMetadata} from './matrix-utils.mjs';
const output=process.argv[2];await mkdir(resolve(output,'shell'),{recursive:true});
const h=await createHarness(resolve(output,'assets'));const records=[],targets=[];
const destinations=['Dashboard','Today','Projects','Tasks','Calendar','Plans','Notes','Tech Stack','Accountability','Portfolio','Files','GitHub','Settings'];
async function visibleFocus(page,label){
  const state=await page.evaluate(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.y+r.height/2)));return {text:e.getAttribute('aria-label')||e.textContent,width:r.width,height:r.height,x:r.x,y:r.y,visible:r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth,uncovered:!!hit&&(hit===e||e.contains(hit)),inert:!!e.closest('[inert]')};});
  assert.ok(state.visible&&!state.inert&&state.uncovered,`${label}: hidden/covered focus ${JSON.stringify(state)}`);return state;
}
async function tabTo(page,locator,label){for(let index=0;index<180;index++){if(await locator.evaluate(e=>e===document.activeElement)){await visibleFocus(page,label);return index;}await page.keyboard.press('Tab');}throw new Error(`Keyboard cannot reach ${label}`);}
async function activate(page,locator,label){await tabTo(page,locator,label);await page.keyboard.press('Enter');await settle(page);}
const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function measure(page,stage,viewport,theme){
  const rows=await page.evaluate(()=>[...document.querySelectorAll('.workspace-layout button,.workspace-layout a,.workspace-layout input,.workspace-layout select,.workspace-layout textarea,.workspace-layout [role="separator"]')].filter(e=>e.getClientRects().length&&!e.closest('[inert]')&&!e.closest('[hidden]')).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,80),component:e.closest('.workspace-drawer')?'Drawer':e.closest('.workspace-rail')?'Rail':e.closest('.workspace-bottom-nav')?'Bottom navigation':e.closest('.workspace-ai-panel')?'Assistant shell':e.closest('.workspace-header')?'Header':'Workspace',tag:e.tagName,className:e.className,width:r.width,height:r.height,exception:e.matches('input[type=file].sr-only')?'Approved hidden input; Files > New > File upload':null};}));
  for(const row of rows)assert.ok(row.exception||row.width>=44&&row.height>=44,`Target ${stage}: ${JSON.stringify(row)}`);
  targets.push(...rows.map(row=>({...row,stage,viewport,theme})));
}
try{
 for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light']){
  const viewport={width,height};const {page,context,errors}=await h.session('unseen',viewport,theme,{surface:'dashboard'});page.setDefaultTimeout(5000);
  const steps=[];
  const capture=async stage=>{await settle(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${stage} page overflow`);const headings=await page.locator('.workspace-context h2,.workspace-drawer h2').evaluateAll(nodes=>nodes.map(e=>getComputedStyle(e).fontFamily));assert.ok(headings.every(font=>font.includes('Geist')&&!/Caveat|Kalam/.test(font)));await measure(page,stage,viewport,theme);const filename=`${stage}--${theme}--${width}x${height}--after.png`;await page.screenshot({path:resolve(output,'shell',filename)});steps.push({stage,filename,fonts:await fontMetadata(page)});};
  try{
   await ready(page);await capture('shell-default');
   const titleFont=await page.locator('.workspace-header h1[data-workspace-page-title]').evaluate(e=>getComputedStyle(e).fontFamily);assert.match(titleFont,/Caveat/);
   const operationalHeadings=await page.locator('.workspace-context h2,.workspace-rail h2').evaluateAll(nodes=>nodes.map(e=>getComputedStyle(e).fontFamily));assert.ok(operationalHeadings.every(font=>font.includes('Geist')&&!/Caveat|Kalam/.test(font)));
   if(width>700){for(const name of destinations){const target=page.locator('.workspace-rail').getByRole('button',{name,exact:true});await tabTo(page,target,`rail ${name}`);}
   }
   for(const name of destinations){
    await activate(page,button(page,'Open workspace navigation'),'open navigation');
    const dialog=page.getByRole('dialog',{name:'Workspace navigation',exact:true});
    for(const heading of ['Work','Planning and review','Publishing and connections','Personal settings'])assert.equal(await dialog.getByRole('heading',{name:heading,exact:true}).count(),1);
    await activate(page,dialog.getByRole('button',{name,exact:true}),`drawer ${name}`);
    await page.locator('.workspace-header h1').filter({hasText:new RegExp(`^${name}$`)}).waitFor();await visibleFocus(page,`return from ${name}`);
   }
   await activate(page,button(page,'Open workspace navigation'),'navigation Escape');await capture('navigation-drawer');await page.keyboard.press('Escape');assert.equal(await button(page,'Open workspace navigation').evaluate(e=>e===document.activeElement),true);
   await activate(page,button(page,'Open workspace navigation'),'dashboard return');await activate(page,page.getByRole('dialog',{name:'Workspace navigation',exact:true}).getByRole('button',{name:'Dashboard',exact:true}),'Dashboard');
   if(width<1280){await activate(page,button(page,'Open context sidebar'),'context');await capture('context-drawer');await page.keyboard.press('Escape');assert.equal(await button(page,'Open context sidebar').evaluate(e=>e===document.activeElement),true);if(width===1024){await activate(page,button(page,'Open context sidebar'),'responsive context');await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Collapse sidebar');await visibleFocus(page,'context drawer to inline');await page.setViewportSize(viewport);await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open context sidebar');await visibleFocus(page,'context inline to drawer trigger');}}
   else {await activate(page,button(page,'Collapse sidebar'),'collapse');assert.equal(await page.locator('aside.workspace-context').count(),0);await capture('context-collapsed');await activate(page,button(page,'Expand sidebar'),'expand');assert.equal(await page.locator('aside.workspace-context').count(),1);const resize=page.getByRole('separator',{name:'Context sidebar width'});await tabTo(page,resize,'resize context');await page.keyboard.press('End');assert.equal(await resize.getAttribute('aria-valuenow'),'300');await page.keyboard.press('Home');assert.equal(await resize.getAttribute('aria-valuenow'),'192');}
   await activate(page,button(page,'Search workspace'),'search');await page.getByRole('dialog',{name:'Search workspace',exact:true}).waitFor();await capture('search');await page.keyboard.press('Escape');assert.equal(await button(page,'Search workspace').evaluate(e=>e===document.activeElement),true);
   await page.keyboard.press('Control+k');await page.getByRole('dialog',{name:'Search workspace',exact:true}).waitFor();await page.keyboard.press('Escape');await visibleFocus(page,'search shortcut return');
   await activate(page,button(page,'Open account menu'),'account');await visibleFocus(page,'account first action');await capture('account-menu');await page.keyboard.press('Escape');assert.equal(await button(page,'Open account menu').evaluate(e=>e===document.activeElement),true);
   await activate(page,button(page,'Open account menu'),'profile menu');await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'Your profile',exact:true}).waitFor();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open account menu');
   await activate(page,button(page,'Open Workspace AI chat'),'AI open');await button(page,'Minimize chat').waitFor();await visibleFocus(page,'AI first focus');await capture('assistant-open');
   if(width<1280){assert.equal(await page.locator('.workspace-center').getAttribute('inert'),'');for(let i=0;i<18;i++){await page.keyboard.press('Tab');await visibleFocus(page,`AI Tab ${i}`);assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.workspace-assistant')),true);}}
   await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open Workspace AI chat');assert.equal(await page.locator('.workspace-ai-panel.is-open').count(),0);
   // Exact sidebar/compact/AI restoration, using only keyboard controls.
   if(width>=1280){await activate(page,button(page,'Use compact navigation'),'compact');await activate(page,button(page,'Collapse sidebar'),'collapse before focus');await activate(page,button(page,'Open Workspace AI chat'),'AI before focus');}
   const before=await page.locator('.workspace-layout').evaluate(e=>({collapsed:e.classList.contains('context-collapsed'),compact:e.classList.contains('navigation-compact'),ai:!!e.querySelector('.workspace-ai-panel.is-open'),contextWidth:e.style.getPropertyValue('--context-width')}));
   await activate(page,button(page,'Enter Focus Mode'),'enter focus');await capture('focus-mode');await page.keyboard.press('Escape');
   const after=await page.locator('.workspace-layout').evaluate(e=>({collapsed:e.classList.contains('context-collapsed'),compact:e.classList.contains('navigation-compact'),ai:!!e.querySelector('.workspace-ai-panel.is-open'),contextWidth:e.style.getPropertyValue('--context-width')}));assert.deepEqual(after,before);await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Enter Focus Mode');await visibleFocus(page,'focus restoration');
   await capture('focus-restored');
   if(width>=1280){await page.setViewportSize({width:1024,height:768});await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Minimize chat');await visibleFocus(page,'docked to modal resize');assert.equal(await page.locator('.workspace-skip').getAttribute('inert'),'');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open Workspace AI chat');await page.setViewportSize(viewport);}
   const events=await page.evaluate(()=>window.redesignFixture.snapshot().events);assert.equal(events.filter(e=>/inbox|ack/.test(e.kind)).length,0,'Shell navigation must not mount/read/ACK Inbox');assert.deepEqual(errors,[]);
   records.push({viewport,theme,steps,focusRestoration:{before,after},inboxEvents:events.filter(e=>/inbox|ack/.test(e.kind)),keyboardOnly:true});console.log(`${width}x${height} ${theme}: keyboard shell journey passed`);
  }catch(error){await writeFile(resolve(output,'shell-failure.txt'),`${width} ${theme}\n${error.stack}\n${await page.locator('body').innerText()}`);throw error;}finally{await context.close();}
 }
 await writeFile(resolve(output,'shell-journey.json'),JSON.stringify({fixtureVersion:'phase0b-v1',fixedTime:'2026-10-26T02:00:00.000Z',records},null,2));
 await writeFile(resolve(output,'shell-target-ledger.json'),JSON.stringify({policy:'44px minimum; only approved hidden file input exception. No inline-link exception.',measurements:targets},null,2));
}finally{await writeFile(resolve(output,'shell-request-log.json'),JSON.stringify(h.requestLog,null,2));await h.close();}
