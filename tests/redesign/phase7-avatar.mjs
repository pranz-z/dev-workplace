import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
const o=process.argv[2],h=await createHarness(resolve(o,'avatar-assets'),{embeddedFonts:true}),records=[];
try{for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light']){
 const {page,context}=await h.session('unseen',{width,height},theme,{surface:'public',variant:'rich',contextOptions:{reducedMotion:'reduce'}});
 try{const portrait=page.getByRole('img',{name:/Focus to enlarge/});await portrait.waitFor();await portrait.focus();
 const state=await portrait.locator('img').evaluate(e=>({transform:getComputedStyle(e).transform,transition:getComputedStyle(e).transitionDuration,width:e.parentElement.getBoundingClientRect().width,height:e.parentElement.getBoundingClientRect().height,label:e.parentElement.getAttribute('aria-label')}));
 assert.match(state.transform,/matrix\(3, 0, 0, 3, 0, 0\)/);assert.equal(state.transition,'0s');assert.ok(state.width>=44&&state.height>=44);
 records.push({...state,viewport:{width,height},theme,component:'Public portrait',selector:'[role=img][tabindex=0]'});
 }finally{await context.close();}
}}finally{await writeFile(resolve(o,'avatar-regression.json'),JSON.stringify({records},null,2));await writeFile(resolve(o,'avatar-request-log.json'),JSON.stringify(h.requestLog,null,2));await h.close();}
