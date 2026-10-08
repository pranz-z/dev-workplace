import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";

const migration = readFileSync(new URL("../../../supabase/migrations/20261008152535_workspace_agent_task_proposals.sql", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", project = "33333333-3333-4333-8333-333333333333", task = "44444444-4444-4444-8444-444444444444", milestone = "55555555-5555-4555-8555-555555555555";
test("proposal migration protects private tables and restricts every exposed RPC", () => {
  for (const table of ["agent_runs","agent_actions","agent_action_limits"]) assert.match(migration,new RegExp(`alter table private.${table} enable row level security`));
  assert.match(migration,/from public, anon, authenticated, service_role/);
  assert.match(migration,/for update/);
  assert.match(migration,/t.updated_at is distinct from a.expected_updated_at/);
  assert.doesNotMatch(migration,/execute format|request_text|chain.of.thought/i);
});

test("disposable PostgreSQL: private grants, proposals, apply, stale state, cancel, validation, completion and independent outcomes", { skip: !process.env.AGENT_TEST_PGLITE_MODULE }, async (context) => {
  const { PGlite } = await import(pathToFileURL(process.env.AGENT_TEST_PGLITE_MODULE).href);
  const db = new PGlite();
  context.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    create table public.projects(id uuid primary key, user_id uuid references auth.users(id));
    create table public.milestones(id uuid primary key, project_id uuid references public.projects(id));
    create table public.tasks(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),project_id uuid references public.projects(id),milestone_id uuid references public.milestones(id),title text not null,description text not null default '',status text not null default 'Backlog',priority text not null default 'Medium',due_date timestamptz,sort_order integer not null default 0,updated_at timestamptz not null default clock_timestamp(),completed_at timestamptz,check ((status='Completed')=(completed_at is not null)));
    create function private.stamp_task() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end; $$;
    create trigger stamp_task before update on public.tasks for each row execute function private.stamp_task();
    insert into auth.users values('${owner}'),('${other}');
    insert into public.projects values('${project}','${owner}'),('${other}','${other}');
    insert into public.milestones values('${milestone}','${project}'),('${other}','${other}');
    insert into public.tasks(id,user_id,project_id,title,priority) values('${task}','${owner}','${project}','Task','Low');
  `);
  await db.exec(migration);
  const one = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
  const taskRow = () => one("select * from public.tasks where id=$1",[task]);
  let idCounter=1;
  async function save(payload,type='update_task') {
    const current=await taskRow(); const id=`66666666-6666-4666-8666-${String(idCounter++).padStart(12,'0')}`;
    const actions=[{id,type,taskId:type==='update_task'?task:null,projectId:project,title:'Task',payload,before:{priority:current.priority},expectedUpdatedAt:type==='update_task'?current.updated_at:null,diff:[{field:'priority',before:current.priority,after:payload.priority??null}]}];
    return (await one("select public.save_agent_proposal_batch($1,$2::jsonb) as batch",[owner,JSON.stringify(actions)])).batch;
  }
  const apply=(batch,user=owner,id=batch.actions[0].id)=>one("select public.apply_agent_task_action($1,$2,$3) as result",[user,batch.runId,id]).then(r=>r.result);
  let batch=await save({priority:'High'});
  await assert.rejects(db.query("update private.agent_actions set user_id=$1 where id=$2",[other,batch.actions[0].id]), /foreign key/);
  await assert.rejects(db.query("update private.agent_actions set status='unknown' where id=$1",[batch.actions[0].id]), /check constraint/);
  assert.equal((await taskRow()).priority,'Low');
  assert.equal((await one("select public.get_agent_proposal_batch($1,$2) as batch",[other,batch.runId])).batch,null);
  assert.equal((await apply(batch,other)).errorCode,'FORBIDDEN');
  assert.equal((await apply(batch)).status,'applied');
  assert.equal((await taskRow()).priority,'High');
  const timestamp=(await taskRow()).updated_at;
  assert.equal((await apply(batch)).status,'applied');
  assert.equal(String((await taskRow()).updated_at),String(timestamp));
  batch=await save({status:'In Progress'});
  await db.query("update public.tasks set status='Completed',completed_at=now() where id=$1",[task]);
  assert.equal((await apply(batch)).status,'conflict');
  assert.equal((await taskRow()).status,'Completed');
  batch=await save({status:'In Progress'}); await apply(batch);
  assert.equal((await taskRow()).completed_at,null);
  batch=await save({status:'Completed'}); await apply(batch);
  assert.ok((await taskRow()).completed_at);
  batch=await save({priority:'Critical'});
  await db.query("select public.cancel_agent_task_actions($1,$2,$3::uuid[])",[owner,batch.runId,[batch.actions[0].id]]);
  assert.equal((await apply(batch)).status,'cancelled');
  assert.equal((await taskRow()).priority,'High');
  batch=await save({title:'New QA',status:'Backlog',priority:'Medium'},'create_task');
  assert.equal((await one("select count(*)::int as n from public.tasks")).n,1);
  const created=await apply(batch); assert.equal(created.status,'applied');
  await apply(batch); assert.equal((await one("select count(*)::int as n from public.tasks")).n,2);
  assert.equal((await one("select sort_order from public.tasks where id=$1",[created.entityId])).sort_order,1);
  const completedCreation=await save({title:'Completed QA',status:'Completed'},'create_task');
  const completedResult=await apply(completedCreation);
  assert.ok((await one('select completed_at from public.tasks where id=$1',[completedResult.entityId])).completed_at);
  batch=await save({priority:'Low'});
  const completionTimestamp=(await taskRow()).completed_at;
  assert.equal((await one('select public.cancel_agent_task_actions($1,$2,$3::uuid[]) as b',[other,batch.runId,[batch.actions[0].id]])).b,null);
  await apply(batch);
  assert.equal(String((await taskRow()).completed_at),String(completionTimestamp));
  batch=await save({priority:'Low'});
  await db.query("update public.projects set user_id=$1 where id=$2",[other,project]);
  assert.equal((await apply(batch)).errorCode,'FORBIDDEN');
  await db.query("update public.projects set user_id=$1 where id=$2",[owner,project]);
  batch=await save({priority:'Low'});
  await db.query("update private.agent_actions set payload='{"+'"user_id":"'+other+'"'+"}'::jsonb where id=$1",[batch.actions[0].id]);
  assert.equal((await apply(batch)).errorCode,'INVALID_INPUT');
  for(const payload of [{},{priority:'Urgent'},{status:'Done'},{dueDate:'2026-02-30'},{milestoneId:other}]) await assert.rejects(save(payload));
  batch=await save({dueDate:'2026-10-10',milestoneId:milestone}); await apply(batch);
  assert.equal(new Date((await taskRow()).due_date).toISOString().slice(0,10),'2026-10-10');
  assert.equal((await taskRow()).milestone_id,milestone);
  batch=await save({dueDate:null,milestoneId:null});await apply(batch);
  assert.equal((await taskRow()).due_date,null);
  assert.equal((await taskRow()).milestone_id,null);
  // A mixed batch keeps each independent outcome and successful task update.
  const mixed = [];
  for (let n=0;n<3;n++) {
    const entityId=`77777777-7777-4777-8777-${String(n).padStart(12,'0')}`;
    await db.query("insert into public.tasks(id,user_id,project_id,title) values($1,$2,$3,'Independent')",[entityId,owner,project]);
    const row=await one("select * from public.tasks where id=$1",[entityId]);
    mixed.push({id:`88888888-8888-4888-8888-${String(n).padStart(12,'0')}`,type:'update_task',taskId:entityId,projectId:project,title:'Independent',payload:{priority:'High'},before:{priority:'Medium'},expectedUpdatedAt:row.updated_at,diff:[{field:'priority',before:'Medium',after:'High'}]});
  }
  const mixedBatch=(await one('select public.save_agent_proposal_batch($1,$2::jsonb) as batch',[owner,JSON.stringify(mixed)])).batch;
  await db.query("update public.tasks set title='Manually changed' where id=$1",[mixed[1].taskId]);
  await db.query("update private.agent_actions set payload='{\"priority\":\"invalid\"}'::jsonb where id=$1",[mixed[2].id]);
  const outcomes=[];
  for(const a of mixed) outcomes.push((await apply(mixedBatch,owner,a.id)).status);
  assert.deepEqual(outcomes,['applied','conflict','failed']);
  assert.equal((await one('select priority from public.tasks where id=$1',[mixed[0].taskId])).priority,'High');
  assert.equal((await one('select title from public.tasks where id=$1',[mixed[1].taskId])).title,'Manually changed');
  // Force audit failure after the task UPDATE: the subtransaction must roll it back.
  await db.exec(`create function private.reject_applied() returns trigger language plpgsql as $$ begin if new.status='applied' then raise exception 'audit failed'; end if; return new; end; $$;
    create trigger reject_applied before update on private.agent_actions for each row execute function private.reject_applied();`);
  batch=await save({priority:'Critical'});
  const previousPriority=(await taskRow()).priority;
  assert.equal((await apply(batch)).status,'failed');
  assert.equal((await taskRow()).priority,previousPriority);
  await db.exec('drop trigger reject_applied on private.agent_actions');
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from private.agent_actions'));
    await assert.rejects(db.query('select public.apply_agent_task_action($1,$2,$3)',[owner,batch.runId,batch.actions[0].id]));
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.ok((await one('select public.get_agent_proposal_batch($1,$2) as batch',[owner,batch.runId])).batch);
  await assert.rejects(db.query('select * from private.agent_actions'));
  await db.exec('reset role');
  for(let n=0;n<30;n++) assert.equal((await one('select public.consume_agent_action_limit($1) as allowed',[owner])).allowed,true);
  assert.equal((await one('select public.consume_agent_action_limit($1) as allowed',[owner])).allowed,false);
});
