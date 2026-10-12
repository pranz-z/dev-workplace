-- Phase 3B is additive. Existing date-only deadlines and deployed migrations are unchanged.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create unique index projects_time_block_owner_key on public.projects(id,user_id);
create unique index tasks_time_block_relationship_key on public.tasks(id,user_id,project_id);
create table public.workspace_time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid, task_id uuid,
  title text not null check (length(btrim(title)) between 1 and 180 and title=btrim(title)),
  start_at timestamptz not null, end_at timestamptz not null,
  kind text not null default 'focus' check (kind in ('focus','task','break','custom')),
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  notes text check (length(notes)<=4000),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check (isfinite(start_at) and isfinite(end_at) and start_at<end_at and end_at-start_at<=interval '12 hours'),
  check (task_id is null or project_id is not null),
  foreign key (project_id,user_id) references public.projects(id,user_id),
  foreign key (task_id,user_id,project_id) references public.tasks(id,user_id,project_id) on delete set null (task_id),
  constraint workspace_time_blocks_no_overlap exclude using gist (user_id extensions.gist_uuid_ops with =,tstzrange(start_at,end_at,'[)') with &&) where (status <> 'cancelled')
);
create index workspace_time_blocks_user_start_idx on public.workspace_time_blocks(user_id,start_at);
create index workspace_time_blocks_user_end_idx on public.workspace_time_blocks(user_id,end_at);
create index workspace_time_blocks_project_idx on public.workspace_time_blocks(user_id,project_id,start_at);
create index workspace_time_blocks_task_idx on public.workspace_time_blocks(user_id,task_id,start_at);
create index workspace_time_blocks_status_idx on public.workspace_time_blocks(user_id,status,start_at);
create table public.workspace_scheduling_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workday_start time not null,workday_end time not null,
  weekdays integer[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]),
  focus_minutes integer not null check (focus_minutes between 1 and 180),
  buffer_minutes integer not null check (buffer_minutes between 0 and 120),
  updated_at timestamptz not null default clock_timestamp(),
  check (workday_start<workday_end and workday_end<'24:00'::time)
);
create function private.stamp_time_block() returns trigger language plpgsql set search_path='' as $$
begin
  if new.user_id is distinct from old.user_id then raise exception 'Owner is immutable' using errcode='42501';end if;
  new.updated_at=clock_timestamp();return new;
end;$$;
-- Preserve historical blocks when an existing workspace entity is deleted.
create function private.unlink_project_time_blocks() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.workspace_time_blocks set project_id=null,task_id=null where project_id=old.id and user_id=old.user_id;
 return old;
end;$$;
revoke all on function private.unlink_project_time_blocks() from public,anon,authenticated;
create trigger unlink_project_time_blocks before delete on public.projects for each row execute function private.unlink_project_time_blocks();
create trigger stamp_time_block before update on public.workspace_time_blocks for each row execute function private.stamp_time_block();
create trigger stamp_scheduling_preferences before update on public.workspace_scheduling_preferences for each row execute function private.stamp_time_block();
alter table public.workspace_time_blocks enable row level security;
alter table public.workspace_scheduling_preferences enable row level security;
create policy time_blocks_select on public.workspace_time_blocks for select to authenticated using (user_id=(select auth.uid()));
create policy time_blocks_insert on public.workspace_time_blocks for insert to authenticated with check (user_id=(select auth.uid()));
create policy time_blocks_update on public.workspace_time_blocks for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy scheduling_preferences_select on public.workspace_scheduling_preferences for select to authenticated using (user_id=(select auth.uid()));
create policy scheduling_preferences_insert on public.workspace_scheduling_preferences for insert to authenticated with check (user_id=(select auth.uid()));
create policy scheduling_preferences_update on public.workspace_scheduling_preferences for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
revoke all on public.workspace_time_blocks,public.workspace_scheduling_preferences from public,anon,authenticated;
grant select,insert,update on public.workspace_time_blocks,public.workspace_scheduling_preferences to authenticated;
grant select,insert,update on public.workspace_time_blocks,public.workspace_scheduling_preferences to service_role;

alter table private.agent_actions alter column project_id drop not null;
alter table private.agent_actions drop constraint agent_actions_action_type_check;
alter table private.agent_actions add constraint agent_actions_action_type_check check (action_type in ('create_task','update_task','reschedule_milestone','reschedule_project','create_time_block','update_time_block','cancel_time_block'));
alter table private.agent_actions drop constraint agent_actions_check;
alter table private.agent_actions add constraint agent_actions_check check (
  (action_type in ('create_task','update_task','reschedule_milestone','reschedule_project') and project_id is not null or action_type in ('create_time_block','update_time_block','cancel_time_block')) and
  ((action_type in ('create_task','create_time_block') and expected_updated_at is null) or
   (action_type in ('update_task','reschedule_milestone','reschedule_project','update_time_block','cancel_time_block') and entity_id is not null and expected_updated_at is not null))
);
alter table private.agent_actions drop constraint agent_actions_diff_check;
alter table private.agent_actions add constraint agent_actions_diff_check check (jsonb_typeof(diff)='array' and jsonb_array_length(diff) between 1 and 10 and octet_length(diff::text)<=80000);
create unique index agent_actions_one_time_block_idx on private.agent_actions(run_id,entity_id) where action_type in ('update_time_block','cancel_time_block');
create function private.agent_time_block_patch_valid(p jsonb,creating boolean) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;
begin
 if p is null or jsonb_typeof(p)<>'object' or p='{}'::jsonb then return false;end if;
 if creating and not (p ?& array['title','startAt','endAt','kind','status','projectId','taskId']) then return false;end if;
 for k,v in select * from jsonb_each(p) loop
  if k not in ('title','startAt','endAt','projectId','taskId','kind','status') then return false;end if;
  if k='title' and (jsonb_typeof(v)<>'string' or length(btrim(p->>k)) not between 1 and 180 or p->>k<>btrim(p->>k)) then return false;end if;
  if k in ('startAt','endAt') and (jsonb_typeof(v)<>'string' or p->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' or not isfinite((p->>k)::timestamptz)) then return false;end if;
  if k in ('projectId','taskId') and v<>'null'::jsonb and (jsonb_typeof(v)<>'string' or p->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then return false;end if;
  if k='kind' and (jsonb_typeof(v)<>'string' or p->>k not in ('focus','task','break','custom')) then return false;end if;
  if k='status' and (jsonb_typeof(v)<>'string' or p->>k not in ('scheduled','completed','cancelled')) then return false;end if;
 end loop;
 if p ?& array['startAt','endAt'] and not ((p->>'startAt')::timestamptz<(p->>'endAt')::timestamptz and (p->>'endAt')::timestamptz-(p->>'startAt')::timestamptz<=interval '12 hours') then return false;end if;
 return true;
exception when others then return false;end;$$;

create or replace function public.save_agent_proposal_batch(p_user_id uuid,p_actions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_run_id uuid;a jsonb;v_project_id uuid;v_entity_id uuid;v_task_id uuid;
begin
 if p_user_id is null or jsonb_typeof(p_actions) is distinct from 'array' or jsonb_array_length(p_actions) not between 1 and 10 then raise exception 'Invalid proposals' using errcode='22023';end if;
 insert into private.agent_runs(user_id) values(p_user_id) returning id into v_run_id;
 for a in select value from jsonb_array_elements(p_actions) loop
  v_project_id=(a->>'projectId')::uuid;v_entity_id=(a->>'entityId')::uuid;
  if a->>'type' in ('create_time_block','update_time_block','cancel_time_block') then
   if not private.agent_time_block_patch_valid(a->'payload',a->>'type'='create_time_block') or (a->>'type'='cancel_time_block' and a->'payload'<>'{"status":"cancelled"}'::jsonb) then raise exception 'Invalid time block proposal' using errcode='22023';end if;
   if a->>'type'<>'create_time_block' and not exists(select 1 from public.workspace_time_blocks b where b.id=v_entity_id and b.user_id=p_user_id) then raise exception 'Unavailable block' using errcode='42501';end if;
   v_project_id=case when a->'payload' ? 'projectId' then (a->'payload'->>'projectId')::uuid else v_project_id end;
   v_task_id=(a->'payload'->>'taskId')::uuid;
   if v_task_id is not null and not exists(select 1 from public.tasks t where t.id=v_task_id and t.user_id=p_user_id and t.project_id=v_project_id) then raise exception 'Unavailable task' using errcode='42501';end if;
  elsif a->>'type' in ('reschedule_milestone','reschedule_project') then
   if not private.agent_schedule_patch_valid(a->'payload') then raise exception 'Invalid date proposal' using errcode='22023';end if;
   if a->>'type'='reschedule_project' and v_entity_id is distinct from v_project_id then raise exception 'Unavailable project' using errcode='42501';end if;
   if a->>'type'='reschedule_milestone' and not exists(select 1 from public.milestones m where m.id=v_entity_id and m.project_id=v_project_id) then raise exception 'Unavailable milestone' using errcode='42501';end if;
  elsif a->>'type' in ('create_task','update_task') then
   if not private.agent_task_patch_valid(a->'payload',a->>'type'='create_task') then raise exception 'Invalid task proposal' using errcode='22023';end if;
   v_entity_id=(a->>'taskId')::uuid;
   if a->>'type'='update_task' and not exists(select 1 from public.tasks t where t.id=v_entity_id and t.user_id=p_user_id and t.project_id=v_project_id) then raise exception 'Unavailable task' using errcode='42501';end if;
   if a->'payload'->>'milestoneId' is not null and not exists(select 1 from public.milestones m where m.id=(a->'payload'->>'milestoneId')::uuid and m.project_id=v_project_id) then raise exception 'Unavailable milestone' using errcode='42501';end if;
  else raise exception 'Invalid proposal' using errcode='22023';end if;
  if (v_project_id is not null and not exists(select 1 from public.projects p where p.id=v_project_id and p.user_id=p_user_id)) or (v_project_id is null and a->>'type' not in ('create_time_block','update_time_block','cancel_time_block')) then raise exception 'Unavailable project' using errcode='42501';end if;
  insert into private.agent_actions(id,run_id,user_id,action_type,entity_id,project_id,title,payload,before_state,expected_updated_at,diff) values((a->>'id')::uuid,v_run_id,p_user_id,a->>'type',v_entity_id,v_project_id,a->>'title',a->'payload',a->'before',(a->>'expectedUpdatedAt')::timestamptz,a->'diff');
 end loop;
 return private.agent_batch(v_run_id,p_user_id);
end;$$;

create function public.apply_agent_time_block_action(p_user_id uuid,p_run_id uuid,p_action_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.agent_actions%rowtype;b public.workspace_time_blocks%rowtype;p jsonb;v_id uuid;code text;
begin
 select * into a from private.agent_actions where id=p_action_id and run_id=p_run_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('id',p_action_id,'status','failed','errorCode','FORBIDDEN');end if;
 if a.status<>'pending' then return jsonb_build_object('id',a.id,'status',a.status,'entityId',a.entity_id,'errorCode',a.error_code);end if;
 begin
  p=a.payload;
  if a.action_type not in ('create_time_block','update_time_block','cancel_time_block') or not private.agent_time_block_patch_valid(p,a.action_type='create_time_block') then raise exception 'Invalid block action' using errcode='22023';end if;
  if a.action_type='cancel_time_block' and p<>'{"status":"cancelled"}'::jsonb then raise exception 'Invalid cancellation' using errcode='22023';end if;
  if a.action_type<>'create_time_block' then
   select * into b from public.workspace_time_blocks where id=a.entity_id and user_id=p_user_id for update;
   if not found then raise exception 'Unavailable block' using errcode='42501';end if;
   if b.updated_at is distinct from a.expected_updated_at then
    update private.agent_actions set status='conflict',approved_at=now(),error_code='STALE_ENTITY' where id=a.id;
   else
    update public.workspace_time_blocks set
     title=case when p ? 'title' then p->>'title' else b.title end,
     start_at=case when p ? 'startAt' then (p->>'startAt')::timestamptz else b.start_at end,
     end_at=case when p ? 'endAt' then (p->>'endAt')::timestamptz else b.end_at end,
     project_id=case when p ? 'projectId' then (p->>'projectId')::uuid else b.project_id end,
     task_id=case when p ? 'taskId' then (p->>'taskId')::uuid else b.task_id end,
     kind=case when p ? 'kind' then p->>'kind' else b.kind end,
     status=case when p ? 'status' then p->>'status' else b.status end
    where id=b.id and user_id=p_user_id returning id into v_id;
    update private.agent_actions set status='applied',approved_at=now(),executed_at=now() where id=a.id;
   end if;
  else
   insert into public.workspace_time_blocks(user_id,title,start_at,end_at,project_id,task_id,kind,status)
   values(p_user_id,p->>'title',(p->>'startAt')::timestamptz,(p->>'endAt')::timestamptz,(p->>'projectId')::uuid,(p->>'taskId')::uuid,p->>'kind',p->>'status') returning id into v_id;
   update private.agent_actions set entity_id=v_id,status='applied',approved_at=now(),executed_at=now() where id=a.id;
  end if;
 exception when others then
  code=case when sqlstate='23P01' then 'TIME_BLOCK_OVERLAP' when sqlstate in ('42501','23503') then 'FORBIDDEN' when sqlstate in ('22023','23514','22007','22008') then 'INVALID_INPUT' else 'TIME_BLOCK_SAVE_FAILED' end;
  update private.agent_actions set status=case when code='TIME_BLOCK_OVERLAP' then 'conflict' else 'failed' end,approved_at=now(),error_code=code where id=a.id;
 end;
 if not exists(select 1 from private.agent_actions where run_id=p_run_id and status='pending') then update private.agent_runs set completed_at=now() where id=p_run_id;end if;
 select * into a from private.agent_actions where id=p_action_id;
 return jsonb_build_object('id',a.id,'status',a.status,'entityId',a.entity_id,'errorCode',a.error_code);
end;$$;
-- Creation actions acquire their entity ID only on successful application.
alter table private.agent_actions drop constraint agent_actions_check;
alter table private.agent_actions add constraint agent_actions_check check (
 (project_id is not null or action_type in ('create_time_block','update_time_block','cancel_time_block')) and
 ((action_type in ('create_task','create_time_block') and expected_updated_at is null) or
 (action_type in ('update_task','reschedule_milestone','reschedule_project','update_time_block','cancel_time_block') and entity_id is not null and expected_updated_at is not null)));
revoke all on function private.stamp_time_block(),private.agent_time_block_patch_valid(jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.apply_agent_time_block_action(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_agent_time_block_action(uuid,uuid,uuid) to service_role;
