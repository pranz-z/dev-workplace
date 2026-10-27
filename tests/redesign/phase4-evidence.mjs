import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
import {ready,navigate,controlTargets,fontMetadata,settle} from './matrix-utils.mjs';
const output=process.argv[2],phase=process.argv.includes('--before')?'before':'after';
const h=await createHarness(resolve(output,`${phase==='before'?'before-':''}assets`)),records=[];
await mkdir(resolve(output,`daily-${phase}`),{recursive:true});
const now=Date.parse('2026-10-26T02:00:00Z');
const cases=[...['no-tasks','no-projects','overdue','loading','error'].map(v=>({name:v,variant:`phase4-${v}`,surface:'dashboard'})),{name:'near-midnight',variant:'phase4-midnight',surface:'calendar',fixedTime:'2026-10-26T16:01:00Z'},...['running','paused','completed'].map(status=>({name:`focus-${status}`,surface:'today',focusSnapshot:{durationMinutes:25,selectedTaskId:null,session:status==='running'?{status,taskId:null,startedAt:now,endsAt:now+1500000}:status==='paused'?{status,taskId:null,remainingSeconds:900}:{status,taskId:null}}})),...['plans','notes','tech'].map(surface=>({name:`empty-${surface}`,variant:'phase4-no-projects',surface}))];
try{
 for(const viewport of [{width:390,height:844},{width:1024,height:768}])for(const theme of ['dark','light'])for(const item of cases){
  const {page,context,errors}=await h.session('unseen',viewport,theme,item);page.setDefaultTimeout(8000);
  try{
   await ready(page,item.name==='error'?'error':item.name==='loading'?'loading':undefined);
   if(item.name==='loading')await page.getByText('Loading your workspace...',{exact:true}).waitFor();
   if(item.surface!=='dashboard')await navigate(page,item.surface,{today:'Today',calendar:'Calendar',plans:'Plans',notes:'Notes',tech:'Tech Stack'}[item.surface]);
   await settle(page);
   const text=await page.locator('#workspace-content').innerText();
   const state={};
   if(['no-tasks','no-projects','overdue'].includes(item.name)){
    const totals=await page.locator('.dashboard-totals').count()?await page.locator('.dashboard-totals').innerText():await page.locator('.stat-card').allInnerTexts();
    state.totals=typeof totals==='string'?totals:totals.join('\n');
    const values=state.totals.match(/\b\d+\b/g).map(Number);assert.deepEqual(values,item.name==='no-projects'?[0,0,0,0]:item.name==='no-tasks'?[2,0,1,1]:[2,6,1,1]);
    if(phase==='after'&&item.name!=='overdue'){assert.ok(text.includes('No open tasks'));const action=page.getByRole('region',{name:'Next tasks'}).getByRole('button',{name:'Create a task',exact:true});assert.ok((await action.boundingBox()).y<viewport.height);}
   }
   if(item.name==='near-midnight'){state.selectedDate=await page.locator('#calendar-day-detail').innerText();assert.ok(state.selectedDate.includes('27'));}
   if(item.name.startsWith('focus-')){
    const timer=page.locator('[data-focus-timer]');state.timer=await timer.innerText();assert.equal(state.timer,item.name==='focus-running'?'25:00':item.name==='focus-paused'?'15:00':'00:00');
    if(item.name==='focus-running')await page.getByRole('button',{name:'Pause',exact:true}).last().click();
    if(item.name!=='focus-completed'){await page.getByRole('button',{name:'Resume',exact:true}).last().click();await page.getByRole('button',{name:'Pause',exact:true}).last().click();}
    const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('developer-workspace-focus-session-v1:11111111-1111-4111-8111-111111111111')));state.persisted=stored;assert.equal(stored.session.status,item.name==='focus-completed'?'completed':'paused');
    await page.reload();await ready(page);await navigate(page,'today','Today');await timer.waitFor();assert.equal(await timer.innerText(),state.timer);
   }
   const filename=`${item.name}--${theme}--${viewport.width}x${viewport.height}.png`;await page.screenshot({path:resolve(output,`daily-${phase}`,filename)});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);assert.equal(overflow,true,filename);
   const fixture=await page.evaluate(()=>window.matrixFixture);assert.deepEqual(fixture.unexpected,[]);assert.deepEqual(errors,[]);
   records.push({filename,name:item.name,theme,viewport,config:item,state,text,overflow,fonts:await fontMetadata(page),targets:await controlTargets(page),calls:fixture.calls});
   if(item.name.startsWith('focus-')){await page.getByRole('button',{name:item.name==='focus-completed'?'Done':'End Session',exact:true}).last().click();await page.getByRole('button',{name:'Start Focus Session',exact:true}).waitFor();assert.equal(await page.locator('[data-focus-timer]').innerText(),'25:00');await page.getByRole('button',{name:'Start Focus Session',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).last().waitFor();await page.getByRole('button',{name:'End Session',exact:true}).last().click();}
  }finally{await context.close();}
  console.log(`${phase} daily ${records.length}: ${item.name} ${theme} ${viewport.width}`);
 }
 if(phase==='after'){const before=JSON.parse(await readFile(resolve(output,'daily-before.json'),'utf8'));for(const row of records){const previous=before.records.find(r=>r.filename===row.filename);assert.ok(previous);assert.deepEqual(row.config,previous.config);const semantics=state=>({...state,...(state.totals?{totals:state.totals.match(/\b\d+\b/g).map(Number)}:{})});assert.deepEqual(semantics(row.state),semantics(previous.state),`Behavior equality ${row.filename}`);}}
}finally{await writeFile(resolve(output,`daily-${phase}.json`),JSON.stringify({phase,records},null,2));await writeFile(resolve(output,`daily-${phase}-request-log.json`),JSON.stringify(h.requestLog,null,2));await h.close();}
