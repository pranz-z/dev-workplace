import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,basename } from 'node:path';
import { createHarness } from './browser-harness.mjs';
import { selectSurface,settle,fontMetadata } from './matrix-utils.mjs';
const output=process.argv[2];const phase=process.argv[3]==='--after'?'after':'before';
await mkdir(resolve(output,`anonymous-${phase}`),{recursive:true});
const assets=resolve(output,phase==='after'?'anonymous-assets':'assets');
const build=JSON.parse(await readFile(resolve(assets,'build-manifest.json'),'utf8'));
const accepted=JSON.parse(await readFile(resolve(output,basename(output)==='core'?'../../phase-0b/before-manifest.json':'../phase-0b/before-manifest.json'),'utf8'));
if(phase==='before')assert.equal(build.cssSha256,accepted.build.cssSha256,'Accepted baseline CSS must be unchanged');
assert.ok(build.inputs.some(input=>input.endsWith('tests/redesign/anonymous-auth.ts')));
const harness=await createHarness(assets);const captures=[];
try{
  for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const theme of ['dark','light'])for(const surface of ['public','public-projects','case-study']){
    const {context,page,errors}=await harness.session('unseen',{width,height},theme,{surface:surface==='public-projects'?'public':surface});
    try{
      assert.deepEqual(await page.evaluate(()=>window.addendumAuth),{status:'unauthenticated',user:null,configured:true});
      await page.getByText(surface==='case-study'?'Synthetic project with a deliberately long descriptive title':'Synthetic Developer',{exact:true}).first().waitFor();
      await selectSurface(page,surface);await settle(page);
      const fixture=await page.evaluate(()=>window.matrixFixture);assert.deepEqual(fixture.unexpected,[]);assert.deepEqual(errors,[]);
      const filename=`${surface}--anonymous--${theme}--${width}x${height}--${phase}.png`;
      await page.screenshot({path:resolve(output,`anonymous-${phase}`,filename)});
      const overflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
      if(phase==='after')assert.ok(overflow.scrollWidth<=width,`${surface} ${theme} ${width}: page overflow`);
      captures.push({filename,surface,theme,viewport:{width,height},overflow,auth:{status:'unauthenticated',user:null},fonts:await fontMetadata(page)});
    }finally{await context.close();}
  }
  assert.equal(captures.length,30);assert.equal(harness.requestLog.filter(e=>e.disposition.startsWith('denied')).length,0);
  await writeFile(resolve(output,`anonymous-${phase}-manifest.json`),JSON.stringify({fixtureVersion:'phase0b-v1',variant:`anonymous visitor; same public dataset; ${phase} CSS`,source:accepted.source,browser:harness.browser.version(),fixedTime:accepted.fixedTime,timezone:accepted.timezone,build,captures},null,2));
  console.log(`30 anonymous ${phase.toUpperCase()} captures complete.`);
}finally{await writeFile(resolve(output,`anonymous-${phase}-request-log.json`),JSON.stringify(harness.requestLog,null,2));await harness.close();}
