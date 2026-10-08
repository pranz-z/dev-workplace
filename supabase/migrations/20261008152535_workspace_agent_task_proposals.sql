-- Private operational proposals. No prompt text, model thoughts, or credentials.
create table private.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, user_id)
);
create table private.agent_actions (
  id uuid primary key,
  run_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (action_type in ('create_task','update_task')),
  entity_id uuid,
  project_id uuid not null,
  title text not null check (length(title) between 1 and 180),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 40000),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object' and octet_length(before_state::text) <= 40000),
  diff jsonb not null check (jsonb_typeof(diff) = 'array' and jsonb_array_length(diff) between 1 and 6 and octet_length(diff::text) <= 80000),
  expected_updated_at timestamptz,
  status text not null default 'pending' check (status in ('pending','applied','cancelled','conflict','failed')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  executed_at timestamptz,
  error_code text,
  foreign key (run_id, user_id) references private.agent_runs(id, user_id) on delete cascade,
  check ((action_type = 'update_task' and entity_id is not null and expected_updated_at is not null) or (action_type = 'create_task' and expected_updated_at is null))
);
create index agent_runs_user_created_idx on private.agent_runs(user_id, created_at desc);
create index agent_actions_run_user_idx on private.agent_actions(run_id, user_id);
create unique index agent_actions_one_task_per_run_idx on private.agent_actions(run_id, entity_id) where action_type = 'update_task';
create table private.agent_action_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null check (requests between 1 and 30)
);
alter table private.agent_runs enable row level security;
alter table private.agent_actions enable row level security;
alter table private.agent_action_limits enable row level security;
revoke all on private.agent_runs, private.agent_actions, private.agent_action_limits from public, anon, authenticated, service_role;

create function private.agent_task_patch_valid(p jsonb, creating boolean)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; d text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then return false; end if;
  if creating and not (p ? 'title') then return false; end if;
  for k,v in select * from jsonb_each(p) loop
    if k not in ('title','description','status','priority','dueDate','milestoneId') then return false; end if;
    if k = 'title' and (jsonb_typeof(v) <> 'string' or length(btrim(p->>k)) not between 1 and 180 or p->>k <> btrim(p->>k)) then return false; end if;
    if k = 'description' and (jsonb_typeof(v) <> 'string' or length(p->>k) > 4000) then return false; end if;
    if k = 'status' and (jsonb_typeof(v) <> 'string' or p->>k not in ('Backlog','Planned','In Progress','Review','Testing','Blocked','Completed')) then return false; end if;
    if k = 'priority' and (jsonb_typeof(v) <> 'string' or p->>k not in ('Low','Medium','High','Critical')) then return false; end if;
    if k = 'dueDate' and v <> 'null'::jsonb then
      d := p->>k;
      if jsonb_typeof(v) <> 'string' or d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD') <> d then return false; end if;
    end if;
    if k = 'milestoneId' and v <> 'null'::jsonb then
      if jsonb_typeof(v) <> 'string' or (p->>k) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function private.agent_batch(p_run_id uuid, p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('runId', r.id, 'actions', coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'type',a.action_type,'taskId',a.entity_id,'projectId',a.project_id,'title',a.title,
      'payload',a.payload,'before',a.before_state,'expectedUpdatedAt',a.expected_updated_at,'diff',a.diff,'status',a.status) order by a.created_at,a.id)
    from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id
  ),'[]'::jsonb)) from private.agent_runs r where r.id=p_run_id and r.user_id=p_user_id;
$$;

create function public.save_agent_proposal_batch(p_user_id uuid, p_actions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run_id uuid; a jsonb; v_project_id uuid;
begin
  if p_user_id is null or jsonb_typeof(p_actions) is distinct from 'array' or jsonb_array_length(p_actions) not between 1 and 10 then raise exception 'Invalid proposals' using errcode='22023'; end if;
  insert into private.agent_runs(user_id) values(p_user_id) returning id into v_run_id;
  for a in select value from jsonb_array_elements(p_actions) loop
    v_project_id := (a->>'projectId')::uuid;
    if a->>'type' not in ('create_task','update_task') or not private.agent_task_patch_valid(a->'payload',a->>'type'='create_task') then raise exception 'Invalid proposal' using errcode='22023'; end if;
    if not exists(select 1 from public.projects p where p.id=v_project_id and p.user_id=p_user_id) then raise exception 'Unavailable project' using errcode='42501'; end if;
    if a->>'type'='update_task' and not exists(select 1 from public.tasks t where t.id=(a->>'taskId')::uuid and t.user_id=p_user_id and t.project_id=v_project_id) then raise exception 'Unavailable task' using errcode='42501'; end if;
    if a->'payload'->>'milestoneId' is not null and not exists(select 1 from public.milestones m where m.id=(a->'payload'->>'milestoneId')::uuid and m.project_id=v_project_id) then raise exception 'Unavailable milestone' using errcode='42501'; end if;
    insert into private.agent_actions(id,run_id,user_id,action_type,entity_id,project_id,title,payload,before_state,expected_updated_at,diff)
    values((a->>'id')::uuid,v_run_id,p_user_id,a->>'type',(a->>'taskId')::uuid,v_project_id,a->>'title',a->'payload',a->'before',(a->>'expectedUpdatedAt')::timestamptz,a->'diff');
  end loop;
  return private.agent_batch(v_run_id,p_user_id);
end;
$$;

create function public.get_agent_proposal_batch(p_user_id uuid, p_run_id uuid)
returns jsonb language sql security definer set search_path = '' as $$ select private.agent_batch(p_run_id,p_user_id); $$;

create function public.consume_agent_action_limit(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare permitted boolean := false;
begin
  if p_user_id is null then return false; end if;
  insert into private.agent_action_limits as l(user_id,window_start,requests) values(p_user_id,now(),1)
  on conflict(user_id) do update set window_start=case when l.window_start<=now()-interval '1 minute' then now() else l.window_start end,
    requests=case when l.window_start<=now()-interval '1 minute' then 1 else l.requests+1 end
  where l.window_start<=now()-interval '1 minute' or l.requests<30 returning true into permitted;
  return coalesce(permitted,false);
end;
$$;

-- One call/action is atomic: row locks, task mutation and audit status commit together.
-- The caller handles each selected action independently; batches may have mixed results.
create function public.apply_agent_task_action(p_user_id uuid, p_run_id uuid, p_action_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a private.agent_actions%rowtype; t public.tasks%rowtype; p jsonb; task_status text; new_id uuid; sort_order integer; code text;
begin
  select * into a from private.agent_actions where id=p_action_id and run_id=p_run_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('id',p_action_id,'status','failed','errorCode','FORBIDDEN'); end if;
  if a.status<>'pending' then return jsonb_build_object('id',a.id,'status',a.status,'entityId',a.entity_id,'errorCode',a.error_code); end if;
  begin
    p := a.payload;
    if not private.agent_task_patch_valid(p,a.action_type='create_task') then raise exception 'Invalid patch' using errcode='22023'; end if;
    -- Lock parent ownership while performing the task mutation.
    perform 1 from public.projects where id=a.project_id and user_id=p_user_id for share;
    if not found then raise exception 'Unavailable project' using errcode='42501'; end if;
    if p->>'milestoneId' is not null then
      perform 1 from public.milestones where id=(p->>'milestoneId')::uuid and project_id=a.project_id for share;
      if not found then raise exception 'Unavailable milestone' using errcode='42501'; end if;
    end if;
    if a.action_type='update_task' then
      select * into t from public.tasks where id=a.entity_id and user_id=p_user_id and project_id=a.project_id for update;
      if not found then raise exception 'Unavailable task' using errcode='42501'; end if;
      if t.updated_at is distinct from a.expected_updated_at then
        update private.agent_actions set status='conflict',approved_at=now(),error_code='STALE_TASK' where id=a.id;
      else
        update public.tasks set
          title=case when p ? 'title' then p->>'title' else title end,
          description=case when p ? 'description' then p->>'description' else description end,
          status=case when p ? 'status' then p->>'status' else status end,
          priority=case when p ? 'priority' then p->>'priority' else priority end,
          due_date=case when p ? 'dueDate' then ((p->>'dueDate')::date::timestamp at time zone 'UTC') else due_date end,
          milestone_id=case when p ? 'milestoneId' then (p->>'milestoneId')::uuid else milestone_id end,
          completed_at=case when p ? 'status' then case when p->>'status'='Completed' then now() else null end else completed_at end
        where id=t.id and user_id=p_user_id;
        update private.agent_actions set status='applied',approved_at=now(),executed_at=now() where id=a.id;
      end if;
    elsif a.action_type='create_task' then
      task_status := coalesce(p->>'status','Backlog');
      select coalesce(max(t2.sort_order),0)+1 into sort_order from public.tasks t2 where t2.project_id=a.project_id and t2.status=task_status;
      insert into public.tasks(user_id,project_id,title,description,status,priority,due_date,milestone_id,sort_order,completed_at)
      values(p_user_id,a.project_id,p->>'title',coalesce(p->>'description',''),task_status,coalesce(p->>'priority','Medium'),((p->>'dueDate')::date::timestamp at time zone 'UTC'),(p->>'milestoneId')::uuid,sort_order,case when task_status='Completed' then now() else null end)
      returning id into new_id;
      update private.agent_actions set entity_id=new_id,status='applied',approved_at=now(),executed_at=now() where id=a.id;
    else raise exception 'Invalid action' using errcode='22023';
    end if;
  exception when others then
    code := case when sqlstate='42501' then 'FORBIDDEN' when sqlstate='22023' then 'INVALID_INPUT' else 'TASK_SAVE_FAILED' end;
    update private.agent_actions set status='failed',approved_at=now(),error_code=code where id=a.id;
  end;
  if not exists(select 1 from private.agent_actions where run_id=p_run_id and status='pending') then update private.agent_runs set completed_at=now() where id=p_run_id; end if;
  select * into a from private.agent_actions where id=p_action_id;
  return jsonb_build_object('id',a.id,'status',a.status,'entityId',a.entity_id,'errorCode',a.error_code);
end;
$$;

create function public.cancel_agent_task_actions(p_user_id uuid,p_run_id uuid,p_action_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_action_ids is null or cardinality(p_action_ids) not between 1 and 10 then raise exception 'Invalid selection' using errcode='22023'; end if;
  if not exists(select 1 from private.agent_runs where id=p_run_id and user_id=p_user_id) then return null; end if;
  update private.agent_actions set status='cancelled' where run_id=p_run_id and user_id=p_user_id and id=any(p_action_ids) and status='pending';
  if not exists(select 1 from private.agent_actions where run_id=p_run_id and status='pending') then update private.agent_runs set completed_at=now() where id=p_run_id; end if;
  return private.agent_batch(p_run_id,p_user_id);
end;
$$;

revoke all on function private.agent_task_patch_valid(jsonb,boolean), private.agent_batch(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_agent_proposal_batch(uuid,jsonb), public.get_agent_proposal_batch(uuid,uuid), public.consume_agent_action_limit(uuid), public.apply_agent_task_action(uuid,uuid,uuid), public.cancel_agent_task_actions(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.save_agent_proposal_batch(uuid,jsonb), public.get_agent_proposal_batch(uuid,uuid), public.consume_agent_action_limit(uuid), public.apply_agent_task_action(uuid,uuid,uuid), public.cancel_agent_task_actions(uuid,uuid,uuid[]) to service_role;
