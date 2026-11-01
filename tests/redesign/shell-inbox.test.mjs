import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createHarness} from './browser-harness.mjs';
import {ready,settle} from './matrix-utils.mjs';
test('wide shell navigation preserves the already mounted real Inbox without another ACK',async()=>{
 const output=process.env.REDESIGN_TEST_OUTPUT,h=await createHarness(resolve(output,'assets'));
 try{const {context,page}=await h.session('unseen',{width:1440,height:1000},'dark',{surface:'dashboard'});
  try{await ready(page);await page.getByRole('button',{name:'Open Workspace AI chat',exact:true}).click();await page.getByRole('button',{name:'Inbox',exact:true}).click();
   await page.getByRole('region',{name:'Agent Inbox',exact:true}).waitFor();await page.waitForFunction(()=>window.redesignFixture.snapshot().events.some(e=>e.kind==='ack-in-memory'));
   await page.evaluate(()=>{window.shellInboxNode=document.querySelector('[aria-label="Agent Inbox"]');});
   const lifecycle=events=>events.filter(event=>event.kind==='inbox-read-in-memory'||event.kind.startsWith('ack-'));
   const before=lifecycle(await page.evaluate(()=>window.redesignFixture.snapshot().events));
   for(const name of ['Projects','Tasks','Calendar','Plans','Notes','Tech Stack','Accountability','Portfolio','Files','GitHub','Settings','Today','Dashboard']){
    await page.locator('.workspace-rail').getByRole('button',{name,exact:true}).click();await settle(page);
    assert.equal(await page.evaluate(()=>document.querySelector('[aria-label="Agent Inbox"]')===window.shellInboxNode),true,name);
    const events=lifecycle(await page.evaluate(()=>window.redesignFixture.snapshot().events));assert.deepEqual(events,before,`${name}: Inbox lifecycle changed`);
   }
   await writeFile(resolve(output,'shell-mounted-inbox-evidence.json'),JSON.stringify({before,after:await page.evaluate(()=>window.redesignFixture.snapshot().events),sameDomNode:true,destinations:13,transport:'in-memory only'},null,2));
  }finally{await context.close();}
 }finally{await h.close();}
});
