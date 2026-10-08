import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";
const phase2=readFileSync(new URL("../../../supabase/migrations/20261008152535_workspace_agent_task_proposals.sql",import.meta.url),"utf8");
const migration=readFileSync(new URL("../../../supabase/migrations/20261008231753_workspace_agent_date_scheduling.sql",import.meta.url),"utf8");
const owner="11111111-1111-4111-8111-111111111111", other="22222222-2222-4222-8222-222222222222", project="33333333-3333-4333-8333-333333333333", milestone="44444444-4444-4444-8444-444444444444", task="55555555-5555-4555-8555-555555555555";
test("Phase 3A migration contains only narrow static date mutations and service RPC",()=>{
  assert.doesNotMatch(migration,/execute format|delete from|create table|grant .* to authenticated/i);
  assert.match(migration,/update public.projects set target_date=/);assert.match(migration,/update public.milestones set target_date=/);
  assert.match(migration,/v_updated_at is distinct from a.expected_updated_at/);
});
test("disposable PostgreSQL: Phase 2 preservation and complete date-action safety",{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async context=>{
  const {PGlite}=await import(pathToFileURL(process.env.AGENT_TEST_PGLITE_MODULE).href);const db=new PGlite();context.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
    create table auth.users(id uuid primary key);
    create table public.projects(id uuid primary key,user_id uuid references auth.users(id),title text default 'Project',target_date date,updated_at timestamptz not null default clock_timestamp(),status text default 'In Progress');
    create table public.milestones(id uuid primary key,project_id uuid references public.projects(id),title text default 'Milestone',target_date date,updated_at timestamptz not null default clock_timestamp(),status text default 'active');
    create table public.tasks(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),project_id uuid references public.projects(id),milestone_id uuid references public.milestones(id),title text not null,description text default '',status text default 'Backlog',priority text default 'Medium',due_date date,sort_order integer default 0,updated_at timestamptz not null default clock_timestamp(),completed_at timestamptz);
    create function private.stamp() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end;$$;
    create trigger stamp before update on public.projects for each row execute function private.stamp();
    create trigger stamp before update on public.milestones for each row execute function private.stamp();
    create trigger stamp before update on public.tasks for each row execute function private.stamp();
    insert into auth.users values('${owner}'),('${other}');
    insert into public.projects(id,user_id) values('${project}','${owner}'),('${other}','${other}');
    insert into public.milestones(id,project_id) values('${milestone}','${project}'),('${other}','${other}');
    insert into public.tasks(id,user_id,project_id,title) values('${task}','${owner}','${project}','Task');`);
  await db.exec(phase2);
  const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
  let counter=0;
  const row=async entity=>{const r=await one(`select * from public.${entity==='project'?'projects':entity==='milestone'?'milestones':'tasks'} where id=$1`,[entity==='project'?project:entity==='milestone'?milestone:task]);if(r.target_date instanceof Date)r.target_date=r.target_date.toISOString().slice(0,10);return r;};
  async function draft(entity,date="2026-10-20") {
    const current=await row(entity);return {id:`66666666-6666-4666-8666-${String(++counter).padStart(12,'0')}`,type:entity==='task'?'update_task':`reschedule_${entity}`,entityId:current.id,taskId:entity==='task'?current.id:null,projectId:project,title:current.title,payload:entity==='task'?{dueDate:date}:{targetDate:date},before:entity==='task'?{dueDate:current.due_date}:{targetDate:current.target_date},expectedUpdatedAt:current.updated_at,diff:[{field:entity==='task'?'dueDate':'targetDate',before:null,after:date}]};
  }
  const save=async actions=>(await one('select public.save_agent_proposal_batch($1,$2::jsonb) as b',[owner,JSON.stringify(actions)])).b;
  const apply=async(batch,index=0,user=owner)=>(await one(`select public.${batch.actions[index].type.startsWith('reschedule_')?'apply_agent_schedule_action':'apply_agent_task_action'}($1,$2,$3) as r`,[user,batch.runId,batch.actions[index].id])).r;
  const cancel=batch=>one('select public.cancel_agent_task_actions($1,$2,$3::uuid[])',[owner,batch.runId,batch.actions.map(a=>a.id)]);
  const oldPending=await save([await draft('task')]);
  const oldApplied=await save([await draft('task','2026-10-19')]);await apply(oldApplied);
  const oldCancelled=await save([await draft('task')]);await cancel(oldCancelled);
  await db.exec(migration);
  assert.equal((await one('select status from private.agent_actions where id=$1',[oldApplied.actions[0].id])).status,'applied');
  assert.equal((await apply(oldCancelled)).status,'cancelled');
  assert.equal((await apply(oldPending)).status,'conflict');
  const legacy=await save([await draft('task')]);assert.equal((await apply(legacy)).status,'applied');
  for(const entity of ['milestone','project']) {
    const before=await row(entity);let batch=await save([await draft(entity)]);
    assert.equal((await row(entity)).target_date,before.target_date);
    assert.equal((await apply(batch,0,other)).errorCode,'FORBIDDEN');
    assert.equal((await one('select public.get_agent_proposal_batch($1,$2) as b',[other,batch.runId])).b,null);
    assert.equal((await apply(batch)).status,'applied');assert.equal((await row(entity)).target_date,'2026-10-20');
    assert.equal((await row(entity)).title,before.title);assert.equal((await row(entity)).status,before.status);
    const version=(await row(entity)).updated_at;await apply(batch);assert.equal(String((await row(entity)).updated_at),String(version));
    batch=await save([await draft(entity,null)]);assert.equal((await apply(batch)).status,'applied');assert.equal((await row(entity)).target_date,null);
    batch=await save([await draft(entity)]);await db.query(`update public.${entity==='project'?'projects':'milestones'} set target_date='2026-10-25' where id=$1`,[entity==='project'?project:milestone]);
    assert.equal((await apply(batch)).status,'conflict');assert.equal((await row(entity)).target_date,'2026-10-25');
    batch=await save([await draft(entity)]);await cancel(batch);assert.equal((await apply(batch)).status,'cancelled');
    for(const payload of [{targetDate:'tomorrow'},{targetDate:'2026-02-30'},{targetDate:'2026-10-12',title:'Injected'},{},{targetDate:42}]) {const a=await draft(entity);a.payload=payload;await assert.rejects(save([a]));}
    const foreign=await draft(entity);foreign.entityId=other;if(entity==='project')foreign.projectId=other;await assert.rejects(save([foreign]));
    batch=await save([await draft(entity)]);await db.query('update public.projects set user_id=$1 where id=$2',[other,project]);assert.equal((await apply(batch)).errorCode,'FORBIDDEN');await db.query('update public.projects set user_id=$1 where id=$2',[owner,project]);
  }
  // All three entity types in one batch retain independent outcomes.
  const mixed=await save([await draft('task'),await draft('milestone'),await draft('project')]);
  await db.query('update public.milestones set title=title where id=$1',[milestone]);
  await db.query("update private.agent_actions set payload='{\"targetDate\":\"2026-10-30\",\"status\":\"Completed\"}'::jsonb where id=$1",[mixed.actions.find(a=>a.type==='reschedule_project').id]);
  const outcomes=[];for(let i=0;i<mixed.actions.length;i++)outcomes.push((await apply(mixed,i)).status);assert.deepEqual(outcomes.sort(),['applied','conflict','failed']);
  // Audit failure rolls back the entity mutation inside the action subtransaction.
  const atomic=await save([await draft('milestone','2026-11-01')]);const unchanged=(await row('milestone')).target_date;
  await db.exec(`create function private.fail_audit() returns trigger language plpgsql as $$begin if new.status='applied' then raise exception 'audit failure';end if;return new;end;$$;create trigger fail_audit before update on private.agent_actions for each row execute function private.fail_audit();`);
  assert.equal((await apply(atomic)).status,'failed');assert.equal((await row('milestone')).target_date,unchanged);await db.exec('drop trigger fail_audit on private.agent_actions');
  const invalid=await draft('project');invalid.type='delete_project';await assert.rejects(save([invalid]));
  for(const role of ['anon','authenticated']) {
    const permissions=await one("select has_function_privilege($1,'public.apply_agent_schedule_action(uuid,uuid,uuid)','EXECUTE') as rpc,has_table_privilege($1,'private.agent_actions','SELECT') as tbl",[role]);assert.equal(permissions.rpc,false);assert.equal(permissions.tbl,false);
    await db.exec(`set role ${role}`);await assert.rejects(db.query('select * from private.agent_actions'));await assert.rejects(db.query('select public.apply_agent_schedule_action($1,$2,$3)',[owner,atomic.runId,atomic.actions[0].id]));await db.exec('reset role');
  }
  assert.equal((await one("select has_function_privilege('service_role','public.apply_agent_schedule_action(uuid,uuid,uuid)','EXECUTE') as ok")).ok,true);
  assert.equal((await one("select has_table_privilege('service_role','private.agent_actions','SELECT') as ok")).ok,false);
});
