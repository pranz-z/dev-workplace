import {fixture as base,root} from './phase5b-fixture.mjs';
import {readFileSync,readdirSync} from 'node:fs';
export async function fixture(t,{includePhase5c=true}={}){
 const f=await base(t),read=n=>readFileSync(new URL('supabase/migrations/'+n,root),'utf8');
 const baseline=read('20260930120000_phase1.sql'),policies=read('20260930140000_phase2b.sql');
 const extract=(s,re)=>{const found=s.match(re)?.[0];if(!found)throw new Error('Plan baseline definition missing');return found;};
 for(const table of ['plans','project_plan_items']){await f.db.exec(extract(baseline,new RegExp('create table if not exists public\\.'+table+' \\([\\s\\S]*?\\n\\);')));await f.db.exec(extract(baseline,new RegExp('create trigger '+table+'_set_updated_at[\\s\\S]*?;')));}
 await f.db.exec(extract(policies,/create or replace function private\.owns_plan\(p_plan_id uuid\)[\s\S]*?\$\$;/));
 await f.db.exec('revoke all on function private.owns_plan(uuid) from public;grant execute on function private.owns_plan(uuid) to authenticated;alter table public.plans enable row level security;alter table public.project_plan_items enable row level security;grant select,insert,update,delete on public.plans,public.project_plan_items to authenticated;');
 for(const name of ['own plans','own project plan items'])await f.db.exec(extract(policies,new RegExp('create policy "'+name+'"[\\s\\S]*?;')));
 for(const name of ['plans_user_id_idx','project_plan_items_plan_id_idx','project_plan_items_project_id_idx'])await f.db.exec(extract(policies,new RegExp('create index if not exists '+name+'[^;]*;')));
 const plan='66666666-6666-4666-8666-666666666666',foreignPlan='77777777-7777-4777-8777-777777777777';
 await f.db.query("insert into public.plans(id,user_id,title,description,timeframe) values($1,$2,'Plan','Before',null),($3,$4,'Foreign','',null)",[plan,f.owner,foreignPlan,f.other]);
 if(includePhase5c){const files=readdirSync(new URL('supabase/migrations/',root)).filter(n=>n.endsWith('_workspace_agent_plans.sql'));if(files.length!==1)throw new Error('Exactly one Phase5C migration required');await f.db.exec(read(files[0]));}
 const version=async()=>(await f.one('select updated_at::text v from public.plans where id=$1',[plan])).v;
 return {...f,plan,foreignPlan,version};
}
export async function draft(f,patch,type='update_plan'){
 const row=await f.one('select title,description,timeframe,status,target_date::text as "targetDate",updated_at::text as version from public.plans where id=$1',[f.plan]),creating=type==='create_plan';
 return {id:crypto.randomUUID(),type,entityId:creating?null:f.plan,taskId:null,projectId:null,title:creating?patch.title:row.title,payload:patch,before:creating?{}:Object.fromEntries(Object.keys(patch).map(k=>[k,row[k]])),expectedUpdatedAt:creating?null:row.version,diff:Object.entries(patch).map(([field,after])=>({field,before:creating?null:row[field],after}))};
}
export async function save(f,a){return (await f.one('select public.save_agent_proposal_batch($1,$2) r',[f.owner,JSON.stringify([a])])).r;}
export async function apply(f,b,inverse=false){return (await f.one(`select public.${inverse?'apply_agent_inverse_action':'apply_agent_plan_action'}($1,$2,$3) r`,[f.owner,b.runId,b.actions[0].id])).r;}
