import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {fixture,owner,other,task,project,milestone} from './phase4b-fixture.mjs';
test('named uniqueness loser rolls back its draft/run and recovers canonical winner; unrelated uniqueness errors propagate',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t),s=await f.source(),winner=(await f.prepare(s)).proposalBatch;await f.db.query('select public.cancel_agent_task_actions($1,$2,$3)',[owner,winner.runId,[winner.actions[0].id]]);
 const counts=await f.one('select (select count(*) from private.agent_runs)::int runs,(select count(*) from private.agent_actions)::int actions');
 // Deterministic fault injection, NOT multi-connection proof: make an existing
 // canonical cancelled inverse become pending after eligibility, outside the
 // save/link exception subtransaction, to exercise the uniqueness-loser branch.
 await f.db.exec(`alter function private.agent_undo_evaluate(uuid,uuid,uuid,timestamptz,uuid) rename to test_original_undo_evaluate;
 create table private.test_undo_calls(n int);insert into private.test_undo_calls values(0);
 create function private.agent_undo_evaluate(p_user_id uuid,p_run_id uuid,p_action_id uuid,p_now timestamptz,p_selected_inverse_id uuid default null) returns jsonb language plpgsql volatile set search_path='' as $$declare r jsonb;n integer;begin
 r=private.test_original_undo_evaluate(p_user_id,p_run_id,p_action_id,p_now,p_selected_inverse_id);update private.test_undo_calls set n=test_undo_calls.n+1 returning test_undo_calls.n into n;
 if n=2 then update private.agent_actions set status='pending' where id='${winner.actions[0].id}';end if;return r;end;$$;`);
 const recovered=await f.prepare(s);assert.equal(recovered.proposalBatch.runId,winner.runId);assert.equal(recovered.eligibility.reason,'PENDING_INVERSE');assert.deepEqual(await f.one('select (select count(*) from private.agent_runs)::int runs,(select count(*) from private.agent_actions)::int actions'),counts);
 await f.db.query('select public.cancel_agent_task_actions($1,$2,$3)',[owner,winner.runId,[winner.actions[0].id]]);
 await f.db.exec(`alter function public.save_agent_proposal_batch(uuid,jsonb) rename to test_original_save_agent_proposal_batch;
 create function public.save_agent_proposal_batch(p_user_id uuid,p_actions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin perform public.test_original_save_agent_proposal_batch(p_user_id,p_actions);raise exception 'unrelated uniqueness' using errcode='23505',constraint='unrelated_index';end;$$;`);
 await assert.rejects(f.prepare(s),e=>e.code==='23505'&&e.constraint==='unrelated_index');assert.deepEqual(await f.one('select (select count(*) from private.agent_runs)::int runs,(select count(*) from private.agent_actions)::int actions'),counts);
});
test('microsecond versions stay strict and profile timezone changes never invent historical date compatibility',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);await f.db.exec('alter table public.tasks disable trigger test_stamp');await f.db.query("update public.tasks set updated_at='2026-10-12T00:00:00.123456Z' where id=$1",[task]);const s=await f.source(),b=(await f.prepare(s)).proposalBatch;await f.db.query("update public.tasks set updated_at='2026-10-12T00:00:00.123457Z' where id=$1",[task]);assert.equal((await f.apply(b)).errorCode,'STALE_ENTITY');
 await f.db.query("update public.tasks set due_date='2026-11-01T17:00Z' where id=$1",[task]);const date=await f.source('update_task',{dueDate:null},{dueDate:'2026-11-02'});assert.equal((await f.evaluate(date)).eligibility.state,'available');await f.db.query("update public.profiles set time_zone='America/Los_Angeles' where id=$1",[owner]);assert.equal((await f.evaluate(date)).eligibility.reason,'STATE_CHANGED');
});
test('completed block restoration requires a future slot and equivalent timezone offsets compare canonically',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);const state={title:'Focus',startAt:'2099-01-01T17:00:00.000+08:00',endAt:'2099-01-01T18:00:00.000+08:00',projectId:null,taskId:null,kind:'focus',status:'scheduled'};
 const id=(await f.one(`insert into public.workspace_time_blocks(user_id,title,start_at,end_at,status) values($1,'Focus','2099-01-01T09:00Z','2099-01-01T10:00Z','completed') returning id`,[owner])).id;
 const s=await f.source('update_time_block',state,{status:'completed'},id,null);assert.equal((await f.apply((await f.prepare(s)).proposalBatch)).status,'applied');
 await f.db.query("update public.workspace_time_blocks set status='completed',start_at='2000-01-01T09:00Z',end_at='2000-01-01T10:00Z' where id=$1",[id]);const past=await f.source('update_time_block',{...state,startAt:'2000-01-01T09:00:00.000Z',endAt:'2000-01-01T10:00:00.000Z'},{status:'completed'},id,null);assert.equal((await f.prepare(past)).eligibility.reason,'SLOT_PAST');
});
test('large unrelated task description survives title reversal without overflowing canonical history',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);await f.db.query('update public.tasks set description=$1 where id=$2',['x'.repeat(41000),task]);const s=await f.source();assert.equal((await f.evaluate(s)).eligibility.state,'available');const b=(await f.prepare(s)).proposalBatch;assert.ok(b);assert.equal((await f.apply(b)).status,'applied');assert.equal((await f.one('select length(description)::int n from public.tasks where id=$1',[task])).n,41000);assert.ok(b.actions[0].before.description.length<=4000);
});
test('a block moved to another owned project is unavailable, but its historical project reversal remains supported',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t),second=randomUUID();await f.db.query('insert into public.projects(id,user_id) values($1,$2)',[second,owner]);const id=(await f.one(`insert into public.workspace_time_blocks(user_id,title,project_id,start_at,end_at) values($1,'After',$2,'2099-01-01T09:00Z','2099-01-01T10:00Z') returning id`,[owner,project])).id;
 const state={title:'Before',startAt:'2099-01-01T09:00:00.000Z',endAt:'2099-01-01T10:00:00.000Z',projectId:project,taskId:null,kind:'focus',status:'scheduled'};
 const s=await f.source('update_time_block',state,{title:'After'},id,project);await f.db.query('update public.workspace_time_blocks set project_id=$1 where id=$2',[second,id]);assert.equal((await f.prepare(s)).eligibility.reason,'STATE_CHANGED');
 const change=await f.source('update_time_block',state,{projectId:second},id,second);const b=(await f.prepare(change)).proposalBatch;assert.ok(b);assert.equal((await f.apply(b)).status,'applied');assert.equal((await f.one('select project_id from public.workspace_time_blocks where id=$1',[id])).project_id,project);
});
test('every supported task field and multi-field inverse uses actual Apply, including UUID restoration and null dates',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);
 for(const [field,column,before,after] of [['title','title','Old','After'],['description','description','Old description','After description'],['priority','priority','Low','High'],['status','status','Planned','Completed'],['dueDate','due_date',null,'2026-11-01'],['milestoneId','milestone_id',milestone,null]])await t.test(field,async()=>{
  await f.db.query(`update public.tasks set ${column}=$1 where id=$2`,[after,task]);const s=await f.source('update_task',{[field]:before},{[field]:after});const b=(await f.prepare(s)).proposalBatch;assert.deepEqual(b.actions[0].payload,{[field]:before});assert.equal((await f.apply(b)).status,'applied');const r=await f.one(`select ${column} value from public.tasks where id=$1`,[task]);assert.equal(r.value,before);
 });
 await f.db.query("update public.tasks set title='After',priority='High' where id=$1",[task]);const multi=await f.source('update_task',{title:'Old',priority:'Low'},{title:'After',priority:'High'});assert.equal((await f.apply((await f.prepare(multi)).proposalBatch)).status,'applied');assert.deepEqual(await f.one('select title,priority from public.tasks where id=$1',[task]),{title:'Old',priority:'Low'});
});
test('malformed multi-field history cannot partially reverse; unknown actions, null/missing and foreign mutations fail closed',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);
 const s=await f.source('update_task',{title:'Old'},{title:'After',priority:'High'});assert.equal((await f.prepare(s)).eligibility.reason,'HISTORY_INCOMPLETE');assert.equal((await f.one('select count(*)::int n from private.agent_actions where undo_of_action_id=$1',[s.id])).n,0);
 const incomplete=await f.source();await f.db.query(`update private.agent_actions set diff='[{"field":"title","before":"Different","after":"After"}]' where id=$1`,[incomplete.id]);assert.equal((await f.prepare(incomplete)).eligibility.reason,'HISTORY_INCOMPLETE');
 const unknown=await f.source();await f.db.exec('alter table private.agent_actions drop constraint agent_actions_action_type_check;alter table private.agent_actions drop constraint agent_actions_check');await f.db.query("update private.agent_actions set action_type='future_action' where id=$1",[unknown.id]);assert.equal((await f.prepare(unknown)).eligibility.reason,'UNSUPPORTED_ACTION');
 assert.equal((await f.one('select public.prepare_agent_undo($1,$2,$3) r',[other,incomplete.runId,incomplete.id])).r,null);
 assert.equal((await f.one('select public.apply_agent_inverse_action($1,$2,$3) r',[owner,incomplete.runId,incomplete.id])).r.errorCode,'FORBIDDEN');
});
test('Apply rejects forged persisted inverse, deleted links and expiry without partially writing entity',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);const s=await f.source(),b=(await f.prepare(s)).proposalBatch;await f.db.query(`update private.agent_actions set payload='{"title":"Forged"}' where id=$1`,[b.actions[0].id]);assert.equal((await f.apply(b)).errorCode,'INVALID_INPUT');assert.equal((await f.one('select title from public.tasks where id=$1',[task])).title,'After');
 const link=await f.source('update_task',{milestoneId:milestone},{milestoneId:null}),lb=(await f.prepare(link)).proposalBatch;await f.db.query('delete from public.milestones where id=$1',[milestone]);assert.equal((await f.apply(lb)).errorCode,'FORBIDDEN');
 const start=new Date(Date.now()+2000).toISOString(),end=new Date(Date.now()+3600000).toISOString();const id=(await f.one(`insert into public.workspace_time_blocks(user_id,title,start_at,end_at,status) values($1,'Expires',$2,$3,'cancelled') returning id`,[owner,start,end])).id;
 const state={title:'Expires',startAt:start,endAt:end,projectId:null,taskId:null,kind:'focus',status:'scheduled'};const cancellation=await f.source('cancel_time_block',state,{status:'cancelled'},id,null),cb=(await f.prepare(cancellation)).proposalBatch;assert.ok(cb);await new Promise(r=>setTimeout(r,2100));assert.equal((await f.apply(cb)).errorCode,'INVALID_INPUT');assert.equal((await f.one('select status from public.workspace_time_blocks where id=$1',[id])).status,'cancelled');
});
test('inverse Apply reuses mutation paths, keeps whole-row stale protection, lineage and idempotency',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);assert.equal((await f.one("select to_regprocedure('public.apply_agent_inverse_action(uuid,uuid,uuid)') is not null found")).found,true);
 const s=await f.source();const original=(await f.one('select to_jsonb(a) r from private.agent_actions a where id=$1',[s.id])).r;
 const b=(await f.prepare(s)).proposalBatch;assert.equal((await f.apply(b)).status,'applied');assert.equal((await f.one('select title from public.tasks where id=$1',[task])).title,'Before');assert.equal((await f.apply(b)).status,'applied');assert.equal((await f.prepare(s)).eligibility.reason,'ALREADY_REVERSED');
 const inverseSource={runId:b.runId,id:b.actions[0].id};const next=(await f.prepare(inverseSource)).proposalBatch;assert.equal(next.actions[0].undoOf.actionId,inverseSource.id);assert.equal((await f.apply(next)).status,'applied');assert.equal((await f.prepare(s)).eligibility.reason,'ALREADY_REVERSED');assert.deepEqual((await f.one('select to_jsonb(a) r from private.agent_actions a where id=$1',[s.id])).r,original);
 const stale=await f.source();const staleBatch=(await f.prepare(stale)).proposalBatch;await f.db.query("update public.tasks set priority='Critical' where id=$1",[task]);assert.equal((await f.apply(staleBatch)).errorCode,'STALE_ENTITY');assert.equal((await f.one('select title from public.tasks where id=$1',[task])).title,'After');
 const status=await f.source('update_task',{status:'Planned'},{status:'Completed'});const statusBatch=(await f.prepare(status)).proposalBatch;assert.equal((await f.apply(statusBatch)).status,'applied');assert.equal((await f.one('select completed_at from public.tasks where id=$1',[task])).completed_at,null);
 for(const [type,id,table] of [['reschedule_project',project,'projects'],['reschedule_milestone',milestone,'milestones']]){await f.db.query(`update public.${table} set target_date='2026-11-01' where id=$1`,[id]);const source=await f.source(type,{targetDate:null},{targetDate:'2026-11-01'},id);assert.equal((await f.apply((await f.prepare(source)).proposalBatch)).status,'applied');assert.equal((await f.one(`select target_date from public.${table} where id=$1`,[id])).target_date,null);}
 const cancelled=await f.source();const cb=(await f.prepare(cancelled)).proposalBatch;await f.db.query('select public.cancel_agent_task_actions($1,$2,$3)',[owner,cb.runId,[cb.actions[0].id]]);assert.equal((await f.apply(cb)).status,'cancelled');
});
test('block inverse create/cancel/update paths revalidate occupied slots at Apply and preserve deadlines',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);assert.equal((await f.one("select to_regprocedure('public.apply_agent_inverse_action(uuid,uuid,uuid)') is not null found")).found,true);
 const id=(await f.one(`insert into public.workspace_time_blocks(user_id,title,start_at,end_at) values($1,'Focus','2099-01-01T09:00Z','2099-01-01T10:00Z') returning id`,[owner])).id;
 const state={title:'Focus',startAt:'2099-01-01T09:00:00.000Z',endAt:'2099-01-01T10:00:00.000Z',projectId:null,taskId:null,kind:'focus',status:'scheduled'};
 const s=await f.source('create_time_block',{},state,id,null),b=(await f.prepare(s)).proposalBatch;assert.equal((await f.apply(b)).status,'applied');assert.equal((await f.one('select status from public.workspace_time_blocks where id=$1',[id])).status,'cancelled');
 const restoration=await f.prepare({runId:b.runId,id:b.actions[0].id});assert.equal(restoration.eligibility.state,'available',JSON.stringify(restoration));const restore=restoration.proposalBatch;assert.equal((await f.apply(restore)).status,'applied');
 await f.db.query("update public.workspace_time_blocks set title='Changed' where id=$1",[id]);const update=await f.source('update_time_block',state,{title:'Changed'},id,null);assert.equal((await f.apply((await f.prepare(update)).proposalBatch)).status,'applied');
 await f.db.query("update public.workspace_time_blocks set status='cancelled' where id=$1",[id]);const cancel=await f.source('cancel_time_block',state,{status:'cancelled'},id,null);const c=(await f.prepare(cancel)).proposalBatch;
 await f.db.query(`insert into public.workspace_time_blocks(user_id,title,start_at,end_at) values($1,'Other','2099-01-01T09:30Z','2099-01-01T10:30Z')`,[owner]);assert.equal((await f.apply(c)).errorCode,'TIME_BLOCK_OVERLAP');assert.equal((await f.one('select status from public.workspace_time_blocks where id=$1',[id])).status,'cancelled');
 assert.equal((await f.one('select due_date from public.tasks where id=$1',[task])).due_date,null);
});
test('Prepare is atomic, recovers duplicate/lost response, preserves source and unrelated edits; Cancel permits fresh preparation',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);const s=await f.source();const present=await f.one("select to_regprocedure('public.prepare_agent_undo(uuid,uuid,uuid)') is not null found");assert.equal(present.found,true);
 await f.db.query("update public.tasks set priority='Critical' where id=$1",[task]);
 const original=(await f.one('select to_jsonb(a) r from private.agent_actions a where id=$1',[s.id])).r;
 const workspace=(await f.one('select to_jsonb(t) r from public.tasks t where id=$1',[task])).r;
 const first=await f.prepare(s);assert.equal(first.proposalBatch.actions.length,1);assert.deepEqual(first.proposalBatch.actions[0].payload,{title:'Before'});assert.equal(first.proposalBatch.actions[0].undoOf.actionId,s.id);
 assert.equal(first.proposalBatch.actions[0].expectedUpdatedAt,workspace.updated_at);
 const duplicates=await Promise.all([f.prepare(s),f.prepare(s)]);assert.ok(duplicates.every(r=>r.proposalBatch.runId===first.proposalBatch.runId));
 assert.deepEqual((await f.one('select to_jsonb(t) r from public.tasks t where id=$1',[task])).r,workspace);
 assert.deepEqual((await f.one('select to_jsonb(a) r from private.agent_actions a where id=$1',[s.id])).r,original);
 const a=first.proposalBatch.actions[0];await f.db.query('select public.cancel_agent_task_actions($1,$2,$3)',[owner,first.proposalBatch.runId,[a.id]]);
 const fresh=await f.prepare(s);assert.notEqual(fresh.proposalBatch.runId,first.proposalBatch.runId);assert.equal((await f.one("select count(*)::int n from private.agent_actions where undo_of_action_id=$1 and status in ('pending','applied')",[s.id])).n,1);
 await f.db.query('select public.cancel_agent_task_actions($1,$2,$3)',[owner,fresh.proposalBatch.runId,[fresh.proposalBatch.actions[0].id]]);
 const counts=await f.one('select (select count(*) from private.agent_runs)::int runs,(select count(*) from private.agent_actions)::int actions');
 await f.db.exec(`create function private.reject_link() returns trigger language plpgsql as $$begin if new.undo_of_action_id is not null then raise exception 'reject link';end if;return new;end;$$;create trigger reject_link before update on private.agent_actions for each row execute function private.reject_link();`);
 await assert.rejects(f.prepare(s));assert.deepEqual(await f.one('select (select count(*) from private.agent_runs)::int runs,(select count(*) from private.agent_actions)::int actions'),counts);
});
test('undo lineage enforces same owner, self rejection and one live inverse; projections are bounded and service-only',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 const f=await fixture(t);const s=await f.source(),inverse=await f.source();
 const column=await f.one("select count(*)::int n from information_schema.columns where table_schema='private' and table_name='agent_actions' and column_name='undo_of_action_id'");assert.equal(column.n,1);
 const snapshot=(await f.one('select to_jsonb(a) r from private.agent_actions a where id=$1',[s.id])).r;
 await assert.rejects(f.db.query('update private.agent_actions set undo_of_action_id=id where id=$1',[s.id]),e=>e.code==='23514');
 await f.db.query('update private.agent_actions set undo_of_action_id=$1,status=$2 where id=$3',[s.id,'pending',inverse.id]);
 const duplicate=await f.source();await assert.rejects(f.db.query('update private.agent_actions set undo_of_action_id=$1 where id=$2',[s.id,duplicate.id]),e=>e.code==='23505');
 const foreignRun=randomUUID();await f.db.query('insert into private.agent_runs(id,user_id) values($1,$2)',[foreignRun,other]);await assert.rejects(f.db.query(`insert into private.agent_actions(id,run_id,user_id,action_type,project_id,title,payload,before_state,diff,undo_of_action_id) values($1,$2,$3,'create_task',$4,'Foreign','{"title":"Foreign"}','{}','[{"field":"title","before":null,"after":"Foreign"}]',$5)`,[randomUUID(),foreignRun,other,other,duplicate.id]),e=>e.code==='23503');
 const detail=(await f.one('select public.get_agent_activity_run($1,$2) r',[owner,s.runId])).r;
 assert.equal(detail.actions[0].undo.reason,'PENDING_INVERSE');assert.equal(detail.actions[0].undo.existingInverse.actionId,inverse.id);assert.ok(detail.actions[0].undo.explanation.length<=240);assert.doesNotMatch(JSON.stringify(detail),/before_state|payload|prompt|reasoning/);
 await f.db.query("update private.agent_actions set status='cancelled' where id=$1",[inverse.id]);await f.db.query('update private.agent_actions set undo_of_action_id=$1 where id=$2',[s.id,duplicate.id]);assert.equal((await f.one('select public.get_agent_undo_eligibility($1,$2,$3) r',[owner,s.runId,s.id])).r.reason,'ALREADY_REVERSED');
 assert.deepEqual((await f.one('select to_jsonb(a) r from private.agent_actions a where id=$1',[s.id])).r,snapshot);
 for(const role of ['anon','authenticated']){await f.db.exec(`set role ${role}`);await assert.rejects(f.db.query('select public.get_agent_undo_eligibility($1,$2,$3)',[owner,s.runId,s.id]));await assert.rejects(f.db.exec('select * from private.agent_actions'));await f.db.exec('reset role');}
 await f.db.exec('set role service_role');assert.ok((await f.one('select public.get_agent_undo_eligibility($1,$2,$3) r',[owner,s.runId,s.id])).r);await assert.rejects(f.db.exec("select private.agent_undo_reason('AVAILABLE')"));await assert.rejects(f.db.exec('select * from private.agent_actions'));await f.db.exec('reset role');
 for(const name of ['get_agent_undo_eligibility','prepare_agent_undo','apply_agent_inverse_action']){
  const signature=`public.${name}(uuid,uuid,uuid)`;
  for(const role of ['anon','authenticated','service_role'])assert.equal((await f.one("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).allowed,role==='service_role');
  const security=await f.one('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature]);assert.equal(security.prosecdef,true);assert.ok(security.proconfig.includes('search_path=""'));
 }
 const functions=(await f.db.query(`select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_agent_undo_eligibility'`)).rows;assert.equal(functions[0].prosecdef,true);assert.ok(functions[0].proconfig.includes('search_path=""'));
 assert.equal((await f.one('select public.get_agent_undo_eligibility($1,$2,$3) r',[other,s.runId,s.id])).r,null);
 assert.equal((await f.one('select title from public.tasks where id=$1',[task])).title,'After');
});
