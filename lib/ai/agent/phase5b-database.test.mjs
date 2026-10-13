import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture} from './phase5b-fixture.mjs';
Error.stackTraceLimit=0;
const fixtureUrl=new URL('./phase5b-fixture.mjs',import.meta.url);
test('fixture_matches_milestone_schema_and_policies',async t=>{
 assert.ok(existsSync(fixtureUrl),'accurate Phase5B fixture is required');
 const {fixture}=await import(fixtureUrl.href);const {db,one,owner,other,project,milestone,task}=await fixture(t);
 const columns=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='milestones' order by ordinal_position")).rows.map(r=>r.column_name);
 assert.deepEqual(columns,['id','project_id','title','description','status','target_date','sort_order','created_at','updated_at']);
 const before=await one('select * from public.milestones where id=$1',[milestone]);
 assert.equal(before.description,'');assert.equal(before.status,'pending');assert.equal(before.sort_order,0);assert.ok(before.created_at);
 const updated=await one('update public.milestones set description=$2 where id=$1 returning updated_at, now() as transaction_time',[milestone,'Updated']);
 assert.equal(updated.updated_at.getTime(),updated.transaction_time.getTime());
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${other}'`);
 assert.equal((await one('select count(*)::int n from public.milestones')).n,0);
 await assert.rejects(db.query('insert into public.milestones(project_id,title) values($1,$2)',[project,'Forbidden']));
 await db.exec(`set request.jwt.claim.sub='${owner}'`);
 assert.equal((await one('select count(*)::int n from public.milestones')).n,1);
 await db.query('update public.milestones set status=$2 where id=$1',[milestone,'active']);
 await db.exec('reset role');await db.query('update public.tasks set milestone_id=$2 where id=$1',[task,milestone]);
 await db.query('delete from public.milestones where id=$1',[milestone]);
 assert.equal((await one('select milestone_id from public.tasks where id=$1',[task])).milestone_id,null);
 await db.query('insert into public.milestones(project_id,title) values($1,$2)',[project,'Cascade']);
 await db.query('delete from public.projects where id=$1',[project]);
 assert.equal((await one('select count(*)::int n from public.milestones')).n,0);
 await db.exec('set role anon');await assert.rejects(db.query('select * from public.milestones'));
});
export async function draft(f,patch,type='update_milestone'){
 const current=await f.one('select * from public.milestones where id=$1',[f.milestone]);
 const creating=type==='create_milestone';
 const values={title:current.title,description:current.description,status:current.status,targetDate:current.target_date instanceof Date?current.target_date.toISOString().slice(0,10):current.target_date};
 const before=creating?{}:{...(type==='update_milestone'?{projectId:f.project}:{}),...Object.fromEntries(Object.keys(patch).map(k=>[k,values[k]]))};
 return {id:randomUUID(),type,entityId:creating?null:f.milestone,taskId:null,projectId:f.project,title:'Milestone',payload:patch,before,expectedUpdatedAt:creating?null:current.updated_at.toISOString(),diff:Object.entries(patch).map(([field,after])=>({field,before:creating?null:values[field],after}))};
}
export async function save(f,action){return (await f.one('select public.save_agent_proposal_batch($1,$2) r',[f.owner,JSON.stringify([action])])).r;}
export async function apply(f,batch,rpc='apply_agent_milestone_action'){return (await f.one(`select public.${rpc}($1,$2,$3) r`,[f.owner,batch.runId,batch.actions[0].id])).r;}
test('milestone_patch_validator_is_exact',async t=>{
 const f=await fixture(t);
 const exists=await f.one("select to_regprocedure('private.agent_milestone_patch_valid(jsonb,boolean)') is not null found");assert.equal(exists.found,true);
 for(const patch of [{},{title:' '},{title:' x '},{description:null},{status:'Backlog'},{targetDate:'2026-02-30'},{projectId:f.project},{title:'x'.repeat(181)},{description:'x'.repeat(4001)}])assert.equal((await f.one('select private.agent_milestone_patch_valid($1,false) ok',[JSON.stringify(patch)])).ok,false);
 for(const patch of [{description:''},{status:'active'},{targetDate:null},{title:'Valid'}])assert.equal((await f.one('select private.agent_milestone_patch_valid($1,false) ok',[JSON.stringify(patch)])).ok,true);
});
test('shared_patch_has_no_audit_side_effects_and_checks_version',async t=>{
 const f=await fixture(t);const current=await f.one('select updated_at from public.milestones where id=$1',[f.milestone]);
 assert.equal((await f.one('select private.agent_apply_milestone_patch($1,$2,$3,$4,$5) ok',[f.owner,f.project,f.milestone,'{"description":"After"}',current.updated_at])).ok,true);
 assert.equal((await f.one('select count(*)::int n from private.agent_actions')).n,0);
 assert.equal((await f.one('select private.agent_apply_milestone_patch($1,$2,$3,$4,$5) ok',[f.owner,f.project,f.milestone,'{"status":"active"}',current.updated_at])).ok,false);
 await assert.rejects(f.db.query('select private.agent_apply_milestone_patch($1,$2,$3,$4,$5)',[f.other,f.project,f.milestone,'{"status":"active"}',current.updated_at]));
});
test('milestone_create_is_atomic_idempotent_and_appends',async t=>{
 const f=await fixture(t),payload={title:'Created',description:'',status:'pending',targetDate:null};
 const b=await save(f,await draft(f,payload,'create_milestone'));
 assert.equal((await f.one('select count(*)::int n from public.milestones')).n,1);
 const result=await apply(f,b);assert.equal(result.status,'applied');assert.ok(result.entityId);
 assert.deepEqual(await apply(f,b),result);assert.equal((await f.one('select count(*)::int n from public.milestones')).n,2);
 const created=await f.one('select * from public.milestones where id=$1',[result.entityId]);assert.equal(created.sort_order,1);assert.equal(created.status,'pending');
 const undo=(await f.one('select public.get_agent_undo_eligibility($1,$2,$3) r',[f.owner,b.runId,b.actions[0].id])).r;assert.equal(undo.reason,'UNSUPPORTED_ACTION');
 const cancelled=await save(f,await draft(f,payload,'create_milestone'));
 await f.one('select public.cancel_agent_task_actions($1,$2,$3) r',[f.owner,cancelled.runId,[cancelled.actions[0].id]]);assert.equal((await apply(f,cancelled)).status,'cancelled');assert.equal((await f.one('select count(*)::int n from public.milestones')).n,2);
});
test('milestone_update_is_grouped_and_strictly_stale_without_cascades',async t=>{
 const f=await fixture(t);const taskBefore=await f.one('select * from public.tasks where id=$1',[f.task]);
 await f.db.query('update public.milestones set target_date=$2 where id=$1',[f.milestone,'2026-11-01']);
 const b=await save(f,await draft(f,{description:'After',targetDate:null,status:'active'}));assert.equal((await apply(f,b)).status,'applied');
 const row=await f.one('select * from public.milestones where id=$1',[f.milestone]);assert.equal(row.description,'After');assert.equal(row.status,'active');assert.equal(row.title,'Milestone');
 assert.deepEqual(await f.one('select * from public.tasks where id=$1',[f.task]),taskBefore);
 const stale=await save(f,await draft(f,{title:'Agent'}));await f.db.query('update public.milestones set description=$2 where id=$1',[f.milestone,'Manual']);assert.equal((await apply(f,stale)).errorCode,'STALE_ENTITY');
 assert.equal((await f.one('select title from public.milestones where id=$1',[f.milestone])).title,'Milestone');
});
test('new_milestone_batch_requires_one_exact_action_and_preserves_old_shapes',async t=>{
 const f=await fixture(t),a=await draft(f,{title:'After'});
 for(const changed of [{...a,before:{title:'Milestone'}},{...a,before:{projectId:f.project,title:null}},{...a,diff:[...a.diff,...a.diff]},{...a,payload:{title:'Milestone'}},{...a,expectedUpdatedAt:null},{...a,entityId:null},{...a,projectId:f.other}])await assert.rejects(save(f,changed));
 await assert.rejects(f.one('select public.save_agent_proposal_batch($1,$2) r',[f.owner,JSON.stringify([a,{...a,id:randomUUID(),type:'reschedule_milestone',payload:{targetDate:null},before:{targetDate:'2026-11-01'},diff:[{field:'targetDate',before:'2026-11-01',after:null}]}])]));
 assert.equal((await f.one('select count(*)::int n from private.agent_runs')).n,0);
 const b=await save(f,a);assert.equal(b.actions[0].type,'update_milestone');assert.equal(b.actions[0].taskId,null);
 await assert.rejects(f.db.query(`insert into private.agent_actions(id,run_id,user_id,action_type,entity_id,project_id,title,payload,before_state,expected_updated_at,diff) values($1,$2,$3,'reschedule_milestone',$4,$5,'Old','{"targetDate":null}','{"targetDate":null}',now(),'[{"field":"targetDate","before":null,"after":null}]')`,[randomUUID(),b.runId,f.owner,f.milestone,f.project]));
});
test('legacy_reschedule_preserves_payload_audit_and_undo',async t=>{
 const f=await fixture(t),action=await draft(f,{targetDate:'2026-11-03'},'reschedule_milestone'),b=await save(f,action);
 assert.equal((await apply(f,b,'apply_agent_schedule_action')).status,'applied');
 const row=await f.one('select * from private.agent_actions where id=$1',[action.id]);assert.deepEqual(row.payload,{targetDate:'2026-11-03'});assert.deepEqual(row.before_state,{targetDate:null});
 const inverse=(await f.one('select public.prepare_agent_undo($1,$2,$3) r',[f.owner,b.runId,action.id])).r;
 assert.ok(inverse.proposalBatch);assert.equal((await apply(f,inverse.proposalBatch,'apply_agent_inverse_action')).status,'applied');
 const current=await f.one('select * from public.milestones where id=$1',[f.milestone]);assert.equal(current.target_date,null);assert.equal(current.description,'');assert.equal(current.status,'pending');
 assert.equal((await f.one('select count(*)::int n from private.agent_actions')).n,2);
});
test('create_failure_rolls_back_workspace_and_records_safe_error',async t=>{
 const f=await fixture(t),b=await save(f,await draft(f,{title:'Created',description:'',status:'pending',targetDate:null},'create_milestone'));
 await f.db.exec(`create function private.test_audit_failure() returns trigger language plpgsql as $$begin if new.status='applied' then raise exception 'Sensitive internal detail';end if;return new;end;$$;create trigger test_audit_failure before update on private.agent_actions for each row execute function private.test_audit_failure();`);
 const r=await apply(f,b);assert.equal(r.status,'failed');assert.equal(r.errorCode,'MILESTONE_SAVE_FAILED');assert.equal((await f.one('select count(*)::int n from public.milestones')).n,1);
});
test('milestone_rpcs_are_service_only_and_private_helpers_remain_private',async t=>{
 const f=await fixture(t);
 for(const signature of ['public.apply_agent_milestone_action(uuid,uuid,uuid)','public.save_agent_proposal_batch(uuid,jsonb)','public.apply_agent_schedule_action(uuid,uuid,uuid)','public.apply_agent_inverse_action(uuid,uuid,uuid)']){
  for(const role of ['anon','authenticated'])assert.equal((await f.one('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).allowed,false);
  assert.equal((await f.one('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',[signature])).allowed,true);
  const definition=await f.one('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature]);assert.equal(definition.prosecdef,true);assert.ok(definition.proconfig.includes('search_path=""'));
 }
 for(const signature of ['private.agent_apply_milestone_patch(uuid,uuid,uuid,jsonb,timestamptz)','private.agent_milestone_patch_valid(jsonb,boolean)'])for(const role of ['anon','authenticated','service_role'])assert.equal((await f.one('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).allowed,false);
 await f.db.exec('set role authenticated');await assert.rejects(f.db.query('select * from private.agent_actions'));await assert.rejects(f.db.query('select public.apply_agent_milestone_action($1,$2,$3)',[f.owner,f.owner,f.owner]));
});
test('migration_preserves_every_old_kind_and_inverse_history_immutably',async t=>{
 const f=await fixture(t,{includePhase5b:false}),run=randomUUID(),ids=[];
 await f.db.query('insert into private.agent_runs(id,user_id) values($1,$2)',[run,f.owner]);
 for(const type of ['create_task','update_task','reschedule_milestone','reschedule_project','create_time_block','update_time_block','cancel_time_block']){
  const id=randomUUID();ids.push(id);const entity=type==='reschedule_project'?f.project:type.endsWith('_time_block')?randomUUID():type.endsWith('_task')?f.task:f.milestone;
  await f.db.query(`insert into private.agent_actions(id,run_id,user_id,action_type,entity_id,project_id,title,payload,before_state,expected_updated_at,diff,status) values($1,$2,$3,$4,$5,$6,'Historical',$7,$8,case when $4 like 'create_%' then null else now() end,'[{"field":"title","before":"Before","after":"After"}]','applied')`,[id,run,f.owner,type,entity,f.project,JSON.stringify(type.startsWith('reschedule')?{targetDate:null}:{title:'After'}),JSON.stringify(type.startsWith('reschedule')?{targetDate:'2026-11-20'}:{title:'Before'})]);
 }
 await f.db.query('update private.agent_actions set undo_of_action_id=$2 where id=$1',[ids[1],ids[0]]);
 const before=(await f.db.query('select * from private.agent_actions order by id')).rows;
 const duplicates=await f.one("select count(*)::int n from (select run_id,entity_id from private.agent_actions where action_type in ('update_milestone','reschedule_milestone') and entity_id is not null group by run_id,entity_id having count(*)>1) d");assert.equal(duplicates.n,0);
 await f.db.exec(readFileSync(new URL('../../../supabase/migrations/20261013090001_workspace_agent_milestones.sql',import.meta.url),'utf8'));
 assert.deepEqual((await f.db.query('select * from private.agent_actions order by id')).rows,before);
});
test('legacy_date_null_noop_stale_and_owner_errors_remain_compatible',async t=>{
 const f=await fixture(t);
 const noOp=await save(f,await draft(f,{targetDate:null},'reschedule_milestone'));assert.equal((await apply(f,noOp,'apply_agent_schedule_action')).status,'applied');
 const stale=await save(f,await draft(f,{targetDate:'2026-11-20'},'reschedule_milestone'));await f.db.query('update public.milestones set description=$2 where id=$1',[f.milestone,'Manual']);assert.equal((await apply(f,stale,'apply_agent_schedule_action')).errorCode,'STALE_ENTITY');
 const unavailable=await save(f,await draft(f,{targetDate:null},'reschedule_milestone'));await f.db.query('update public.milestones set project_id=$2 where id=$1',[f.milestone,f.other]);assert.equal((await apply(f,unavailable,'apply_agent_schedule_action')).errorCode,'FORBIDDEN');
});
