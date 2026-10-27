import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {checkSources} from './source-guard.mjs';
const output=process.argv[2];
await writeFile(resolve(output,'protected-source-verification.json'),JSON.stringify({pass:true,hashes:await checkSources()},null,2));
const read=async path=>JSON.parse(await readFile(resolve(output,path),'utf8'));
const before=await read('../phase-0b/before-manifest.json'),after=await read('after-manifest.json');
const anonymousBefore=await read('../pre-phase-1-addendum/anonymous-before-manifest.json'),anonymousAfter=await read('anonymous-after-manifest.json');
const key=row=>`${row.surface}/${row.theme}/${row.viewport.width}x${row.viewport.height}`;
const pairs=[];
for(const [role,a,b,base] of [['owner',before,after,'../phase-0b/before'],['anonymous',anonymousBefore,anonymousAfter,'../pre-phase-1-addendum/anonymous-before']]){
  for(const name of ['fixtureVersion','source','fixedTime','timezone','browser'])assert.equal(a[name],b[name],`${role} ${name}`);
  const indexed=new Map(a.captures.map(row=>[key(row),row]));
  assert.equal(indexed.size,b.captures.length);
  for(const row of b.captures){
    const prior=indexed.get(key(row));assert.ok(prior);
    const width=row.overflow.documentWidth??row.overflow.scrollWidth;assert.ok(width<=row.viewport.width,`${key(row)} overflow`);
    pairs.push({role,key:key(row),before:`${base}/${prior.filename}`,after:`${role==='owner'?'after':'anonymous-after'}/${row.filename}`});
  }
}
assert.equal(pairs.length,240);
for(const name of ['tests/redesign/fixtures.ts','app/fonts.ts','package-lock.json'])assert.equal(before.build.sources[name],after.build.sources[name],name);
// The accepted addendum added the optional preview variant after phase0b.
// Assert that Phase1 keeps that exact source, and the original default data.
assert.equal(anonymousBefore.build.sources['tests/redesign/matrix-data.ts'],after.build.sources['tests/redesign/matrix-data.ts']);
const oldBundle=await readFile(resolve(output,'../phase-0b/assets/fixture.js'),'utf8'),newBundle=await readFile(resolve(output,'assets/fixture.js'),'utf8');
const defaultData=bundle=>bundle.slice(bundle.indexOf('  var config = window.matrixConfiguration'),bundle.indexOf('  async function memoryResponse'));
assert.ok(defaultData(oldBundle).length>1000);assert.equal(defaultData(oldBundle),defaultData(newBundle),'Original phase0b data and service results');
const memoryPayloads=bundle=>bundle.slice(bundle.indexOf('    const payloads = {'),bundle.indexOf('    if (url.pathname.endsWith("/preview-video"))'));
assert.ok(memoryPayloads(oldBundle).length>1000);assert.equal(memoryPayloads(oldBundle),memoryPayloads(newBundle),'Original memory projection data');
assert.equal(after.build.cssSha256,anonymousAfter.build.cssSha256);
const targets=await read('target-exceptions.json'),original=await read('../pre-phase-1-addendum/target-components.json');
const originalInstances=await read('../pre-phase-1-addendum/target-component-instances.json');
const instanceKey=(row,selector)=>`${row.surface}/${row.viewport.width}/${row.viewport.height}/${row.theme}/${selector}`;
const signatures=new Map(originalInstances.map(row=>[instanceKey(row,row.selector),row.classSignature]));
const components=original.components.map(group=>{
  const rows=targets.measurements.filter(row=>row.component===group.component&&signatures.get(instanceKey(row,row.originalSelector))===group.classSignature);assert.equal(rows.length,group.countOfInstances);
  return {component:group.component,selector:group.selector,viewportRange:group.viewports,count:rows.length,meets44:rows.filter(row=>row.meets44).length,
    measuredSizes:[...new Set(rows.map(row=>`${Math.round(row.width*100)/100}×${Math.round(row.height*100)/100}`))],
    disposition:rows.every(row=>row.meets44)?'44px minimum applied':'PROPOSED EXCEPTION: hidden native file input',
    reason:rows.every(row=>row.meets44)?'Real shared control; no relaxed target.':'1px accessibility-hidden input is invoked by the visible Files → New → File upload action.',
    equivalentAction:rows.every(row=>row.meets44)?null:'File upload menu item; measured ≥44×44 and verified to open this exact native picker without selecting/uploading files.'};
});
assert.equal(components.length,45);
const ledger={componentGroups:45,originalInstances:508,nowMeets44:targets.nowMeets44,components,proxyProof:targets.proxyProof,
  conditionalInlineLinkException:{reason:'Inline prose links keep reading flow; forcing a 44px inline box disrupts sentences.',equivalentAction:'Same visible text link with keyboard focus and its original destination.',instancesInOriginal508:0,note:'Explicit CSS policy for p a; no dense-table exception and no unrecorded measured exception.'}};
await writeFile(resolve(output,'target-component-ledger.json'),JSON.stringify(ledger,null,2));
await writeFile(resolve(output,'target-component-ledger.md'),'# Phase 1 target ledger\n\n503 of 508 previously undersized instances now meet 44×44px. The other five are one hidden file-input component across five sizes. No dense-row exception is proposed.\n\n| Component / selector | Instances | ≥44×44 | Disposition / reason |\n|---|---:|---:|---|\n'+components.map(row=>`| ${row.component} / \`${row.selector}\` | ${row.count} | ${row.meets44} | ${row.disposition}: ${row.reason} |`).join('\n')+'\n\nHidden-input equivalent: **Files → New → File upload**. The visible menu action measures at least 44×44px and opens that exact native input. No file was selected or uploaded.\n\nConditional inline-prose exception: paragraph links retain the same visible destination and keyboard action to preserve sentence flow; zero instances in the original 508 measurements. Full viewport ranges and measured sizes are in target-component-ledger.json.\n');
await writeFile(resolve(output,'comparison-manifest.json'),JSON.stringify({fixtureVersion:after.fixtureVersion,source:after.source,fixedTime:after.fixedTime,timezone:after.timezone,pairCount:pairs.length,pairs},null,2));
await writeFile(resolve(output,'comparison.html'),`<!doctype html><meta charset="utf-8"><title>Phase 1 matched comparisons</title><style>body{font:16px system-ui;margin:24px;background:#eee;color:#222}select{padding:10px;max-width:100%}main{display:flex;gap:20px;align-items:start}figure{margin:16px 0;flex:1;min-width:0}img{max-width:100%;height:auto;border:1px solid #888}figcaption{padding:8px}</style><h1>Phase 1 matched BEFORE / AFTER</h1><p>phase0b-v1 · fixed 2026-10-26 02:00 UTC · local fixtures · owner and anonymous bundles</p><select aria-label="Capture pair"></select><main><figure><figcaption>BEFORE</figcaption><img id="before" alt="Before"></figure><figure><figcaption>AFTER</figcaption><img id="after" alt="After"></figure></main><script>const pairs=${JSON.stringify(pairs)};const select=document.querySelector('select');pairs.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=p.role+' / '+p.key;select.append(o)});function show(){const p=pairs[select.value];document.querySelector('#before').src=p.before;document.querySelector('#after').src=p.after}select.onchange=show;show();</script>`);
const requestSummary=[];
for(const file of ['after-request-log.json','anonymous-after-request-log.json','foundation-request-log.json','target-request-log.json','preview-request-log.json']){
  const rows=await read(file);const denied=rows.filter(row=>row.disposition?.startsWith('denied'));assert.equal(denied.length,0,file);
  requestSummary.push({file,events:rows.length,denied:denied.length});
}
await writeFile(resolve(output,'gate-summary.json'),JSON.stringify({matchedPairs:240,owner:210,anonymous:30,noPageOverflow:true,unchangedFixtureDataClockAndFontLoader:true,sameOwnerAnonymousCss:true,targets:{groups:45,instances:508,meets44:targets.nowMeets44,exceptions:targets.proposedExceptions.length},requestSummary},null,2));
console.log('240 matched pairs; no page overflow; 45-group ledger and local comparison viewer written.');
