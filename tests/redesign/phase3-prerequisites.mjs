import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {checkSources} from './source-guard.mjs';
const output=process.argv[2];await mkdir(output,{recursive:true});
const finish=process.argv.includes('--finish');
await checkSources();
if(!finish){const build=spawnSync(process.execPath,['tests/redesign/run.mjs','offline-next-build',output],{env:process.env,encoding:'utf8',maxBuffer:2*1024*1024});await writeFile(resolve(output,'build-run.log'),(build.stdout??'')+(build.stderr??''));}
const result=JSON.parse(await readFile(resolve(output,'next-build-result.json'),'utf8'));assert.equal(result.exitCode,0);assert.equal(result.sourceUnchanged,true);assert.equal((await readFile(resolve(output,'build-network-log.jsonl'),'utf8')).trim(),'');
const runs=[];
for(let index=1;index<=3;index++){const run=finish?null:spawnSync(process.execPath,['tests/redesign/run.mjs','test',resolve(output,'../phase-2/inbox')],{env:process.env,encoding:'utf8',maxBuffer:2*1024*1024});const log=finish?await readFile(resolve(output,`inbox-run-${index}.log`),'utf8'):(run.stdout??'')+(run.stderr??'');if(!finish)await writeFile(resolve(output,`inbox-run-${index}.log`),log);const entry={run:index,exitCode:run?.status??(log.includes('ℹ fail 0')?0:1),tests:Number(/ℹ tests (\d+)/.exec(log)?.[1]),pass:Number(/ℹ pass (\d+)/.exec(log)?.[1]),startupTimeout:/Timeout 30000ms|fixture startup|page.waitForFunction: Timeout/.test(log)};runs.push(entry);console.log(JSON.stringify(entry));}
assert.ok(runs.every(run=>run.exitCode===0&&run.tests===8&&run.pass===8&&!run.startupTimeout));
const ledger=JSON.parse(await readFile(resolve(output,'../phase-2/target-component-ledger.json'),'utf8')),shell=JSON.parse(await readFile(resolve(output,'../phase-2/shell-target-ledger.json'),'utf8'));
assert.equal(ledger.unresolved,0);
const controls=[['compact toggle',r=>r.label==='Use compact navigation'||r.label==='Use labeled navigation'],['context opener',r=>r.label==='Open context sidebar'],['context close',r=>r.label==='Close context sidebar'],['bottom bar',r=>r.component==='Bottom navigation'],['More',r=>r.label==='More workspace sections'],['context resize',r=>r.label==='Context sidebar width'],['AI resize',r=>r.label==='Workspace AI panel width']].map(([name,predicate])=>{const rows=shell.measurements.filter(predicate);assert.ok(rows.length,`Missing ${name} measurements`);assert.ok(rows.every(r=>r.width>=44&&r.height>=44),name);return {name,samples:rows.length,minWidth:Math.min(...rows.map(r=>r.width)),minHeight:Math.min(...rows.map(r=>r.height))};});
await writeFile(resolve(output,'prerequisites.json'),JSON.stringify({pass:true,build:result,inboxRuns:runs,startupTimeoutRecurred:false,shellControls:controls,ledgerUnresolved:0,protectedHashes:await checkSources()},null,2));
console.log('All three Phase3 prerequisites pass.');
