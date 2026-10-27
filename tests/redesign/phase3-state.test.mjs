import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createHarness} from './browser-harness.mjs';
import {ready,navigate,settle,controlTargets} from './matrix-utils.mjs';
test('all collection modes retain filters across detail/back and recover empty results without history writes',async()=>{
 const h=await createHarness(resolve(process.env.REDESIGN_TEST_OUTPUT,'assets'));
 const targets=[];
 try{for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light']){const {context,page}=await h.session('unseen',{width,height},theme,{surface:'projects'});
  try{await ready(page);await navigate(page,'projects','Projects');const historyBefore=await page.evaluate(()=>({length:history.length,path:location.pathname,search:location.search,hash:location.hash}));
   for(const mode of ['grid','list','kanban']){
    await page.locator('#workspace-content').getByRole('button',{name:mode,exact:true}).click();await page.getByRole('textbox',{name:'Filter project collection'}).fill('private');await page.getByRole('combobox',{name:'Project status filter'}).selectOption('In Development');await page.locator('.project-collection').getByRole('button').filter({hasText:'Synthetic private project'}).first().click();await page.getByRole('button',{name:'Back to projects',exact:true}).click();await settle(page);
    assert.equal(await page.locator('#workspace-content').getByRole('button',{name:mode,exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.getByRole('textbox',{name:'Filter project collection'}).inputValue(),'private');assert.equal(await page.getByRole('combobox',{name:'Project status filter'}).inputValue(),'In Development');
    await page.getByRole('textbox',{name:'Filter project collection'}).fill('no matching synthetic record');await page.getByRole('heading',{name:'No matching projects',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const measured=await controlTargets(page);assert.ok(measured.every(row=>row.exception||row.width>=44&&row.height>=44));targets.push(...measured.map(row=>({...row,viewport:{width,height},theme,mode})));await page.screenshot({path:resolve(process.env.REDESIGN_TEST_OUTPUT,'projects-tasks',`collection-empty-${mode}--${theme}--${width}x${height}.png`)});await page.getByRole('button',{name:'Clear project collection filters',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Filter project collection'}).inputValue(),'');assert.equal(await page.getByRole('combobox',{name:'Project status filter'}).inputValue(),'all');
   }
   assert.deepEqual(await page.evaluate(()=>({length:history.length,path:location.pathname,search:location.search,hash:location.hash})),historyBefore);
  }finally{await context.close();}
 }}finally{await writeFile(resolve(process.env.REDESIGN_TEST_OUTPUT,'collection-state-targets.json'),JSON.stringify(targets,null,2));await h.close();}
});
