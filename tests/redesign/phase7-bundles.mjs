import assert from 'node:assert/strict';import {mkdir,copyFile,cp,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {spawnSync} from 'node:child_process';
const o=process.argv[2];
for(const f of ['core','daily','integrations','ai','public','actions'])for(const phase of ['before','after']){
 if(process.argv.includes('--after-only')&&phase==='before')continue;
 const name=phase==='before'?'before-assets':f==='public'?'after-assets':f==='actions'?'action-assets':'assets',out=resolve(o,f,name);await mkdir(out,{recursive:true});
 await cp(resolve(o,'../phase-0b/assets/fonts'),resolve(out,'fonts'),{recursive:true});await copyFile(resolve(o,'../phase-0b/assets/font-manifest.json'),resolve(out,'font-manifest.json'));
 const r=spawnSync(process.execPath,['tests/redesign/run.mjs',`phase7-${f}-build-${phase}`,out],{encoding:'utf8',env:process.env,maxBuffer:8e6,windowsHide:true});await writeFile(resolve(o,`${f}-${phase}-build.log`),r.stdout+r.stderr);assert.equal(r.status,0,`${f}/${phase}: ${r.stdout+r.stderr}`);console.log(`Built ${f}/${phase}`);
}
await cp(resolve(o,'core/assets'),resolve(o,'shell/assets'),{recursive:true});await cp(resolve(o,'actions/action-assets'),resolve(o,'actions/assets'),{recursive:true});await cp(resolve(o,'actions/action-assets'),resolve(o,'actions/reconcile-assets'),{recursive:true});
