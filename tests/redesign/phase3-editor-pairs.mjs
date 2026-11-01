import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
import {ready,navigate,fontMetadata,controlTargets} from './matrix-utils.mjs';
const output=process.argv[2],afterOnly=process.argv.includes('--after-only'),records=afterOnly?JSON.parse(await readFile(resolve(output,'editor-pairs.json'),'utf8')).records.filter(row=>row.phase==='before'):[];
for(const [phase,assets] of afterOnly?[['after','assets']]:[['before','../phase-2/assets'],['after','assets']]){
 await mkdir(resolve(output,`editor-${phase}`),{recursive:true});const h=await createHarness(resolve(output,assets));
 try{for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light']){const {page,context}=await h.session('unseen',{width,height},theme,{surface:'projects'});
  try{await ready(page);await navigate(page,'projects','Projects');await page.locator('#workspace-content').getByRole('button',{name:'New project',exact:true}).click();const fields=await page.locator('dialog[open] label').evaluateAll(labels=>labels.filter(e=>e.querySelector('input,select,textarea')).map(e=>e.childNodes[0].textContent.trim()));assert.equal(fields.length,12);const filename=`new-project--${theme}--${width}x${height}.png`;await page.screenshot({path:resolve(output,`editor-${phase}`,filename)});records.push({phase,filename,viewport:{width,height},theme,fields,fonts:await fontMetadata(page),targets:phase==='after'?await controlTargets(page):[]});
   if(phase==='after'){await page.locator('.project-editor-optional summary').click();await page.screenshot({path:resolve(output,`editor-${phase}`,`expanded--${theme}--${width}x${height}.png`)});}
  }finally{await context.close();}
 }}finally{await writeFile(resolve(output,`editor-${phase}-request-log.json`),JSON.stringify(h.requestLog,null,2));await h.close();}
}
await writeFile(resolve(output,'editor-pairs.json'),JSON.stringify({fixtureVersion:'phase0b-v1',scenario:'Projects → New project; empty original draft, same 12 fields; local fonts/data/clock',records},null,2));
console.log('10 matched editor pairs and10 expanded AFTER frames saved.');
