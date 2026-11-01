import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=process.argv[2],results=[];
const commands=[['targeted-tests',['--test','components/workspace/WorkspaceShell.test.mjs','data/focusSession.test.mjs','lib/auth/redirects.test.mjs','lib/ai/agent/phase5d-ui.test.mjs','tests/redesign/isolation.test.mjs','tests/redesign/source-guard.test.mjs']],['lint',['node_modules/eslint/bin/eslint.js','components/workspace/WorkspaceShell.tsx','components/auth/user-menu.tsx','app/app/page.tsx','tests/redesign/']],['diff-check',[]]];
for(const [name,args] of commands){const run=name==='diff-check'?spawnSync('git',['diff','--check'],{encoding:'utf8',env:process.env}):spawnSync(process.execPath,args,{encoding:'utf8',env:process.env,maxBuffer:16*1024*1024});await writeFile(resolve(output,`${name}.log`),(run.stdout??'')+(run.stderr??''));results.push({name,exitCode:run.status});if(run.status!==0)process.exitCode=1;console.log(`${name}: ${run.status}`);}
await writeFile(resolve(output,'validation-results.json'),JSON.stringify(results,null,2));
