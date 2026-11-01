import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {defaultEsbuild} from './build-fixture.mjs';
const o=process.argv[2],input=JSON.parse(await readFile(resolve(o,'suite-inputs.json'),'utf8')),results=process.argv.includes('--current-only')?[JSON.parse(await readFile(resolve(o,'full-suite-comparison.json'),'utf8')).results[0]]:[];
const pglite='C:/Users/Franz/AppData/Local/Temp/workspace-agent-phase2-tools/node_modules/@electric-sql/pglite/dist/index.js';
for(const kind of process.argv.includes('--current-only')?['current']:['baseline','current']){
 const network=resolve(o,`suite-${kind}-network.jsonl`);await writeFile(network,'');
 const env={...process.env,PORTFOLIO_TEST_ESBUILD_MODULE:defaultEsbuild,PORTFOLIO_TEST_PGLITE_MODULE:pglite,AGENT_TEST_PGLITE_MODULE:pglite,REDESIGN_SUITE_NETWORK_LOG:network,REDESIGN_BROWSER_NETWORK_LOG:network,NODE_OPTIONS:`--require "${resolve('tests/redesign/phase7-suite-guard.cjs').replaceAll('\\','/')}"`};
 const r=spawnSync(process.execPath,['--import',pathToFileURL(resolve('tests/redesign/phase6-browser-isolation.mjs')).href,'--test','--test-reporter=tap','--test-concurrency=2',...input.tests],{cwd:kind==='baseline'?input.baseline:input.current,env,encoding:'utf8',maxBuffer:64e6,windowsHide:true});
 const log=r.stdout+r.stderr;await writeFile(resolve(o,`suite-${kind}.log`),log);const counts={};for(const key of ['tests','pass','fail','skipped'])counts[key]=Number([...log.matchAll(new RegExp(`^# ${key} (\\d+)`,'gm'))].at(-1)?.[1]??0);
 const failures=[...log.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(m=>m[1]);results.push({kind,exitCode:r.status,fileCount:86,counts,failures});console.log(kind,JSON.stringify(counts));
}
const introduced=results[1].failures.filter(n=>!results[0].failures.includes(n)),resolved=results[0].failures.filter(n=>!results[1].failures.includes(n));
await writeFile(resolve(o,'full-suite-comparison.json'),JSON.stringify({tests:input.tests,results,introducedFailures:introduced,resolvedFailures:resolved,comparison:'Same86 file paths; HEAD uses its own tests and source, final snapshot uses final tests/source; output CSS caches and all handlers local.'},null,2));assert.equal(introduced.length,0,JSON.stringify(introduced));
