import {spawnSync} from 'node:child_process';
import {readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {defaultEsbuild} from './build-fixture.mjs';
const output=process.argv[2],pglite='C:/Users/Franz/AppData/Local/Temp/workspace-agent-phase2-tools/node_modules/@electric-sql/pglite/dist/index.js';
const files=[...(await readdir('data')).filter(name=>/^task.*\.test\.mjs$/i.test(name)).map(name=>`data/${name}`),'data/workspaceCalendar.test.mjs','data/focusSession.test.mjs','data/timeBlocks.test.mjs','data/timeBlockService.test.mjs','data/accountabilityService.test.mjs','data/accountabilityReports.test.mjs','components/projects/project-screenshots.test.mjs',...(await readdir('lib/project-video')).filter(name=>name.endsWith('.test.mjs')).map(name=>`lib/project-video/${name}`),'lib/security/content-security-policy.test.mjs','components/workspace/WorkspaceShell.test.mjs','tests/redesign/isolation.test.mjs','tests/redesign/source-guard.test.mjs'];
const env={...process.env,PORTFOLIO_TEST_ESBUILD_MODULE:defaultEsbuild,PORTFOLIO_TEST_PGLITE_MODULE:pglite,AGENT_TEST_PGLITE_MODULE:pglite};
const run=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=2',...files],{env,encoding:'utf8',maxBuffer:24*1024*1024});const log=(run.stdout??'')+(run.stderr??'');await writeFile(resolve(output,'daily-existing-tests.log'),log);const counts={};for(const name of ['tests','pass','fail','skipped'])counts[name]=Number([...log.matchAll(new RegExp(`^# ${name} (\\d+)`,'gm'))].at(-1)?.[1]??0);
await writeFile(resolve(output,'daily-existing-tests.json'),JSON.stringify({files,exitCode:run.status,counts},null,2));console.log(JSON.stringify(counts));if(run.status!==0)process.exitCode=1;
