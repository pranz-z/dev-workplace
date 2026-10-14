-- Phase 5C: user-owned Plan record proposals. No Plan/item schema or RLS changes.
create function private.agent_plan_patch_valid(p jsonb,creating boolean)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;trim_chars text=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
begin
 if p is null or jsonb_typeof(p)<>'object' or p='{}'::jsonb then return false;end if;
 if creating and not(p ?& array['title','description','timeframe','status','targetDate']) then return false;end if;
 for k,v in select * from jsonb_each(p) loop
  if k not in ('title','description','timeframe','status','targetDate') then return false;end if;
  if k='title' and (jsonb_typeof(v)<>'string' or char_length(p->>k) not between 1 and 180 or p->>k is distinct from btrim(p->>k,trim_chars)) then return false;end if;
  if k='description' and (jsonb_typeof(v)<>'string' or char_length(p->>k)>4000) then return false;end if;
  if k='timeframe' and v<>'null'::jsonb and (jsonb_typeof(v)<>'string' or char_length(p->>k)>180 or p->>k is distinct from btrim(p->>k,trim_chars)) then return false;end if;
  if k='status' and (jsonb_typeof(v)<>'string' or p->>k not in ('Planning','Active','Paused','Completed','Cancelled')) then return false;end if;
  if k='targetDate' and private.agent_schedule_patch_valid(jsonb_build_object(k,v)) is not true then return false;end if;
 end loop;
 return true;
exception when others then return false;end;$$;

create function private.agent_apply_plan_patch(p_user_id uuid,p_plan_id uuid,p_patch jsonb,p_expected_updated_at timestamptz)
returns boolean language plpgsql set search_path='' as $$
declare version timestamptz;current_values jsonb;
begin
 if p_expected_updated_at is null or private.agent_plan_patch_valid(p_patch,false) is not true then raise exception 'Invalid Plan patch' using errcode='22023';end if;
 select updated_at,jsonb_build_object('title',title,'description',description,'timeframe',timeframe,'status',status,'targetDate',target_date) into version,current_values from public.plans where id=p_plan_id and user_id=p_user_id for update;
 if not found then raise exception 'Unavailable Plan' using errcode='42501';end if;
 if version is distinct from p_expected_updated_at then return false;end if;
 if not exists(select 1 from jsonb_each(p_patch) e where current_values->e.key is distinct from e.value) then raise exception 'No Plan change' using errcode='22023';end if;
 update public.plans set title=case when p_patch ? 'title' then p_patch->>'title' else title end,
 description=case when p_patch ? 'description' then p_patch->>'description' else description end,
 timeframe=case when p_patch ? 'timeframe' then p_patch->>'timeframe' else timeframe end,
 status=case when p_patch ? 'status' then p_patch->>'status' else status end,
 target_date=case when p_patch ? 'targetDate' then (p_patch->>'targetDate')::date else target_date end where id=p_plan_id and user_id=p_user_id;
 return true;
end;$$;
revoke all on function private.agent_plan_patch_valid(jsonb,boolean),private.agent_apply_plan_patch(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;

create function public.apply_agent_plan_action(p_user_id uuid,p_run_id uuid,p_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.agent_actions%rowtype;code text;v_id uuid;resulting public.plans%rowtype;
begin
 select * into a from private.agent_actions where id=p_action_id and run_id=p_run_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('id',p_action_id,'status','failed','errorCode','FORBIDDEN');end if;
 if a.status<>'pending' then return jsonb_build_object('id',a.id,'status',a.status,'entityId',a.entity_id,'errorCode',a.error_code);end if;
 begin
  if a.action_type not in ('create_plan','update_plan') or a.project_id is not null or private.agent_plan_patch_valid(a.payload,a.action_type='create_plan') is not true then raise exception 'Invalid Plan action' using errcode='22023';end if;
  if a.action_type='create_plan' then
   if a.expected_updated_at is not null or a.entity_id is not null then raise exception 'Invalid creation' using errcode='22023';end if;
   insert into public.plans(user_id,title,description,timeframe,status,target_date) values(p_user_id,a.payload->>'title',a.payload->>'description',a.payload->>'timeframe',a.payload->>'status',(a.payload->>'targetDate')::date) returning * into resulting;
   v_id=resulting.id;
   update private.agent_actions set entity_id=v_id,status='applied',approved_at=now(),executed_at=now() where id=a.id;
  elsif private.agent_apply_plan_patch(p_user_id,a.entity_id,a.payload,a.expected_updated_at) then
   select * into resulting from public.plans where id=a.entity_id and user_id=p_user_id;
   update private.agent_actions set status='applied',approved_at=now(),executed_at=now() where id=a.id;
  else update private.agent_actions set status='conflict',approved_at=now(),error_code='STALE_ENTITY' where id=a.id;end if;
 exception when others then
  code=case when sqlstate='42501' then 'FORBIDDEN' when sqlstate='22023' then 'INVALID_INPUT' else 'PLAN_SAVE_FAILED' end;
  update private.agent_actions set status='failed',approved_at=now(),error_code=code where id=a.id;
 end;
 if not exists(select 1 from private.agent_actions where run_id=p_run_id and status='pending') then update private.agent_runs set completed_at=now() where id=p_run_id;end if;
 select * into a from private.agent_actions where id=p_action_id;
 return jsonb_build_object('id',a.id,'status',a.status,'entityId',a.entity_id,'errorCode',a.error_code);
end;$$;
revoke all on function public.apply_agent_plan_action(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_agent_plan_action(uuid,uuid,uuid) to service_role;

alter table private.agent_actions drop constraint agent_actions_action_type_check;
alter table private.agent_actions add constraint agent_actions_action_type_check check(action_type in ('create_task','update_task','reschedule_milestone','reschedule_project','create_time_block','update_time_block','cancel_time_block','create_milestone','update_milestone','create_plan','update_plan'));
alter table private.agent_actions drop constraint agent_actions_check;
alter table private.agent_actions add constraint agent_actions_check check (
 (project_id is not null or action_type in ('create_time_block','update_time_block','cancel_time_block','create_plan','update_plan')) and
 (action_type not in ('create_plan','update_plan') or project_id is null) and
 ((action_type in ('create_task','create_time_block','create_milestone','create_plan') and expected_updated_at is null) or
 (action_type in ('update_task','reschedule_milestone','reschedule_project','update_time_block','cancel_time_block','update_milestone','update_plan') and entity_id is not null and expected_updated_at is not null)) and
 (action_type not in ('create_milestone','create_plan') or entity_id is null or status='applied'));
do $$begin
 if exists(select 1 from private.agent_actions where action_type='update_plan' and entity_id is not null group by run_id,entity_id having count(*)>1) then raise exception 'Plan history uniqueness preflight failed';end if;
end;$$;
create unique index agent_actions_one_plan_target_idx on private.agent_actions(run_id,entity_id) where action_type='update_plan';

create or replace function public.save_agent_proposal_batch(p_user_id uuid,p_actions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_run_id uuid;a jsonb;v_project_id uuid;v_entity_id uuid;v_task_id uuid;v_current jsonb;k text;v jsonb;creating boolean;
begin
 if p_user_id is null or jsonb_typeof(p_actions) is distinct from 'array' or jsonb_array_length(p_actions) not between 1 and 10 then raise exception 'Invalid proposals' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_actions) x where x->>'type' in ('create_milestone','update_milestone')) and jsonb_array_length(p_actions)<>1 then raise exception 'One milestone action required' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_actions) x where x->>'type' in ('create_plan','update_plan')) and jsonb_array_length(p_actions)<>1 then raise exception 'One Plan action required' using errcode='22023';end if;
 insert into private.agent_runs(user_id) values(p_user_id) returning id into v_run_id;
 for a in select value from jsonb_array_elements(p_actions) loop
  v_project_id=(a->>'projectId')::uuid;v_entity_id=(a->>'entityId')::uuid;
  if a->>'type' in ('create_plan','update_plan') then
   creating=a->>'type'='create_plan';
   if v_project_id is not null or a->>'taskId' is not null or a->>'undoOf' is not null or a ? 'undo_of_action_id' or private.agent_plan_patch_valid(a->'payload',creating) is not true or jsonb_typeof(a->'before') is distinct from 'object' or jsonb_typeof(a->'diff') is distinct from 'array' then raise exception 'Invalid Plan proposal' using errcode='22023';end if;
   if jsonb_array_length(a->'diff')<>(select count(*) from jsonb_object_keys(a->'payload')) then raise exception 'Invalid Plan diff' using errcode='22023';end if;
   if creating then
    if v_entity_id is not null or a->>'expectedUpdatedAt' is not null or a->'before'<>'{}'::jsonb then raise exception 'Invalid Plan creation' using errcode='22023';end if;
   else
    if v_entity_id is null or a->>'expectedUpdatedAt' is null or (select count(*) from jsonb_object_keys(a->'before'))<>(select count(*) from jsonb_object_keys(a->'payload')) then raise exception 'Invalid Plan history' using errcode='22023';end if;
    select jsonb_build_object('title',p.title,'description',p.description,'timeframe',p.timeframe,'status',p.status,'targetDate',p.target_date) into v_current from public.plans p where p.id=v_entity_id and p.user_id=p_user_id and p.updated_at=(a->>'expectedUpdatedAt')::timestamptz;
    if not found then raise exception 'Unavailable Plan' using errcode='42501';end if;
   end if;
   for k,v in select * from jsonb_each(a->'payload') loop
    if not creating and (not(a->'before' ? k) or a->'before'->k is distinct from v_current->k or v is not distinct from a->'before'->k or private.agent_plan_patch_valid(jsonb_build_object(k,a->'before'->k),false) is not true) then raise exception 'Invalid Plan history' using errcode='22023';end if;
    if (select count(*) from jsonb_array_elements(a->'diff') d where d->>'field'=k and d->'after' is not distinct from v and d->'before' is not distinct from case when creating then 'null'::jsonb else a->'before'->k end)<>1 then raise exception 'Invalid Plan diff' using errcode='22023';end if;
   end loop;
  elsif a->>'type' in ('create_milestone','update_milestone') then
   creating=a->>'type'='create_milestone';
   if private.agent_milestone_patch_valid(a->'payload',creating) is not true or jsonb_typeof(a->'before') is distinct from 'object' or jsonb_typeof(a->'diff') is distinct from 'array' or a->>'taskId' is not null then raise exception 'Invalid milestone proposal' using errcode='22023';end if;
   if jsonb_array_length(a->'diff')<>(select count(*) from jsonb_object_keys(a->'payload')) then raise exception 'Invalid milestone diff' using errcode='22023';end if;
   if creating then
    if v_entity_id is not null or a->>'expectedUpdatedAt' is not null or a->'before'<>'{}'::jsonb then raise exception 'Invalid milestone creation' using errcode='22023';end if;
   else
    if v_entity_id is null or a->>'expectedUpdatedAt' is null or a->'before'->>'projectId' is distinct from v_project_id::text or (select count(*) from jsonb_object_keys(a->'before'))<>(select count(*)+1 from jsonb_object_keys(a->'payload')) then raise exception 'Invalid milestone history' using errcode='22023';end if;
    select jsonb_build_object('title',m.title,'description',m.description,'status',m.status,'targetDate',m.target_date) into v_current from public.milestones m join public.projects p on p.id=m.project_id where m.id=v_entity_id and m.project_id=v_project_id and p.user_id=p_user_id and m.updated_at=(a->>'expectedUpdatedAt')::timestamptz;
    if not found then raise exception 'Unavailable milestone' using errcode='42501';end if;
   end if;
   for k,v in select * from jsonb_each(a->'payload') loop
    if not creating and (not (a->'before' ? k) or a->'before'->k is distinct from v_current->k or v is not distinct from a->'before'->k or private.agent_milestone_patch_valid(jsonb_build_object(k,a->'before'->k),false) is not true) then raise exception 'Invalid affected history' using errcode='22023';end if;
    if (select count(*) from jsonb_array_elements(a->'diff') d where d->>'field'=k and d->'after' is not distinct from v and d->'before' is not distinct from case when creating then 'null'::jsonb else a->'before'->k end)<>1 then raise exception 'Invalid milestone diff' using errcode='22023';end if;
   end loop;
  elsif a->>'type' in ('create_time_block','update_time_block','cancel_time_block') then
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
  if (v_project_id is not null and not exists(select 1 from public.projects p where p.id=v_project_id and p.user_id=p_user_id)) or (v_project_id is null and a->>'type' not in ('create_time_block','update_time_block','cancel_time_block','create_plan','update_plan')) then raise exception 'Unavailable project' using errcode='42501';end if;
  insert into private.agent_actions(id,run_id,user_id,action_type,entity_id,project_id,title,payload,before_state,expected_updated_at,diff) values((a->>'id')::uuid,v_run_id,p_user_id,a->>'type',v_entity_id,v_project_id,a->>'title',a->'payload',a->'before',(a->>'expectedUpdatedAt')::timestamptz,a->'diff');
 end loop;
 return private.agent_batch(v_run_id,p_user_id);
end;$$;
revoke all on function public.save_agent_proposal_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_agent_proposal_batch(uuid,jsonb) to service_role;

create or replace function private.agent_undo_evaluate(p_user_id uuid,p_run_id uuid,p_action_id uuid,p_now timestamptz,p_selected_inverse_id uuid default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare a private.agent_actions%rowtype;cur jsonb;old jsonb;after_values jsonb;inv jsonb='{}';changes jsonb='[]';k text;v jsonb;d jsonb;linked private.agent_actions%rowtype;version timestamptz;context_id uuid;candidate_type text;label text;resulting jsonb;start_time timestamptz;end_time timestamptz;current_project uuid;current_task uuid;affected text[]='{}';zone text;
begin
 select * into a from private.agent_actions where id=p_action_id and run_id=p_run_id and user_id=p_user_id;
 if not found then return null;end if;
 if a.status<>'applied' then return jsonb_build_object('eligibility',private.agent_undo_reason('NOT_APPLIED'));end if;
 if a.action_type not in ('update_plan','update_milestone','update_task','reschedule_milestone','reschedule_project','create_time_block','update_time_block','cancel_time_block') then return jsonb_build_object('eligibility',private.agent_undo_reason('UNSUPPORTED_ACTION'));end if;
 select * into linked from private.agent_actions i where i.undo_of_action_id=a.id and i.user_id=p_user_id and i.status in ('pending','applied') and i.id is distinct from p_selected_inverse_id;
 if found then return jsonb_build_object('eligibility',private.agent_undo_reason(case when linked.status='applied' then 'ALREADY_REVERSED' else 'PENDING_INVERSE' end)||jsonb_build_object('existingInverse',jsonb_build_object('runId',linked.run_id,'actionId',linked.id,'createdAt',linked.created_at,'status',linked.status)));end if;
 candidate_type=a.action_type;old=a.before_state;
 if a.action_type='update_plan' then
  select jsonb_build_object('title',p.title,'description',p.description,'timeframe',p.timeframe,'status',p.status,'targetDate',p.target_date),p.updated_at,p.title into cur,version,label from public.plans p where p.id=a.entity_id and p.user_id=p_user_id;
  if cur is null then return jsonb_build_object('eligibility',private.agent_undo_reason('ENTITY_MISSING'));end if;
  if a.project_id is not null or private.agent_plan_patch_valid(a.payload,false) is not true or private.agent_plan_patch_valid(old,false) is not true or jsonb_typeof(a.diff) is distinct from 'array' then raise exception 'Incomplete Plan history' using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(old))<>(select count(*) from jsonb_object_keys(a.payload)) or jsonb_array_length(a.diff)<>(select count(*) from jsonb_object_keys(a.payload)) then raise exception 'Incomplete Plan history' using errcode='22023';end if;
  for k,v in select * from jsonb_each(a.payload) loop
   if not(old ? k) or old->k is not distinct from v then raise exception 'Incomplete Plan history' using errcode='22023';end if;
   if (select count(*) from jsonb_array_elements(a.diff) hist(value) where hist.value->>'field'=k and hist.value ?& array['before','after'] and hist.value->'before' is not distinct from old->k and hist.value->'after' is not distinct from v)<>1 then raise exception 'Incomplete Plan diff' using errcode='22023';end if;
   if cur->k is distinct from v then return jsonb_build_object('eligibility',private.agent_undo_reason('STATE_CHANGED'));end if;
   inv=inv||jsonb_build_object(k,old->k);changes=changes||jsonb_build_array(jsonb_build_object('field',k,'before',cur->k,'after',old->k));
  end loop;
  select jsonb_object_agg(e.key,e.value) into cur from jsonb_each(cur) e where inv ? e.key;
  return jsonb_build_object('eligibility',private.agent_undo_reason('AVAILABLE')||jsonb_build_object('inverseSummary',left('Undo: '||label,180)),
   'candidate',jsonb_build_object('type','update_plan','entityId',a.entity_id,'taskId',null,'projectId',null,'title',left(label,180),'payload',inv,'before',cur,'expectedUpdatedAt',version,'diff',changes,'status','pending'));
 end if;
 if a.action_type='update_task' then
  select jsonb_build_object('title',t.title,'description',coalesce(t.description,''),'status',t.status,'priority',t.priority,
   'dueDate',case when t.due_date is null then null when (t.due_date at time zone 'UTC')::time='00:00:00' then to_char(t.due_date at time zone 'UTC','YYYY-MM-DD') else to_char(t.due_date at time zone coalesce((select p.time_zone from public.profiles p where p.id=p_user_id),'UTC'),'YYYY-MM-DD') end,'milestoneId',t.milestone_id),t.updated_at,t.project_id,t.title into cur,version,context_id,label
   from public.tasks t where t.id=a.entity_id and t.user_id=p_user_id;
 elsif a.action_type='reschedule_project' then
  select jsonb_build_object('targetDate',p.target_date),p.updated_at,p.id,p.title into cur,version,context_id,label from public.projects p where p.id=a.entity_id and p.user_id=p_user_id;
 elsif a.action_type='update_milestone' then
  select jsonb_build_object('title',m.title,'description',m.description,'status',m.status,'targetDate',m.target_date),m.updated_at,m.project_id,m.title into cur,version,context_id,label from public.milestones m join public.projects p on p.id=m.project_id and p.user_id=p_user_id where m.id=a.entity_id;
 elsif a.action_type='reschedule_milestone' then
  select jsonb_build_object('targetDate',m.target_date),m.updated_at,m.project_id,m.title into cur,version,context_id,label from public.milestones m join public.projects p on p.id=m.project_id and p.user_id=p_user_id where m.id=a.entity_id;
 else
  select jsonb_build_object('title',b.title,'startAt',b.start_at,'endAt',b.end_at,'projectId',b.project_id,'taskId',b.task_id,'kind',b.kind,'status',b.status),b.updated_at,b.project_id,b.title into cur,version,context_id,label from public.workspace_time_blocks b where b.id=a.entity_id and b.user_id=p_user_id;
 end if;
 if cur is null then return jsonb_build_object('eligibility',private.agent_undo_reason('ENTITY_MISSING'));end if;
 -- Canonical project_id records the resulting context, including a historical move.
 if context_id is distinct from a.project_id then return jsonb_build_object('eligibility',private.agent_undo_reason('STATE_CHANGED'));end if;
 if context_id is not null and not exists(select 1 from public.projects p where p.id=context_id and p.user_id=p_user_id) then return jsonb_build_object('eligibility',private.agent_undo_reason('LINK_UNAVAILABLE'));end if;
 if jsonb_typeof(old)<>'object' or jsonb_typeof(a.payload)<>'object' or jsonb_typeof(a.diff)<>'array' then raise exception 'Incomplete history' using errcode='22023';end if;
 if a.action_type='create_time_block' then
  if not private.agent_time_block_patch_valid(a.payload,true) or not a.payload ?& array['title','startAt','endAt','projectId','taskId','kind','status'] then raise exception 'Incomplete history' using errcode='22023';end if;
  for k,v in select * from jsonb_each(a.payload) loop
   if private.agent_undo_value(k,cur->k) is distinct from private.agent_undo_value(k,v) then return jsonb_build_object('eligibility',private.agent_undo_reason('STATE_CHANGED'));end if;
  end loop;
  if cur->>'status'<>'scheduled' or exists(select 1 from public.workspace_time_blocks b where b.id=a.entity_id and coalesce(b.notes,'')<>'') then return jsonb_build_object('eligibility',private.agent_undo_reason('STATE_CHANGED'));end if;
  inv='{"status":"cancelled"}';candidate_type='cancel_time_block';affected=array['status'];
 else
  for k,v in select * from jsonb_each(a.payload) loop
   if not old ? k then raise exception 'Missing historical key' using errcode='22023';end if;
   if k in ('title','description') and (length(old->>k)>=case when k='title' then 180 else 4000 end or right(old->>k,1)='…' or length(v #>> '{}')>=case when k='title' then 180 else 4000 end or right(v #>> '{}',1)='…') then raise exception 'Truncated history' using errcode='22023';end if;
   if private.agent_undo_value(k,old->k) is distinct from private.agent_undo_value(k,v) then
    affected=array_append(affected,k);
    if private.agent_undo_value(k,cur->k) is distinct from private.agent_undo_value(k,v) then return jsonb_build_object('eligibility',private.agent_undo_reason('STATE_CHANGED'));end if;
    inv=inv||jsonb_build_object(k,old->k);
   end if;
  end loop;
  if inv='{}' then raise exception 'No inverse' using errcode='22023';end if;
  if jsonb_array_length(a.diff)<>cardinality(affected) then raise exception 'Incomplete diff' using errcode='22023';end if;
  for k in select unnest(affected) loop
   if (select count(*) from jsonb_array_elements(a.diff) x where x->>'field'=k)<>1 then raise exception 'Missing diff field' using errcode='22023';end if;
   select x into d from jsonb_array_elements(a.diff) x where x->>'field'=k;
   if not d ?& array['before','after'] then raise exception 'Missing diff value' using errcode='22023';end if;
   if k<>'milestoneId' and (private.agent_undo_value(k,d->'before') is distinct from private.agent_undo_value(k,old->k) or private.agent_undo_value(k,d->'after') is distinct from private.agent_undo_value(k,a.payload->k)) then raise exception 'Inconsistent diff' using errcode='22023';end if;
  end loop;
  if a.action_type='cancel_time_block' then
   if a.payload<>'{"status":"cancelled"}'::jsonb or old->>'status'<>'scheduled' or not old ?& array['title','startAt','endAt','projectId','taskId','kind','status'] then raise exception 'Incomplete cancellation' using errcode='22023';end if;
   candidate_type='update_time_block';after_values=old||a.payload;
   for k,v in select * from jsonb_each(after_values) loop
    if private.agent_undo_value(k,cur->k) is distinct from private.agent_undo_value(k,v) then return jsonb_build_object('eligibility',private.agent_undo_reason('STATE_CHANGED'));end if;
   end loop;
  end if;
 end if;
 if candidate_type='update_task' then
  if not private.agent_task_patch_valid(inv,false) or not private.agent_task_patch_valid(a.payload,false) then raise exception 'Invalid history' using errcode='22023';end if;
  if inv->>'milestoneId' is not null and not exists(select 1 from public.milestones m where m.id=(inv->>'milestoneId')::uuid and m.project_id=context_id) then return jsonb_build_object('eligibility',private.agent_undo_reason('LINK_UNAVAILABLE'));end if;
 elsif candidate_type='update_milestone' then
  if old->>'projectId' is distinct from context_id::text or private.agent_milestone_patch_valid(inv,false) is not true or private.agent_milestone_patch_valid(a.payload,false) is not true then raise exception 'Invalid milestone history' using errcode='22023';end if;
 elsif candidate_type like 'reschedule_%' then
  if not private.agent_schedule_patch_valid(inv) or not private.agent_schedule_patch_valid(a.payload) then raise exception 'Invalid history' using errcode='22023';end if;
 else
  if not private.agent_time_block_patch_valid(inv,false) then raise exception 'Invalid inverse' using errcode='22023';end if;
  resulting=cur||inv;
  if not private.agent_time_block_patch_valid(resulting,true) then raise exception 'Invalid block history' using errcode='22023';end if;
  current_project=(resulting->>'projectId')::uuid;current_task=(resulting->>'taskId')::uuid;
  if (current_project is not null and not exists(select 1 from public.projects p where p.id=current_project and p.user_id=p_user_id)) or (current_task is not null and not exists(select 1 from public.tasks t where t.id=current_task and t.user_id=p_user_id and t.project_id=current_project)) then return jsonb_build_object('eligibility',private.agent_undo_reason('LINK_UNAVAILABLE'));end if;
  start_time=(resulting->>'startAt')::timestamptz;end_time=(resulting->>'endAt')::timestamptz;
  if resulting->>'status'<>'cancelled' then
   if ((resulting->>'status'='scheduled' and cur->>'status'<>'scheduled') or inv ?| array['startAt','endAt']) and start_time<=p_now then return jsonb_build_object('eligibility',private.agent_undo_reason('SLOT_PAST'));end if;
   if exists(select 1 from public.workspace_time_blocks b where b.user_id=p_user_id and b.id<>a.entity_id and b.status<>'cancelled' and b.start_at<end_time and b.end_at>start_time) then return jsonb_build_object('eligibility',private.agent_undo_reason('SLOT_OCCUPIED'));end if;
  end if;
  context_id=current_project;
 end if;
 for k in select unnest(affected) loop changes=changes||jsonb_build_array(jsonb_build_object('field',k,'before',cur->k,'after',inv->k));end loop;
 -- Unrelated text may be larger than the proposal contract. Capture its ordinary
 -- excerpt only after affected-field compatibility/derivation used exact values.
 if candidate_type='update_task' then
  for k in select unnest(array['title','description']) loop
   if length(cur->>k)>(case when k='title' then 180 else 4000 end) then
    cur=jsonb_set(cur,array[k],to_jsonb(left(cur->>k,case when k='title' then 179 else 3999 end)||'…'));
   end if;
  end loop;
 end if;
 if candidate_type='update_milestone' then
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb)||jsonb_build_object('projectId',context_id) into cur from jsonb_each(cur) e where inv ? e.key;
 end if;
 return jsonb_build_object('eligibility',private.agent_undo_reason('AVAILABLE')||jsonb_build_object('inverseSummary',left('Undo: '||coalesce(label,'Workspace item'),180)),
 'candidate',jsonb_build_object('type',candidate_type,'entityId',a.entity_id,'taskId',case when candidate_type='update_task' then a.entity_id end,'projectId',context_id,'title',left(coalesce(label,'Workspace item'),180),'payload',inv,'before',cur,'expectedUpdatedAt',version,'diff',changes,'status','pending'));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value or check_violation then
 return jsonb_build_object('eligibility',private.agent_undo_reason('HISTORY_INCOMPLETE'));
end;$$;
create or replace function private.agent_undo_lock_context(p_user_id uuid,p_source_id uuid) returns void
language plpgsql set search_path='' as $$
declare a private.agent_actions%rowtype;discovered jsonb;verified jsonb;ids uuid[];attempt integer;
begin
 select * into a from private.agent_actions where id=p_source_id and user_id=p_user_id;
 if a.action_type='update_plan' then
  perform 1 from public.plans p where p.id=a.entity_id and p.user_id=p_user_id for update;
  return;
 end if;
 for attempt in 1..3 loop
  begin
   if a.action_type like '%time_block' then
    select jsonb_build_object('projectId',b.project_id,'taskId',b.task_id) into discovered from public.workspace_time_blocks b where b.id=a.entity_id and b.user_id=p_user_id;
   elsif a.action_type='update_task' then
    select jsonb_build_object('projectId',t.project_id,'milestoneId',t.milestone_id) into discovered from public.tasks t where t.id=a.entity_id and t.user_id=p_user_id;
   elsif a.action_type in ('reschedule_milestone','update_milestone') then
    select jsonb_build_object('projectId',m.project_id) into discovered from public.milestones m where m.id=a.entity_id;
   else discovered=jsonb_build_object('projectId',a.project_id);end if;
   ids=array[a.project_id,(discovered->>'projectId')::uuid,(a.before_state->>'projectId')::uuid,(a.payload->>'projectId')::uuid];
   if a.action_type='reschedule_project' then
    perform p.id from public.projects p where p.id=a.entity_id and p.user_id=p_user_id for update;
   else perform p.id from public.projects p where p.id=any(ids) and p.user_id=p_user_id order by p.id for share;end if;
   ids=array[(discovered->>'milestoneId')::uuid,(a.before_state->>'milestoneId')::uuid,(a.payload->>'milestoneId')::uuid];
   if a.action_type in ('reschedule_milestone','update_milestone') then
    perform m.id from public.milestones m where m.id=a.entity_id order by m.id for update;
   else perform m.id from public.milestones m where m.id=any(ids) order by m.id for share;end if;
   ids=array[(discovered->>'taskId')::uuid,(a.before_state->>'taskId')::uuid,(a.payload->>'taskId')::uuid];
   perform t.id from public.tasks t where t.id=any(ids) and t.user_id=p_user_id order by t.id for share;
   if a.action_type='update_task' then
    select jsonb_build_object('projectId',t.project_id,'milestoneId',t.milestone_id) into verified from public.tasks t where t.id=a.entity_id and t.user_id=p_user_id for update;
   elsif a.action_type like '%time_block' then
    select jsonb_build_object('projectId',b.project_id,'taskId',b.task_id) into verified from public.workspace_time_blocks b where b.id=a.entity_id and b.user_id=p_user_id for update;
   elsif a.action_type in ('reschedule_milestone','update_milestone') then
    select jsonb_build_object('projectId',m.project_id) into verified from public.milestones m where m.id=a.entity_id;
   else verified=discovered;end if;
   if verified is distinct from discovered then raise exception 'Retry context discovery' using errcode='40001';end if;
   return;
  exception when serialization_failure then if attempt=3 then raise;end if;
  end;
 end loop;
end;$$;
create or replace function public.apply_agent_inverse_action(p_user_id uuid,p_run_id uuid,p_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.agent_actions%rowtype;source private.agent_actions%rowtype;source_id uuid;r jsonb;c jsonb;code text;outcome text;
begin
 -- Discovery only. Never lock an inverse while waiting for its source.
 select undo_of_action_id into source_id from private.agent_actions where id=p_action_id and run_id=p_run_id and user_id=p_user_id;
 if source_id is null then return jsonb_build_object('id',p_action_id,'status','failed','errorCode','FORBIDDEN');end if;
 select * into source from private.agent_actions where id=source_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('id',p_action_id,'status','failed','errorCode','FORBIDDEN');end if;
 select * into a from private.agent_actions where id=p_action_id and run_id=p_run_id and user_id=p_user_id and undo_of_action_id=source_id for update;
 if not found then return jsonb_build_object('id',p_action_id,'status','failed','errorCode','FORBIDDEN');end if;
 if a.status<>'pending' then return jsonb_build_object('id',a.id,'status',a.status,'entityId',a.entity_id,'errorCode',a.error_code);end if;
 perform private.agent_undo_lock_context(p_user_id,source.id);
 r=private.agent_undo_evaluate(p_user_id,source.run_id,source.id,clock_timestamp(),a.id);c=r->'candidate';
 if r->'eligibility'->>'state'<>'available' then
  code=case r->'eligibility'->>'reason' when 'STATE_CHANGED' then 'STALE_ENTITY' when 'SLOT_OCCUPIED' then 'TIME_BLOCK_OVERLAP' when 'LINK_UNAVAILABLE' then 'FORBIDDEN' when 'ENTITY_MISSING' then 'FORBIDDEN' else 'INVALID_INPUT' end;
 elsif (c->>'expectedUpdatedAt')::timestamptz is distinct from a.expected_updated_at then code='STALE_ENTITY';
 elsif source.status<>'applied' or a.action_type is distinct from c->>'type' or a.entity_id is distinct from (c->>'entityId')::uuid or a.project_id is distinct from (c->>'projectId')::uuid or a.payload is distinct from c->'payload' then code='INVALID_INPUT';
 end if;
 if code is not null then
  outcome=case when code in ('STALE_ENTITY','TIME_BLOCK_OVERLAP') then 'conflict' else 'failed' end;
  update private.agent_actions set status=outcome,approved_at=clock_timestamp(),error_code=code where id=a.id;
  if not exists(select 1 from private.agent_actions where run_id=p_run_id and status='pending') then update private.agent_runs set completed_at=clock_timestamp() where id=p_run_id;end if;
  return jsonb_build_object('id',a.id,'status',outcome,'entityId',a.entity_id,'errorCode',code);
 end if;
 -- Locks and strict version are retained through the existing atomic mutation.
 if a.action_type='update_plan' then return public.apply_agent_plan_action(p_user_id,p_run_id,p_action_id);
 elsif a.action_type='update_milestone' then return public.apply_agent_milestone_action(p_user_id,p_run_id,p_action_id);
 elsif a.action_type like '%time_block' then return public.apply_agent_time_block_action(p_user_id,p_run_id,p_action_id);
 elsif a.action_type like 'reschedule_%' then return public.apply_agent_schedule_action(p_user_id,p_run_id,p_action_id);
 else return public.apply_agent_task_action(p_user_id,p_run_id,p_action_id);end if;
end;$$;
revoke all on function private.agent_undo_evaluate(uuid,uuid,uuid,timestamptz,uuid),private.agent_undo_lock_context(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.apply_agent_inverse_action(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_agent_inverse_action(uuid,uuid,uuid) to service_role;

create or replace function private.agent_activity_run(p_user_id uuid,p_run_id uuid,p_detail boolean default false)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'createdAt',r.created_at,'completedAt',r.completed_at,
 'actionCount',(select count(*) from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id),
 'primaryEntityLabel',(select a.title from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id order by a.created_at,a.id limit 1),
 'counts',(select jsonb_build_object('pending',count(*) filter(where a.status='pending'),'applied',count(*) filter(where a.status='applied'),'cancelled',count(*) filter(where a.status='cancelled'),'conflict',count(*) filter(where a.status='conflict'),'failed',count(*) filter(where a.status='failed')) from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id))
 || case when p_detail then jsonb_build_object('actions',coalesce((select jsonb_agg(jsonb_build_object(
 'id',a.id,'runId',a.run_id,'actionType',a.action_type,'entityId',a.entity_id,'projectId',a.project_id,
 'title',a.title,'status',a.status,'createdAt',a.created_at,'approvedAt',a.approved_at,'executedAt',a.executed_at,
 'errorCode',case when a.error_code in ('STALE_ENTITY','TIME_BLOCK_OVERLAP','FORBIDDEN','INVALID_INPUT','TIME_BLOCK_SAVE_FAILED','TASK_SAVE_FAILED','MILESTONE_SAVE_FAILED','PLAN_SAVE_FAILED') then a.error_code else null end,
 'undo',private.agent_undo_project(private.agent_undo_evaluate(p_user_id,a.run_id,a.id,statement_timestamp(),null)),
 'undoOf',private.agent_undo_reference(p_user_id,a.undo_of_action_id),
 'reversedBy',(select private.agent_undo_reference(p_user_id,i.id) from private.agent_actions i where i.undo_of_action_id=a.id and i.user_id=p_user_id and i.status='applied'),
 'diff',coalesce((select jsonb_agg(jsonb_build_object('field',d->>'field',
 'before',case when jsonb_typeof(d->'before')='string' then left(d->>'before',4000) end,
 'after',case when jsonb_typeof(d->'after')='string' then left(d->>'after',4000) end))
 from jsonb_array_elements(a.diff) d where d->>'field' in ('timeframe','title','description','priority','status','dueDate','milestoneId','targetDate','startAt','endAt','projectId','taskId','kind')),'[]'::jsonb)
 ) order by a.created_at,a.id) from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id),'[]'::jsonb)) else '{}'::jsonb end
 from private.agent_runs r where r.id=p_run_id and r.user_id=p_user_id;
$$;
revoke all on function private.agent_activity_run(uuid,uuid,boolean) from public,anon,authenticated,service_role;
