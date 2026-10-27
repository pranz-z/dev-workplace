import { readdir,mkdir,copyFile,symlink,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve,join } from 'node:path';
import { root,defaultEsbuild } from './build-fixture.mjs';
const output=process.argv[2];const baseline=resolve(output,'baseline-source');
await mkdir(baseline,{recursive:true});
const archive=resolve(output,'baseline-source.tar');
const archived=spawnSync('git',['archive','--format=tar',`--output=${archive}`,'HEAD','app','components','data','lib','supabase','public','docs','types.ts','package.json','package-lock.json','tsconfig.json','next.config.ts','proxy.ts','postcss.config.mjs','eslint.config.mjs','README.md','AGENTS.md','RTK.md','.env.example'],{cwd:root,encoding:'utf8'});
if(archived.status!==0)throw new Error(archived.stderr);
const extracted=spawnSync('tar',['-xf',archive,'-C',baseline],{encoding:'utf8'});if(extracted.status!==0)throw new Error(extracted.stderr);
if(!existsSync(join(baseline,'node_modules')))await symlink(join(root,'node_modules'),join(baseline,'node_modules'),'junction');
async function files(dir){const result=[];for(const e of await readdir(join(root,dir),{withFileTypes:true})){const name=join(dir,e.name);if(e.isDirectory())result.push(...await files(name));else if(e.name.endsWith('.test.mjs'))result.push(name);}return result;}
const tests=(await Promise.all(['lib','data','components'].map(files))).flat().sort();
const pglite='C:/Users/Franz/AppData/Local/Temp/workspace-agent-phase2-tools/node_modules/@electric-sql/pglite/dist/index.js';
const env={...process.env,PORTFOLIO_TEST_ESBUILD_MODULE:defaultEsbuild,PORTFOLIO_TEST_PGLITE_MODULE:pglite,AGENT_TEST_PGLITE_MODULE:pglite};
const results=[];
for(const [kind,directory,css] of [['baseline',baseline,resolve(output,'../phase-0b/assets/app.css')],['current',root,resolve(output,'assets/app.css')]]){
  const cache=resolve(output,'test-runtime',kind,'.next/static/chunks');await mkdir(cache,{recursive:true});await copyFile(css,join(cache,'fixture.css'));
  if(!existsSync(join(directory,'.next')))await symlink(resolve(cache,'../..'),join(directory,'.next'),'junction');
  else throw new Error(`Unexpected existing .next at ${directory}; do not overwrite user build cache`);
  const run=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=2',...tests],{cwd:directory,env,encoding:'utf8',maxBuffer:64*1024*1024});
  const log=(run.stdout??'')+(run.stderr??'');await writeFile(resolve(output,`existing-${kind}.log`),log);
  const failures=[...log.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(match=>match[1]);
  const counts={};for(const name of ['tests','pass','fail','skipped'])counts[name]=Number([...log.matchAll(new RegExp(`^# ${name} (\\d+)`,'gm'))].at(-1)?.[1]??0);
  results.push({kind,exitCode:run.status,fileCount:tests.length,counts,failures});console.log(`${kind}: ${JSON.stringify(counts)}`);
}
const introduced=results[1].failures.filter(name=>!results[0].failures.includes(name));
await writeFile(resolve(output,'existing-suite-comparison.json'),JSON.stringify({tests,results,introducedFailures:introduced,baseline:'Git HEAD source archive outside repo with shared installed node_modules and accepted CSS; no original checkout used.'},null,2));
if(introduced.length)process.exitCode=1;
