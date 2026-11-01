import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
const o=process.argv[2],h=await createHarness(resolve(o,'after-assets'),{embeddedFonts:true});
try{const {page,context}=await h.session('unseen',{width:1440,height:1000},'dark',{surface:'public',variant:'rich'});
await page.locator('article.portfolio-project').first().waitFor();
const data=await page.locator('article.portfolio-project').first().evaluate(e=>{const m=e.querySelector('video').parentElement,b=m.getBoundingClientRect(),text=e.querySelector('h3').getBoundingClientRect();return{tape:getComputedStyle(e,'::before').content,outline:getComputedStyle(e.querySelector('.notebook-border')).display,media:{x:b.x,width:b.width},title:{x:text.x,width:text.width}};});
await writeFile(resolve(o,'featured-card-regression.json'),JSON.stringify(data,null,2));assert.equal(data.tape,'none','Repeated decorative tape removed');assert.equal(data.outline,'none','Repeated sketch outline removed');assert.ok(data.title.x>data.media.x+data.media.width,'Wide featured card uses media and readable text columns');assert.ok(data.title.width>300);await page.locator('#projects').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(o,'featured-card-final.png')});await context.close();
}finally{await h.close();}
