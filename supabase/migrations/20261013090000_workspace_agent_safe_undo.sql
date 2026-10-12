alter table private.agent_actions add column undo_of_action_id uuid;
alter table private.agent_actions add constraint agent_actions_id_owner_key unique(id,user_id);
alter table private.agent_actions add constraint agent_actions_undo_owner_fkey foreign key(undo_of_action_id,user_id) references private.agent_actions(id,user_id) on delete restrict;
alter table private.agent_actions add constraint agent_actions_undo_not_self_check check(undo_of_action_id is null or undo_of_action_id<>id);
create unique index agent_actions_one_live_inverse_idx on private.agent_actions(undo_of_action_id) where undo_of_action_id is not null and status in ('pending','applied');
-- Phase 4B: deterministic inverse proposals. Applied migration history is immutable.
create function private.agent_undo_reason(p_code text) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('state',case p_code when 'AVAILABLE' then 'available' when 'PENDING_INVERSE' then 'available' when 'ALREADY_REVERSED' then 'already_reversed' when 'ENTITY_MISSING' then 'entity_missing' when 'STATE_CHANGED' then 'state_changed' when 'UNSUPPORTED_ACTION' then 'unsupported' when 'NOT_APPLIED' then 'unsupported' else 'unsafe' end,
 'reason',p_code,'explanation',left(case p_code
 when 'AVAILABLE' then 'A reversal can be prepared for review. Nothing has changed yet.'
 when 'PENDING_INVERSE' then 'An undo proposal already awaits your review.'
 when 'ALREADY_REVERSED' then 'A direct undo action has already been applied.'
 when 'ENTITY_MISSING' then 'The original workspace item is no longer available.'
 when 'STATE_CHANGED' then 'The affected values have changed since this action.'
 when 'UNSUPPORTED_ACTION' then 'Safe reversal is not supported for this action.'
 when 'NOT_APPLIED' then 'Only applied actions can be reversed.'
 when 'LINK_UNAVAILABLE' then 'A required workspace relationship is no longer available.'
 when 'SLOT_PAST' then 'Restoration requires a future time slot.'
 when 'SLOT_OCCUPIED' then 'The original time slot is occupied.'
 else 'The saved history is incomplete or cannot be reversed safely.' end,240));
$$;

create function private.agent_undo_value(p_field text,p_value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
begin
 if p_field in ('startAt','endAt') and p_value<>'null'::jsonb then
  return to_jsonb(extract(epoch from (p_value #>> '{}')::timestamptz));
 end if;
 if p_field in ('milestoneId','projectId','taskId') and p_value<>'null'::jsonb then return to_jsonb((p_value #>> '{}')::uuid);end if;
 return p_value;
end;$$;

create function private.agent_undo_evaluate(p_user_id uuid,p_run_id uuid,p_action_id uuid,p_now timestamptz,p_selected_inverse_id uuid default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare a private.agent_actions%rowtype;cur jsonb;old jsonb;after_values jsonb;inv jsonb='{}';changes jsonb='[]';k text;v jsonb;d jsonb;linked private.agent_actions%rowtype;version timestamptz;context_id uuid;candidate_type text;label text;resulting jsonb;start_time timestamptz;end_time timestamptz;current_project uuid;current_task uuid;affected text[]='{}';zone text;
begin
 select * into a from private.agent_actions where id=p_action_id and run_id=p_run_id and user_id=p_user_id;
 if not found then return null;end if;
 if a.status<>'applied' then return jsonb_build_object('eligibility',private.agent_undo_reason('NOT_APPLIED'));end if;
 if a.action_type not in ('update_task','reschedule_milestone','reschedule_project','create_time_block','update_time_block','cancel_time_block') then return jsonb_build_object('eligibility',private.agent_undo_reason('UNSUPPORTED_ACTION'));end if;
 select * into linked from private.agent_actions i where i.undo_of_action_id=a.id and i.user_id=p_user_id and i.status in ('pending','applied') and i.id is distinct from p_selected_inverse_id;
 if found then return jsonb_build_object('eligibility',private.agent_undo_reason(case when linked.status='applied' then 'ALREADY_REVERSED' else 'PENDING_INVERSE' end)||jsonb_build_object('existingInverse',jsonb_build_object('runId',linked.run_id,'actionId',linked.id,'createdAt',linked.created_at,'status',linked.status)));end if;
 candidate_type=a.action_type;old=a.before_state;
 if a.action_type='update_task' then
  select jsonb_build_object('title',t.title,'description',coalesce(t.description,''),'status',t.status,'priority',t.priority,
   'dueDate',case when t.due_date is null then null when (t.due_date at time zone 'UTC')::time='00:00:00' then to_char(t.due_date at time zone 'UTC','YYYY-MM-DD') else to_char(t.due_date at time zone coalesce((select p.time_zone from public.profiles p where p.id=p_user_id),'UTC'),'YYYY-MM-DD') end,'milestoneId',t.milestone_id),t.updated_at,t.project_id,t.title into cur,version,context_id,label
   from public.tasks t where t.id=a.entity_id and t.user_id=p_user_id;
 elsif a.action_type='reschedule_project' then
  select jsonb_build_object('targetDate',p.target_date),p.updated_at,p.id,p.title into cur,version,context_id,label from public.projects p where p.id=a.entity_id and p.user_id=p_user_id;
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
 return jsonb_build_object('eligibility',private.agent_undo_reason('AVAILABLE')||jsonb_build_object('inverseSummary',left('Undo: '||coalesce(label,'Workspace item'),180)),
 'candidate',jsonb_build_object('type',candidate_type,'entityId',a.entity_id,'taskId',case when candidate_type='update_task' then a.entity_id end,'projectId',context_id,'title',left(coalesce(label,'Workspace item'),180),'payload',inv,'before',cur,'expectedUpdatedAt',version,'diff',changes,'status','pending'));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value or check_violation then
 return jsonb_build_object('eligibility',private.agent_undo_reason('HISTORY_INCOMPLETE'));
end;$$;

create function private.agent_undo_project(p_result jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select case when p_result is null then null else jsonb_build_object('state',p_result->'eligibility'->'state','reason',p_result->'eligibility'->'reason','explanation',left(p_result->'eligibility'->>'explanation',240))
 || case when p_result->'eligibility' ? 'inverseSummary' then jsonb_build_object('inverseSummary',left(p_result->'eligibility'->>'inverseSummary',180)) else '{}'::jsonb end || case when p_result->'eligibility' ? 'existingInverse' then jsonb_build_object('existingInverse',p_result->'eligibility'->'existingInverse') else '{}'::jsonb end end;
$$;
revoke all on function private.agent_undo_reason(text),private.agent_undo_value(text,jsonb),private.agent_undo_evaluate(uuid,uuid,uuid,timestamptz,uuid),private.agent_undo_project(jsonb) from public,anon,authenticated,service_role;

-- Caller already holds source then any inverse action locks. Each discovery attempt
-- is a subtransaction: changed relationships release only context locks before retry.
create function private.agent_undo_lock_context(p_user_id uuid,p_source_id uuid) returns void
language plpgsql set search_path='' as $$
declare a private.agent_actions%rowtype;discovered jsonb;verified jsonb;ids uuid[];attempt integer;
begin
 select * into a from private.agent_actions where id=p_source_id and user_id=p_user_id;
 for attempt in 1..3 loop
  begin
   if a.action_type like '%time_block' then
    select jsonb_build_object('projectId',b.project_id,'taskId',b.task_id) into discovered from public.workspace_time_blocks b where b.id=a.entity_id and b.user_id=p_user_id;
   elsif a.action_type='update_task' then
    select jsonb_build_object('projectId',t.project_id,'milestoneId',t.milestone_id) into discovered from public.tasks t where t.id=a.entity_id and t.user_id=p_user_id;
   elsif a.action_type='reschedule_milestone' then
    select jsonb_build_object('projectId',m.project_id) into discovered from public.milestones m where m.id=a.entity_id;
   else discovered=jsonb_build_object('projectId',a.project_id);end if;
   ids=array[a.project_id,(discovered->>'projectId')::uuid,(a.before_state->>'projectId')::uuid,(a.payload->>'projectId')::uuid];
   if a.action_type='reschedule_project' then
    perform p.id from public.projects p where p.id=a.entity_id and p.user_id=p_user_id for update;
   else perform p.id from public.projects p where p.id=any(ids) and p.user_id=p_user_id order by p.id for share;end if;
   ids=array[(discovered->>'milestoneId')::uuid,(a.before_state->>'milestoneId')::uuid,(a.payload->>'milestoneId')::uuid];
   if a.action_type='reschedule_milestone' then
    perform m.id from public.milestones m where m.id=a.entity_id order by m.id for update;
   else perform m.id from public.milestones m where m.id=any(ids) order by m.id for share;end if;
   ids=array[(discovered->>'taskId')::uuid,(a.before_state->>'taskId')::uuid,(a.payload->>'taskId')::uuid];
   perform t.id from public.tasks t where t.id=any(ids) and t.user_id=p_user_id order by t.id for share;
   if a.action_type='update_task' then
    select jsonb_build_object('projectId',t.project_id,'milestoneId',t.milestone_id) into verified from public.tasks t where t.id=a.entity_id and t.user_id=p_user_id for update;
   elsif a.action_type like '%time_block' then
    select jsonb_build_object('projectId',b.project_id,'taskId',b.task_id) into verified from public.workspace_time_blocks b where b.id=a.entity_id and b.user_id=p_user_id for update;
   elsif a.action_type='reschedule_milestone' then
    select jsonb_build_object('projectId',m.project_id) into verified from public.milestones m where m.id=a.entity_id;
   else verified=discovered;end if;
   if verified is distinct from discovered then raise exception 'Retry context discovery' using errcode='40001';end if;
   return;
  exception when serialization_failure then if attempt=3 then raise;end if;
  end;
 end loop;
end;$$;
revoke all on function private.agent_undo_lock_context(uuid,uuid) from public,anon,authenticated,service_role;

create function public.prepare_agent_undo(p_user_id uuid,p_run_id uuid,p_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.agent_actions%rowtype;linked private.agent_actions%rowtype;r jsonb;b jsonb;draft jsonb;new_id uuid;constraint_name text;
begin
 select * into a from private.agent_actions where id=p_action_id and run_id=p_run_id and user_id=p_user_id for update;
 if not found then return null;end if;
 select * into linked from private.agent_actions where undo_of_action_id=a.id and user_id=p_user_id and status in ('pending','applied') for update;
 if found then
  r=private.agent_undo_evaluate(p_user_id,p_run_id,p_action_id,clock_timestamp(),null);
  return jsonb_build_object('eligibility',private.agent_undo_project(r))||case when linked.status='pending' then jsonb_build_object('proposalBatch',private.agent_batch(linked.run_id,p_user_id)) else '{}'::jsonb end;
 end if;
 -- Unsupported history never needs context locking/casts.
 r=private.agent_undo_evaluate(p_user_id,p_run_id,p_action_id,clock_timestamp(),null);
 if r->'eligibility'->>'state'<>'available' then return jsonb_build_object('eligibility',private.agent_undo_project(r));end if;
 perform private.agent_undo_lock_context(p_user_id,a.id);
 r=private.agent_undo_evaluate(p_user_id,p_run_id,p_action_id,clock_timestamp(),null);
 if r->'eligibility'->>'state'<>'available' then return jsonb_build_object('eligibility',private.agent_undo_project(r));end if;
 begin
  new_id=gen_random_uuid();draft=r->'candidate'||jsonb_build_object('id',new_id);
  b=public.save_agent_proposal_batch(p_user_id,jsonb_build_array(draft));
  update private.agent_actions set undo_of_action_id=a.id where id=new_id and user_id=p_user_id;
  return jsonb_build_object('eligibility',private.agent_undo_project(r),'proposalBatch',private.agent_batch((b->>'runId')::uuid,p_user_id));
 exception when unique_violation then
  get stacked diagnostics constraint_name=constraint_name;
  if constraint_name<>'agent_actions_one_live_inverse_idx' then raise;end if;
 end;
 -- The exception subtransaction rolled back both new records before recovery.
 select * into linked from private.agent_actions where undo_of_action_id=a.id and user_id=p_user_id and status in ('pending','applied') for update;
 if not found then raise exception 'Retry canonical recovery' using errcode='40001';end if;
 r=private.agent_undo_evaluate(p_user_id,p_run_id,p_action_id,clock_timestamp(),null);
 return jsonb_build_object('eligibility',private.agent_undo_project(r))||case when linked.status='pending' then jsonb_build_object('proposalBatch',private.agent_batch(linked.run_id,p_user_id)) else '{}'::jsonb end;
end;$$;
revoke all on function public.prepare_agent_undo(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_agent_undo(uuid,uuid,uuid) to service_role;

create function public.apply_agent_inverse_action(p_user_id uuid,p_run_id uuid,p_action_id uuid) returns jsonb
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
 if a.action_type like '%time_block' then return public.apply_agent_time_block_action(p_user_id,p_run_id,p_action_id);
 elsif a.action_type like 'reschedule_%' then return public.apply_agent_schedule_action(p_user_id,p_run_id,p_action_id);
 else return public.apply_agent_task_action(p_user_id,p_run_id,p_action_id);end if;
end;$$;
revoke all on function public.apply_agent_inverse_action(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_agent_inverse_action(uuid,uuid,uuid) to service_role;

create function private.agent_undo_reference(p_user_id uuid,p_action_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('runId',a.run_id,'actionId',a.id,'createdAt',a.created_at) from private.agent_actions a where a.id=p_action_id and a.user_id=p_user_id;
$$;
revoke all on function private.agent_undo_reference(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_agent_undo_eligibility(p_user_id uuid,p_run_id uuid,p_action_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select private.agent_undo_project(private.agent_undo_evaluate(p_user_id,p_run_id,p_action_id,statement_timestamp(),null));
$$;
revoke all on function public.get_agent_undo_eligibility(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_agent_undo_eligibility(uuid,uuid,uuid) to service_role;
create or replace function private.agent_activity_run(p_user_id uuid,p_run_id uuid,p_detail boolean default false)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'createdAt',r.created_at,'completedAt',r.completed_at,
 'actionCount',(select count(*) from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id),
 'primaryEntityLabel',(select a.title from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id order by a.created_at,a.id limit 1),
 'counts',(select jsonb_build_object('pending',count(*) filter(where a.status='pending'),'applied',count(*) filter(where a.status='applied'),'cancelled',count(*) filter(where a.status='cancelled'),'conflict',count(*) filter(where a.status='conflict'),'failed',count(*) filter(where a.status='failed')) from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id))
 || case when p_detail then jsonb_build_object('actions',coalesce((select jsonb_agg(jsonb_build_object(
 'id',a.id,'runId',a.run_id,'actionType',a.action_type,'entityId',a.entity_id,'projectId',a.project_id,
 'title',a.title,'status',a.status,'createdAt',a.created_at,'approvedAt',a.approved_at,'executedAt',a.executed_at,
 'errorCode',case when a.error_code in ('STALE_ENTITY','TIME_BLOCK_OVERLAP','FORBIDDEN','INVALID_INPUT','TIME_BLOCK_SAVE_FAILED','TASK_SAVE_FAILED') then a.error_code else null end,
 'undo',private.agent_undo_project(private.agent_undo_evaluate(p_user_id,a.run_id,a.id,statement_timestamp(),null)),
 'undoOf',private.agent_undo_reference(p_user_id,a.undo_of_action_id),
 'reversedBy',(select private.agent_undo_reference(p_user_id,i.id) from private.agent_actions i where i.undo_of_action_id=a.id and i.user_id=p_user_id and i.status='applied'),
 'diff',coalesce((select jsonb_agg(jsonb_build_object('field',d->>'field',
 'before',case when jsonb_typeof(d->'before')='string' then left(d->>'before',4000) end,
 'after',case when jsonb_typeof(d->'after')='string' then left(d->>'after',4000) end))
 from jsonb_array_elements(a.diff) d where d->>'field' in ('title','description','priority','status','dueDate','milestoneId','targetDate','startAt','endAt','projectId','taskId','kind')),'[]'::jsonb)
 ) order by a.created_at,a.id) from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id),'[]'::jsonb)) else '{}'::jsonb end
 from private.agent_runs r where r.id=p_run_id and r.user_id=p_user_id;
$$;
revoke all on function private.agent_activity_run(uuid,uuid,boolean) from public,anon,authenticated,service_role;


create or replace function private.agent_batch(p_run_id uuid, p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('runId', r.id, 'actions', coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'type',a.action_type,'taskId',case when a.action_type in ('create_task','update_task') then a.entity_id end,'entityId',a.entity_id,'projectId',a.project_id,'title',a.title,
      'payload',a.payload,'before',a.before_state,'expectedUpdatedAt',a.expected_updated_at,'diff',a.diff,'status',a.status,'undoOf',private.agent_undo_reference(p_user_id,a.undo_of_action_id)) order by a.created_at,a.id)
    from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id
  ),'[]'::jsonb)) from private.agent_runs r where r.id=p_run_id and r.user_id=p_user_id;
$$;
