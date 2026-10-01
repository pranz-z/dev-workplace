-- =============================================================================
-- Developer Workplace - canonical database schema (Phase 2B: real workspace data)
--
-- This file is a canonical reference / documentation artifact. It is intentionally
-- kept runnable as a standalone schema file, but the migration files in
-- supabase/migrations/ are self-contained SQL and do not use psql include commands
-- such as \ir or \i. Supabase migration runners execute raw SQL only.
--
-- FRONTEND MODEL -> TABLE MAPPING
--   Project              -> public.projects          (+ public.project_settings        1:1)
--   Project.technologies -> public.technologies      (+ public.project_technologies    n:n)
--   Task                 -> public.tasks             (optional -> milestones.id)
--   Milestone            -> public.milestones
--   Plan / PlanItem      -> public.plans             (+ public.project_plan_items      n:1)
--   NoteItem             -> public.notes
--   TechnologyItem       -> public.technologies      (usedIn is derived from project_technologies)
--   Profile              -> public.profiles          (1:1 with auth.users)
--
-- ID RULES
--   id   = internal uuid primary key. Never rendered in a public URL.
--   slug = public, human readable, GLOBALLY unique identifier for /view/project/<slug>.
--
-- SECURITY MODEL
--   1. RLS is enabled on every application table. `anon` has NO privileges at all.
--   2. `authenticated` can only reach rows it owns. Child tables (tasks, milestones,
--      notes, plan items, project_technologies) re-check that the referenced
--      project/plan belongs to auth.uid() instead of trusting project_id.
--   3. Public portfolio reads go through two SECURITY DEFINER functions in the
--      exposed `public` schema (`public_project_list`, `public_project_by_slug`).
--      They delegate to a core query in the `private` schema, which is NOT exposed
--      by the Data API (see [api].schemas in config.toml), and return an explicit
--      safe column list. The list can only ever return visibility = 'Public' rows;
--      the detail lookup additionally allows Unlisted by exact slug (share link)
--      and can therefore never be used to enumerate unlisted projects.
--   4. Views with `security_invoker = true` were evaluated and rejected for the
--      public path: any view over the base table requires granting the calling
--      roles direct column access to `projects`, which cannot express "all columns
--      for my own rows, safe columns for public rows" - internal planning columns
--      (current_objective, next_action, ...) would leak to every signed-in reader
--      of a public project. Function based projections keep the row filter and the
--      column list in one auditable place.
-- =============================================================================

create extension if not exists "pgcrypto";
create schema if not exists private;

-- -----------------------------------------------------------------------------
-- shared helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Ownership helper used by the child-table policies. SECURITY DEFINER keeps the
-- check itself free from the `projects` policy (no recursive policy evaluation)
-- and hardened search_path prevents search_path hijacking. It only ever answers
-- for auth.uid(), so it cannot be used to probe other accounts.
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

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  username text,
  github_username text,
  avatar_url text,
  bio text,
  -- Reserved for a later public profile surface. Phase 2B grants no public read
  -- path for profiles: they stay owner-only until a curated projection exists.
  public_profile_enabled boolean not null default false,
  time_zone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists github_username text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists public_profile_enabled boolean not null default false;
alter table public.profiles add column if not exists time_zone text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Phase 1 declared `username text unique` (case sensitive). Replace it with a
-- case-insensitive unique index so "@Pranz" and "@pranz" cannot both exist.
alter table public.profiles drop constraint if exists profiles_username_key;
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username)) where username is not null;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  title text not null,
  description text not null default '',
  project_type text not null default 'Personal',
  status text not null default 'Planning',
  workflow_stage text not null default 'planning',
  priority text not null default 'Medium',
  is_featured boolean not null default false,
  visibility text not null default 'Private',
  role text,
  team_size integer,
  start_date date,
  target_date date,
  current_objective text not null default '',
  next_action text not null default '',
  -- Public showcase content. Only ever exposed through the public projection.
  public_summary text,
  public_problem text,
  public_solution text,
  public_result text,
  -- Public links. GitHub *repository* metadata stays a Phase 3 concern; the
  -- placeholder columns installed by Phase 1 are kept untouched and unused here.
  repository_url text,
  demo_url text,
  docs_url text,
  -- Evidence flags rendered on the public project page.
  health_documentation boolean not null default false,
  health_screenshots boolean not null default false,
  health_testing boolean not null default false,
  health_deployment boolean not null default false,
  github_repository_id bigint,
  github_repository_owner text,
  github_repository_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
alter table public.projects add column if not exists created_at timestamptz not null default now();
alter table public.projects add column if not exists updated_at timestamptz not null default now();

-- Phase 1 stored uppercase workflow stages ('DEVELOPMENT'). Phase 2B stores the
-- lowercase vocabulary from the phase brief; normalise legacy rows first.
update public.projects set workflow_stage = lower(workflow_stage) where workflow_stage <> lower(workflow_stage);

-- Legacy rows may miss a slug. Backfill deterministically, then enforce the format.
update public.projects
  set slug = nullif(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), '')
  where slug is null or slug = '';
update public.projects set slug = 'project-' || left(replace(id::text, '-', ''), 12) where slug is null or slug = '';

-- Per-user slugs were ambiguous for a URL without an owner segment: the public
-- route /view/project/<slug> requires a globally unique slug.
drop index if exists public.projects_user_slug_idx;
drop index if exists public.projects_slug_idx;

-- Backfilled slugs can collide (two projects titled "Portfolio"). Resolve them
-- deterministically before the unique constraint is installed.
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

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- project_settings (one-to-one with projects)
-- -----------------------------------------------------------------------------
-- Replaces the Phase 1 `project_metadata` table, which duplicated settings and
-- carried its own copy of current_objective / next_action (now on projects).
create table if not exists public.project_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  custom_color text,
  custom_icon text,
  show_github_activity boolean not null default false,
  show_commit_count boolean not null default false,
  show_streak boolean not null default false,
  show_accountability boolean not null default false,
  show_live_demo boolean not null default false,
  show_repository boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_settings add column if not exists custom_color text;
alter table public.project_settings add column if not exists custom_icon text;
alter table public.project_settings add column if not exists show_github_activity boolean not null default false;
alter table public.project_settings add column if not exists show_commit_count boolean not null default false;
alter table public.project_settings add column if not exists show_streak boolean not null default false;
alter table public.project_settings add column if not exists show_accountability boolean not null default false;
alter table public.project_settings add column if not exists show_live_demo boolean not null default false;
alter table public.project_settings add column if not exists show_repository boolean not null default false;
alter table public.project_settings add column if not exists created_at timestamptz not null default now();
alter table public.project_settings add column if not exists updated_at timestamptz not null default now();

-- Carry any prototype data across, then retire the duplicated table.
do $$
begin
  if to_regclass('public.project_metadata') is not null then
    insert into public.project_settings (project_id, custom_color, custom_icon)
    select project_id, custom_color, custom_icon from public.project_metadata
    on conflict (project_id) do update
      set custom_color = coalesce(public.project_settings.custom_color, excluded.custom_color),
          custom_icon = coalesce(public.project_settings.custom_icon, excluded.custom_icon);
    drop table public.project_metadata;
  end if;
end $$;

drop trigger if exists project_settings_set_updated_at on public.project_settings;
create trigger project_settings_set_updated_at before update on public.project_settings
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- GitHub App repository authorization and project links (Phase 3A)
-- -----------------------------------------------------------------------------
create table if not exists public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id bigint not null check (installation_id > 0),
  account_login text not null,
  account_type text not null check (account_type in ('User', 'Organization', 'Enterprise')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, installation_id)
);

create table if not exists public.github_repository_links (
  project_id uuid primary key references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_record_id uuid not null references public.github_installations(id) on delete cascade,
  repository_id bigint not null check (repository_id > 0),
  owner text not null,
  name text not null,
  full_name text not null,
  default_branch text not null,
  html_url text not null check (html_url like 'https://github.com/%'),
  is_private boolean not null,
  primary_language text,
  updated_at_github timestamptz,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (user_id, repository_id)
);

create index if not exists github_repository_links_installation_idx on public.github_repository_links(installation_record_id);

drop trigger if exists github_installations_set_updated_at on public.github_installations;
create trigger github_installations_set_updated_at before update on public.github_installations
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- milestones
-- -----------------------------------------------------------------------------
create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'pending',
  target_date date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.milestones add column if not exists description text not null default '';
alter table public.milestones add column if not exists sort_order integer not null default 0;
alter table public.milestones add column if not exists created_at timestamptz not null default now();
alter table public.milestones add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'milestones_status_check' and conrelid = 'public.milestones'::regclass) then
    alter table public.milestones add constraint milestones_status_check check (status in ('pending', 'active', 'completed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'milestones_title_not_blank_check' and conrelid = 'public.milestones'::regclass) then
    alter table public.milestones add constraint milestones_title_not_blank_check check (length(btrim(title)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'milestones_sort_order_check' and conrelid = 'public.milestones'::regclass) then
    alter table public.milestones add constraint milestones_sort_order_check check (sort_order >= 0);
  end if;
end $$;

drop trigger if exists milestones_set_updated_at on public.milestones;
create trigger milestones_set_updated_at before update on public.milestones
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  milestone_id uuid references public.milestones(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'Backlog',
  priority text not null default 'Medium',
  due_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.tasks add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.tasks add column if not exists description text not null default '';
alter table public.tasks add column if not exists updated_at timestamptz not null default now();
alter table public.tasks add column if not exists completed_at timestamptz;

-- Legacy rows inherit the owner from their project, then ownership is enforced.
update public.tasks set user_id = projects.user_id from public.projects
  where public.tasks.project_id = projects.id and public.tasks.user_id is null;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'user_id' and is_nullable = 'YES'
  ) then
    alter table public.tasks alter column user_id set not null;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_status_check' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_status_check
      check (status in ('Backlog', 'Planned', 'In Progress', 'Review', 'Testing', 'Blocked', 'Completed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_priority_check' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_priority_check check (priority in ('Low', 'Medium', 'High', 'Critical'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_title_not_blank_check' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_title_not_blank_check check (length(btrim(title)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_completed_at_check' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_completed_at_check
      check ((status = 'Completed') = (completed_at is not null));
  end if;
end $$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

-- A task may only hang off a milestone of its own project, and a task's owner
-- must match the project owner. RLS already re-checks the project owner; this
-- trigger keeps denormalised data honest even for service_role writes.
create or replace function private.assert_task_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_owner uuid;
begin
  select p.user_id into project_owner from public.projects p where p.id = new.project_id;
  if project_owner is null then
    raise exception 'task project % does not exist', new.project_id;
  end if;
  if new.user_id is distinct from project_owner then
    raise exception 'task user_id must match the owner of project %', new.project_id;
  end if;
  if new.milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = new.milestone_id and m.project_id = new.project_id
  ) then
    raise exception 'milestone % does not belong to project %', new.milestone_id, new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_assert_consistency on public.tasks;
create trigger tasks_assert_consistency before insert or update on public.tasks
  for each row execute function private.assert_task_consistency();

-- -----------------------------------------------------------------------------
-- plans
-- -----------------------------------------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  timeframe text,
  status text not null default 'Planning',
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plans add column if not exists description text not null default '';
alter table public.plans add column if not exists timeframe text;
alter table public.plans add column if not exists status text not null default 'Planning';
alter table public.plans add column if not exists created_at timestamptz not null default now();
alter table public.plans add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plans_status_check' and conrelid = 'public.plans'::regclass) then
    alter table public.plans add constraint plans_status_check check (status in ('Planning', 'Active', 'Paused', 'Completed', 'Cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plans_title_not_blank_check' and conrelid = 'public.plans'::regclass) then
    alter table public.plans add constraint plans_title_not_blank_check check (length(btrim(title)) > 0);
  end if;
end $$;

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at before update on public.plans
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- project_plan_items
-- -----------------------------------------------------------------------------
-- Links a plan step to a project and/or an existing task so no work is duplicated.
-- `label` stays free text for checklist-only steps.
create table if not exists public.project_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  label text not null default '',
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_plan_items add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.project_plan_items add column if not exists task_id uuid references public.tasks(id) on delete set null;
alter table public.project_plan_items add column if not exists label text not null default '';
alter table public.project_plan_items add column if not exists done boolean not null default false;
alter table public.project_plan_items add column if not exists sort_order integer not null default 0;
alter table public.project_plan_items add column if not exists created_at timestamptz not null default now();
alter table public.project_plan_items add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_plan_items_sort_order_check' and conrelid = 'public.project_plan_items'::regclass) then
    alter table public.project_plan_items add constraint project_plan_items_sort_order_check check (sort_order >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_plan_items_shape_check' and conrelid = 'public.project_plan_items'::regclass) then
    alter table public.project_plan_items add constraint project_plan_items_shape_check
      check (task_id is not null or project_id is not null or length(btrim(label)) > 0);
  end if;
end $$;

drop trigger if exists project_plan_items_set_updated_at on public.project_plan_items;
create trigger project_plan_items_set_updated_at before update on public.project_plan_items
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- notes
-- -----------------------------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Screenshots stay in a private Storage bucket; this table holds only owner-checked metadata.
create table if not exists public.project_screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null unique,
  caption text not null default '' check (char_length(caption) <= 200),
  created_at timestamptz not null default now(),
  check (storage_path = user_id::text || '/' || project_id::text || '/' || split_part(storage_path, '/', 3))
);

alter table public.notes add column if not exists content text not null default '';
alter table public.notes add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_title_not_blank_check' and conrelid = 'public.notes'::regclass) then
    alter table public.notes add constraint notes_title_not_blank_check check (length(btrim(title)) > 0);
  end if;
end $$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at before update on public.notes
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- technologies + project_technologies
-- -----------------------------------------------------------------------------
create table if not exists public.technologies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.technologies add column if not exists created_at timestamptz not null default now();
alter table public.technologies add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'technologies_name_not_blank_check' and conrelid = 'public.technologies'::regclass) then
    alter table public.technologies add constraint technologies_name_not_blank_check check (length(btrim(name)) > 0);
  end if;
  -- Phase 1 used a case sensitive unique (user_id, name). De-duplicate first so
  -- the case-insensitive rule below can be installed on existing databases.
  if not exists (select 1 from pg_constraint where conname = 'technologies_user_name_lower_key' and conrelid = 'public.technologies'::regclass) then
    delete from public.technologies t
      using public.technologies other
      where t.user_id = other.user_id
        and lower(btrim(t.name)) = lower(btrim(other.name))
        and (t.created_at, t.id) > (other.created_at, other.id);
    update public.technologies set name = btrim(name) where name <> btrim(name);
    alter table public.technologies add constraint technologies_user_name_lower_key unique (user_id, lower(name));
  end if;
end $$;

drop trigger if exists technologies_set_updated_at on public.technologies;
create trigger technologies_set_updated_at before update on public.technologies
  for each row execute function private.set_updated_at();

-- The composite primary key prevents duplicate technology links for a project.
create table if not exists public.project_technologies (
  project_id uuid not null references public.projects(id) on delete cascade,
  technology_id uuid not null references public.technologies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, technology_id)
);

alter table public.project_technologies add column if not exists created_at timestamptz not null default now();

create or replace function private.assert_project_technology_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_owner uuid;
  technology_owner uuid;
begin
  select p.user_id into project_owner from public.projects p where p.id = new.project_id;
  select t.user_id into technology_owner from public.technologies t where t.id = new.technology_id;
  if project_owner is null or technology_owner is null then
    raise exception 'project_technologies references a missing project or technology';
  end if;
  if project_owner is distinct from technology_owner then
    raise exception 'a project can only link technologies owned by the same account';
  end if;
  return new;
end;
$$;

drop trigger if exists project_technologies_assert_consistency on public.project_technologies;
create trigger project_technologies_assert_consistency before insert or update on public.project_technologies
  for each row execute function private.assert_project_technology_consistency();

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_settings enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.plans enable row level security;
alter table public.project_plan_items enable row level security;
alter table public.notes enable row level security;
alter table public.project_screenshots enable row level security;
alter table public.technologies enable row level security;
alter table public.project_technologies enable row level security;
alter table public.github_installations enable row level security;
alter table public.github_repository_links enable row level security;

-- Phase 1 policies that are replaced by the stricter Phase 2B model.
-- `public projects are readable` allowed every role to read Public AND Unlisted
-- rows straight off the base table (unlisted projects were enumerable), and
-- `public profile` opened profiles with no curated column list.
drop policy if exists "public projects are readable" on public.projects;
drop policy if exists "public profile" on public.profiles;
drop policy if exists "own profile" on public.profiles;
drop policy if exists "own projects" on public.projects;
drop policy if exists "own project metadata" on public.project_metadata;
drop policy if exists "own project settings" on public.project_settings;
drop policy if exists "own milestones" on public.milestones;
drop policy if exists "own tasks" on public.tasks;
drop policy if exists "own plans" on public.plans;
drop policy if exists "own project plan items" on public.project_plan_items;
drop policy if exists "own notes" on public.notes;
drop policy if exists "read own project screenshots" on public.project_screenshots;
drop policy if exists "add own project screenshots" on public.project_screenshots;
drop policy if exists "remove own project screenshots" on public.project_screenshots;
drop policy if exists "own technologies" on public.technologies;
drop policy if exists "own project technologies" on public.project_technologies;
drop policy if exists "own github installations" on public.github_installations;
drop policy if exists "own project github links" on public.github_repository_links;
drop policy if exists "read own github installations" on public.github_installations;

-- Owner policies. `with check` mirrors `using`, so a row can never be moved to
-- another account and a child row can never be attached to somebody else's
-- project/plan. No policy is granted to `anon`.
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

create policy "read own project screenshots" on public.project_screenshots for select to authenticated
  using (user_id = auth.uid() and private.owns_project(project_id));

create policy "add own project screenshots" on public.project_screenshots for insert to authenticated
  with check (
    user_id = auth.uid()
    and private.owns_project(project_id)
    and split_part(storage_path, '/', 1) = auth.uid()::text
    and split_part(storage_path, '/', 2) = project_id::text
  );

create policy "remove own project screenshots" on public.project_screenshots for delete to authenticated
  using (user_id = auth.uid() and private.owns_project(project_id));

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

create policy "read own github installations" on public.github_installations for select to authenticated
  using (user_id = auth.uid());

create policy "own project github links" on public.github_repository_links for all to authenticated
  using (user_id = auth.uid() and private.owns_project(project_id) and exists (
    select 1 from public.github_installations i where i.id = installation_record_id and i.user_id = auth.uid()
  ))
  with check (user_id = auth.uid() and private.owns_project(project_id) and exists (
    select 1 from public.github_installations i where i.id = installation_record_id and i.user_id = auth.uid()
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-screenshots', 'project-screenshots', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "read own project screenshot files" on storage.objects;
create policy "read own project screenshot files" on storage.objects for select to authenticated
  using (bucket_id = 'project-screenshots' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[2] and p.user_id = auth.uid()));

drop policy if exists "upload own project screenshot files" on storage.objects;
create policy "upload own project screenshot files" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-screenshots' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[2] and p.user_id = auth.uid()));

drop policy if exists "delete own project screenshot files" on storage.objects;
create policy "delete own project screenshot files" on storage.objects for delete to authenticated
  using (bucket_id = 'project-screenshots' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[2] and p.user_id = auth.uid()));

-- -----------------------------------------------------------------------------
-- Public portfolio projection
-- -----------------------------------------------------------------------------
-- This is the ONLY path by which project data leaves the database for public
-- readers. The row shape is declared once as a composite type so the list and
-- the share-link lookup can never drift apart.
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

-- Core query. SECURITY DEFINER + owner (postgres) means row level security is
-- bypassed *inside* this function only, which is what allows it to build the
-- curated projection; the row filter below (public always, unlisted only for an
-- exact slug) plus the declared column list above are the enforcement points.
-- NOTE: never `alter table ... force row level security` on these tables - that
-- removes the owner bypass the projection and the trigger helpers rely on.
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
      case when coalesce(s.show_repository, false)
        and not coalesce((select l.is_private from public.github_repository_links l where l.project_id = p.id), false)
        then coalesce((select l.html_url from public.github_repository_links l where l.project_id = p.id and not l.is_private), p.repository_url)
        else null end as repository_url,
      p.demo_url, p.docs_url,
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
  -- Deterministic progress, identical to lib/projectProgress.ts:
  --   workflow 40% (ordered pipeline only) / milestones 35% / tasks 25%,
  --   renormalised over the components that actually have data.
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

-- Public entry point 1: the portfolio list. Can only ever return Public rows.
-- SECURITY DEFINER is required so the wrapper may call the private core on behalf
-- of anon; the arguments are hardcoded, so a caller cannot ask for unlisted rows.
create or replace function public.public_project_list()
returns setof public.public_project_card
language sql
security definer
stable
set search_path = ''
as $$
  select * from private.public_project_rows(null, false);
$$;

-- Public entry point 2: share link lookup. Unlisted projects stay invisible to
-- the list and to every table query, but a reader who has the exact slug can open
-- the project page - the same contract as a private share URL.
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

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
-- `anon` is locked out of every application table: the public surface is the two
-- projection functions above. `authenticated` keeps table access, but row level
-- security still limits it to owned rows only.
revoke all on public.profiles from anon;
revoke all on public.projects from anon;
revoke all on public.project_settings from anon;
revoke all on public.milestones from anon;
revoke all on public.tasks from anon;
revoke all on public.plans from anon;
revoke all on public.project_plan_items from anon;
revoke all on public.notes from anon;
revoke all on public.project_screenshots from anon;
revoke all on public.technologies from anon;
revoke all on public.project_technologies from anon;
revoke all on public.github_installations from anon;
revoke all on public.github_repository_links from anon;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_settings to authenticated;
grant select, insert, update, delete on public.milestones to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.plans to authenticated;
grant select, insert, update, delete on public.project_plan_items to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
grant select, insert, delete on public.project_screenshots to authenticated;
grant select, insert, update, delete on public.technologies to authenticated;
grant select, insert, update, delete on public.project_technologies to authenticated;
revoke all on public.github_installations from authenticated;
grant select on public.github_installations to authenticated;
grant select, insert, update, delete on public.github_repository_links to authenticated;
grant all on public.github_installations to service_role;

-- -----------------------------------------------------------------------------
-- Indexes (only what the application actually queries)
-- -----------------------------------------------------------------------------
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
create index if not exists project_screenshots_project_created_idx on public.project_screenshots(project_id, created_at desc);
create index if not exists project_technologies_technology_id_idx on public.project_technologies (technology_id);

-- -----------------------------------------------------------------------------
-- Documentation
-- -----------------------------------------------------------------------------
comment on table public.projects is 'Workspace projects. `id` is internal (uuid); `slug` is the globally unique public identifier used by /view/project/<slug>.';
comment on column public.projects.slug is 'Globally unique, lowercase, hyphenated. Generated by lib/slug.ts with collision suffixes.';
comment on column public.projects.visibility is 'Private (owner only), Public (portfolio list + detail), Unlisted (exact share link only, never listed).';
comment on column public.projects.workflow_stage is 'Lowercase pipeline stage. blocked/on_hold/cancelled are excluded from the progress calculation.';
comment on table public.project_settings is 'Per-project display switches (1:1 with projects). Replaces the Phase 1 project_metadata table.';
comment on function public.public_project_list() is 'Public portfolio list. Public projects only; explicit safe column list; callable by anon.';
comment on function public.public_project_by_slug(text) is 'Public share-link lookup by exact slug. Allows Public and Unlisted; exact slug match prevents enumeration.';

-- Phase 4B private accountability history and dated goals.
create table if not exists public.accountability_snapshots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade, snapshot_date date not null,
  captured_at timestamptz not null default now(), score smallint check (score between 0 and 100),
  health text not null check (health in ('Active','Steady','Needs Attention','Stalled','Blocked','Completed','On Hold','Cancelled','Building Baseline')),
  factors jsonb not null default '[]'::jsonb check (jsonb_typeof(factors) = 'array'),
  github_status text not null check (github_status in ('not-connected','unavailable','available','not-relevant')),
  model_version smallint not null default 1 check (model_version > 0), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique (user_id, project_id, snapshot_date)
);
create index if not exists accountability_snapshots_user_date_idx on public.accountability_snapshots (user_id, snapshot_date desc);
create index if not exists accountability_snapshots_project_date_idx on public.accountability_snapshots (project_id, snapshot_date desc);
alter table public.accountability_snapshots enable row level security;
revoke all on public.accountability_snapshots from anon;
grant select, insert, update, delete on public.accountability_snapshots to authenticated;
drop policy if exists "own accountability snapshots" on public.accountability_snapshots;
create policy "own accountability snapshots" on public.accountability_snapshots for all to authenticated
  using (user_id = (select auth.uid()) and private.owns_project(project_id))
  with check (user_id = (select auth.uid()) and private.owns_project(project_id));
drop trigger if exists accountability_snapshots_set_updated_at on public.accountability_snapshots;
create trigger accountability_snapshots_set_updated_at before update on public.accountability_snapshots
  for each row execute function private.set_updated_at();

create table if not exists public.accountability_goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120), description text check (description is null or length(description) <= 1000),
  metric text not null check (metric in ('tasks_completed','milestones_completed','plan_items_completed','manual')),
  target integer not null check (target > 0 and target <= 10000), period_start date not null, period_end date not null,
  status text not null default 'active' check (status in ('active','completed','closed')),
  manual_progress integer not null default 0 check (manual_progress >= 0 and manual_progress <= 10000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (period_end >= period_start)
);
create index if not exists accountability_goals_user_period_idx on public.accountability_goals (user_id, period_start, period_end);
create index if not exists accountability_goals_project_idx on public.accountability_goals (project_id);
alter table public.accountability_goals enable row level security;
revoke all on public.accountability_goals from anon;
grant select, insert, update, delete on public.accountability_goals to authenticated;
drop policy if exists "own accountability goals" on public.accountability_goals;
create policy "own accountability goals" on public.accountability_goals for all to authenticated
  using (user_id = (select auth.uid()) and (project_id is null or private.owns_project(project_id)))
  with check (user_id = (select auth.uid()) and (project_id is null or private.owns_project(project_id)));
drop trigger if exists accountability_goals_set_updated_at on public.accountability_goals;
create trigger accountability_goals_set_updated_at before update on public.accountability_goals
  for each row execute function private.set_updated_at();

