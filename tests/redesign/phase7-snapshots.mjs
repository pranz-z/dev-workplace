import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile,symlink,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {sha256,root} from './build-fixture.mjs';
const o=process.argv[2];await mkdir(o,{recursive:true});
const baseline=resolve(o,'head-source'),current=resolve(o,'final-source');await mkdir(baseline,{recursive:true});await mkdir(current,{recursive:true});
const roots=spawnSync('git',['ls-tree','--name-only','HEAD'],{encoding:'utf8'}).stdout.trim().split('\n').filter(p=>!p.startsWith('.env')&&p!=='.auth'&&!['.codex','.rtk'].includes(p));
const archive=resolve(o,'head-source.tar');let r=spawnSync('git',['archive','--format=tar',`--output=${archive}`,'HEAD',...roots],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);r=spawnSync('tar',['-xf',archive,'-C',baseline],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
const tracked=spawnSync('git',['ls-files','-z'],{encoding:'utf8'}).stdout.split('\0').filter(Boolean).filter(p=>!p.split('/').some(p=>p.startsWith('.env')||p==='.auth')&&!p.startsWith('.codex/')&&!p.startsWith('.rtk/'));
const hashes={};for(const p of tracked){await mkdir(dirname(resolve(current,p)),{recursive:true});await copyFile(resolve(root,p),resolve(current,p));hashes[p]=sha256(await readFile(resolve(root,p)));}
for(const d of [baseline,current])try{await symlink(resolve(root,'node_modules'),resolve(d,'node_modules'),'junction');}catch(e){if(e.code!=='EEXIST')throw e;}
const tests=[];async function walk(dir){for(const e of await readdir(resolve(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())await walk(p);else if(p.endsWith('.test.mjs'))tests.push(p);}}for(const d of ['lib','data','components'])await walk(d);tests.sort();assert.equal(tests.length,86);
for(const [d,css] of [[baseline,resolve(o,'../phase-0b/assets/app.css')],[current,resolve(o,'core/assets/app.css')]]){const cache=resolve(d,'.next/static/chunks');await mkdir(cache,{recursive:true});await copyFile(css,resolve(cache,'fixture.css'));}
await writeFile(resolve(o,'suite-inputs.json'),JSON.stringify({baseline,current,head:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),tests,hashes,envFiles:[],credentials:false,cssPolicy:'Exact original Phase0b CSS for HEAD; final accepted Phase6 compiled CSS for final snapshot, generated test cache outside repo.'},null,2));console.log('Fresh HEAD and final external snapshots prepared;86 test files; no env/credentials copied.');
