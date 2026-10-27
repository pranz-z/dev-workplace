import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFile,readFile,mkdir,copyFile,symlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {defaultEsbuild} from './build-fixture.mjs';
const o=process.argv[2],preflight=process.argv.includes('--preflight'),source=preflight?resolve(o,'browser-validation-source'):resolve(o,'../phase-6-final-verification/next-build-source'),network=resolve(o,'existing-browser-network.jsonl');
if(preflight){const listing=spawnSync('git',['ls-files','-z'],{encoding:'utf8'});assert.equal(listing.status,0);for(const f of listing.stdout.split('\0').filter(Boolean).filter(f=>!f.split('/').some(p=>p.startsWith('.env')||p==='.auth'))){await mkdir(dirname(resolve(source,f)),{recursive:true});await copyFile(resolve(f),resolve(source,f));}try{await symlink(resolve('node_modules'),resolve(source,'node_modules'),'junction');}catch(e){if(e.code!=='EEXIST')throw e;}}
if(preflight){await mkdir(resolve(source,'.next/static/chunks'),{recursive:true});await copyFile(resolve(o,'after-assets/app.css'),resolve(source,'.next/static/chunks/phase6-fixture.css'));}
await writeFile(network,'');
const files=['lib/project-video/browser.test.mjs','lib/project-video/case-study.test.mjs'];
const run=spawnSync(process.execPath,['--import',pathToFileURL(resolve('tests/redesign/phase6-browser-isolation.mjs')).href,'--test','--test-reporter=tap','--test-concurrency=1',...files],{cwd:source,encoding:'utf8',env:{...process.env,PORTFOLIO_TEST_ESBUILD_MODULE:defaultEsbuild,REDESIGN_BROWSER_NETWORK_LOG:network},maxBuffer:12e6});
await writeFile(resolve(o,'existing-browser-tests.log'),run.stdout+run.stderr);await writeFile(resolve(o,'existing-browser-tests.json'),JSON.stringify({files,exitCode:run.status,source,networkLog:network,sourcePolicy:'Exact final build source outside repo; existing tests unmodified, deny unhandled hosted requests; test-owned synthetic routes take precedence.'},null,2));
console.log((run.stdout+run.stderr).slice(-3000));assert.equal(run.status,0);assert.equal((await readFile(network,'utf8')).trim(),'');
