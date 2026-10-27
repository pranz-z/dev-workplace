import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {readFile,writeFile,open} from 'node:fs/promises';import {resolve} from 'node:path';
const o=process.argv[2];
const defs=[['timeblocks-before','timeblocks',[]],['timeblocks','timeblocks',['timeblocks-before']],['core','core',[]],['gaps','.', ['core']],['public-before','public',[]],['public','public',['public-before']],['integrations-before','integrations',[]],['integrations','integrations',['integrations-before']],['github-retry','integrations',['integrations']],['integration-journey','integrations',['integrations']],['daily-before','daily',[]],['daily','daily',['daily-before']],['ai-before','ai',[]],['ai','ai',['ai-before']],['ai-journey-before','ai',['ai']],['ai-journey','ai',['ai-journey-before']],['actions-before','actions',[]],['actions','actions',['actions-before']],['feature-targets','actions',['actions']],['shell','shell',[]],['public-journey','public',['public']],['media','public',['public']],['public-accessibility','public',['public']]];
let prior=[];try{prior=JSON.parse(await readFile(resolve(o,'job-status.json'),'utf8'));}catch{}
const jobs=defs.map(([id,folder,deps])=>({id,folder,deps,status:prior.find(j=>j.id===id)?.status==='passed'?'passed':'pending'}));
const save=()=>writeFile(resolve(o,'job-status.json'),JSON.stringify(jobs,null,2));await save();
async function execute(j){j.status='running';await save();const file=await open(resolve(o,`job-${j.id}.log`),'w');
 const child=spawn(process.execPath,['tests/redesign/run.mjs','phase7-'+j.id,resolve(o,j.folder)],{env:process.env,stdio:['ignore',file.fd,file.fd],windowsHide:true});
 const code=await new Promise((r,reject)=>{child.on('error',reject);child.on('close',r);});await file.close();j.exitCode=code;j.status=code===0?'passed':'failed';await save();console.log(`${j.id}: ${j.status}`);
}
const active=new Map();
while(true){for(const j of jobs){if(active.size>=2)break;if(j.status==='pending'&&j.deps.every(d=>jobs.find(x=>x.id===d).status==='passed')){const p=execute(j);active.set(j.id,p);p.finally(()=>active.delete(j.id));}}
 if(!active.size)break;await Promise.race(active.values());}
await save();assert.ok(jobs.every(j=>j.status==='passed'),JSON.stringify(jobs.filter(j=>j.status!=='passed')));
