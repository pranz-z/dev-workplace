import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createHarness} from './browser-harness.mjs';
import {ready,navigate,settle} from './phase7-utils.mjs';
const output=process.argv[2];await mkdir(output,{recursive:true});
const h=await createHarness(resolve(output,'before-assets'),{embeddedFonts:true});
try{const {context,page}=await h.session('unseen',{width:1440,height:1000},'dark',{surface:'projects'});
 try{await ready(page);await navigate(page,'projects','Projects');const historyBefore=await page.evaluate(()=>({length:history.length,pathname:location.pathname,search:location.search,hash:location.hash}));
 await page.locator('#workspace-content').getByRole('button',{name:'list',exact:true}).click();await page.getByRole('textbox',{name:'Find a project'}).fill('private');
 await page.locator('#workspace-content').getByRole('button',{name:/Synthetic private project/}).first().click();await settle(page);
 assert.equal(await page.locator('#workspace-content h2').filter({hasText:'Synthetic private project'}).count(),1);
 const historyAfter=await page.evaluate(()=>({length:history.length,pathname:location.pathname,search:location.search,hash:location.hash}));assert.deepEqual(historyAfter,historyBefore);
 await navigate(page,'tasks','Tasks');await navigate(page,'projects','Projects');
 const retainedMode=await page.locator('#workspace-content').getByRole('button',{name:'list',exact:true}).getAttribute('class');assert.ok(retainedMode.includes('is-selected'));assert.equal(await page.getByRole('textbox',{name:'Find a project'}).inputValue(),'private');
 await page.locator('#workspace-content').getByRole('button',{name:'New project',exact:true}).click();const fields=await page.locator('dialog[open] label').evaluateAll(labels=>labels.filter(e=>e.querySelector('input,select,textarea')).map(e=>e.childNodes[0].textContent.trim()));assert.equal(fields.length,12);
 await writeFile(resolve(output,'before-behavior.json'),JSON.stringify({fixtureVersion:'phase0b-v1',source:'Supplement from exact Original Phase0b/Git HEAD source',historyBefore,historyAfter,retainedMode:'list',retainedProjectQuery:'private',selectedProject:'Synthetic private project',fieldLabels:fields,fieldCount:12,back:'No explicit collection back control in BEFORE; return preserves these mode/query/history invariants.'},null,2));
 }finally{await context.close();}
}finally{await h.close();}
console.log('Original Phase0b/Git HEAD source and baseline collection/history/12-field assertions recorded.');
