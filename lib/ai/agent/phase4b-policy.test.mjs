import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,task,project,milestone,owner} from './phase4b-fixture.mjs';
test('undo policy derives exact affected task fields, rejects changed/missing/truncated history, preserves unrelated edits',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);
 const cases=[['title','Before','After'],['description','Before description','After description'],['status','Planned','Completed'],['priority','Low','High'],['dueDate',null,'2026-11-01'],['milestoneId',null,milestone]];
 await f.db.query('update public.tasks set due_date=$1,milestone_id=$2 where id=$3',['2026-11-01',milestone,task]);
 for(const [field,before,after] of cases){const s=await f.source('update_task',{[field]:before},{[field]:after});const r=await f.evaluate(s);assert.equal(r.eligibility.state,'available',field);assert.deepEqual(r.candidate.payload,{[field]:before});assert.ok(r.candidate.expectedUpdatedAt);}
 const multi=await f.source('update_task',{title:'Old',priority:'Medium'},{title:'After',priority:'High'});assert.deepEqual((await f.evaluate(multi)).candidate.payload,{title:'Old',priority:'Medium'});
 const due=await f.source('update_task',{dueDate:null},{dueDate:'2026-11-01'});await f.db.query("update public.tasks set priority='Critical' where id=$1",[task]);assert.equal((await f.evaluate(due)).eligibility.state,'available');
 await f.db.query("update public.tasks set due_date='2026-11-02' where id=$1",[task]);assert.equal((await f.evaluate(due)).eligibility.reason,'STATE_CHANGED');assert.equal((await f.evaluate(multi)).eligibility.reason,'STATE_CHANGED');
 for(const old of ['x'.repeat(180),'x'.repeat(179)+'…','Lost…']){const s=await f.source('update_task',{title:old},{title:'After'});assert.equal((await f.evaluate(s)).eligibility.reason,'HISTORY_INCOMPLETE');}
 for(const length of [3999,4000]){const s=await f.source('update_task',{description:'x'.repeat(length)},{description:'After description'});assert.equal((await f.evaluate(s)).eligibility.state,length===3999?'available':'unsafe');}
 const missing=await f.source('update_task',{}, {title:'After'});assert.equal((await f.evaluate(missing)).eligibility.reason,'HISTORY_INCOMPLETE');
 const uuid=await f.source('update_task',{milestoneId:milestone},{milestoneId:null});await f.db.query('update public.tasks set milestone_id=null where id=$1',[task]);await f.db.query(`update private.agent_actions set diff='[{"field":"milestoneId","before":"Label","after":null}]' where id=$1`,[uuid.id]);assert.equal((await f.evaluate(uuid)).candidate.payload.milestoneId,milestone);
 const unsupported=await f.source('create_task',{}, {title:'After'});assert.equal((await f.evaluate(unsupported)).eligibility.reason,'UNSUPPORTED_ACTION');
 const pending=await f.source();await f.db.query("update private.agent_actions set status='pending' where id=$1",[pending.id]);assert.equal((await f.evaluate(pending)).eligibility.reason,'NOT_APPLIED');
});
test('undo policy dates, missing links and time-block range/status restoration fail closed',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);
 for(const [type,id,table] of [['reschedule_project',project,'projects'],['reschedule_milestone',milestone,'milestones']]){await f.db.query(`update public.${table} set target_date='2026-11-01' where id=$1`,[id]);const s=await f.source(type,{targetDate:null},{targetDate:'2026-11-01'},id);assert.deepEqual((await f.evaluate(s)).candidate.payload,{targetDate:null});}
 const block=(await f.one(`insert into public.workspace_time_blocks(user_id,title,start_at,end_at) values($1,'Focus','2099-01-01T09:00Z','2099-01-01T10:00Z') returning id`,[owner])).id;
 const state={title:'Focus',startAt:'2099-01-01T09:00:00.000Z',endAt:'2099-01-01T10:00:00.000Z',projectId:null,taskId:null,kind:'focus',status:'scheduled'};
 const create=await f.source('create_time_block',{},state,block,null);assert.deepEqual((await f.evaluate(create)).candidate.payload,{status:'cancelled'});
 await f.db.query("update public.workspace_time_blocks set notes='Annotated' where id=$1",[block]);assert.equal((await f.evaluate(create)).eligibility.reason,'STATE_CHANGED');
 await f.db.query("update public.workspace_time_blocks set notes=null,status='cancelled' where id=$1",[block]);
 const cancel=await f.source('cancel_time_block',state,{status:'cancelled'},block,null);assert.deepEqual((await f.evaluate(cancel)).candidate.payload,{status:'scheduled'});
 await f.db.query(`insert into public.workspace_time_blocks(user_id,title,start_at,end_at) values($1,'Occupied','2099-01-01T09:30Z','2099-01-01T10:30Z')`,[owner]);assert.equal((await f.evaluate(cancel)).eligibility.reason,'SLOT_OCCUPIED');
 await f.db.query('delete from public.workspace_time_blocks where id<>$1',[block]);
 const update=await f.source('update_time_block',{...state,status:'scheduled'},{status:'cancelled'},block,null);assert.equal((await f.evaluate(update)).eligibility.state,'available');
 await f.db.query("update public.workspace_time_blocks set start_at='2000-01-01T09:00Z',end_at='2000-01-01T10:00Z' where id=$1",[block]);
 const pastState={...state,startAt:'2000-01-01T09:00Z',endAt:'2000-01-01T10:00Z'};const past=await f.source('cancel_time_block',pastState,{status:'cancelled'},block,null);assert.equal((await f.evaluate(past)).eligibility.reason,'SLOT_PAST');
 const link=await f.source('update_task',{milestoneId:milestone},{milestoneId:null});await f.db.query('delete from public.milestones where id=$1',[milestone]);assert.equal((await f.evaluate(link)).eligibility.reason,'LINK_UNAVAILABLE');
 await f.db.query('delete from public.tasks where id=$1',[task]);assert.equal((await f.evaluate(link)).eligibility.reason,'ENTITY_MISSING');
});
