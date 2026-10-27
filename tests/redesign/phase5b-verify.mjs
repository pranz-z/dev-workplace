import {spawnSync} from 'node:child_process';
import {readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {defaultEsbuild} from './build-fixture.mjs';
const output=process.argv[2],pglite='C:/Users/Franz/AppData/Local/Temp/workspace-agent-phase2-tools/node_modules/@electric-sql/pglite/dist/index.js';
const files=['lib/ai/agent/phase5d-ui.test.mjs','lib/ai/agent/phase5d-handoff.test.mjs','lib/ai/agent/phase5d-gemini.test.mjs','lib/ai/agent/gemini-retry.test.mjs','tests/redesign/source-guard.test.mjs','tests/redesign/isolation.test.mjs','lib/security/content-security-policy.test.mjs'];
const env={...process.env,PORTFOLIO_TEST_ESBUILD_MODULE:defaultEsbuild,PORTFOLIO_TEST_PGLITE_MODULE:pglite,AGENT_TEST_PGLITE_MODULE:pglite};
const run=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=2',...files],{env,encoding:'utf8',maxBuffer:24*1024*1024});const log=(run.stdout??'')+(run.stderr??'');await writeFile(resolve(output,'agent-ui-handoff-gemini-tests.log'),log);const counts={};for(const name of ['tests','pass','fail','skipped'])counts[name]=Number([...log.matchAll(new RegExp(`^# ${name} (\\d+)`,'gm'))].at(-1)?.[1]??0);
await writeFile(resolve(output,'agent-ui-handoff-gemini-tests.json'),JSON.stringify({files,exitCode:run.status,counts},null,2));console.log(JSON.stringify(counts));if(run.status!==0)process.exitCode=1;
