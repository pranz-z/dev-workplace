-- Phase 5D foundation. No scheduler, provider activation, secrets or workspace writes.
create function private.agent_pulse_hash(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p::text,'UTF8')),'hex');
$$;
create function private.agent_pulse_uuid_scope(p uuid[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(p)<=20 and array_position(p,null) is null
    and cardinality(p)=(select count(distinct v) from unnest(p) v) and octet_length(p::text)<=2048;
$$;
create function private.agent_pulse_reasons(p text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(p) between 1 and 7 and array_position(p,null) is null
    and p <@ array['DEADLINE_OVERDUE','DEADLINE_TODAY','DEADLINE_SOON','IMPORTANT_NO_WORK','PROJECT_QUIET','TOMORROW_DEADLINES','TOMORROW_OCCUPANCY']::text[]
    and cardinality(p)=(select count(distinct v) from unnest(p) v);
$$;

create table private.agent_pulse_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'off' check(mode in ('off','workspace','workspace_ai')),
  cadence text not null default 'normal' check(cadence in ('normal','quiet')),
  checks_consent_version text check(length(checks_consent_version) between 1 and 40), checks_consented_at timestamptz,
  ai_consent_version text check(length(ai_consent_version) between 1 and 40), ai_consented_at timestamptz,
  ai_project_ids uuid[] not null default '{}' check(private.agent_pulse_uuid_scope(ai_project_ids)),
  settings_revision bigint not null default 1 check(settings_revision>0),
  policy_version text not null default 'pulse-v1' check(length(policy_version) between 1 and 40),
  next_due_at timestamptz, last_success_at timestamptz, last_deterministic_at timestamptz, last_brief_ack_at timestamptz,
  last_coverage jsonb not null default '{}' check(jsonb_typeof(last_coverage)='object' and octet_length(last_coverage::text)<=2048),
  baseline jsonb not null default '{}' check(jsonb_typeof(baseline)='object' and octet_length(baseline::text)<=16384),
  lease_token uuid, lease_expires_at timestamptz, fence bigint not null default 0 check(fence>=0),
  ui_window_started_at timestamptz, ui_write_count integer not null default 0 check(ui_write_count between 0 and 60),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check((checks_consent_version is null)=(checks_consented_at is null)),
  check((ai_consent_version is null)=(ai_consented_at is null)),
  check(mode='off' or checks_consent_version is not null),
  check(mode<>'workspace_ai' or ai_consent_version is not null),
  check((lease_token is null)=(lease_expires_at is null)),
  check(isfinite(created_at) and isfinite(updated_at) and (next_due_at is null or isfinite(next_due_at))
    and (checks_consented_at is null or isfinite(checks_consented_at)) and (ai_consented_at is null or isfinite(ai_consented_at))
    and (lease_expires_at is null or isfinite(lease_expires_at)) and (last_success_at is null or isfinite(last_success_at))
    and (last_deterministic_at is null or isfinite(last_deterministic_at)) and (last_brief_ack_at is null or isfinite(last_brief_ack_at))
    and (ui_window_started_at is null or isfinite(ui_window_started_at))),
  check(next_due_at is null or mod(extract(epoch from next_due_at),14400)=0)
);
create index agent_pulse_state_due_idx on private.agent_pulse_state(next_due_at,user_id) where mode<>'off';

create table private.agent_pulses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_slot timestamptz not null check(isfinite(scheduled_slot) and mod(extract(epoch from scheduled_slot),14400)=0),
  dispatch_nonce uuid not null, status text not null default 'running' check(status in ('running','succeeded','partial','failed','abandoned')),
  started_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  fence bigint not null check(fence>0), lease_token uuid not null, lease_expires_at timestamptz not null,
  settings_revision bigint not null check(settings_revision>0), policy_version text not null check(length(policy_version) between 1 and 40),
  time_zone_used text check(length(time_zone_used) between 1 and 100),
  coverage jsonb not null default '{}' check(jsonb_typeof(coverage)='object' and octet_length(coverage::text)<=2048),
  deterministic_commit_id uuid, deterministic_committed_at timestamptz,
  created_count integer not null default 0 check(created_count between 0 and 3),
  updated_count integer not null default 0 check(updated_count between 0 and 20),
  resolved_count integer not null default 0 check(resolved_count between 0 and 20),
  ai_reserved_at timestamptz, installation_reservation_key uuid unique,
  ai_outcome text not null default 'none' check(ai_outcome in ('none','reserved','accepted','unavailable','malformed','timeout','unknown','skipped_budget','skipped_time_budget','skipped_scope')),
  ai_parent_id uuid, ai_parent_episode bigint check(ai_parent_episode>0), ai_attempt_number integer check(ai_attempt_number between 1 and 2),
  idea_accepted_at timestamptz,
  error_code text check(error_code in ('UNKNOWN_COVERAGE','SOURCE_CHANGED','SOURCE_UNAVAILABLE','AUTHORITY_LOST','CAPACITY','BUDGET','AI_UNAVAILABLE','AI_MALFORMED','AI_TIMEOUT')),
  summary text check(length(summary)<=400),
  unique(id,user_id), unique(user_id,scheduled_slot),
  check((status='running')=(completed_at is null)),
  check((deterministic_commit_id is null)=(deterministic_committed_at is null)),
  check((ai_reserved_at is null)=(installation_reservation_key is null)),
  check((ai_reserved_at is null)=(ai_parent_episode is null) and (ai_reserved_at is null)=(ai_attempt_number is null)),
  check(idea_accepted_at is null or ai_reserved_at is not null),
  check(isfinite(started_at) and isfinite(lease_expires_at) and lease_expires_at>started_at
    and (completed_at is null or isfinite(completed_at)) and (deterministic_committed_at is null or isfinite(deterministic_committed_at))
    and (ai_reserved_at is null or isfinite(ai_reserved_at)) and (idea_accepted_at is null or isfinite(idea_accepted_at)))
);
create unique index agent_pulses_one_running on private.agent_pulses(user_id) where status='running';
create index agent_pulses_dispatch on private.agent_pulses(scheduled_slot,dispatch_nonce);
create index agent_pulses_owner_history on private.agent_pulses(user_id,started_at desc,id desc);
create index agent_pulses_owner_requests on private.agent_pulses(user_id,ai_reserved_at) where ai_reserved_at is not null;
create index agent_pulses_owner_ideas on private.agent_pulses(user_id,idea_accepted_at) where idea_accepted_at is not null;

create table private.agent_observations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'signal' check(kind in ('signal','idea')),
  condition_key text not null check(length(condition_key) between 1 and 160),
  family text check(family in ('deadline','important_work','quiet_project','tomorrow')),
  target_type text not null check(target_type in ('task','milestone','project','workspace_day')), target_id uuid not null, target_date date,
  parent_observation_id uuid, parent_episode bigint check(parent_episode>0),
  idea_category text check(idea_category in ('review_deadline','consider_scheduling','review_quiet_project','review_tomorrow')),
  episode bigint not null default 1 check(episode>0),
  ai_attempt_count integer not null default 0 check(ai_attempt_count between 0 and 2),
  ai_last_attempt_at timestamptz check(isfinite(ai_last_attempt_at)),
  ai_attempt_terminal boolean not null default false,
  check((ai_attempt_count=0)=(ai_last_attempt_at is null)),
  check(not ai_attempt_terminal or ai_attempt_count>0),
  check(kind='signal' or (ai_attempt_count=0 and ai_last_attempt_at is null and not ai_attempt_terminal)),
  material_fingerprint text not null check(material_fingerprint ~ '^[0-9a-f]{64}$'),
  source_token text not null check(source_token ~ '^[0-9a-f]{64}$'),
  evidence_valid_until timestamptz not null check(isfinite(evidence_valid_until)),
  reason_codes text[] not null check(private.agent_pulse_reasons(reason_codes)),
  evidence jsonb not null default '{}' check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=2048),
  title text not null default '' check(length(title)<=120), summary text not null default '' check(length(summary)<=400),
  explanation text not null default '' check(length(explanation)<=240),
  importance text not null default 'normal' check(importance in ('critical','high','normal')),
  rank integer not null default 3 check(rank between 0 and 5),
  state text not null default 'active' check(state in ('active','snoozed','dismissed','resolved')),
  first_noticed_at timestamptz not null default clock_timestamp(), last_checked_at timestamptz not null default clock_timestamp(),
  last_changed_at timestamptz not null default clock_timestamp(), snooze_until timestamptz, revisit_at timestamptz, resolved_at timestamptz,
  resolution_code text check(resolution_code in ('USER','PROVEN_FALSE','SOURCE_UNAVAILABLE','AUTHORITY_LOST','EXPIRED')),
  feedback_count integer not null default 0 check(feedback_count>=0),
  row_revision bigint not null default 1 check(row_revision>0), content_revision bigint not null default 1 check(content_revision>0),
  seen_content_revision bigint not null default 0 check(seen_content_revision between 0 and content_revision),
  origin_pulse_id uuid not null, latest_pulse_id uuid not null,
  unique(id,user_id), unique(user_id,condition_key),
  foreign key(origin_pulse_id,user_id) references private.agent_pulses(id,user_id),
  foreign key(latest_pulse_id,user_id) references private.agent_pulses(id,user_id),
  foreign key(parent_observation_id,user_id) references private.agent_observations(id,user_id),
  check(parent_observation_id is distinct from id),
  check((target_type='workspace_day')=(target_date is not null)),
  check(target_type<>'workspace_day' or target_id=user_id),
  check((state='snoozed')=(snooze_until is not null)),
  check((kind='signal' and family is not null and parent_observation_id is null and parent_episode is null and idea_category is null)
    or (kind='idea' and family is null and parent_observation_id is not null and parent_episode is not null and idea_category is not null and rank=5)),
  check(kind<>'signal' or (family='deadline' and target_type in ('task','milestone','project')) or (family='important_work' and target_type='task')
    or (family='quiet_project' and target_type='project') or (family='tomorrow' and target_type='workspace_day')),
  check(isfinite(first_noticed_at) and isfinite(last_checked_at) and isfinite(last_changed_at)
    and (snooze_until is null or isfinite(snooze_until)) and (revisit_at is null or isfinite(revisit_at)) and (resolved_at is null or isfinite(resolved_at)))
);
create unique index agent_observations_idea_identity on private.agent_observations(user_id,parent_observation_id,parent_episode,idea_category) where kind='idea';
create index agent_observations_inbox on private.agent_observations(user_id,state,rank,last_changed_at desc,id);
alter table private.agent_pulses add foreign key(ai_parent_id,user_id) references private.agent_observations(id,user_id) on delete set null (ai_parent_id);

create table private.agent_pulse_installation_events (
  id uuid primary key default gen_random_uuid(), event_kind text not null check(event_kind in ('dispatch_slot','provider_reservation')),
  created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
  scheduled_slot timestamptz, nonce_fingerprint text, dispatch_outcome text, claim_count integer, reservation_key uuid,
  check((event_kind='dispatch_slot' and scheduled_slot is not null and isfinite(scheduled_slot) and mod(extract(epoch from scheduled_slot),14400)=0
    and nonce_fingerprint is not null and nonce_fingerprint ~ '^[0-9a-f]{64}$' and dispatch_outcome is not null and claim_count is not null
    and ((dispatch_outcome in ('empty','disabled') and claim_count=0) or (dispatch_outcome='claimed' and claim_count between 1 and 2)) and reservation_key is null)
    or (event_kind='provider_reservation' and reservation_key is not null and scheduled_slot is null and nonce_fingerprint is null and dispatch_outcome is null and claim_count is null))
);
create unique index agent_pulse_installation_slot on private.agent_pulse_installation_events(scheduled_slot) where event_kind='dispatch_slot';
create unique index agent_pulse_installation_reservation on private.agent_pulse_installation_events(reservation_key) where event_kind='provider_reservation';
create index agent_pulse_installation_retention on private.agent_pulse_installation_events(event_kind,created_at);

create function private.agent_pulse_installation_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' or old.created_at>clock_timestamp()-interval '48 hours' then raise exception 'Immutable operational event' using errcode='42501'; end if;
  return old;
end;$$;
create trigger agent_pulse_installation_guard before update or delete on private.agent_pulse_installation_events for each row execute function private.agent_pulse_installation_guard();
create function private.agent_pulse_state_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.user_id<>old.user_id then raise exception 'Immutable owner' using errcode='42501'; end if;
  if new.fence<old.fence or new.settings_revision<old.settings_revision then raise exception 'Monotonic authority' using errcode='23514'; end if;
  return new;
end;$$;
create trigger agent_pulse_state_guard before update on private.agent_pulse_state for each row execute function private.agent_pulse_state_guard();
create function private.agent_pulse_history_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.user_id,new.scheduled_slot,new.dispatch_nonce,new.fence,new.lease_token,new.lease_expires_at,new.settings_revision,new.policy_version,new.started_at,new.time_zone_used)
    is distinct from (old.id,old.user_id,old.scheduled_slot,old.dispatch_nonce,old.fence,old.lease_token,old.lease_expires_at,old.settings_revision,old.policy_version,old.started_at,old.time_zone_used)
    or (old.ai_reserved_at is not null and (new.ai_reserved_at,new.installation_reservation_key,new.ai_parent_episode,new.ai_attempt_number) is distinct from (old.ai_reserved_at,old.installation_reservation_key,old.ai_parent_episode,old.ai_attempt_number))
    or (old.idea_accepted_at is not null and new.idea_accepted_at is distinct from old.idea_accepted_at)
    or (old.deterministic_commit_id is not null and (new.deterministic_commit_id,new.deterministic_committed_at) is distinct from (old.deterministic_commit_id,old.deterministic_committed_at))
    or (old.status<>'running' and (to_jsonb(new)-'summary'-'ai_parent_id') is distinct from (to_jsonb(old)-'summary'-'ai_parent_id')) then
    raise exception 'Immutable Pulse history' using errcode='42501';
  end if;
  if new.ai_parent_id is distinct from old.ai_parent_id and old.ai_parent_id is not null and new.ai_parent_id is not null then raise exception 'Immutable reservation parent' using errcode='42501'; end if;
  return new;
end;$$;
create trigger agent_pulse_history_guard before update on private.agent_pulses for each row execute function private.agent_pulse_history_guard();

create function private.agent_pulse_observation_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.id,new.user_id,new.kind,new.condition_key,new.family,new.target_type,new.target_id,new.target_date,new.parent_observation_id,new.parent_episode,new.idea_category,new.origin_pulse_id)
    is distinct from (old.id,old.user_id,old.kind,old.condition_key,old.family,old.target_type,old.target_id,old.target_date,old.parent_observation_id,old.parent_episode,old.idea_category,old.origin_pulse_id) then
    raise exception 'Immutable observation identity' using errcode='42501';
  end if;
  if new.kind='idea' and exists(select 1 from private.agent_observations o where o.id=new.parent_observation_id and o.user_id=new.user_id and o.kind<>'signal') then
    raise exception 'Idea parent must be a signal' using errcode='23514';
  end if;
  return new;
end;$$;
create trigger agent_pulse_observation_guard before insert or update on private.agent_observations for each row execute function private.agent_pulse_observation_guard();

alter table private.agent_pulse_state enable row level security;
alter table private.agent_pulses enable row level security;
alter table private.agent_observations enable row level security;
alter table private.agent_pulse_installation_events enable row level security;
revoke all on private.agent_pulse_state,private.agent_pulses,private.agent_observations,private.agent_pulse_installation_events from public,anon,authenticated,service_role;
revoke all on function private.agent_pulse_hash(jsonb),private.agent_pulse_uuid_scope(uuid[]),private.agent_pulse_reasons(text[]),
  private.agent_pulse_installation_guard(),private.agent_pulse_state_guard(),private.agent_pulse_history_guard(),private.agent_pulse_observation_guard() from public,anon,authenticated,service_role;

create function private.agent_pulse_stamp(p timestamptz) returns text language sql immutable set search_path='' as $$
  select case when p is null then null when not pg_catalog.isfinite(p) then 'invalid' else pg_catalog.to_char(p at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end;
$$;

-- The sole canonical source projection. Publication and safe detail reads reuse it.
-- Discovery caps are independent of at most twenty stored-target rechecks.
create function private.agent_pulse_source_projection(p_owner uuid,p_at timestamptz,p_refs jsonb)
returns jsonb language sql stable set search_path='' set statement_timeout='3s' as $$
with
zone as materialized (select (select p.time_zone from public.profiles p where p.id=p_owner) saved),
bounds as materialized (select saved,
  case when exists(select 1 from pg_catalog.pg_timezone_names n where n.name=zone.saved)
    then (((p_at at time zone saved)::date+8)::timestamp at time zone saved) else p_at+interval '9 days' end finish from zone),
refs as materialized (select r from pg_catalog.jsonb_array_elements(p_refs) r limit 20),
pgeneric as materialized (select p.id,p.user_id,p.title,p.status,p.workflow_stage,p.priority,p.target_date,p.created_at,p.updated_at
  from public.projects p where p.user_id=p_owner order by p.target_date nulls last,p.id limit 51),
parents as materialized (
  select (r->'target'->>'id')::uuid id from refs where r->'target'->>'type'='project'
  union select t.project_id from refs join public.tasks t on t.id=(r->'target'->>'id')::uuid and t.user_id=p_owner where r->'target'->>'type'='task'
  union select m.project_id from refs join public.milestones m on m.id=(r->'target'->>'id')::uuid join public.projects p on p.id=m.project_id and p.user_id=p_owner where r->'target'->>'type'='milestone'),
pr as materialized (select * from (select * from pgeneric limit 50) x union
  select p.id,p.user_id,p.title,p.status,p.workflow_stage,p.priority,p.target_date,p.created_at,p.updated_at from public.projects p join parents x on x.id=p.id where p.user_id=p_owner),
pf as materialized (select p.id,pg_catalog.jsonb_build_object('id',p.id,'userId',p.user_id,'title',pg_catalog.left(p.title,120),'status',p.status,
  'workflowStage',p.workflow_stage,'priority',p.priority,'targetDate',p.target_date::text,'createdAt',private.agent_pulse_stamp(p.created_at),'updatedAt',private.agent_pulse_stamp(p.updated_at)) v from pr p),
tg as materialized (select t.id,t.user_id,t.project_id,t.title,t.status,t.priority,t.due_date,t.created_at,t.updated_at,t.completed_at
  from public.tasks t join pr p on p.id=t.project_id where t.user_id=p_owner order by t.due_date nulls last,t.id limit 201),
tr as materialized (select * from (select * from tg limit 200) x union
  select t.id,t.user_id,t.project_id,t.title,t.status,t.priority,t.due_date,t.created_at,t.updated_at,t.completed_at
  from public.tasks t join pr p on p.id=t.project_id join refs on r->'target'->>'type'='task' and t.id=(r->'target'->>'id')::uuid where t.user_id=p_owner),
tf as materialized (select t.id,t.project_id,pg_catalog.jsonb_build_object('id',t.id,'userId',t.user_id,'projectId',t.project_id,'title',pg_catalog.left(t.title,120),
  'status',t.status,'priority',t.priority,'dueDate',t.due_date::text,'createdAt',private.agent_pulse_stamp(t.created_at),'updatedAt',private.agent_pulse_stamp(t.updated_at),'completedAt',private.agent_pulse_stamp(t.completed_at)) v from tr t),
mg as materialized (select m.id,m.project_id,m.title,m.status,m.target_date,m.created_at,m.updated_at
  from public.milestones m join pr p on p.id=m.project_id order by m.target_date nulls last,m.id limit 101),
mr as materialized (select * from (select * from mg limit 100) x union
  select m.id,m.project_id,m.title,m.status,m.target_date,m.created_at,m.updated_at from public.milestones m join pr p on p.id=m.project_id
  join refs on r->'target'->>'type'='milestone' and m.id=(r->'target'->>'id')::uuid),
mf as materialized (select m.id,m.project_id,pg_catalog.jsonb_build_object('id',m.id,'userId',p_owner,'projectId',m.project_id,'title',pg_catalog.left(m.title,120),
  'status',m.status,'targetDate',m.target_date::text,'createdAt',private.agent_pulse_stamp(m.created_at),'updatedAt',private.agent_pulse_stamp(m.updated_at)) v from mr m),
bg as materialized (select b.id,pg_catalog.jsonb_build_object('id',b.id,'userId',b.user_id,'projectId',b.project_id,'taskId',b.task_id,'kind',b.kind,'status',b.status,
  'startAt',private.agent_pulse_stamp(b.start_at),'endAt',private.agent_pulse_stamp(b.end_at)) v from public.workspace_time_blocks b,bounds
  where b.user_id=p_owner and b.end_at>p_at and b.start_at<bounds.finish order by b.start_at,b.id limit 501),
relations as materialized (select t.id,coalesce(rb.rows,'[]'::jsonb) rows,rb.n<=500 complete from tf t cross join bounds
  cross join lateral (select count(*) n,pg_catalog.jsonb_agg(b.v order by b.id) filter(where b.rn<=500) rows from (
    select b.id,row_number() over(order by b.id) rn,pg_catalog.jsonb_build_object('id',b.id,'userId',b.user_id,'projectId',b.project_id,'taskId',b.task_id,
      'kind',b.kind,'status',b.status,'startAt',private.agent_pulse_stamp(b.start_at),'endAt',private.agent_pulse_stamp(b.end_at)) v
    from public.workspace_time_blocks b where b.user_id=p_owner and b.task_id=t.id and b.project_id=t.project_id
      and b.status='scheduled' and b.kind in ('task','focus') and b.end_at>p_at and b.start_at<bounds.finish order by b.id limit 501) b) rb),
activity as materialized (select p.id,pg_catalog.jsonb_build_object('coverage',pg_catalog.jsonb_build_object('complete',true),
  'lastActivityAt',private.agent_pulse_stamp(a.last_at),'invalidActivity',coalesce(a.invalid,false)) v from pr p
  cross join lateral (select max(x.at) last_at,pg_catalog.bool_or(not pg_catalog.isfinite(x.at) or x.at>p_at) invalid from (
    select p.created_at at union all select p.updated_at
    union all select t.created_at from public.tasks t where t.user_id=p_owner and t.project_id=p.id
    union all select t.updated_at from public.tasks t where t.user_id=p_owner and t.project_id=p.id
    union all select t.completed_at from public.tasks t where t.user_id=p_owner and t.project_id=p.id
    union all select m.created_at from public.milestones m where m.project_id=p.id
    union all select m.updated_at from public.milestones m where m.project_id=p.id) x) a),
prefs as materialized (select (select pg_catalog.jsonb_build_object('workdayStart',pg_catalog.to_char(s.workday_start,'HH24:MI'),'workdayEnd',pg_catalog.to_char(s.workday_end,'HH24:MI'),
  'weekdays',s.weekdays,'focusMinutes',s.focus_minutes,'bufferMinutes',s.buffer_minutes) from public.workspace_scheduling_preferences s where s.user_id=p_owner) v),
taskfacts as materialized (select t.id,t.v,rb.rows,rb.complete,private.agent_pulse_hash(pg_catalog.jsonb_build_object('task',t.v,'parent',p.v,'blocks',rb.rows,'complete',rb.complete,'zone',bounds.saved)) token
  from tf t join pf p on p.id=t.project_id join relations rb on rb.id=t.id cross join bounds),
snapshot as materialized (select pg_catalog.jsonb_build_object(
  'userId',p_owner,'evaluatedAt',private.agent_pulse_stamp(p_at),'timeZone',bounds.saved,
  'settingsRevision',coalesce(s.settings_revision,1),'policyVersion',coalesce(s.policy_version,'pulse-v1'),'baseline',coalesce(s.baseline,'{}'::jsonb),
  'projects',coalesce((select pg_catalog.jsonb_agg(p.v||pg_catalog.jsonb_build_object('sourceToken',private.agent_pulse_hash(p.v||pg_catalog.jsonb_build_object('zone',bounds.saved))) order by p.id) from pf p),'[]'::jsonb),
  'tasks',coalesce((select pg_catalog.jsonb_agg(t.v||pg_catalog.jsonb_build_object('sourceToken',t.token) order by t.id) from taskfacts t),'[]'::jsonb),
  'milestones',coalesce((select pg_catalog.jsonb_agg(m.v||pg_catalog.jsonb_build_object('sourceToken',private.agent_pulse_hash(pg_catalog.jsonb_build_object('milestone',m.v,'parent',p.v,'zone',bounds.saved))) order by m.id) from mf m join pf p on p.id=m.project_id),'[]'::jsonb),
  'blocks',coalesce((select pg_catalog.jsonb_agg(v order by id) from (select * from bg limit 500) b),'[]'::jsonb),
  'taskBlocks',coalesce((select pg_catalog.jsonb_object_agg(id::text,pg_catalog.jsonb_build_object('coverage',pg_catalog.jsonb_build_object('complete',complete),'sourceToken',token,'blocks',rows)) from taskfacts),'{}'::jsonb),
  'projectActivity',coalesce((select pg_catalog.jsonb_object_agg(a.id::text,a.v||pg_catalog.jsonb_build_object('sourceToken',private.agent_pulse_hash(pg_catalog.jsonb_build_object('project',p.v,'activity',a.v)))) from activity a join pf p on p.id=a.id),'{}'::jsonb),
  'preferences',prefs.v,'coverage',pg_catalog.jsonb_build_object(
    'projects',pg_catalog.jsonb_build_object('complete',(select count(*)<=50 from pgeneric),'limit',50),
    'tasks',pg_catalog.jsonb_build_object('complete',(select count(*)<=200 from tg) and (select count(*)<=50 from pgeneric),'limit',200),
    'milestones',pg_catalog.jsonb_build_object('complete',(select count(*)<=100 from mg) and (select count(*)<=50 from pgeneric),'limit',100),
    'blocks',pg_catalog.jsonb_build_object('complete',(select count(*)<=500 from bg),'limit',500,'checkedStart',private.agent_pulse_stamp(p_at),'checkedEnd',private.agent_pulse_stamp(bounds.finish))),
  'existing',coalesce((select pg_catalog.jsonb_agg(r order by r->>'key') from refs),'[]'::jsonb)) v
  from bounds cross join prefs left join private.agent_pulse_state s on s.user_id=p_owner),
tokens as materialized (
  select 'task:'||id||':attention' key,token from taskfacts
  union all select 'project:'||id||':deadline',p.v->>'sourceToken' from snapshot,pg_catalog.jsonb_array_elements(snapshot.v->'projects') p(v) cross join lateral(select (p.v->>'id')::uuid id) x
  union all select 'milestone:'||(m->>'id')||':deadline',m->>'sourceToken' from snapshot,pg_catalog.jsonb_array_elements(v->'milestones') m
  union all select 'project:'||key||':quiet_project',value->>'sourceToken' from snapshot,pg_catalog.jsonb_each(v->'projectActivity')
), tomorrow as materialized (select private.agent_pulse_hash(v-'evaluatedAt'-'existing'-'baseline'-'settingsRevision') token,
  case when exists(select 1 from pg_catalog.pg_timezone_names n where n.name=bounds.saved)
    then 'workspace_day:'||p_owner||':tomorrow:'||((p_at at time zone bounds.saved)::date+1)::text end key from snapshot cross join bounds),
checked as materialized (select r->>'key' key,exists(select 1 from tokens where tokens.key=r->>'key') or coalesce(r->>'key'=(select key from tomorrow),false) found from refs)
select snapshot.v||pg_catalog.jsonb_build_object('tomorrowSourceToken',tomorrow.token,
  'targetChecks',coalesce((select pg_catalog.jsonb_object_agg(c.key,pg_catalog.jsonb_build_object('complete',true,'exists',c.found,'sourceToken',
    coalesce(case when c.key=tomorrow.key then tomorrow.token end,(select token from tokens where key=c.key),private.agent_pulse_hash(pg_catalog.jsonb_build_object('owner',p_owner,'key',c.key,'exists',false))))) from checked c),'{}'::jsonb),
  'sourceTokens',coalesce((select pg_catalog.jsonb_object_agg(key,token) from tokens),'{}'::jsonb)||case when tomorrow.key is not null then pg_catalog.jsonb_build_object(tomorrow.key,tomorrow.token) else '{}'::jsonb end)
from snapshot cross join tomorrow;
$$;
revoke all on function private.agent_pulse_stamp(timestamptz),private.agent_pulse_source_projection(uuid,timestamptz,jsonb) from public,anon,authenticated,service_role;

create function public.agent_pulse_read_source(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint)
returns jsonb language sql stable security definer set search_path='' set statement_timeout='3s' as $$
with tick as materialized(select clock_timestamp() at), authority as materialized (
  select tick.at from tick,private.agent_pulse_state s join private.agent_pulses p on p.user_id=s.user_id
  where s.user_id=p_user_id and p.id=p_pulse_id and s.mode<>'off' and s.checks_consent_version='checks-v1'
    and s.lease_token=p_lease_token and p.lease_token=p_lease_token and s.fence=p_fence and p.fence=p_fence
    and s.settings_revision=p.settings_revision and s.policy_version=p.policy_version and p.policy_version='pulse-v1'
    and p.status='running' and s.lease_expires_at>tick.at and p.lease_expires_at>tick.at)
select private.agent_pulse_source_projection(p_user_id,a.at,coalesce((select jsonb_agg(o.v) from (
  select jsonb_build_object('id',id,'episode',episode,'key',condition_key,'target',jsonb_build_object('type',target_type,'id',target_id),'family',family,'state',state,
    'materialFingerprint',material_fingerprint,'sourceToken',source_token,'evidenceValidUntil',private.agent_pulse_stamp(evidence_valid_until),'rowRevision',row_revision,
    'seen',seen_content_revision>=content_revision,'lastCheckedAt',private.agent_pulse_stamp(last_checked_at)) v
  from private.agent_observations where user_id=p_user_id and kind='signal' order by rank,last_changed_at desc,id limit 20) o),'[]'::jsonb)) from authority a;
$$;
revoke all on function public.agent_pulse_read_source(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.agent_pulse_read_source(uuid,uuid,uuid,bigint) to service_role;

create function private.agent_pulse_authority_dto(p private.agent_pulses) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('userId',p.user_id,'pulseId',p.id,'slot',private.agent_pulse_stamp(p.scheduled_slot),'leaseToken',p.lease_token,
  'leaseExpiresAt',private.agent_pulse_stamp(p.lease_expires_at),'fence',p.fence,'settingsRevision',p.settings_revision,'policyVersion',p.policy_version);
$$;
-- Writers enter at owner state then Pulse. Global-accounting callers acquire (505,5) first.
create function private.agent_pulse_guard(p_owner uuid,p_id uuid,p_token uuid,p_fence bigint,p_revision bigint)
returns private.agent_pulses language plpgsql set search_path='' as $$
declare s private.agent_pulse_state; p private.agent_pulses; tick timestamptz:=clock_timestamp();
begin
  select * into s from private.agent_pulse_state where user_id=p_owner for update;
  if not found then raise exception 'AUTHORITY_LOST' using errcode='40001'; end if;
  select * into p from private.agent_pulses where id=p_id and user_id=p_owner for update;
  tick:=clock_timestamp();
  if not found or s.mode='off' or s.checks_consent_version is distinct from 'checks-v1' or p.status<>'running'
    or s.lease_token is distinct from p_token or p.lease_token is distinct from p_token or s.fence<>p_fence or p.fence<>p_fence
    or s.settings_revision<>p.settings_revision or (p_revision is not null and s.settings_revision<>p_revision)
    or s.policy_version<>p.policy_version or p.policy_version<>'pulse-v1' or s.lease_expires_at<=tick or p.lease_expires_at<=tick then
    raise exception 'AUTHORITY_LOST' using errcode='40001';
  end if;
  return p;
end;$$;

create function public.agent_pulse_claim_dispatch(p_slot timestamptz,p_nonce uuid,p_issued_at timestamptz,p_processing_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare tick timestamptz:=clock_timestamp(); event private.agent_pulse_installation_events; owners uuid[]; state_row private.agent_pulse_state;
  pulse_row private.agent_pulses; claims jsonb:='[]'; n integer:=0; outcome text; zone text; now_epoch bigint; issued_epoch bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  if p_processing_enabled is null or p_nonce is null or p_slot is null or not isfinite(p_slot) or p_issued_at is null or not isfinite(p_issued_at)
    or p_slot<>date_bin(interval '4 hours',tick,timestamptz '1970-01-01') or p_issued_at<>date_trunc('second',p_issued_at) then
    raise exception 'Invalid dispatch identity' using errcode='22023';
  end if;
  now_epoch:=floor(extract(epoch from tick))::bigint;
  issued_epoch:=extract(epoch from p_issued_at)::bigint;
  if issued_epoch<now_epoch-600 or issued_epoch>now_epoch+60 then
    raise exception 'Invalid dispatch identity' using errcode='22023';
  end if;
  select * into event from private.agent_pulse_installation_events where event_kind='dispatch_slot' and scheduled_slot=p_slot;
  if found then
    select coalesce(jsonb_agg(private.agent_pulse_authority_dto(p) order by p.user_id,p.id),'[]') into claims from private.agent_pulses p
      where p.scheduled_slot=p_slot and private.agent_pulse_hash(to_jsonb(p.dispatch_nonce::text))=event.nonce_fingerprint;
    return jsonb_build_object('slot',private.agent_pulse_stamp(p_slot),'replay',true,'outcome',event.dispatch_outcome,'claimCount',event.claim_count,'claims',claims);
  end if;
  if not p_processing_enabled then
    insert into private.agent_pulse_installation_events(event_kind,scheduled_slot,nonce_fingerprint,dispatch_outcome,claim_count)
      values('dispatch_slot',p_slot,private.agent_pulse_hash(to_jsonb(p_nonce::text)),'disabled',0);
    return jsonb_build_object('slot',private.agent_pulse_stamp(p_slot),'replay',false,'outcome','disabled','claimCount',0,'claims','[]'::jsonb);
  end if;
  select array_agg(user_id order by user_id) into owners from (
    select s.user_id from private.agent_pulse_state s where s.mode<>'off' and s.checks_consent_version='checks-v1' and s.policy_version='pulse-v1'
      and s.next_due_at<=tick and (s.lease_expires_at is null or s.lease_expires_at<=tick)
      and not exists(select 1 from private.agent_pulses p where p.user_id=s.user_id and p.status='running' and p.lease_expires_at>tick)
      and (select count(*) from private.agent_pulses p where p.user_id=s.user_id and p.started_at>tick-interval '24 hours' and p.started_at<=tick)<6
    order by s.next_due_at,s.user_id limit 2) selected;
  -- Acquire the whole selected state set before any selected Pulse row.
  perform 1 from private.agent_pulse_state where user_id=any(owners) order by user_id for update;
  perform 1 from private.agent_pulses where user_id=any(owners) and status='running' order by id for update;
  for state_row in select * from private.agent_pulse_state where user_id=any(owners) order by user_id loop
    if state_row.mode='off' or state_row.checks_consent_version is distinct from 'checks-v1' or state_row.policy_version<>'pulse-v1' or state_row.next_due_at>tick
      or state_row.lease_expires_at>tick or exists(select 1 from private.agent_pulses x where x.user_id=state_row.user_id and x.status='running' and x.lease_expires_at>tick)
      or (select count(*) from private.agent_pulses x where x.user_id=state_row.user_id and x.started_at>tick-interval '24 hours' and x.started_at<=tick)>=6 then continue; end if;
    update private.agent_pulses set status='abandoned',completed_at=tick,ai_outcome=case when ai_outcome='reserved' then 'unknown' else ai_outcome end
      where user_id=state_row.user_id and status='running' and lease_expires_at<=tick;
    zone:=(select time_zone from public.profiles where id=state_row.user_id);
    insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,started_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,time_zone_used)
      values(state_row.user_id,p_slot,p_nonce,tick,state_row.fence+1,gen_random_uuid(),tick+interval '90 seconds',state_row.settings_revision,state_row.policy_version,zone) returning * into pulse_row;
    update private.agent_pulse_state set fence=pulse_row.fence,lease_token=pulse_row.lease_token,lease_expires_at=pulse_row.lease_expires_at,
      next_due_at=p_slot+case when state_row.cadence='quiet' then interval '12 hours' else interval '4 hours' end,updated_at=tick where user_id=state_row.user_id;
    claims:=claims||jsonb_build_array(private.agent_pulse_authority_dto(pulse_row)); n:=n+1;
  end loop;
  outcome:=case when n=0 then 'empty' else 'claimed' end;
  insert into private.agent_pulse_installation_events(event_kind,scheduled_slot,nonce_fingerprint,dispatch_outcome,claim_count)
    values('dispatch_slot',p_slot,private.agent_pulse_hash(to_jsonb(p_nonce::text)),outcome,n);
  return jsonb_build_object('slot',private.agent_pulse_stamp(p_slot),'replay',false,'outcome',outcome,'claimCount',n,'claims',claims);
end;$$;

create function public.agent_pulse_recover(p_user_id uuid,p_pulse_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',id,'status',status,'commitId',deterministic_commit_id,'reserved',ai_reserved_at is not null,
    'ideaAccepted',idea_accepted_at is not null,'aiOutcome',ai_outcome,'createdCount',created_count,'updatedCount',updated_count,'resolvedCount',resolved_count)
  from private.agent_pulses where user_id=p_user_id and id=p_pulse_id;
$$;
create function public.agent_pulse_finish(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint,p_ai_outcome text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.agent_pulses; tick timestamptz:=clock_timestamp(); result text;
begin
  p:=private.agent_pulse_guard(p_user_id,p_pulse_id,p_lease_token,p_fence,null);
  if p_ai_outcome not in ('none','accepted','unavailable','malformed','timeout','unknown','skipped_budget','skipped_time_budget','skipped_scope')
    or p_ai_outcome is null or (p_ai_outcome='accepted' and p.idea_accepted_at is null) then raise exception 'Invalid AI outcome' using errcode='22023'; end if;
  result:=case when p.deterministic_commit_id is null then 'failed' when p.coverage->>'complete'='true' then 'succeeded' else 'partial' end;
  if p_ai_outcome='malformed' and p.ai_parent_id is not null then
    update private.agent_observations set ai_attempt_terminal=true where user_id=p_user_id and id=p.ai_parent_id and episode=p.ai_parent_episode;
  end if;
  update private.agent_pulses set status=result,completed_at=tick,
    ai_outcome=case when p.ai_outcome='accepted' then 'accepted' when p.ai_reserved_at is not null and p_ai_outcome='none' then 'unknown' else p_ai_outcome end,
    summary=case when result='failed' then 'Workspace check did not complete.' when result='partial' then 'Workspace check completed with limited coverage.' else 'Workspace check completed.' end
    where id=p.id;
  update private.agent_pulse_state set lease_token=null,lease_expires_at=null,last_success_at=case when result='succeeded' then tick else last_success_at end,updated_at=tick where user_id=p_user_id;
  return public.agent_pulse_recover(p_user_id,p_pulse_id);
end;$$;
revoke all on function private.agent_pulse_authority_dto(private.agent_pulses),private.agent_pulse_guard(uuid,uuid,uuid,bigint,bigint) from public,anon,authenticated,service_role;
revoke all on function public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean),public.agent_pulse_recover(uuid,uuid),public.agent_pulse_finish(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean),public.agent_pulse_recover(uuid,uuid),public.agent_pulse_finish(uuid,uuid,uuid,bigint,text) to service_role;

create function private.agent_pulse_decision_valid(d jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare e jsonb; k text; reasons text[]; target text; id uuid; family text; expected_key text;
begin
  if jsonb_typeof(d)<>'object' or octet_length(d::text)>8192 or exists(select 1 from jsonb_object_keys(d) x where x not in
    ('key','target','family','truth','reasonCodes','materialFingerprint','sourceToken','evidenceValidUntil','evidence','importance','rank','deadline','priority','materialChangedAt','complete','baselineParts','expectedRowRevision')) then return false; end if;
  if not (d ?& array['key','target','family','truth','reasonCodes','materialFingerprint','sourceToken','evidenceValidUntil','evidence','importance','rank','complete'])
    or jsonb_typeof(d->'target')<>'object' or not(d->'target' ?& array['type','id']) or (select count(*) from jsonb_object_keys(d->'target'))<>2
    or d->>'truth' not in ('true','false','unknown') or jsonb_typeof(d->'complete')<>'boolean'
    or jsonb_typeof(d->'rank')<>'number' or (d->>'rank')::integer not between 0 and 5
    or d->>'importance' not in ('critical','high','normal') or d->>'materialFingerprint' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(d->'reasonCodes')<>'array' or jsonb_array_length(d->'reasonCodes')>7 then return false; end if;
  if d->>'truth'<>'unknown' and d->>'sourceToken' !~ '^[0-9a-f]{64}$' then return false; end if;
  select array_agg(x) into reasons from jsonb_array_elements_text(d->'reasonCodes') x;
  if cardinality(reasons)>0 and not private.agent_pulse_reasons(reasons) then return false; end if;
  if d->>'truth'='true' and coalesce(cardinality(reasons),0)=0 then return false; end if;
  e:=d->'evidence'; target:=d->'target'->>'type'; id:=(d->'target'->>'id')::uuid; family:=d->>'family';
  if family not in ('deadline','important_work','quiet_project','tomorrow') or target not in ('task','milestone','project','workspace_day')
    or (family='important_work' and target<>'task') or (family='quiet_project' and target<>'project') or ((family='tomorrow')<>(target='workspace_day')) then return false; end if;
  expected_key:=target||':'||id||':'||case when target='task' then 'attention' else family end;
  if target='workspace_day' then expected_key:=expected_key||':'||(e->>'date')::date::text; end if;
  if d->>'key' is distinct from expected_key or length(d->>'key')>160 then return false; end if;
  if jsonb_typeof(e)<>'object' or octet_length(e::text)>2048 or not(e ?& array['title','summary','explanation','evaluatedAt'])
    or jsonb_typeof(e->'title')<>'string' or length(e->>'title')>120 or jsonb_typeof(e->'summary')<>'string' or length(e->>'summary')>400
    or jsonb_typeof(e->'explanation')<>'string' or length(e->>'explanation')>240 or not isfinite((e->>'evaluatedAt')::timestamptz)
    or exists(select 1 from jsonb_object_keys(e) x where x not in ('title','summary','explanation','evaluatedAt','date','status','issue','checkedStart','checkedEnd','taskCount','milestoneCount','projectCount','occupancyPercent','occupancyIssue','lastActivityAt','thresholdDays')) then return false; end if;
  for k in select jsonb_object_keys(e) loop
    if jsonb_typeof(e->k) not in ('string','number','null') then return false; end if;
    if k not in ('title','summary','explanation') and length(e->>k)>100 then return false; end if;
  end loop;
  if d ? 'expectedRowRevision' and (jsonb_typeof(d->'expectedRowRevision')<>'number' or (d->>'expectedRowRevision')::bigint<1) then return false; end if;
  return true;
exception when others then return false;
end;$$;

create function private.agent_pulse_commit_dto(p private.agent_pulses) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('commitId',p.deterministic_commit_id,'createdCount',p.created_count,'updatedCount',p.updated_count,'resolvedCount',p.resolved_count,'partial',coalesce(p.coverage->>'complete','false')<>'true');
$$;
create function public.agent_pulse_publish_deterministic(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint,p_settings_revision bigint,p_commit_id uuid,p_scan jsonb,p_baseline jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare v_pulse private.agent_pulses; o private.agent_observations; d jsonb; decisions jsonb; cov jsonb; snapshot jsonb; refs jsonb;
  at_time timestamptz; tick timestamptz; canonical text; lost boolean; changed boolean; reopen boolean; new_episode boolean;
  live_count integer; total_count integer; suppressed integer; created integer:=0; updated integer:=0; resolved integer:=0;
  was_found boolean; partial boolean:=false; meaningful boolean:=false; accepted text[]:='{}'; pair record; base jsonb; state_value text;
begin
  v_pulse:=private.agent_pulse_guard(p_user_id,p_pulse_id,p_lease_token,p_fence,p_settings_revision);
  if p_commit_id is null then raise exception 'Invalid commit' using errcode='22023'; end if;
  if v_pulse.deterministic_commit_id is not null then
    if v_pulse.deterministic_commit_id<>p_commit_id then raise exception 'COMMIT_CONFLICT' using errcode='40001'; end if;
    return private.agent_pulse_commit_dto(v_pulse);
  end if;
  decisions:=p_scan->'decisions'; cov:=p_scan->'coverage';
  if jsonb_typeof(p_scan)<>'object' or (select count(*) from jsonb_object_keys(p_scan))<>2 or jsonb_typeof(decisions)<>'array' or jsonb_array_length(decisions)>23
    or exists(select 1 from jsonb_array_elements(decisions) x where not private.agent_pulse_decision_valid(x))
    or (select count(distinct x->>'key') from jsonb_array_elements(decisions) x)<>jsonb_array_length(decisions)
    or jsonb_typeof(cov)<>'object' or not(cov ?& array['true','false','unknown','complete','collections']) or (select count(*) from jsonb_object_keys(cov))<>5
    or jsonb_typeof(cov->'complete')<>'boolean' or jsonb_typeof(cov->'collections')<>'object'
    or (select count(*) from jsonb_object_keys(cov->'collections'))<>4 or not(cov->'collections' ?& array['projects','tasks','milestones','blocks'])
    or exists(select 1 from jsonb_each(cov->'collections') x where jsonb_typeof(x.value)<>'boolean')
    or exists(select 1 from jsonb_each(cov-'collections'-'complete') x where jsonb_typeof(x.value)<>'number' or (x.value::text)::integer not between 0 and 1000)
    or jsonb_typeof(p_baseline)<>'object' or octet_length(p_baseline::text)>16384 then raise exception 'Invalid scan' using errcode='22023'; end if;
  for pair in select * from jsonb_each_text(p_baseline) loop
    if pair.value !~ '^[0-9a-f]{64}$' or not exists(select 1 from jsonb_array_elements(decisions) x where pair.key=x->>'key'
      or pair.key in ((x->>'key')||'/deadline',(x->>'key')||'/important_work',(x->>'key')||'/quiet_project',(x->>'key')||'/tomorrow',
        (x->>'key')||'/taskCount',(x->>'key')||'/milestoneCount',(x->>'key')||'/projectCount',(x->>'key')||'/occupancy')) then raise exception 'Invalid baseline' using errcode='22023'; end if;
  end loop;
  at_time:=coalesce((decisions->0->'evidence'->>'evaluatedAt')::timestamptz,clock_timestamp());
  if at_time<v_pulse.started_at or at_time>clock_timestamp() or exists(select 1 from jsonb_array_elements(decisions) x where (x->'evidence'->>'evaluatedAt')::timestamptz<>at_time) then raise exception 'Invalid evaluation time' using errcode='22023'; end if;
  select coalesce(jsonb_agg(x.v),'[]') into refs from (select jsonb_build_object('key',condition_key,'target',jsonb_build_object('type',target_type,'id',target_id)) v
    from private.agent_observations where user_id=p_user_id and kind='signal' order by rank,last_changed_at desc,id limit 20) x;
  snapshot:=private.agent_pulse_source_projection(p_user_id,at_time,refs);
  perform 1 from private.agent_observations where user_id=p_user_id and condition_key in(select x->>'key' from jsonb_array_elements(decisions) x) order by id for update;
  for d in select value from jsonb_array_elements(decisions) loop
    tick:=clock_timestamp();
    if tick>=v_pulse.lease_expires_at then raise exception 'AUTHORITY_LOST' using errcode='40001'; end if;
    select * into o from private.agent_observations where user_id=p_user_id and condition_key=d->>'key'; was_found:=found;
    if was_found and (d->>'expectedRowRevision')::bigint is distinct from o.row_revision then partial:=true; continue; end if;
    if d->>'truth'='unknown' then
      partial:=true;
      if was_found then update private.agent_observations set last_checked_at=tick,evidence_valid_until=least(evidence_valid_until,tick),row_revision=row_revision+1,latest_pulse_id=p_pulse_id where id=o.id; updated:=updated+1; end if;
      continue;
    end if;
    canonical:=coalesce(snapshot->'sourceTokens'->>(d->>'key'),snapshot->'targetChecks'->(d->>'key')->>'sourceToken');
    lost:=coalesce(snapshot->'targetChecks'->(d->>'key')->>'exists'='false',false);
    if canonical is null or canonical is distinct from d->>'sourceToken' or (not lost and ((d->>'evidenceValidUntil')::timestamptz is null or (d->>'evidenceValidUntil')::timestamptz<=tick)) then partial:=true; continue; end if;
    if not (d->>'complete')::boolean then partial:=true; end if;
    select count(*) filter(where state in ('active','snoozed')),count(*),count(*) filter(where state in ('dismissed','resolved')) into live_count,total_count,suppressed from private.agent_observations where user_id=p_user_id;
    if not was_found then
      if d->>'truth'<>'true' then continue; end if;
      if created>=3 or live_count>=100 or total_count>=300 or suppressed>=200 then partial:=true; continue; end if;
      insert into private.agent_observations(user_id,condition_key,family,target_type,target_id,target_date,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,summary,explanation,importance,rank,origin_pulse_id,latest_pulse_id)
      values(p_user_id,d->>'key',d->>'family',d->'target'->>'type',(d->'target'->>'id')::uuid,case when d->'target'->>'type'='workspace_day' then (d->'evidence'->>'date')::date end,
        d->>'materialFingerprint',canonical,(d->>'evidenceValidUntil')::timestamptz,array(select jsonb_array_elements_text(d->'reasonCodes')),
        ((d->'evidence')-'title'-'summary'-'explanation')||jsonb_build_object('complete',(d->>'complete')::boolean),d->'evidence'->>'title',d->'evidence'->>'summary',d->'evidence'->>'explanation',d->>'importance',(d->>'rank')::integer,p_pulse_id,p_pulse_id);
      created:=created+1;
    else
      if updated>=20 then partial:=true; continue; end if;
      changed:=o.material_fingerprint<>d->>'materialFingerprint';
      reopen:=d->>'truth'='true' and (d->>'complete')::boolean and ((o.state in ('dismissed','resolved') and (changed or o.resolution_code='PROVEN_FALSE')) or (o.state='snoozed' and o.snooze_until<=tick));
      if reopen and o.state not in ('active','snoozed') and live_count>=100 then partial:=true; continue; end if;
      meaningful:=meaningful or changed or reopen or (lost and o.title<>'');
      state_value:=case when d->>'truth'='false' then 'resolved' when reopen then 'active' else o.state end;
      new_episode:=d->>'truth'='true' and ((changed and d->>'complete'='true') or (reopen and o.state<>'snoozed'));
      update private.agent_observations set state=state_value,snooze_until=case when state_value='snoozed' then snooze_until end,
        resolved_at=case when state_value='resolved' then coalesce(resolved_at,tick) end,
        resolution_code=case when lost then 'SOURCE_UNAVAILABLE' when d->>'truth'='false' then 'PROVEN_FALSE' when reopen then null else resolution_code end,
        episode=episode+case when new_episode then 1 else 0 end,
        ai_attempt_count=case when new_episode then 0 else ai_attempt_count end,
        ai_last_attempt_at=case when new_episode then null else ai_last_attempt_at end,
        ai_attempt_terminal=case when new_episode then false else ai_attempt_terminal end,
        material_fingerprint=case when d->>'complete'='true' then d->>'materialFingerprint' else material_fingerprint end,
        source_token=canonical,evidence_valid_until=coalesce((d->>'evidenceValidUntil')::timestamptz,tick),
        reason_codes=case when jsonb_array_length(d->'reasonCodes')>0 then array(select jsonb_array_elements_text(d->'reasonCodes')) else reason_codes end,
        evidence=case when lost then '{}'::jsonb else ((d->'evidence')-'title'-'summary'-'explanation')||jsonb_build_object('complete',(d->>'complete')::boolean) end,
        title=case when lost then '' else d->'evidence'->>'title' end,summary=case when lost then '' else d->'evidence'->>'summary' end,explanation=case when lost then '' else d->'evidence'->>'explanation' end,
        importance=d->>'importance',rank=(d->>'rank')::integer,last_checked_at=tick,
        last_changed_at=case when changed or reopen or lost then tick else last_changed_at end,
        content_revision=content_revision+case when changed or reopen or (lost and o.title<>'') then 1 else 0 end,
        row_revision=row_revision+1,latest_pulse_id=p_pulse_id where id=o.id;
      updated:=updated+1; if d->>'truth'='false' and o.state<>'resolved' then resolved:=resolved+1; end if;
    end if;
    accepted:=array_append(accepted,d->>'key');
  end loop;
  select baseline into base from private.agent_pulse_state where user_id=p_user_id;
  for pair in select * from jsonb_each_text(p_baseline) loop
    if exists(select 1 from unnest(accepted) key where pair.key=key or pair.key like key||'/%') then
      if octet_length((base||jsonb_build_object(pair.key,pair.value))::text)<=16384 then base:=base||jsonb_build_object(pair.key,pair.value); else partial:=true; end if;
    end if;
  end loop;
  if partial then cov:=jsonb_set(cov,'{complete}','false'); end if;
  cov:=cov||jsonb_build_object('meaningful',meaningful or created>0 or resolved>0,'checkedCounts',jsonb_build_object(
    'projects',jsonb_array_length(snapshot->'projects'),'tasks',jsonb_array_length(snapshot->'tasks'),
    'milestones',jsonb_array_length(snapshot->'milestones'),'blocks',jsonb_array_length(snapshot->'blocks')));
  if clock_timestamp()>=v_pulse.lease_expires_at then raise exception 'AUTHORITY_LOST' using errcode='40001'; end if;
  update private.agent_pulse_state set baseline=base,last_coverage=cov,last_deterministic_at=clock_timestamp() where user_id=p_user_id;
  update private.agent_pulses set deterministic_commit_id=p_commit_id,deterministic_committed_at=clock_timestamp(),coverage=cov,created_count=created,updated_count=updated,resolved_count=resolved where id=p_pulse_id returning * into v_pulse;
  return private.agent_pulse_commit_dto(v_pulse);
end;$$;

create function private.agent_pulse_ui_write(p_owner uuid) returns void language plpgsql set search_path='' as $$
declare s private.agent_pulse_state; tick timestamptz:=clock_timestamp();
begin
  select * into s from private.agent_pulse_state where user_id=p_owner for update;
  if not found then raise exception 'STATE_CHANGED' using errcode='40001'; end if;
  if s.ui_window_started_at>tick-interval '1 minute' and s.ui_write_count>=60 then raise exception 'RATE_LIMITED' using errcode='P0001'; end if;
  update private.agent_pulse_state set ui_window_started_at=case when s.ui_window_started_at>tick-interval '1 minute' then s.ui_window_started_at else tick end,
    ui_write_count=case when s.ui_window_started_at>tick-interval '1 minute' then s.ui_write_count+1 else 1 end where user_id=p_owner;
end;$$;
-- Match the existing strict wall-time helper: require exactly one round-trip instant.
create function private.agent_pulse_wall_time(p_wall timestamp,p_zone text) returns timestamptz language plpgsql stable set search_path='' as $$
declare result timestamptz; matches integer;
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then raise exception 'SNOOZE_TIME_INVALID' using errcode='22023'; end if;
  with offsets as (select distinct ((probe at time zone p_zone)-(probe at time zone 'UTC')) offset_value
    from (select (p_wall at time zone 'UTC')+g*interval '6 hours' probe from generate_series(-8,8) g) x),
    candidates as (select (p_wall at time zone 'UTC')-offset_value candidate from offsets)
  select min(candidate),count(*) into result,matches from candidates where candidate at time zone p_zone=p_wall;
  if matches<>1 then raise exception 'SNOOZE_TIME_INVALID' using errcode='22023'; end if;
  return result;
end;$$;
create function public.agent_pulse_feedback(p_user_id uuid,p_id uuid,p_row_revision bigint,p_action text,p_snooze_days integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.agent_observations; tick timestamptz; zone text; until_time timestamptz;
begin
  if p_action is null or p_action not in ('snooze','dismiss','resolve') or (p_action='snooze' and (p_snooze_days is null or p_snooze_days not in (1,3,7)))
    or (p_action<>'snooze' and p_snooze_days is not null) then raise exception 'Invalid feedback' using errcode='22023'; end if;
  perform private.agent_pulse_ui_write(p_user_id);
  select * into o from private.agent_observations where user_id=p_user_id and id=p_id for update;
  if not found or o.row_revision is distinct from p_row_revision then raise exception 'STATE_CHANGED' using errcode='40001'; end if;
  tick:=clock_timestamp();
  if p_action='snooze' then
    if o.state not in ('active','snoozed') and (select count(*) from private.agent_observations where user_id=p_user_id and state in ('active','snoozed'))>=100 then raise exception 'CAPACITY' using errcode='P0001'; end if;
    zone:=(select time_zone from public.profiles where id=p_user_id);
    until_time:=private.agent_pulse_wall_time((tick at time zone zone)+make_interval(days=>p_snooze_days),zone);
  end if;
  update private.agent_observations set state=case p_action when 'snooze' then 'snoozed' when 'dismiss' then 'dismissed' else 'resolved' end,
    snooze_until=until_time,revisit_at=until_time,resolved_at=case when p_action='resolve' then tick end,
    resolution_code=case when p_action='resolve' then 'USER' end,row_revision=row_revision+1,feedback_count=feedback_count+1 where id=o.id returning * into o;
  return jsonb_build_object('id',o.id,'state',o.state,'rowRevision',o.row_revision,'contentRevision',o.content_revision);
end;$$;
revoke all on function private.agent_pulse_decision_valid(jsonb),private.agent_pulse_commit_dto(private.agent_pulses),private.agent_pulse_ui_write(uuid),private.agent_pulse_wall_time(timestamp,text) from public,anon,authenticated,service_role;
revoke all on function public.agent_pulse_publish_deterministic(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,jsonb),public.agent_pulse_feedback(uuid,uuid,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.agent_pulse_publish_deterministic(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,jsonb),public.agent_pulse_feedback(uuid,uuid,bigint,text,integer) to service_role;

create function private.agent_pulse_usage(p_owner uuid,p_now timestamptz) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object(
  'ownerPulses',(select count(*) from private.agent_pulses where user_id=p_owner and started_at>p_now-interval '24 hours' and started_at<=p_now),
  'ownerRequests',(select count(*) from private.agent_pulses where user_id=p_owner and ai_reserved_at>p_now-interval '24 hours' and ai_reserved_at<=p_now),
  'installationRequests',(select count(*) from private.agent_pulse_installation_events where event_kind='provider_reservation' and created_at>p_now-interval '24 hours' and created_at<=p_now),
  'ownerIdeas',(select count(*) from private.agent_pulses where user_id=p_owner and idea_accepted_at>p_now-interval '24 hours' and idea_accepted_at<=p_now));
$$;
create function private.agent_pulse_ai_parent_eligible(p_owner uuid,p_parent private.agent_observations,p_now timestamptz,p_require_unseen boolean default true)
returns boolean language plpgsql stable set search_path='' as $$
declare s private.agent_pulse_state; source jsonb; project uuid;
begin
  select * into s from private.agent_pulse_state where user_id=p_owner;
  if not found or s.mode<>'workspace_ai' or s.ai_consent_version is distinct from 'ai-v1' or cardinality(s.ai_project_ids)=0
    or p_parent.kind<>'signal' or p_parent.state<>'active' or p_parent.evidence_valid_until<=p_now
    or p_parent.last_checked_at<=p_now-interval '24 hours' or p_parent.evidence->>'complete' is distinct from 'true'
    or (p_require_unseen and p_parent.seen_content_revision>=p_parent.content_revision)
    or exists(select 1 from unnest(s.ai_project_ids) scoped(project_id) where not exists(select 1 from public.projects p where p.id=scoped.project_id and p.user_id=p_owner)) then return false; end if;
  source:=private.agent_pulse_source_projection(p_owner,(p_parent.evidence->>'evaluatedAt')::timestamptz,
    jsonb_build_array(jsonb_build_object('key',p_parent.condition_key,'target',jsonb_build_object('type',p_parent.target_type,'id',p_parent.target_id))));
  if source->'sourceTokens'->>p_parent.condition_key is distinct from p_parent.source_token then return false; end if;
  if p_parent.target_type='project' then project:=p_parent.target_id;
  elsif p_parent.target_type='task' then select project_id into project from public.tasks where id=p_parent.target_id and user_id=p_owner;
  elsif p_parent.target_type='milestone' then select m.project_id into project from public.milestones m join public.projects p on p.id=m.project_id where m.id=p_parent.target_id and p.user_id=p_owner;
  else
    -- A workspace aggregate is in scope only when every contributing project/calendar fact is explicitly covered.
    return not exists(select 1 from public.projects p where p.user_id=p_owner and not p.id=any(s.ai_project_ids))
      and not exists(select 1 from jsonb_array_elements(source->'blocks') b where b->>'status'='scheduled' and
        (b->>'projectId' is null or not (b->>'projectId')::uuid=any(s.ai_project_ids)));
  end if;
  return project is not null and project=any(s.ai_project_ids);
end;$$;

create function public.agent_pulse_reserve_ai(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint,p_settings_revision bigint,p_parent_id uuid,p_episode bigint)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare p private.agent_pulses; o private.agent_observations; u jsonb; tick timestamptz; operation uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  p:=private.agent_pulse_guard(p_user_id,p_pulse_id,p_lease_token,p_fence,p_settings_revision);
  if p.ai_reserved_at is not null then return jsonb_build_object('reserved',true,'recovered',true,'sendAllowed',false); end if;
  select * into o from private.agent_observations where id=p_parent_id and user_id=p_user_id for update;
  tick:=clock_timestamp();
  if not found or p.deterministic_commit_id is null or o.latest_pulse_id<>p.id or o.episode<>p_episode or not private.agent_pulse_ai_parent_eligible(p_user_id,o,tick) then
    return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','SOURCE_CHANGED');
  end if;
  if o.ai_attempt_terminal then return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','AI_MALFORMED'); end if;
  if o.ai_attempt_count>=2 or (o.ai_attempt_count=1 and o.ai_last_attempt_at>tick-interval '12 hours') or exists(select 1 from private.agent_observations where user_id=p_user_id and parent_observation_id=o.id and parent_episode=o.episode) then
    return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','BUDGET');
  end if;
  u:=private.agent_pulse_usage(p_user_id,tick);
  if (u->>'ownerRequests')::integer>=2 or (u->>'installationRequests')::integer>=4 then return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','BUDGET'); end if;
  if clock_timestamp()>=p.lease_expires_at then raise exception 'AUTHORITY_LOST' using errcode='40001'; end if;
  operation:=gen_random_uuid();
  update private.agent_pulses set ai_reserved_at=tick,installation_reservation_key=operation,ai_outcome='reserved',ai_parent_id=o.id,ai_parent_episode=o.episode,ai_attempt_number=o.ai_attempt_count+1 where id=p.id;
  insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) values('provider_reservation',operation,tick);
  update private.agent_observations set ai_attempt_count=ai_attempt_count+1,ai_last_attempt_at=tick where id=o.id;
  return jsonb_build_object('reserved',true,'recovered',false,'sendAllowed',true);
end;$$;

create function public.agent_pulse_publish_ai(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint,p_settings_revision bigint,p_idea jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare p private.agent_pulses; o private.agent_observations; existing uuid; tick timestamptz; category text; u jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  p:=private.agent_pulse_guard(p_user_id,p_pulse_id,p_lease_token,p_fence,p_settings_revision);
  if p.ai_reserved_at is null or p.ai_parent_id is null then raise exception 'Reservation required' using errcode='22023'; end if;
  select * into o from private.agent_observations where user_id=p_user_id and id=p.ai_parent_id for update;
  select id into existing from private.agent_observations where user_id=p_user_id and kind='idea' and origin_pulse_id=p.id;
  if existing is not null then return jsonb_build_object('accepted',true,'recovered',true,'id',existing); end if;
  if jsonb_typeof(p_idea)<>'object' or not(p_idea ?& array['category','title','summary']) or (select count(*) from jsonb_object_keys(p_idea))<>3
    or jsonb_typeof(p_idea->'title')<>'string' or length(btrim(p_idea->>'title')) not between 1 and 120
    or jsonb_typeof(p_idea->'summary')<>'string' or length(btrim(p_idea->>'summary')) not between 1 and 400
    or p_idea->>'category' not in ('review_deadline','consider_scheduling','review_quiet_project','review_tomorrow') then
    update private.agent_pulses set ai_outcome='malformed' where id=p.id;
    update private.agent_observations set ai_attempt_terminal=true where id=o.id and episode=p.ai_parent_episode;
    return jsonb_build_object('accepted',false,'reason','AI_MALFORMED');
  end if;
  tick:=clock_timestamp(); category:=p_idea->>'category';
  if p.ai_outcome='malformed' or o.episode<>p.ai_parent_episode or not private.agent_pulse_ai_parent_eligible(p_user_id,o,tick)
    or not ((category='review_deadline' and o.family='deadline') or (category='consider_scheduling' and 'IMPORTANT_NO_WORK'=any(o.reason_codes))
      or (category='review_quiet_project' and o.family='quiet_project') or (category='review_tomorrow' and o.family='tomorrow')) then
    return jsonb_build_object('accepted',false,'reason','SOURCE_CHANGED');
  end if;
  u:=private.agent_pulse_usage(p_user_id,tick);
  if (u->>'ownerIdeas')::integer>=2 then return jsonb_build_object('accepted',false,'reason','BUDGET'); end if;
  if (select count(*) from private.agent_observations where user_id=p_user_id)>=300
    or (select count(*) from private.agent_observations where user_id=p_user_id and state in ('active','snoozed'))>=100
    or (select count(*) from private.agent_observations where user_id=p_user_id and state in ('dismissed','resolved'))>=200 then return jsonb_build_object('accepted',false,'reason','CAPACITY'); end if;
  select id into existing from private.agent_observations where user_id=p_user_id and parent_observation_id=o.id and parent_episode=o.episode and idea_category=category;
  if existing is not null then return jsonb_build_object('accepted',true,'recovered',true,'id',existing); end if;
  if clock_timestamp()>=p.lease_expires_at then raise exception 'AUTHORITY_LOST' using errcode='40001'; end if;
  insert into private.agent_observations(user_id,kind,condition_key,family,target_type,target_id,target_date,parent_observation_id,parent_episode,idea_category,
    material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,summary,importance,rank,origin_pulse_id,latest_pulse_id)
    values(p_user_id,'idea','idea:'||o.id||':'||o.episode||':'||category,null,o.target_type,o.target_id,o.target_date,o.id,o.episode,category,
      o.material_fingerprint,o.source_token,tick+interval '7 days',o.reason_codes,o.evidence,btrim(p_idea->>'title'),btrim(p_idea->>'summary'),o.importance,5,p.id,p.id) returning id into existing;
  update private.agent_pulses set idea_accepted_at=tick,ai_outcome='accepted' where id=p.id;
  return jsonb_build_object('accepted',true,'recovered',false,'id',existing);
end;$$;
revoke all on function private.agent_pulse_usage(uuid,timestamptz),private.agent_pulse_ai_parent_eligible(uuid,private.agent_observations,timestamptz,boolean) from public,anon,authenticated,service_role;
revoke all on function public.agent_pulse_reserve_ai(uuid,uuid,uuid,bigint,bigint,uuid,bigint),public.agent_pulse_publish_ai(uuid,uuid,uuid,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.agent_pulse_reserve_ai(uuid,uuid,uuid,bigint,bigint,uuid,bigint),public.agent_pulse_publish_ai(uuid,uuid,uuid,bigint,bigint,jsonb) to service_role;

create function public.agent_pulse_get_settings(p_user_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
with state as (select * from private.agent_pulse_state where user_id=p_user_id), owned as (
  select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) ids from public.projects p,state s where p.user_id=p_user_id and p.id=any(s.ai_project_ids))
select jsonb_build_object('mode',case when s.mode<>'off' and s.checks_consent_version is distinct from 'checks-v1' then 'off' else coalesce(s.mode,'off') end,
  'cadence',coalesce(s.cadence,'normal'),'settingsRevision',coalesce(s.settings_revision,0),'policyVersion','pulse-v1',
  'checksConsented',coalesce(s.checks_consent_version='checks-v1',false),'aiConsented',coalesce(s.ai_consent_version='ai-v1',false),
  'aiProjectIds',owned.ids,'aiEligible',coalesce(s.mode='workspace_ai' and s.checks_consent_version='checks-v1' and s.ai_consent_version='ai-v1'
    and cardinality(owned.ids)>0 and cardinality(owned.ids)=cardinality(s.ai_project_ids),false),
  'nextDueAt',private.agent_pulse_stamp(s.next_due_at),'lastSuccessAt',private.agent_pulse_stamp(s.last_success_at),
  'lastDeterministicAt',private.agent_pulse_stamp(s.last_deterministic_at),
  'coverage',jsonb_build_object('complete',coalesce(s.last_coverage->'complete','false'::jsonb),'unknown',coalesce(s.last_coverage->'unknown','0'::jsonb)),
  'usage',private.agent_pulse_usage(p_user_id,clock_timestamp())) from owned left join state s on true;
$$;
create function public.agent_pulse_set_settings(p_user_id uuid,p_expected_revision bigint,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.agent_pulse_state; scope uuid[]; inserted integer; tick timestamptz;
begin
  if p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>4096
    or not(p_input ?& array['mode','cadence','checksConsent','aiConsent','aiProjectIds']) or (select count(*) from jsonb_object_keys(p_input))<>5
    or jsonb_typeof(p_input->'mode')<>'string' or jsonb_typeof(p_input->'cadence')<>'string'
    or p_input->>'mode' not in ('off','workspace','workspace_ai') or p_input->>'cadence' not in ('normal','quiet')
    or jsonb_typeof(p_input->'checksConsent')<>'boolean' or jsonb_typeof(p_input->'aiConsent')<>'boolean' or jsonb_typeof(p_input->'aiProjectIds')<>'array'
    or (p_input->>'mode'<>'off' and p_input->>'checksConsent'<>'true') or (p_input->>'mode'='workspace_ai' and p_input->>'aiConsent'<>'true') then
    raise exception 'Invalid settings' using errcode='22023';
  end if;
  begin select coalesce(array_agg(x::uuid),'{}') into scope from jsonb_array_elements_text(p_input->'aiProjectIds') x;
  exception when invalid_text_representation then raise exception 'Invalid scope' using errcode='22023'; end;
  if not private.agent_pulse_uuid_scope(scope) or (p_input->>'aiConsent'='false' and cardinality(scope)>0)
    or exists(select 1 from unnest(scope) scoped(project_id) where not exists(select 1 from public.projects p where p.id=scoped.project_id and p.user_id=p_user_id)) then
    raise exception 'Invalid scope' using errcode='22023';
  end if;
  -- Returning usage participates in accounting reads, so acquire the installation lock first.
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  insert into private.agent_pulse_state(user_id) values(p_user_id) on conflict do nothing;
  get diagnostics inserted=row_count;
  select * into s from private.agent_pulse_state where user_id=p_user_id for update;
  if (inserted=1 and p_expected_revision<>0) or (inserted=0 and p_expected_revision<>s.settings_revision) then raise exception 'STATE_CHANGED' using errcode='40001'; end if;
  perform private.agent_pulse_ui_write(p_user_id);
  tick:=clock_timestamp();
  update private.agent_pulse_state set mode=p_input->>'mode',cadence=p_input->>'cadence',
    checks_consent_version=case when p_input->>'checksConsent'='true' then 'checks-v1' end,checks_consented_at=case when p_input->>'checksConsent'='true' then tick end,
    ai_consent_version=case when p_input->>'aiConsent'='true' then 'ai-v1' end,ai_consented_at=case when p_input->>'aiConsent'='true' then tick end,
    ai_project_ids=scope,settings_revision=case when inserted=1 then 1 else settings_revision+1 end,policy_version='pulse-v1',
    fence=fence+1,lease_token=null,lease_expires_at=null,updated_at=tick,
    next_due_at=case when p_input->>'mode'<>'off' then date_bin(interval '4 hours',tick,timestamptz '1970-01-01')+interval '4 hours' end where user_id=p_user_id;
  return public.agent_pulse_get_settings(p_user_id);
end;$$;
revoke all on function public.agent_pulse_get_settings(uuid),public.agent_pulse_set_settings(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.agent_pulse_get_settings(uuid),public.agent_pulse_set_settings(uuid,bigint,jsonb) to service_role;

-- Fixed safe projection; reads withdraw stale source text without persisting anything.
create function private.agent_pulse_safe_observation(p private.agent_observations,p_now timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare source jsonb; parent private.agent_observations; source_key text; stale boolean; unavailable boolean; label text:='';
begin
  parent:=p;
  if p.kind='idea' then
    select * into parent from private.agent_observations where user_id=p.user_id and id=p.parent_observation_id;
    if not found then parent:=null; end if;
  end if;
  source_key:=coalesce(parent.condition_key,p.condition_key);
  source:=private.agent_pulse_source_projection(p.user_id,coalesce((parent.evidence->>'evaluatedAt')::timestamptz,p.last_checked_at),
    jsonb_build_array(jsonb_build_object('key',source_key,'target',jsonb_build_object('type',p.target_type,'id',p.target_id))));
  unavailable:=p.target_type<>'workspace_day' and coalesce(source->'targetChecks'->source_key->>'exists','false')<>'true';
  stale:=unavailable or coalesce(source->'sourceTokens'->>source_key,'')<>p.source_token or p.evidence_valid_until<=p_now
    or parent.last_checked_at<=p_now-interval '24 hours' or (p.state in ('dismissed','resolved') and p.last_changed_at<=p_now-interval '30 days');
  if p.kind='idea' then stale:=stale or parent.id is null or p.parent_episode<>parent.episode or not private.agent_pulse_ai_parent_eligible(p.user_id,parent,p_now,false); end if;
  if not unavailable then
    select x->>'title' into label from jsonb_array_elements(case p.target_type when 'task' then source->'tasks' when 'milestone' then source->'milestones' else source->'projects' end) x where x->>'id'=p.target_id::text limit 1;
    if p.target_type='workspace_day' then label:='Tomorrow workload review'; end if;
  end if;
  return jsonb_build_object('id',p.id,'kind',p.kind,'title',case when unavailable then '' when stale then coalesce(label,'') else p.title end,
    'summary',case when stale then '' else p.summary end,'explanation',case when stale then '' else p.explanation end,
    'reasonCodes',case when stale then '{}'::text[] else p.reason_codes end,'state',p.state,
    'target',jsonb_build_object('type',p.target_type,'id',p.target_id),'rowRevision',p.row_revision,'contentRevision',p.content_revision,
    'seen',p.seen_content_revision>=p.content_revision,'watching',coalesce(p.state='active' and p.revisit_at<=p_now,false),'stale',coalesce(stale,true),'unavailable',unavailable,
    'firstNoticedAt',private.agent_pulse_stamp(p.first_noticed_at),'lastCheckedAt',private.agent_pulse_stamp(p.last_checked_at),
    'snoozeUntil',private.agent_pulse_stamp(p.snooze_until),'revisitAt',private.agent_pulse_stamp(p.revisit_at));
end;$$;
create function private.agent_pulse_cursor_valid(p jsonb,p_owner uuid,p_filter text,p_journal boolean)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  if p is null then return true; end if;
  if jsonb_typeof(p)<>'object' or octet_length(p::text)>1024 or p->>'v'<>'1'
    or p->>'ownerDigest' is distinct from private.agent_pulse_hash(to_jsonb(p_owner::text)) or p->>'filter' is distinct from p_filter
    or (p->>'id')::uuid is null then return false; end if;
  if p_journal then
    return (select count(*) from jsonb_object_keys(p))=5 and p ?& array['v','ownerDigest','filter','startedAt','id'] and isfinite((p->>'startedAt')::timestamptz);
  end if;
  return (select count(*) from jsonb_object_keys(p))=6 and p ?& array['v','ownerDigest','filter','rank','changedAt','id']
    and jsonb_typeof(p->'rank')='number' and (p->>'rank')::integer between 0 and 5 and isfinite((p->>'changedAt')::timestamptz);
exception when others then return false;
end;$$;
create function public.agent_pulse_get_observation(p_user_id uuid,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='5s' as $$
declare child private.agent_observations; parent private.agent_observations; item jsonb; parent_item jsonb;
  source jsonb; label text; context jsonb:=null; tick timestamptz:=clock_timestamp();
begin
  select * into child from private.agent_observations where user_id=p_user_id and id=p_id;
  if not found then return null; end if;
  item:=private.agent_pulse_safe_observation(child,tick);
  if coalesce((item->>'stale')::boolean,true) or coalesce((item->>'unavailable')::boolean,true) then
    return item||jsonb_build_object('reviewContext',null);
  end if;
  parent:=child;
  if child.kind='idea' then
    -- Only the canonical same-owner parent link supplies deterministic facts. Target matching is never a lookup.
    select * into parent from private.agent_observations where id=child.parent_observation_id and user_id=p_user_id;
    if not found or parent.kind<>'signal' or child.parent_episode is distinct from parent.episode
      or (child.target_type,child.target_id,child.target_date,child.source_token,child.material_fingerprint)
        is distinct from (parent.target_type,parent.target_id,parent.target_date,parent.source_token,parent.material_fingerprint)
      or not ((child.idea_category='review_deadline' and parent.family='deadline')
        or (child.idea_category='consider_scheduling' and 'IMPORTANT_NO_WORK'=any(parent.reason_codes))
        or (child.idea_category='review_quiet_project' and parent.family='quiet_project')
        or (child.idea_category='review_tomorrow' and parent.family='tomorrow')) then
      return item||jsonb_build_object('reviewContext',null);
    end if;
  end if;
  parent_item:=private.agent_pulse_safe_observation(parent,tick);
  if parent.kind<>'signal' or parent.evidence->>'complete' is distinct from 'true' or btrim(parent.summary)=''
    or coalesce((parent_item->>'stale')::boolean,true) or coalesce((parent_item->>'unavailable')::boolean,true) then
    return item||jsonb_build_object('reviewContext',null);
  end if;
  source:=private.agent_pulse_source_projection(p_user_id,(parent.evidence->>'evaluatedAt')::timestamptz,
    jsonb_build_array(jsonb_build_object('key',parent.condition_key,'target',jsonb_build_object('type',parent.target_type,'id',parent.target_id))));
  if source->'targetChecks'->parent.condition_key->>'complete' is distinct from 'true'
    or source->'targetChecks'->parent.condition_key->>'exists' is distinct from 'true'
    or source->'sourceTokens'->>parent.condition_key is distinct from parent.source_token then
    return item||jsonb_build_object('reviewContext',null);
  end if;
  if parent.target_type='workspace_day' then label:='Tomorrow workload review';
  else
    select x->>'title' into label from jsonb_array_elements(case parent.target_type when 'task' then source->'tasks'
      when 'milestone' then source->'milestones' when 'project' then source->'projects' else '[]'::jsonb end) x
      where x->>'id'=parent.target_id::text limit 1;
  end if;
  if label is not null and btrim(label)<>'' then
    context:=jsonb_build_object('targetLabel',left(label,120),'deterministicSummary',parent.summary,
      'deterministicExplanation',nullif(parent.explanation,''),'advisoryIdea',case when child.kind='idea'
        then jsonb_build_object('title',child.title,'summary',child.summary) else null end);
  end if;
  -- The additional detail-only field never enters Inbox list, Brief or Journal projections.
  return item||jsonb_build_object('reviewContext',context);
end;
$$;
create function public.agent_pulse_list_inbox(p_user_id uuid,p_state text,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='5s' as $$
declare result jsonb; tick timestamptz:=clock_timestamp();
begin
  if p_state is null or p_state not in ('active','snoozed','dismissed','resolved','all') or p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid page' using errcode='22023'; end if;
  if not coalesce(private.agent_pulse_cursor_valid(p_cursor,p_user_id,p_state,false),false) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  with rows as materialized (select o.* from private.agent_observations o where o.user_id=p_user_id and (p_state='all' or o.state=p_state)
    and (p_cursor is null or o.rank>(p_cursor->>'rank')::integer or (o.rank=(p_cursor->>'rank')::integer and
      (o.last_changed_at<(p_cursor->>'changedAt')::timestamptz or (o.last_changed_at=(p_cursor->>'changedAt')::timestamptz and o.id>(p_cursor->>'id')::uuid))))
    order by o.rank,o.last_changed_at desc,o.id limit p_limit+1), page as materialized(select * from rows order by rank,last_changed_at desc,id limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(private.agent_pulse_safe_observation(o,tick) order by rank,last_changed_at desc,id) from page o),'[]'),
    'nextCursor',case when (select count(*) from rows)>p_limit then (select jsonb_build_object('v',1,'ownerDigest',private.agent_pulse_hash(to_jsonb(p_user_id::text)),
      'filter',p_state,'rank',rank,'changedAt',private.agent_pulse_stamp(last_changed_at),'id',id) from page order by rank desc,last_changed_at,id desc limit 1) end) into result;
  return result;
end;$$;
create function public.agent_pulse_get_brief(p_user_id uuid) returns jsonb language sql stable security definer set search_path='' set statement_timeout='5s' as $$
with tick as materialized(select clock_timestamp() at), candidates as materialized (
  select o.target_type,o.target_id,o.rank,o.last_changed_at,o.id,
    coalesce(t.due_date,m.target_date,pr.target_date) deadline,
    case coalesce(t.priority,pr.priority,mp.priority) when 'Critical' then 0 when 'High' then 1 when 'Medium' then 2 else 3 end priority,
    private.agent_pulse_safe_observation(o,tick.at) item
  from private.agent_observations o cross join tick join private.agent_pulse_state s on s.user_id=p_user_id
  left join public.tasks t on o.target_type='task' and t.id=o.target_id and t.user_id=p_user_id
  left join public.projects pr on o.target_type='project' and pr.id=o.target_id and pr.user_id=p_user_id
  left join public.milestones m on o.target_type='milestone' and m.id=o.target_id
  left join public.projects mp on mp.id=m.project_id and mp.user_id=p_user_id
  where o.user_id=p_user_id and s.mode<>'off' and o.state='active' and o.seen_content_revision<o.content_revision
    and o.evidence_valid_until>tick.at and o.last_checked_at>tick.at-interval '24 hours'
    and (s.last_brief_ack_at is null or s.last_brief_ack_at<=tick.at-interval '24 hours')),
dedup as (select distinct on(target_type,target_id) * from candidates where item->>'stale'='false' and item->>'unavailable'='false'
  order by target_type,target_id,rank,deadline nulls last,priority,last_changed_at desc,id), chosen as (select * from dedup order by rank,deadline nulls last,priority,last_changed_at desc,id limit 5)
select jsonb_build_object('items',coalesce((select jsonb_agg(item order by rank,deadline nulls last,priority,last_changed_at desc,id) from chosen),'[]'),
  'lastCheckedAt',(select private.agent_pulse_stamp(last_deterministic_at) from private.agent_pulse_state where user_id=p_user_id));
$$;
create function public.agent_pulse_list_journal(p_user_id uuid,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid page' using errcode='22023'; end if;
  if not coalesce(private.agent_pulse_cursor_valid(p_cursor,p_user_id,'journal',true),false) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  with retained as materialized (select p.* from private.agent_pulses p where user_id=p_user_id and started_at>clock_timestamp()-interval '30 days'
    and summary is not null and (status in ('failed','partial','abandoned') or created_count>0 or resolved_count>0 or coverage->>'meaningful'='true' or ai_outcome in ('accepted','unavailable','malformed','timeout','unknown'))
    order by started_at desc,id desc limit 180), rows as materialized(select * from retained where p_cursor is null or started_at<(p_cursor->>'startedAt')::timestamptz
      or (started_at=(p_cursor->>'startedAt')::timestamptz and id<(p_cursor->>'id')::uuid) order by started_at desc,id desc limit p_limit+1),
    page as materialized(select * from rows order by started_at desc,id desc limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'startedAt',private.agent_pulse_stamp(started_at),
    'completedAt',private.agent_pulse_stamp(completed_at),'summary',summary,'createdCount',created_count,'updatedCount',updated_count,'resolvedCount',resolved_count,'aiOutcome',ai_outcome,'errorCode',error_code,
    'coverage',jsonb_build_object('complete',coalesce(coverage->'complete','false'::jsonb),'unknown',coalesce(coverage->'unknown','0'::jsonb)),
    'checkedCounts',coalesce(coverage->'checkedCounts',jsonb_build_object('projects',0,'tasks',0,'milestones',0,'blocks',0))) order by started_at desc,id desc) from page),'[]'),
    'nextCursor',case when (select count(*) from rows)>p_limit then (select jsonb_build_object('v',1,'ownerDigest',private.agent_pulse_hash(to_jsonb(p_user_id::text)),'filter','journal',
      'startedAt',private.agent_pulse_stamp(started_at),'id',id) from page order by started_at,id limit 1) end) into result;
  return result;
end;$$;

create function public.agent_pulse_ack(p_user_id uuid,p_items jsonb,p_brief boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare matched integer; tick timestamptz;
begin
  if jsonb_typeof(p_items)<>'array' or p_brief is null or jsonb_array_length(p_items) not between 1 and (case when p_brief then 5 else 20 end)
    or exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or not(x ?& array['id','contentRevision']) or (select count(*) from jsonb_object_keys(x))<>2
      or jsonb_typeof(x->'contentRevision')<>'number' or (x->>'contentRevision')::bigint<1)
    or (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then raise exception 'Invalid acknowledgement' using errcode='22023'; end if;
  perform private.agent_pulse_ui_write(p_user_id);
  perform 1 from private.agent_observations where user_id=p_user_id and id in(select (x->>'id')::uuid from jsonb_array_elements(p_items) x) order by id for update;
  select count(*) into matched from private.agent_observations o join jsonb_array_elements(p_items) x on o.id=(x->>'id')::uuid
    where o.user_id=p_user_id and o.content_revision=(x->>'contentRevision')::bigint;
  update private.agent_observations o set seen_content_revision=o.content_revision,row_revision=o.row_revision+1 from jsonb_array_elements(p_items) x
    where o.user_id=p_user_id and o.id=(x->>'id')::uuid and o.content_revision=(x->>'contentRevision')::bigint and o.seen_content_revision<o.content_revision;
  tick:=clock_timestamp();
  if p_brief and matched>0 then update private.agent_pulse_state set last_brief_ack_at=tick where user_id=p_user_id; end if;
  return jsonb_build_object('acknowledged',matched);
end;$$;
create function public.agent_pulse_clear_memory(p_user_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.agent_pulse_state; removed integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  select * into s from private.agent_pulse_state where user_id=p_user_id for update;
  if not found or s.settings_revision is distinct from p_expected_revision then raise exception 'STATE_CHANGED' using errcode='40001'; end if;
  perform private.agent_pulse_ui_write(p_user_id);
  perform 1 from private.agent_pulses where user_id=p_user_id order by id for update;
  perform 1 from private.agent_observations where user_id=p_user_id order by id for update;
  select count(*) into removed from private.agent_observations where user_id=p_user_id;
  delete from private.agent_observations where user_id=p_user_id and kind='idea';
  delete from private.agent_observations where user_id=p_user_id;
  update private.agent_pulses set summary=null where user_id=p_user_id and summary is not null;
  update private.agent_pulse_state set baseline='{}',last_coverage='{}',fence=fence+1,settings_revision=settings_revision+1,lease_token=null,lease_expires_at=null,
    next_due_at=case when mode<>'off' then date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')+interval '4 hours' end where user_id=p_user_id;
  return jsonb_build_object('cleared',removed,'settingsRevision',s.settings_revision+1);
end;$$;

create function public.agent_pulse_retain_installation(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare removed integer; tick timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid retention batch' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(505,5); tick:=clock_timestamp();
  delete from private.agent_pulse_installation_events where id in(select id from private.agent_pulse_installation_events
    where created_at<tick-interval '48 hours' order by created_at,id limit p_limit);
  get diagnostics removed=row_count;
  return jsonb_build_object('deleted',removed);
end;$$;
create function public.agent_pulse_retain(p_user_id uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare tick timestamptz; keep uuid[]; text_keep uuid[]; protected_count integer; touched integer:=0; row_value private.agent_pulses; o private.agent_observations;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid retention batch' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  perform 1 from private.agent_pulse_state where user_id=p_user_id for update;
  if not found then return jsonb_build_object('touched',0); end if;
  perform 1 from private.agent_pulses where user_id=p_user_id order by id for update;
  perform 1 from private.agent_observations where user_id=p_user_id order by id for update;
  tick:=clock_timestamp();
  -- Episode attempt authority lives on the signal; headers preserve provenance/accounting only.
  with protected as (select origin_pulse_id id from private.agent_observations where user_id=p_user_id
    union select latest_pulse_id from private.agent_observations where user_id=p_user_id
    union select id from private.agent_pulses where user_id=p_user_id and (started_at>=tick-interval '48 hours'
      or ai_reserved_at>=tick-interval '48 hours' or idea_accepted_at>=tick-interval '48 hours'))
  select coalesce(array_agg(id),'{}'),count(*) into keep,protected_count from protected;
  if protected_count>780 then raise exception 'CAPACITY' using errcode='P0001'; end if;
  text_keep:=array(select id from private.agent_pulses where user_id=p_user_id and summary is not null and started_at>tick-interval '30 days'
    and (status in ('failed','partial','abandoned') or created_count>0 or resolved_count>0 or coverage->>'meaningful'='true' or ai_outcome in ('accepted','unavailable','malformed','timeout','unknown')) order by started_at desc,id desc limit least(180,780-protected_count));
  keep:=keep||text_keep;
  for row_value in select * from private.agent_pulses where user_id=p_user_id and (not id=any(keep) or (summary is not null and not id=any(text_keep))) order by started_at,id loop
    exit when touched>=p_limit;
    if not row_value.id=any(keep) and row_value.started_at<tick-interval '48 hours'
      and (row_value.ai_reserved_at is null or row_value.ai_reserved_at<tick-interval '48 hours')
      and (row_value.idea_accepted_at is null or row_value.idea_accepted_at<tick-interval '48 hours') then delete from private.agent_pulses where id=row_value.id;
    elsif row_value.summary is not null then update private.agent_pulses set summary=null where id=row_value.id;
    else continue; end if;
    touched:=touched+1;
  end loop;
  for o in select * from private.agent_observations where user_id=p_user_id and state in ('dismissed','resolved') and last_changed_at<=tick-interval '30 days' and (title<>'' or summary<>'' or explanation<>'' or evidence<>'{}'::jsonb) order by id loop
    exit when touched>=p_limit;
    update private.agent_observations set title='',summary='',explanation='',evidence='{}',row_revision=row_revision+1,content_revision=content_revision+1 where id=o.id;
    touched:=touched+1;
  end loop;
  return jsonb_build_object('touched',touched);
end;$$;
revoke all on function private.agent_pulse_safe_observation(private.agent_observations,timestamptz),private.agent_pulse_cursor_valid(jsonb,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.agent_pulse_get_observation(uuid,uuid),public.agent_pulse_list_inbox(uuid,text,jsonb,integer),public.agent_pulse_get_brief(uuid),public.agent_pulse_list_journal(uuid,jsonb,integer),
  public.agent_pulse_ack(uuid,jsonb,boolean),public.agent_pulse_clear_memory(uuid,bigint),public.agent_pulse_retain(uuid,integer),public.agent_pulse_retain_installation(integer) from public,anon,authenticated;
grant execute on function public.agent_pulse_get_observation(uuid,uuid),public.agent_pulse_list_inbox(uuid,text,jsonb,integer),public.agent_pulse_get_brief(uuid),public.agent_pulse_list_journal(uuid,jsonb,integer),
  public.agent_pulse_ack(uuid,jsonb,boolean),public.agent_pulse_clear_memory(uuid,bigint),public.agent_pulse_retain(uuid,integer),public.agent_pulse_retain_installation(integer) to service_role;
