import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';
test('memory fetch preserves Request methods and init overrides without HTTP dispatch', async () => {
  const harness = await createHarness(resolve(process.env.REDESIGN_TEST_OUTPUT, 'assets'));
  try {
    const {context,page}=await harness.session('unseen',{width:1024,height:768},'dark',{surface:'dashboard'});
    try {
      const result=await page.evaluate(async()=>{
        const url=new URL('/api/drive/files',location.origin);
        const attempts=[
          [new Request(url,{method:'POST'}),undefined],
          [new Request(url,{method:'GET'}),{method:'POST'}],
        ];
        const rejected=[];
        for(const [input,init] of attempts){try{await fetch(input,init);rejected.push(false);}catch{rejected.push(true);}}
        const allowed=await fetch(new Request(url,{method:'POST'}),{method:'GET'});
        return {rejected,allowed:allowed.ok};
      });
      assert.deepEqual(result,{rejected:[true,true],allowed:true});
      assert.equal(harness.requestLog.filter(e=>e.layer==='server'&&e.path.startsWith('/api/')).length,0);
    } finally {await context.close();}
  }finally{await harness.close();}
});
