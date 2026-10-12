import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const root=new URL('../../../',import.meta.url);
const migration=new URL('supabase/migrations/20261012090000_workspace_agent_activity.sql',root);
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
test('activity migration provides only narrow read functions without table grants or retention',()=>{
 assert.ok(existsSync(migration));const sql=readFileSync(migration,'utf8');
 assert.doesNotMatch(sql,/create table|alter table|insert into|update private|delete from|grant select|request_text/i);
 assert.match(sql,/grant execute.*service_role/is);assert.match(sql,/set search_path\s*=\s*''/i);
});
test('activity database: private grants, owner isolation, mixed counts, cursor ties and safe historical details',{skip:!process.env.AGENT_TEST_PGLITE_MODULE},async t=>{
 assert.ok(existsSync(migration));
 const {PGlite}=await import(pathToFileURL(process.env.AGENT_TEST_PGLITE_MODULE).href);const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create table auth.users(id uuid primary key);create table public.projects(id uuid primary key,user_id uuid);
 create table public.tasks(id uuid primary key,user_id uuid,project_id uuid,title text,description text,status text,priority text,due_date date,milestone_id uuid,sort_order int,completed_at timestamptz,updated_at timestamptz);
 insert into auth.users values('${owner}'),('${other}');`);
 await db.exec(readFileSync(new URL('supabase/migrations/20261008152535_workspace_agent_task_proposals.sql',root),'utf8'));
 await db.exec(readFileSync(migration,'utf8'));
 const ids=['33333333-3333-4333-8333-333333333331','33333333-3333-4333-8333-333333333332','33333333-3333-4333-8333-333333333333'];
 for(const [i,id] of ids.entries())await db.query(`insert into private.agent_runs(id,user_id,created_at) values($1,$2,'2026-10-12T09:00Z')`,[id,i===2?other:owner]);
 for(const status of ['pending','applied','cancelled','conflict','failed'])await db.query(`insert into private.agent_actions(id,run_id,user_id,action_type,project_id,title,payload,before_state,diff,status,error_code) values(gen_random_uuid(),$1,$2,'create_task',gen_random_uuid(),'Task','{"title":"Task","secret":"HIDDEN"}','{}','[{"field":"title","before":null,"after":"Task"},{"field":"secret","after":"HIDDEN"}]',$3,'RAW_SECRET')`,[ids[1],owner,status]);
 const list=async(user=owner,limit=20,cursor=null,status=null,from=null,to=null)=>(await db.query('select public.list_agent_activity($1,$2,$3,$4,$5,$6,$7) result',[user,limit,cursor?.createdAt??null,cursor?.id??null,status,from,to])).rows[0].result;
 const first=await list(owner,1);assert.equal(first.items.length,1);assert.equal(first.items[0].id,ids[1]);assert.ok(first.nextCursor);assert.equal(first.items[0].counts.applied,1);assert.equal(first.items[0].counts.pending,1);assert.equal(first.items[0].actionCount,5);
 const next=await list(owner,1,first.nextCursor);assert.equal(next.items[0].id,ids[0]);assert.equal(next.nextCursor,null);
 assert.deepEqual((await list(owner,20,null,'conflict')).items.map(r=>r.id),[ids[1]]);
 assert.equal((await list(owner,20,null,null,'2026-10-13T00:00Z',null)).items.length,0);
 assert.equal((await list(other)).items.length,1);assert.equal((await list(owner,20,null,null,null,'2026-10-12T09:00Z')).items.length,0);
 const detail=async(user,id)=>(await db.query('select public.get_agent_activity_run($1,$2) result',[user,id])).rows[0].result;
 assert.equal(await detail(other,ids[1]),null);const run=await detail(owner,ids[1]);assert.equal(run.actions.length,5);assert.ok(run.actions[0].createdAt);assert.doesNotMatch(JSON.stringify(run),/HIDDEN|RAW_SECRET|payload|before_state/);
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(list());await assert.rejects(detail(owner,ids[1]));await db.exec('reset role');}
 await db.exec('set role service_role');assert.equal((await list()).items.length,2);await assert.rejects(db.exec('select * from private.agent_runs'));await assert.rejects(db.exec('update private.agent_actions set title=title'));await db.exec('reset role');
 await assert.rejects(list(owner,31));await assert.rejects(list(owner,0));await assert.rejects(list(owner,20,null,'bad'));
 const before=(await db.query('select count(*)::int n from private.agent_actions')).rows[0].n;await list();await detail(owner,ids[1]);assert.equal((await db.query('select count(*)::int n from private.agent_actions')).rows[0].n,before);
});
