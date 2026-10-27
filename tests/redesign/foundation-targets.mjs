import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';
import { ready,selectSurface,settle } from './matrix-utils.mjs';
const output=process.argv[2];
const original=JSON.parse(await readFile(resolve(output,'../pre-phase-1-addendum/target-component-instances.json'),'utf8'));
const harness=await createHarness(resolve(output,'assets'));const measurements=[],exceptions=[];
const samples=new Map();for(const row of original){const key=JSON.stringify([row.surface,row.viewport,row.theme]);const list=samples.get(key)??[];list.push(row);samples.set(key,list);}
try{
  for(const [key,rows] of samples){
    const [surface,viewport,theme]=JSON.parse(key);const {context,page}=await harness.session('unseen',viewport,theme,{surface});
    try{
      if(surface!=='public'){await ready(page);await selectSurface(page,surface);}await settle(page);
      const current=await page.evaluate(rows=>{
        const controls=[...document.querySelectorAll('button,a,input,select,textarea')];
        const label=e=>(e.getAttribute('aria-label')||e.textContent||e.getAttribute('placeholder')||e.tagName).trim().slice(0,110);
        return rows.map(row=>{
          const index=/document control index (\d+)/.exec(row.selector)?.[1];
          let e=index!==undefined?controls[Number(index)]:document.querySelector(row.selector);
          if(!e||label(e)!==row.label)e=controls.find(value=>label(value)===row.label&&value.tagName===row.tag);
          if(!e)throw new Error(`Original target missing: ${row.selector}`);
          const r=e.getBoundingClientRect();
          return {component:row.component,selector:row.componentSelector,originalSelector:row.selector,label:row.label,width:r.width,height:r.height,
            meets44:r.width>=44&&r.height>=44,proxy:e.classList.contains('sr-only'),inlineProse:e.tagName==='A'&&!!e.closest('p')};
        });
      },rows);
      for(const row of current){measurements.push({...row,surface,viewport,theme});if(!row.meets44)exceptions.push({...row,surface,viewport,reason:row.proxy?'Visually hidden native file input; explicit 44px File upload menu action invokes this same input.':row.inlineProse?'Inline prose link preserves reading flow; retains keyboard focus and visible link styling.':'UNRESOLVED',equivalentAction:row.proxy?'Files → New → File upload (44px or larger)':row.inlineProse?'Same inline link by keyboard or pointer; no hidden alternate action.':null});}
    }finally{await context.close();}
  }
  // Exercise the exact visible equivalent for the original hidden file picker.
  const {context,page}=await harness.session('unseen',{width:390,height:844},'dark',{surface:'files'});
  let proxyProof;
  try{
    await ready(page);await selectSurface(page,'files');await page.getByRole('button',{name:'New',exact:true}).click();
    const upload=page.getByRole('menuitem',{name:'File upload',exact:true});
    const size=await upload.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));
    const [chooser]=await Promise.all([page.waitForEvent('filechooser'),upload.click()]);
    const hiddenClass=await chooser.element().getAttribute('class');assert.ok(hiddenClass.includes('sr-only'));assert.ok(size.width>=44&&size.height>=44);
    proxyProof={size,invokesOriginalHiddenInput:true,selectedOrUploadedFiles:false};
  }finally{await context.close();}
  assert.equal(measurements.length,508);assert.equal(exceptions.filter(row=>row.reason==='UNRESOLVED').length,0);
  await writeFile(resolve(output,'target-exceptions.json'),JSON.stringify({originalInstances:508,nowMeets44:measurements.filter(row=>row.meets44).length,proposedExceptions:exceptions,proxyProof,measurements,note:'No dense-row exception is assumed. Each remaining exception has a reason and equivalent action.'},null,2));
  console.log(`${measurements.filter(row=>row.meets44).length}/508 meet 44px; ${exceptions.length} explicitly justified exceptions.`);
}finally{await writeFile(resolve(output,'target-request-log.json'),JSON.stringify(harness.requestLog,null,2));await harness.close();}
