import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
import {ready,selectSurface,settle} from './matrix-utils.mjs';
test('long project description leaves selected tab and content start above the fold',async()=>{
 const h=await createHarness(resolve(process.env.REDESIGN_TEST_OUTPUT,'assets'));
 try{for(const [width,height] of [[1440,1000],[1024,768]]){const {page,context}=await h.session('unseen',{width,height},'dark',{surface:'project-detail'});
  try{await ready(page);await selectSurface(page,'project-detail');await settle(page);const tab=await page.getByRole('button',{name:'Overview',exact:true}).evaluate(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,background:getComputedStyle(e).backgroundColor}));assert.ok(tab.bottom<=height,`${width}: selected tab below fold: ${tab.bottom}`);const content=await page.locator('[data-project-tab-content]').evaluate(e=>e.getBoundingClientRect().top);assert.ok(content<height);assert.equal(await page.getByRole('button',{name:'Back to projects',exact:true}).count(),1);assert.notEqual(tab.background,await page.getByRole('button',{name:'Workflow',exact:true}).evaluate(e=>getComputedStyle(e).backgroundColor),'Selected state must remain visible after focus moves');
  }finally{await context.close();}
 }}finally{await h.close();}
});
