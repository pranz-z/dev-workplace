-- Extend the deployed Phase 2 action model without rewriting its migration.
alter table private.agent_actions drop constraint agent_actions_action_type_check;
alter table private.agent_actions add constraint agent_actions_action_type_check check (action_type in ('create_task','update_task','reschedule_milestone','reschedule_project'));
alter table private.agent_actions drop constraint agent_actions_check;
alter table private.agent_actions add constraint agent_actions_check check ((action_type in ('update_task','reschedule_milestone','reschedule_project') and entity_id is not null and expected_updated_at is not null) or (action_type='create_task' and expected_updated_at is null));
create unique index agent_actions_one_schedule_entity_idx on private.agent_actions(run_id,action_type,entity_id) where action_type in ('reschedule_milestone','reschedule_project');

create function private.agent_schedule_patch_valid(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare d text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or not (p ? 'targetDate') or (p - 'targetDate') <> '{}'::jsonb then return false; end if;
  if p->'targetDate' = 'null'::jsonb then return true; end if;
  d := p->>'targetDate';
  return jsonb_typeof(p->'targetDate')='string' and d ~ '^\d{4}-\d{2}-\d{2}$' and to_char(d::date,'YYYY-MM-DD')=d;
exception when others then return false;
end;
$$;

create or replace function private.agent_batch(p_run_id uuid, p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('runId', r.id, 'actions', coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'type',a.action_type,'taskId',case when a.action_type in ('create_task','update_task') then a.entity_id end,'entityId',a.entity_id,'projectId',a.project_id,'title',a.title,
      'payload',a.payload,'before',a.before_state,'expectedUpdatedAt',a.expected_updated_at,'diff',a.diff,'status',a.status) order by a.created_at,a.id)
    from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id
  ),'[]'::jsonb)) from private.agent_runs r where r.id=p_run_id and r.user_id=p_user_id;
$$;

create or replace function public.save_agent_proposal_batch(p_user_id uuid, p_actions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run_id uuid; a jsonb; v_project_id uuid; v_entity_id uuid;
begin
  if p_user_id is null or jsonb_typeof(p_actions) is distinct from 'array' or jsonb_array_length(p_actions) not between 1 and 10 then raise exception 'Invalid proposals' using errcode='22023'; end if;
  insert into private.agent_runs(user_id) values(p_user_id) returning id into v_run_id;
  for a in select value from jsonb_array_elements(p_actions) loop
    v_project_id := (a->>'projectId')::uuid;
    if a->>'type' in ('reschedule_milestone','reschedule_project') then
      if not private.agent_schedule_patch_valid(a->'payload') then raise exception 'Invalid date proposal' using errcode='22023'; end if;
      v_entity_id := (a->>'entityId')::uuid;
    elsif a->>'type' in ('create_task','update_task') then
      if not private.agent_task_patch_valid(a->'payload',a->>'type'='create_task') then raise exception 'Invalid task proposal' using errcode='22023'; end if;
      v_entity_id := (a->>'taskId')::uuid;
    else raise exception 'Invalid proposal' using errcode='22023'; end if;
    if not exists(select 1 from public.projects p where p.id=v_project_id and p.user_id=p_user_id) then raise exception 'Unavailable project' using errcode='42501'; end if;
    if a->>'type'='update_task' and not exists(select 1 from public.tasks t where t.id=(a->>'taskId')::uuid and t.user_id=p_user_id and t.project_id=v_project_id) then raise exception 'Unavailable task' using errcode='42501'; end if;
    if a->'payload'->>'milestoneId' is not null and not exists(select 1 from public.milestones m where m.id=(a->'payload'->>'milestoneId')::uuid and m.project_id=v_project_id) then raise exception 'Unavailable milestone' using errcode='42501'; end if;
    if a->>'type'='reschedule_project' and v_entity_id is distinct from v_project_id then raise exception 'Unavailable project' using errcode='42501'; end if;
    if a->>'type'='reschedule_milestone' and not exists(select 1 from public.milestones m where m.id=v_entity_id and m.project_id=v_project_id) then raise exception 'Unavailable milestone' using errcode='42501'; end if;
    insert into private.agent_actions(id,run_id,user_id,action_type,entity_id,project_id,title,payload,before_state,expected_updated_at,diff)
    values((a->>'id')::uuid,v_run_id,p_user_id,a->>'type',v_entity_id,v_project_id,a->>'title',a->'payload',a->'before',(a->>'expectedUpdatedAt')::timestamptz,a->'diff');
  end loop;
  return private.agent_batch(v_run_id,p_user_id);
end;
$$;

-- Each selected date action mutates exactly one target_date and its audit atomically.
create function public.apply_agent_schedule_action(p_user_id uuid,p_run_id uuid,p_action_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a private.agent_actions%rowtype; v_updated_at timestamptz; code text;
begin
  select * into a from private.agent_actions where id=p_action_id and run_id=p_run_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('id',p_action_id,'status','failed','errorCode','FORBIDDEN'); end if;
  if a.status<>'pending' then return jsonb_build_object('id',a.id,'status',a.status,'entityId',a.entity_id,'errorCode',a.error_code); end if;
  begin
    if a.action_type not in ('reschedule_milestone','reschedule_project') or not private.agent_schedule_patch_valid(a.payload) then raise exception 'Invalid date action' using errcode='22023'; end if;
    if a.action_type='reschedule_project' then
      select updated_at into v_updated_at from public.projects where id=a.entity_id and id=a.project_id and user_id=p_user_id for update;
      if not found then raise exception 'Unavailable project' using errcode='42501'; end if;
    else
      perform 1 from public.projects where id=a.project_id and user_id=p_user_id for share;
      if not found then raise exception 'Unavailable project' using errcode='42501'; end if;
      select updated_at into v_updated_at from public.milestones where id=a.entity_id and project_id=a.project_id for update;
      if not found then raise exception 'Unavailable milestone' using errcode='42501'; end if;
    end if;
    if v_updated_at is distinct from a.expected_updated_at then
      update private.agent_actions set status='conflict',approved_at=now(),error_code='STALE_ENTITY' where id=a.id;
    else
      if a.action_type='reschedule_project' then
        update public.projects set target_date=(a.payload->>'targetDate')::date where id=a.entity_id and user_id=p_user_id;
      else
        update public.milestones set target_date=(a.payload->>'targetDate')::date where id=a.entity_id and project_id=a.project_id;
      end if;
      update private.agent_actions set status='applied',approved_at=now(),executed_at=now() where id=a.id;
    end if;
  exception when others then
    code := case when sqlstate='42501' then 'FORBIDDEN' when sqlstate='22023' then 'INVALID_INPUT' else 'SCHEDULE_SAVE_FAILED' end;
    update private.agent_actions set status='failed',approved_at=now(),error_code=code where id=a.id;
  end;
  if not exists(select 1 from private.agent_actions where run_id=p_run_id and status='pending') then update private.agent_runs set completed_at=now() where id=p_run_id; end if;
  select * into a from private.agent_actions where id=p_action_id;
  return jsonb_build_object('id',a.id,'status',a.status,'entityId',a.entity_id,'errorCode',a.error_code);
end;
$$;
revoke all on function private.agent_schedule_patch_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.apply_agent_schedule_action(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_agent_schedule_action(uuid,uuid,uuid) to service_role;
