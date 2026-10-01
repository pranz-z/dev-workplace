-- Phase 2B migration: finalize the real workspace schema, ownership logic,
-- public access boundary, and indexes while preserving the Phase 1 baseline.
--
-- This file is fully self-contained. It intentionally does not use \i / \ir
-- because Supabase migration runners execute raw SQL only.

create or replace function private.owns_project(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.user_id = auth.uid()
  );
$$;

create or replace function private.owns_plan(p_plan_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.plans pl
    where pl.id = p_plan_id and pl.user_id = auth.uid()
  );
$$;

revoke all on function private.owns_project(uuid) from public;
revoke all on function private.owns_plan(uuid) from public;
grant execute on function private.owns_project(uuid) to authenticated;
grant execute on function private.owns_plan(uuid) to authenticated;

alter table public.projects add column if not exists slug text;
alter table public.projects add column if not exists project_type text not null default 'Personal';
alter table public.projects add column if not exists workflow_stage text not null default 'planning';
alter table public.projects add column if not exists priority text not null default 'Medium';
alter table public.projects add column if not exists visibility text not null default 'Private';
alter table public.projects add column if not exists team_size integer;
alter table public.projects add column if not exists current_objective text not null default '';
alter table public.projects add column if not exists next_action text not null default '';
alter table public.projects add column if not exists public_summary text;
alter table public.projects add column if not exists public_problem text;
alter table public.projects add column if not exists public_solution text;
alter table public.projects add column if not exists public_result text;
alter table public.projects add column if not exists repository_url text;
alter table public.projects add column if not exists demo_url text;
alter table public.projects add column if not exists docs_url text;
alter table public.projects add column if not exists health_documentation boolean not null default false;
alter table public.projects add column if not exists health_screenshots boolean not null default false;
alter table public.projects add column if not exists health_testing boolean not null default false;
alter table public.projects add column if not exists health_deployment boolean not null default false;
alter table public.projects add column if not exists github_repository_id bigint;
alter table public.projects add column if not exists github_repository_owner text;
alter table public.projects add column if not exists github_repository_name text;

update public.projects set workflow_stage = lower(workflow_stage) where workflow_stage <> lower(workflow_stage);

update public.projects
  set slug = nullif(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), '')
  where slug is null or slug = '';

update public.projects set slug = 'project-' || left(replace(id::text, '-', ''), 12) where slug is null or slug = '';

do $$
declare
  rec record;
  candidate text;
  suffix integer;
begin
  for rec in
    select id, slug from (
      select id, slug, row_number() over (partition by slug order by created_at, id) as rn
      from public.projects
    ) d
    where d.rn > 1
  loop
    suffix := 2;
    loop
      candidate := rec.slug || '-' || suffix;
      exit when not exists (select 1 from public.projects where slug = candidate);
      suffix := suffix + 1;
    end loop;
    update public.projects set slug = candidate where id = rec.id;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_slug_key' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_slug_key unique (slug);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_slug_format_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_slug_format_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_visibility_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_visibility_check check (visibility in ('Private', 'Public', 'Unlisted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_status_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_status_check
      check (status in ('Planning', 'In Development', 'Research', 'Testing', 'Deployment', 'Completed', 'Blocked', 'On Hold', 'Cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_workflow_stage_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_workflow_stage_check
      check (workflow_stage in ('idea', 'planning', 'research', 'development', 'testing', 'deployment', 'maintenance', 'completed', 'blocked', 'on_hold', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_priority_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_priority_check check (priority in ('Low', 'Medium', 'High', 'Critical'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_team_size_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_team_size_check check (team_size is null or team_size >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_date_order_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_date_order_check check (target_date is null or start_date is null or target_date >= start_date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_title_not_blank_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_title_not_blank_check check (length(btrim(title)) > 0);
  end if;
end $$;

create unique index if not exists profiles_username_lower_key on public.profiles (lower(username)) where username is not null;
create index if not exists projects_user_id_idx on public.projects (user_id);
create index if not exists projects_public_visibility_idx on public.projects (visibility, is_featured desc, updated_at desc) where visibility <> 'Private';
create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_project_id_idx on public.tasks (project_id);
create index if not exists tasks_milestone_id_idx on public.tasks (milestone_id);
create index if not exists tasks_due_date_idx on public.tasks (due_date) where status <> 'Completed';
create index if not exists milestones_project_id_idx on public.milestones (project_id);
create index if not exists plans_user_id_idx on public.plans (user_id);
create index if not exists project_plan_items_plan_id_idx on public.project_plan_items (plan_id);
create index if not exists project_plan_items_project_id_idx on public.project_plan_items (project_id);
create index if not exists notes_user_id_idx on public.notes (user_id);
create index if not exists notes_project_id_idx on public.notes (project_id);
create index if not exists project_technologies_technology_id_idx on public.project_technologies (technology_id);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_settings enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.plans enable row level security;
alter table public.project_plan_items enable row level security;
alter table public.notes enable row level security;
alter table public.technologies enable row level security;
alter table public.project_technologies enable row level security;

drop policy if exists "own profile" on public.profiles;
drop policy if exists "own projects" on public.projects;
drop policy if exists "own project settings" on public.project_settings;
drop policy if exists "own milestones" on public.milestones;
drop policy if exists "own tasks" on public.tasks;
drop policy if exists "own plans" on public.plans;
drop policy if exists "own project plan items" on public.project_plan_items;
drop policy if exists "own notes" on public.notes;
drop policy if exists "own technologies" on public.technologies;
drop policy if exists "own project technologies" on public.project_technologies;

create policy "own profile" on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "own projects" on public.projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own project settings" on public.project_settings for all to authenticated
  using (private.owns_project(project_id)) with check (private.owns_project(project_id));

create policy "own milestones" on public.milestones for all to authenticated
  using (private.owns_project(project_id)) with check (private.owns_project(project_id));

create policy "own tasks" on public.tasks for all to authenticated
  using (user_id = auth.uid() and private.owns_project(project_id))
  with check (user_id = auth.uid() and private.owns_project(project_id));

create policy "own plans" on public.plans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own project plan items" on public.project_plan_items for all to authenticated
  using (private.owns_plan(plan_id)) with check (private.owns_plan(plan_id));

create policy "own notes" on public.notes for all to authenticated
  using (user_id = auth.uid() and (project_id is null or private.owns_project(project_id)))
  with check (user_id = auth.uid() and (project_id is null or private.owns_project(project_id)));

create policy "own technologies" on public.technologies for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own project technologies" on public.project_technologies for all to authenticated
  using (
    private.owns_project(project_id)
    and exists (select 1 from public.technologies t where t.id = technology_id and t.user_id = auth.uid())
  )
  with check (
    private.owns_project(project_id)
    and exists (select 1 from public.technologies t where t.id = technology_id and t.user_id = auth.uid())
  );

drop function if exists public.public_project_by_slug(text);
drop function if exists public.public_project_list();
drop function if exists private.public_project_rows(text, boolean);
drop type if exists public.public_project_card cascade;

create type public.public_project_card as (
  id uuid,
  slug text,
  title text,
  description text,
  project_type text,
  status text,
  workflow_stage text,
  role text,
  team_size integer,
  start_date date,
  target_date date,
  is_featured boolean,
  visibility text,
  public_summary text,
  public_problem text,
  public_solution text,
  public_result text,
  repository_url text,
  demo_url text,
  docs_url text,
  health_documentation boolean,
  health_screenshots boolean,
  health_testing boolean,
  health_deployment boolean,
  show_github_activity boolean,
  show_commit_count boolean,
  show_streak boolean,
  show_accountability boolean,
  show_live_demo boolean,
  show_repository boolean,
  technologies text[],
  total_tasks integer,
  completed_tasks integer,
  total_milestones integer,
  completed_milestones integer,
  progress integer,
  updated_at timestamptz
);

create or replace function private.public_project_rows(p_slug text default null, p_include_unlisted boolean default false)
returns setof public.public_project_card
language sql
security definer
stable
set search_path = ''
as $$
  with task_stats as (
    select t.project_id, count(*)::int as total, count(*) filter (where t.status = 'Completed')::int as completed
    from public.tasks t
    group by t.project_id
  ),
  milestone_stats as (
    select m.project_id, count(*)::int as total, count(*) filter (where m.status = 'completed')::int as completed
    from public.milestones m
    group by m.project_id
  ),
  base as (
    select
      p.id, p.slug, p.title, p.description, p.project_type, p.status, p.workflow_stage, p.role, p.team_size,
      p.start_date, p.target_date, p.is_featured, p.visibility,
      p.public_summary, p.public_problem, p.public_solution, p.public_result,
      p.repository_url, p.demo_url, p.docs_url,
      p.health_documentation, p.health_screenshots, p.health_testing, p.health_deployment,
      p.updated_at,
      coalesce(ts.total, 0) as total_tasks,
      coalesce(ts.completed, 0) as completed_tasks,
      coalesce(ms.total, 0) as total_milestones,
      coalesce(ms.completed, 0) as completed_milestones,
      coalesce(s.show_github_activity, false) as show_github_activity,
      coalesce(s.show_commit_count, false) as show_commit_count,
      coalesce(s.show_streak, false) as show_streak,
      coalesce(s.show_accountability, false) as show_accountability,
      coalesce(s.show_live_demo, false) as show_live_demo,
      coalesce(s.show_repository, false) as show_repository,
      case p.workflow_stage
        when 'idea' then 0 when 'planning' then 1 when 'research' then 2 when 'development' then 3
        when 'testing' then 4 when 'deployment' then 5 when 'maintenance' then 6 when 'completed' then 7
        else null
      end as stage_index
    from public.projects p
    left join public.project_settings s on s.project_id = p.id
    left join task_stats ts on ts.project_id = p.id
    left join milestone_stats ms on ms.project_id = p.id
    where (p.visibility = 'Public' or (p_include_unlisted and p.visibility = 'Unlisted'))
      and (p_slug is null or p.slug = p_slug)
  ),
  scored as (
    select
      b.*,
      case when b.stage_index is null then 0 else b.stage_index::numeric / 7 end as workflow_value,
      case when b.total_tasks = 0 then 0 else b.completed_tasks::numeric / b.total_tasks end as task_value,
      case when b.total_milestones = 0 then 0 else b.completed_milestones::numeric / b.total_milestones end as milestone_value,
      case when b.stage_index is null then 0 else 0.40 end as workflow_weight,
      case when b.total_tasks = 0 then 0 else 0.25 end as task_weight,
      case when b.total_milestones = 0 then 0 else 0.35 end as milestone_weight
    from base b
  )
  select
    s.id, s.slug, s.title, s.description, s.project_type, s.status, s.workflow_stage, s.role, s.team_size,
    s.start_date, s.target_date, s.is_featured, s.visibility,
    s.public_summary, s.public_problem, s.public_solution, s.public_result,
    s.repository_url, s.demo_url, s.docs_url,
    s.health_documentation, s.health_screenshots, s.health_testing, s.health_deployment,
    s.show_github_activity, s.show_commit_count, s.show_streak, s.show_accountability, s.show_live_demo, s.show_repository,
    coalesce((
      select array_agg(t.name order by t.name)
      from public.project_technologies pt
      join public.technologies t on t.id = pt.technology_id
      where pt.project_id = s.id
    ), '{}'::text[]),
    s.total_tasks, s.completed_tasks, s.total_milestones, s.completed_milestones,
    (case
      when (s.workflow_weight + s.task_weight + s.milestone_weight) = 0 then 0
      else round((
        (s.workflow_value * s.workflow_weight + s.task_value * s.task_weight + s.milestone_value * s.milestone_weight)
        / (s.workflow_weight + s.task_weight + s.milestone_weight)
      ) * 100)::int
    end),
    s.updated_at
  from scored s
  order by s.is_featured desc, s.updated_at desc;
$$;

revoke all on function private.public_project_rows(text, boolean) from public;
revoke all on function private.public_project_rows(text, boolean) from anon;
revoke all on function private.public_project_rows(text, boolean) from authenticated;

create or replace function public.public_project_list()
returns setof public.public_project_card
language sql
security definer
stable
set search_path = ''
as $$
  select * from private.public_project_rows(null, false);
$$;

create or replace function public.public_project_by_slug(p_slug text)
returns setof public.public_project_card
language sql
security definer
stable
set search_path = ''
as $$
  select * from private.public_project_rows(p_slug, true)
  where p_slug is not null and length(btrim(p_slug)) > 0 and length(p_slug) <= 120;
$$;

revoke all on function public.public_project_list() from public;
revoke all on function public.public_project_by_slug(text) from public;
grant execute on function public.public_project_list() to anon, authenticated;
grant execute on function public.public_project_by_slug(text) to anon, authenticated;

revoke all on public.profiles from anon;
revoke all on public.projects from anon;
revoke all on public.project_settings from anon;
revoke all on public.milestones from anon;
revoke all on public.tasks from anon;
revoke all on public.plans from anon;
revoke all on public.project_plan_items from anon;
revoke all on public.notes from anon;
revoke all on public.technologies from anon;
revoke all on public.project_technologies from anon;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_settings to authenticated;
grant select, insert, update, delete on public.milestones to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.plans to authenticated;
grant select, insert, update, delete on public.project_plan_items to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
grant select, insert, update, delete on public.technologies to authenticated;
grant select, insert, update, delete on public.project_technologies to authenticated;

comment on table public.projects is 'Workspace projects. `id` is internal (uuid); `slug` is the globally unique public identifier used by /view/project/<slug>.';
comment on column public.projects.slug is 'Globally unique, lowercase, hyphenated. Generated by lib/slug.ts with collision suffixes.';
comment on column public.projects.visibility is 'Private (owner only), Public (portfolio list + detail), Unlisted (exact share link only, never listed).';
comment on column public.projects.workflow_stage is 'Lowercase pipeline stage. blocked/on_hold/cancelled are excluded from the progress calculation.';
comment on table public.project_settings is 'Per-project display switches (1:1 with projects). Replaces the Phase 1 project_metadata table.';
comment on function public.public_project_list() is 'Public portfolio list. Public projects only; explicit safe column list; callable by anon.';
comment on function public.public_project_by_slug(text) is 'Public share-link lookup by exact slug. Allows Public and Unlisted; exact slug match prevents enumeration.';
