import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
const o=process.argv[2],h=await createHarness(resolve(o,'avatar-assets'),{embeddedFonts:true});
try{const {page,context}=await h.session('unseen',{width:390,height:844},'dark',{surface:'public',variant:'rich',contextOptions:{reducedMotion:'reduce'}});
const portrait=page.getByRole('img',{name:/Focus to enlarge/});await portrait.waitFor();await page.keyboard.press('Tab');await portrait.focus();
const state=await portrait.locator('img').evaluate(e=>({transform:getComputedStyle(e).transform,transition:getComputedStyle(e).transitionDuration,width:e.parentElement.getBoundingClientRect().width,height:e.parentElement.getBoundingClientRect().height,label:e.parentElement.getAttribute('aria-label')}));
await writeFile(resolve(o,'avatar-regression.json'),JSON.stringify(state,null,2));assert.match(state.transform,/matrix\(3, 0, 0, 3, 0, 0\)/,'Reduced-motion portrait still enlarges instantly, matching its accessible description');assert.equal(state.transition,'0s');assert.ok(state.width>=44&&state.height>=44);await context.close();
}finally{await h.close();}
