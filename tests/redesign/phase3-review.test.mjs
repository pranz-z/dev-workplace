import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createHarness} from './browser-harness.mjs';
import {ready,navigate,selectSurface,settle,controlTargets} from './matrix-utils.mjs';
const output=process.env.REDESIGN_TEST_OUTPUT;
test('open project actions stay within the viewport and Escape restores summary focus',async()=>{
 const h=await createHarness(resolve(output,'action-assets'));
 try{for(const width of [1440,1024,768,390,320]){const {page,context}=await h.session('unseen',{width,height:844},'light',{surface:'project-detail'});
  try{await ready(page);await selectSurface(page,'project-detail');await page.locator('.project-actions summary').click();await settle(page);const r=await page.locator('.project-action-popover').evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}));assert.ok(r.left>=0&&r.right<=width,`${width}: ${JSON.stringify(r)}`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.project-actions summary').evaluate(e=>e===document.activeElement),true);}finally{await context.close();}
 }}finally{await h.close();}
});
test('three-task downward Before placement uses the existing ordering call with the intended order',async()=>{
 const h=await createHarness(resolve(output,'action-assets'));
 try{const {page,context}=await h.session('unseen',{width:1024,height:768},'dark',{surface:'tasks',variant:'phase3-ordering-before'});
  try{await ready(page);await navigate(page,'tasks','Tasks');await page.getByRole('combobox',{name:'Choose a project for Task Kanban ordering'}).selectOption('aaaaaaaa-aaaa-4aaa-8aaa-000000000001');await page.getByRole('button',{name:'Move or reorder Synthetic Backlog task with a descriptive title',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Move or reorder task'});await dialog.getByRole('combobox',{name:'Task position'}).selectOption('aaaaaaaa-aaaa-4aaa-8aaa-000000000112');await dialog.getByRole('button',{name:'Apply move',exact:true}).click();await page.waitForFunction(()=>window.matrixFixture.calls.some(c=>c.name==='reorderProjectTasks'));const calls=await page.evaluate(()=>window.matrixFixture.calls.filter(c=>c.name==='reorderProjectTasks'));assert.deepEqual(calls[0].args[3].map(u=>u.id),['aaaaaaaa-aaaa-4aaa-8aaa-000000000111','aaaaaaaa-aaaa-4aaa-8aaa-000000000010','aaaaaaaa-aaaa-4aaa-8aaa-000000000112']);}finally{await context.close();}
 }finally{await h.close();}
});
test('move dialog fits all five sizes in both themes and Escape returns focus',async()=>{
 const h=await createHarness(resolve(output,'action-assets')),records=[],targets=[];
 try{for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light']){const {page,context}=await h.session('unseen',{width,height},theme,{surface:'tasks',variant:'phase3-ordering'});
  try{await ready(page);await navigate(page,'tasks','Tasks');await page.getByRole('combobox',{name:'Choose a project for Task Kanban ordering'}).selectOption('aaaaaaaa-aaaa-4aaa-8aaa-000000000001');const trigger=page.getByRole('button',{name:'Move or reorder Synthetic Backlog task with a descriptive title',exact:true});await trigger.click();const dialog=page.getByRole('dialog',{name:'Move or reorder task'});const geometry=await dialog.locator('form').evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,fonts:[...e.querySelectorAll('h2,p,label,select,button')].map(node=>getComputedStyle(node).fontFamily)}));assert.ok(geometry.left>=0&&geometry.right<=width,JSON.stringify({width,geometry}));assert.ok(geometry.scrollWidth<=geometry.clientWidth);assert.ok(geometry.fonts.every(font=>font.includes('Geist')&&!/Kalam|Caveat/.test(font)));await page.screenshot({path:resolve(output,'projects-tasks',`task-move--${theme}--${width}x${height}.png`)});targets.push(...(await controlTargets(page)).map(row=>({...row,viewport:{width,height},theme})));await page.keyboard.press('Escape');assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);records.push({viewport:{width,height},theme,geometry});}finally{await context.close();}
 }}finally{await writeFile(resolve(output,'move-dialog-geometry.json'),JSON.stringify(records,null,2));await writeFile(resolve(output,'move-dialog-targets.json'),JSON.stringify(targets,null,2));await h.close();}
});
