import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha256} from './build-fixture.mjs';
import {checkSources} from './source-guard.mjs';
const o=process.argv[2],results=[];
for(const [name,args] of [['lint',['node_modules/eslint/bin/eslint.js','components/portfolio/PublicPortfolio.tsx','components/portfolio/PortfolioHero.tsx','components/portfolio/ProfessionalSections.tsx','components/public-ai/public-ai-concierge.tsx','app/projects/[slug]/page.tsx']],['types',['tests/redesign/typecheck.mjs',o]],['cms-baseline',['tests/redesign/cms-baseline.mjs',o]],['diff-check',['git','diff','--check']]]){
const git=args[0]==='git',r=spawnSync(git?'git':process.execPath,git?args.slice(1):args,{encoding:'utf8',env:process.env,maxBuffer:12e6});await writeFile(resolve(o,`${name}.log`),r.stdout+r.stderr);results.push({name,exitCode:r.status});}
const hashes=JSON.parse(await readFile(resolve(o,'phase5b-source-hashes.json'),'utf8')),allowed=['app/globals.css','components/portfolio/PortfolioHero.tsx','components/portfolio/PortfolioHero.module.css','components/portfolio/PublicPortfolio.tsx','components/portfolio/ProfessionalSections.tsx','app/projects/[slug]/page.tsx','components/public-ai/public-ai-concierge.tsx'],changed=[];
for(const [file,hash]of Object.entries(hashes)){if(file.startsWith('tests/redesign/'))continue;const actual=sha256(await readFile(file));if(actual!==hash){assert.ok(allowed.includes(file),`Outside Phase6 scope: ${file}`);changed.push(file);}}
const original=await readFile(resolve(o,'source-before/components/public-ai/public-ai-concierge.tsx'),'utf8'),current=await readFile('components/public-ai/public-ai-concierge.tsx','utf8');assert.equal(current.slice(0,current.indexOf('  return <div')),original.slice(0,original.indexOf('  return <div')),'Public AI effects/state/request behavior unchanged');
for(const file of ['components/portfolio/ProjectCardMedia.tsx','components/portfolio/PublicProjectVideo.tsx'])assert.equal(sha256(await readFile(file)),hashes[file]);
await writeFile(resolve(o,'static-gates.json'),JSON.stringify({results,changed,allowed,protected:await checkSources(),publicAiEffectsUnchanged:true,mediaSourcesUnchanged:true,servicesAndConfigsUnchanged:true},null,2));
assert.ok(results.every(r=>r.exitCode===0),JSON.stringify(results));console.log('Static gates passed; only approved public CSS/markup changed.');
