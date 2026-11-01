import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
const o=process.argv[2],h=await createHarness(resolve(o,process.argv.includes('--after')?'after-assets':'before-assets'));
try{const {context,page}=await h.session('unseen',{width:390,height:844},'dark',{surface:'public',variant:'rich'});
await page.locator('#projects').waitFor();
const metrics=await page.evaluate(()=>{const title=document.querySelector('#portfolio-intro'),desk=title.closest('section').querySelector('[class*="desk"]');return{heroIllustrationHeight:desk?.getBoundingClientRect().height??0,bodyFont:getComputedStyle(document.querySelector('.public-shell main p')).fontFamily};});
await writeFile(resolve(o,process.argv.includes('--after')?'green-metrics.json':'red-metrics.json'),JSON.stringify(metrics,null,2));
assert.ok(metrics.heroIllustrationHeight<=320,'Hero illustration must not dominate the mobile introduction');
await context.close();}finally{await h.close();}
