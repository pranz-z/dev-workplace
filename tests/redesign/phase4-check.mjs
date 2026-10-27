import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
import {ready} from './matrix-utils.mjs';
const output=process.argv[2],h=await createHarness(resolve(output,'assets'));
try{for(const theme of ['dark','light']){const {page,context}=await h.session('unseen',{width:390,height:844},theme);try{await ready(page);const task=page.getByText('Synthetic Backlog task with a descriptive title',{exact:true}).first();const box=await task.boundingBox();assert.ok(box.y+box.height<780,`Useful task must precede metrics and be visible at390: ${JSON.stringify(box)}`);const panel=page.getByRole('region',{name:'Next tasks'});assert.ok(await panel.count());const stat=page.getByRole('group',{name:'Workspace totals'});assert.ok((await stat.boundingBox()).y>(await panel.boundingBox()).y);await page.screenshot({path:resolve(output,`dashboard-priority-${theme}.png`)});}finally{await context.close();}}}finally{await h.close();}
await writeFile(resolve(output,'dashboard-priority.json'),JSON.stringify({pass:true,themes:2}));
