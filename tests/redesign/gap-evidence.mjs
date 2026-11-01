import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';
import { ready, selectSurface, settle, fontMetadata } from './matrix-utils.mjs';

const output = process.argv[2];
await mkdir(resolve(output, 'gaps'), { recursive: true });
const harness = await createHarness(resolve(output, 'assets'));
const records = [], targets = [];
const save = async (page, name, details = {}) => {
  await settle(page);
  await page.screenshot({ path: resolve(output, 'gaps', `${name}.png`) });
  const fixture = await page.evaluate(() => window.matrixFixture);
  assert.deepEqual(fixture.unexpected, [], `Unimplemented boundary on ${name}`);
  records.push({ name, ...details, fonts: await fontMetadata(page), calls: fixture.calls });
};
const focus = page => page.evaluate(() => {
  const e = document.activeElement, r = e.getBoundingClientRect(), top = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return { tag: e.tagName, label: e.getAttribute('aria-label') ?? e.textContent?.slice(0,90), inDialog: !!e.closest('dialog[open]'),
    rectangle: { x:r.x,y:r.y,width:r.width,height:r.height }, centerUnobscured: !!top && (top === e || e.contains(top)) };
});
try {
  for (const theme of ['dark','light']) {
    const {context,page,errors} = await harness.session('unseen', {width:1024,height:768}, theme, {surface:'dashboard'});
    try {
      await ready(page);
      const contextVisible = await page.locator('.workspace-context').isVisible();
      await save(page, `1024-native-context-${theme}`, { contextVisible, note: 'Native state; no CSS or hidden controls forced.' });
      const collapse = page.getByRole('button',{name:'Collapse sidebar',exact:true});
      if (await collapse.isVisible()) { await collapse.click(); await save(page,`1024-context-collapsed-${theme}`); }
      else records.push({name:`1024-context-toggle-${theme}`,status:'not available in this native responsive state',contextVisible});
      await page.getByRole('button',{name:'Open Workspace AI chat',exact:true}).click();
      await save(page,`1024-ai-open-${theme}`);
      await page.getByRole('button',{name:'Enter Focus Mode',exact:true}).click();
      await save(page,`1024-focus-mode-${theme}`);
      await page.keyboard.press('Escape');
      const search = page.getByRole('button',{name:'Search workspace',exact:true});
      await search.focus(); await page.keyboard.press('Enter');
      await page.getByRole('dialog',{name:'Search workspace',exact:true}).waitFor();
      const journey = [await focus(page)];
      for(let i=0;i<5;i++){await page.keyboard.press('Tab');journey.push(await focus(page));}
      await save(page,`search-keyboard-${theme}`,{journey,focusContained:journey.every(value=>value.inDialog),
        backgroundInteractiveFocus:journey.some(value=>!value.inDialog&&!['BODY','HTML'].includes(value.tag)),
        note:'BODY at a Tab boundary may represent native browser-chrome focus; not proof a background control received focus.'});
      await page.keyboard.press('Escape');
      await page.getByRole('dialog',{name:'Search workspace',exact:true}).waitFor({state:'hidden'});
      records.push({name:`search-escape-${theme}`,restoredToSearch:await search.evaluate(e=>e===document.activeElement),focus:await focus(page)});
      assert.deepEqual(errors,[]);
    } finally {await context.close();}
  }

  const variants = [
    ['workspace-loading','dashboard','loading'],['workspace-error','dashboard','error'],['projects-empty','projects','empty'],
    ['tasks-empty','tasks-list','empty'],['files-empty','files','empty'],['drive-disconnected','files','disconnected'],
    ['drive-error','files','integration-error'],['public-error','public','error'],['case-notfound','case-study','notfound'],
    ['plans','plans','normal'],['notes','notes','normal'],['tech','tech','normal'],['accountability','accountability','normal'],['github','github','normal'],['portfolio-editor','portfolio','normal'],
  ];
  for (const [name,surface,variant] of variants) {
    const {context,page,errors} = await harness.session('unseen',{width:1024,height:768},'dark',{surface,variant});
    page.setDefaultTimeout(7000);
    try {
      if(!['public','case-study'].includes(surface)){await ready(page,variant);if(!['loading','error'].includes(variant))await selectSurface(page,surface);}
      if(surface==='case-study')await page.getByText(/Project not found|not available|not found/i).first().waitFor();
      await save(page,name,{surface,variant,viewport:{width:1024,height:768},theme:'dark'});
      assert.deepEqual(errors,[],name);
    } finally {await context.close();}
  }

  // Native form overlay without saving, and keyboard Escape/focus restoration.
  {
    const {context,page,errors}=await harness.session('unseen',{width:390,height:844},'dark',{surface:'dashboard'});
    try {
      await ready(page);
      const trigger=page.getByRole('button',{name:/^\+?\s*New Project$/i}).filter({visible:true}).last();
      await trigger.focus();await page.keyboard.press('Enter');
      await page.locator('dialog[open]').waitFor();
      const journey=[await focus(page)];for(let i=0;i<8;i++){await page.keyboard.press('Tab');journey.push(await focus(page));}
      await save(page,'new-project-keyboard-mobile',{journey,focusContained:journey.every(value=>value.inDialog)});
      await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});
      records.push({name:'new-project-escape',restored:await trigger.evaluate(e=>e===document.activeElement)});
      assert.deepEqual(errors,[]);
    } finally {await context.close();}
  }

  // Real touch events in Chromium emulation, not a viewport-only check.
  {
    const {context,page,errors}=await harness.session('unseen',{width:390,height:844},'dark',{surface:'dashboard',contextOptions:{hasTouch:true,isMobile:true}});
    try {
      await ready(page);
      await page.getByRole('button',{name:'Open workspace navigation',exact:true}).tap();
      await save(page,'touch-drawer',{input:'Chromium synthesized touch; no physical-device claim'});
      await page.locator('dialog[open]').getByRole('button',{name:'Tasks',exact:true}).tap();
      await page.locator('.workspace-header h1').filter({hasText:'Tasks'}).waitFor();
      const board=page.getByRole('region',{name:'Task Kanban board',exact:true});await board.scrollIntoViewIfNeeded();
      const before=await board.evaluate(e=>({left:e.scrollLeft,width:e.clientWidth,total:e.scrollWidth}));
      const box=await board.boundingBox();const cdp=await context.newCDPSession(page);
      const x=Math.min(box.x+box.width-25,365),y=Math.max(120,Math.min(box.y+28,780));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-i*35,y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await settle(page);
      const after=await board.evaluate(e=>({left:e.scrollLeft,width:e.clientWidth,total:e.scrollWidth}));
      await save(page,'touch-kanban-scroll',{input:'CDP touchStart/move/end on header area',before,after,scrolled:after.left>before.left});
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }

  // Reduced-motion preference changes and preview eligibility, with no media CDN.
  {
    const {context,page,errors}=await harness.session('unseen',{width:1440,height:1000},'dark',{surface:'public',contextOptions:{reducedMotion:'reduce'}});
    try {
      const card=page.getByRole('article').first();await card.scrollIntoViewIfNeeded();
      await card.hover();await settle(page);
      const reduced=await page.evaluate(()=>({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,previewReads:window.matrixFixture.calls.filter(call=>call.name.includes('preview-video')).length,bodyTransition:getComputedStyle(document.body).transitionDuration}));
      await save(page,'reduced-motion-public',{reduced});
      await page.mouse.move(0,0);await page.emulateMedia({reducedMotion:'no-preference'});await card.hover();await settle(page);
      const normal=await page.evaluate(()=>({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,previewReads:window.matrixFixture.calls.filter(call=>call.name.includes('preview-video')).length}));
      await page.emulateMedia({reducedMotion:'reduce'});await settle(page);
      records.push({name:'motion-preference-toggle',reduced,normal,afterReduce:await page.evaluate(()=>({srcs:[...document.querySelectorAll('video')].map(e=>e.getAttribute('src')),matches:matchMedia('(prefers-reduced-motion: reduce)').matches})),limitation:'Synthetic preview projection returns 404; real MP4 decoding and active-playback stop not proven.'});
      assert.equal(reduced.previewReads,0);assert.ok(normal.previewReads>0);assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }

  // Representative actual target rectangles; small controls remain failures,
  // never silent exceptions. No hit-area equivalence is assumed from a row.
  for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const surface of ['dashboard','tasks-list','files','public']){
    const {context,page}=await harness.session('unseen',{width,height},'dark',{surface});
    try{
      if(surface!=='public'){await ready(page);await selectSurface(page,surface);}await settle(page);
      const rows=await page.evaluate(()=>[...document.querySelectorAll('button,a,input,select,textarea')].flatMap((e,index)=>{
        const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(!r.width||!r.height||s.visibility==='hidden'||r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return[];
        const aria=e.getAttribute('aria-label'),label=(aria||e.textContent||e.getAttribute('placeholder')||e.tagName).trim().slice(0,110);
        return[{selector:aria?`${e.tagName.toLowerCase()}[aria-label=${JSON.stringify(aria)}]`:`${e.tagName.toLowerCase()} (document control index ${index}, text ${JSON.stringify(label)})`,label,width:r.width,height:r.height,meets44:r.width>=44&&r.height>=44,tag:e.tagName}];
      }));
      targets.push({surface,viewport:{width,height},theme:'dark',controls:rows});
    }finally{await context.close();}
  }
  assert.equal(harness.requestLog.filter(e=>e.disposition.startsWith('denied')).length,0);
}finally{
  await writeFile(resolve(output,'gap-evidence.json'),JSON.stringify({browser:harness.browser.version(),records,limitations:['Touch is emulated Chromium only.','Baseline failures are recorded; no shipped UI fixes.','No full screen-reader, physical-device, real MP4 or hosted integration certification.']},null,2));
  await writeFile(resolve(output,'target-exceptions.json'),JSON.stringify({aim:'44x44 CSS px',approvedExceptions:[],policyCandidates:[{kind:'inline prose links',reason:'Preserve reading flow; requires spacing and label review.'},{kind:'dense row action',reason:'Only if equivalent >=44px action performs the SAME operation; not assumed here.'}],baselineShortfalls:'Every meets44=false control remains unresolved; no exception is silently granted.',measurements:targets},null,2));
  await writeFile(resolve(output,'gap-request-log.json'),JSON.stringify(harness.requestLog,null,2));
  await harness.close();
}
