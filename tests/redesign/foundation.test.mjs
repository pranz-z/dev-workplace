import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';
import { ready } from './matrix-utils.mjs';
test('shared workspace controls use Geist and 44px targets while page title retains Caveat',async()=>{
  const harness=await createHarness(resolve(process.env.REDESIGN_TEST_OUTPUT,'assets'));
  try{
    const {context,page}=await harness.session('unseen',{width:1024,height:768},'dark',{surface:'dashboard'});
    try{
      await ready(page);
      const result=await page.evaluate(()=>{
        const button=document.querySelector('[aria-label="Search workspace"]');
        const r=button.getBoundingClientRect();
        return {font:getComputedStyle(button).fontFamily,title:getComputedStyle(document.querySelector('.workspace-header h1')).fontFamily,width:r.width,height:r.height};
      });
      assert.match(result.font,/Geist/);assert.doesNotMatch(result.font,/Caveat|Kalam|cursive/);
      assert.match(result.title,/Caveat/);assert.ok(result.width>=44&&result.height>=44);
    }finally{await context.close();}
  }finally{await harness.close();}
});
