import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
import {ready,selectSurface,fontMetadata} from './matrix-utils.mjs';
const output=process.argv[2],phase=process.argv.includes('--after')?'after':'before';await mkdir(resolve(output,`caption-${phase}`),{recursive:true});const h=await createHarness(resolve(output,phase==='before'?'../phase-2/assets':'assets')),records=[];
try{for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light']){const {context,page}=await h.session('unseen',{width,height},theme,{surface:'project-screenshots'});
 try{await ready(page);await selectSurface(page,'project-screenshots');const caption=page.getByText('No caption',{exact:true}).first();await caption.scrollIntoViewIfNeeded();const geometry=await caption.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));const filename=`screenshot-captions--${theme}--${width}x${height}.png`;await page.screenshot({path:resolve(output,`caption-${phase}`,filename)});records.push({viewport:{width,height},theme,filename,geometry,fonts:await fontMetadata(page)});}finally{await context.close();}
}}finally{await writeFile(resolve(output,`caption-${phase}-request-log.json`),JSON.stringify(h.requestLog,null,2));await h.close();}
await writeFile(resolve(output,`caption-${phase}-manifest.json`),JSON.stringify({fixtureVersion:'phase0b-v1',source:phase==='before'?'Accepted Phase2 component bundle':'Final Phase3 component bundle',records},null,2));
