import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
export const root=new URL('../../../',import.meta.url);
export const migration='20261013090000_workspace_agent_safe_undo.sql';
export const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',project='33333333-3333-4333-8333-333333333333',task='44444444-4444-4444-8444-444444444444',milestone='55555555-5555-4555-8555-555555555555';
export async function fixture(t){
 const mod=process.env.AGENT_TEST_PGLITE_MODULE;
 const {PGlite}=await import(pathToFileURL(mod).href);
 const {btree_gist}=await import(pathToFileURL(mod.replace(/index\.js$/,'contrib/btree_gist.js')).href);
 const db=new PGlite({extensions:{btree_gist}});t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key);
 create table public.profiles(id uuid primary key,time_zone text);
 create table public.projects(id uuid primary key,user_id uuid references auth.users(id),title text default 'Project',target_date date,updated_at timestamptz default clock_timestamp());
 create table public.milestones(id uuid primary key,project_id uuid references public.projects(id),title text default 'Milestone',target_date date,updated_at timestamptz default clock_timestamp());
 create table public.tasks(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),project_id uuid references public.projects(id),milestone_id uuid,title text,description text,status text,priority text,due_date timestamptz,sort_order int,completed_at timestamptz,updated_at timestamptz default clock_timestamp());
 insert into auth.users values('${owner}'),('${other}');insert into public.profiles values('${owner}','Asia/Manila');
 insert into public.projects(id,user_id) values('${project}','${owner}'),('${other}','${other}');
 insert into public.milestones(id,project_id) values('${milestone}','${project}');
 insert into public.tasks(id,user_id,project_id,title,description,status,priority) values('${task}','${owner}','${project}','After','After description','Completed','High');
 create function public.test_stamp() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end;$$;
 create trigger test_stamp before update on public.tasks for each row execute function public.test_stamp();`);
 for(const name of ['20261008152535_workspace_agent_task_proposals.sql','20261008231753_workspace_agent_date_scheduling.sql','20261011090000_workspace_agent_time_blocks.sql','20261012090000_workspace_agent_activity.sql'])await db.exec(readFileSync(new URL('supabase/migrations/'+name,root),'utf8'));
 // Feature absence should produce assertion failures, not missing-file bootstrap errors.
 const {existsSync}=await import('node:fs');if(existsSync(new URL('supabase/migrations/'+migration,root)))await db.exec(readFileSync(new URL('supabase/migrations/'+migration,root),'utf8'));
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 async function source(type='update_task',before={title:'Before'},payload={title:'After'},entityId=task,projectId=project){
  const runId=randomUUID(),id=randomUUID();
  const diff=Object.keys(payload).filter(k=>JSON.stringify(before[k])!==JSON.stringify(payload[k])).map(field=>({field,before:before[field]??null,after:payload[field]}));
  await db.query('insert into private.agent_runs(id,user_id) values($1,$2)',[runId,owner]);
  await db.query(`insert into private.agent_actions(id,run_id,user_id,action_type,entity_id,project_id,title,before_state,payload,diff,expected_updated_at,status,executed_at) values($1,$2,$3,$4,$5,$6,'Source',$7,$8,$9,case when $4 like 'create_%' then null else clock_timestamp() end,'applied',clock_timestamp())`,[id,runId,owner,type,entityId,projectId,JSON.stringify(before),JSON.stringify(payload),JSON.stringify(diff.length?diff:[{field:'title',before:null,after:'Source'}])]);return {runId,id};
 }
 const evaluate=async s=>{
  const exists=await one(`select to_regprocedure('private.agent_undo_evaluate(uuid,uuid,uuid,timestamptz,uuid)') is not null found`);
  if(!exists.found)return {eligibility:{state:'missing_feature'}};
  return (await one('select private.agent_undo_evaluate($1,$2,$3,clock_timestamp(),null) r',[owner,s.runId,s.id])).r;
 };
 const prepare=async s=>(await one('select public.prepare_agent_undo($1,$2,$3) r',[owner,s.runId,s.id])).r;
 const apply=async b=>(await one('select public.apply_agent_inverse_action($1,$2,$3) r',[owner,b.runId,b.actions[0].id])).r;
 return {db,one,source,evaluate,prepare,apply};
}
