import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
import {ready,navigate} from './matrix-utils.mjs';
test('shell exposes four approved groups and reachable 1024 context',async()=>{
  const h=await createHarness(resolve(process.env.REDESIGN_TEST_OUTPUT,'assets'));
  try{const {page,context}=await h.session('unseen',{width:1024,height:768},'dark',{surface:'dashboard'});
    try{await ready(page);await page.getByRole('button',{name:'Open workspace navigation',exact:true}).click();
      for(const name of ['Work','Planning and review','Publishing and connections','Personal settings'])await page.locator('dialog[open]').getByRole('heading',{name,exact:true}).waitFor({timeout:1500});
      await page.keyboard.press('Escape');await page.getByRole('button',{name:'Open context sidebar',exact:true}).click();
      await page.getByRole('dialog',{name:'Dashboard context'}).waitFor();await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button',{name:'Open context sidebar',exact:true}).evaluate(e=>e===document.activeElement),true);
    }finally{await context.close();}
  }finally{await h.close();}
});
test('768px content compression preserves the real field target and page width',async()=>{
 const h=await createHarness(resolve(process.env.REDESIGN_TEST_OUTPUT,'assets'));
 try{for(const theme of ['dark','light']){const {page,context}=await h.session('unseen',{width:768,height:1024},theme,{surface:'tech'});
  try{await ready(page);await navigate(page,'tech','Tech Stack');const size=await page.getByRole('textbox',{name:'Technology name'}).evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));assert.ok(size.width>=44&&size.height>=44);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}finally{await context.close();}
 }}finally{await h.close();}
});
