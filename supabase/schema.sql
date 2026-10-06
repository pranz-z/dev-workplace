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
--      and can therefore never be used to enumerate unlisted projects. Both are
--      scoped to the single owner in private.portfolio_site_config; NULL fails closed.
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
  headline text,
  public_contact_email text,
  show_public_contact_email boolean not null default false,
  public_github_url text,
  public_linkedin_url text,
  public_website_url text,
  public_profile_enabled boolean not null default false,
  public_ai_assistant_enabled boolean not null default false,
  time_zone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists github_username text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists headline text;
alter table public.profiles add column if not exists public_contact_email text;
alter table public.profiles add column if not exists show_public_contact_email boolean not null default false;
alter table public.profiles add column if not exists public_github_url text;
alter table public.profiles add column if not exists public_linkedin_url text;
alter table public.profiles add column if not exists public_website_url text;
alter table public.profiles add column if not exists public_profile_enabled boolean not null default false;
alter table public.profiles add column if not exists time_zone text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- The public site has one operator-designated owner. NULL disables the public
-- profile and project projections until an administrator configures an owner.
create table if not exists private.portfolio_site_config (
  singleton boolean primary key default true check (singleton),
  owner_id uuid references public.profiles(id) on delete set null
);
alter table private.portfolio_site_config enable row level security;
revoke all on table private.portfolio_site_config from public, anon, authenticated, service_role;
insert into private.portfolio_site_config (singleton, owner_id) values (true, null)
  on conflict (singleton) do nothing;
create or replace function private.canonical_portfolio_owner_id()
returns uuid language sql stable security invoker set search_path = '' as $$
  select config.owner_id from private.portfolio_site_config config where config.singleton;
$$;
revoke all on function private.canonical_portfolio_owner_id() from public, anon, authenticated, service_role;
comment on table private.portfolio_site_config is
  'Trusted single-owner public site configuration. Set owner_id with an administrative database role; NULL disables public portfolio projections.';

-- Phase 1 declared `username text unique` (case sensitive). Replace it with a
-- case-insensitive unique index so "@Pranz" and "@pranz" cannot both exist.
alter table public.profiles drop constraint if exists profiles_username_key;
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username)) where username is not null;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.protect_profile_system_metadata()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Profile id and created_at are system-managed' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_profile_system_metadata() from public;
drop trigger if exists profiles_protect_system_metadata on public.profiles;
create trigger profiles_protect_system_metadata before update on public.profiles
  for each row execute function private.protect_profile_system_metadata();

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
  sort_order integer not null default 0,
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
alter table public.projects add column if not exists sort_order integer not null default 0;
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
  if not exists (select 1 from pg_constraint where conname = 'projects_sort_order_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_sort_order_check check (sort_order >= 0);
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
  show_public_accountability boolean not null default false,
  show_public_accountability_score boolean not null default false,
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
alter table public.project_settings add column if not exists show_public_accountability boolean not null default false;
alter table public.project_settings add column if not exists show_public_accountability_score boolean not null default false;
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
  sort_order integer not null default 0,
  priority text not null default 'Medium',
  due_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.tasks add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.tasks add column if not exists description text not null default '';
alter table public.tasks add column if not exists sort_order integer not null default 0;
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
  if not exists (select 1 from pg_constraint where conname = 'tasks_sort_order_check' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_sort_order_check check (sort_order >= 0);
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
  is_public boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (storage_path = user_id::text || '/' || project_id::text || '/' || split_part(storage_path, '/', 3))
);

-- Private external Drive metadata. Keep this separate from the project screenshot
-- system, whose Storage bucket and public-sharing path are intentionally specific.
create table if not exists public.external_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null default 'google_drive' check (provider = 'google_drive'),
  provider_file_id text not null check (length(btrim(provider_file_id)) > 0),
  name text not null check (length(btrim(name)) > 0),
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  modified_at timestamptz,
  status text not null default 'active' check (status in ('active', 'trashed', 'unavailable')),
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_files_task_requires_project_check check (task_id is null or project_id is not null),
  constraint external_files_provider_file_key unique (user_id, provider, provider_file_id)
);
create index if not exists external_files_user_updated_idx on public.external_files (user_id, updated_at desc);
create index if not exists external_files_project_updated_idx on public.external_files (project_id, updated_at desc) where project_id is not null;
create index if not exists external_files_task_updated_idx on public.external_files (task_id, updated_at desc) where task_id is not null;
alter table public.external_files enable row level security;
-- Clear Supabase's default grants before granting row-level operations.
-- In particular, TRUNCATE bypasses RLS and must not remain authenticated.
revoke all on public.external_files from public, anon, authenticated;
grant select, insert, update, delete on public.external_files to authenticated;
comment on table public.external_files is
  'Private Google Drive file metadata and optional owner-checked project/task associations. No public projection; project screenshots remain in project_screenshots.';

create or replace function private.assert_external_file_task_project()
returns trigger language plpgsql set search_path = '' as $$
declare task_project_id uuid;
begin
  if new.task_id is null then return new; end if;
  select t.project_id into task_project_id
  from public.tasks t where t.id = new.task_id and t.user_id = new.user_id;
  if task_project_id is null then
    raise exception 'external_files task must belong to the file owner' using errcode = '23503';
  end if;
  if task_project_id is distinct from new.project_id then
    raise exception 'external_files project_id must match the associated task project' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.assert_external_file_task_project() from public, anon, authenticated, service_role;
drop trigger if exists external_files_check_task_project on public.external_files;
create trigger external_files_check_task_project before insert or update of user_id, project_id, task_id on public.external_files
  for each row execute function private.assert_external_file_task_project();
drop trigger if exists external_files_set_updated_at on public.external_files;
create trigger external_files_set_updated_at before update on public.external_files
  for each row execute function private.set_updated_at();

alter table public.project_screenshots add column if not exists is_public boolean not null default false;
alter table public.project_screenshots add column if not exists sort_order integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_screenshots_sort_order_check' and conrelid = 'public.project_screenshots'::regclass) then
    alter table public.project_screenshots add constraint project_screenshots_sort_order_check check (sort_order >= 0);
  end if;
end $$;

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

create or replace function public.reorder_projects_in_workflow(
  p_project_id uuid,
  p_source_stage text,
  p_destination_stage text,
  p_source_project_ids uuid[],
  p_destination_project_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_ids uuid[] := coalesce(p_source_project_ids, array[]::uuid[]);
  destination_ids uuid[] := coalesce(p_destination_project_ids, array[]::uuid[]);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_source_stage not in ('idea', 'planning', 'research', 'development', 'testing', 'deployment', 'maintenance', 'completed', 'blocked', 'on_hold', 'cancelled')
    or p_destination_stage not in ('idea', 'planning', 'research', 'development', 'testing', 'deployment', 'maintenance', 'completed', 'blocked', 'on_hold', 'cancelled') then
    raise exception using errcode = '22023', message = 'Invalid workflow stage.';
  end if;

  if cardinality(source_ids) <> (select count(distinct id) from unnest(source_ids) as ids(id))
    or cardinality(destination_ids) <> (select count(distinct id) from unnest(destination_ids) as ids(id))
    or not (p_project_id = any(destination_ids)) then
    raise exception using errcode = '22023', message = 'Invalid project order.';
  end if;

  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.user_id = auth.uid() and p.workflow_stage = p_source_stage
  ) then
    raise exception using errcode = '42501', message = 'Project is not available in the source workflow stage.';
  end if;

  if p_source_stage = p_destination_stage then
    if cardinality(source_ids) <> 0
      or exists (
        select p.id from public.projects p
        where p.user_id = auth.uid() and p.workflow_stage = p_source_stage
        except select unnest(destination_ids)
      )
      or exists (
        select unnest(destination_ids)
        except select p.id from public.projects p
        where p.user_id = auth.uid() and p.workflow_stage = p_source_stage
      ) then
      raise exception using errcode = '22023', message = 'Project order does not match the workflow column.';
    end if;

    update public.projects p
    set sort_order = (ordered.position - 1)::integer
    from unnest(destination_ids) with ordinality as ordered(id, position)
    where p.id = ordered.id and p.user_id = auth.uid() and p.workflow_stage = p_source_stage;
  else
    if p_project_id = any(source_ids)
      or exists (
        select p.id from public.projects p
        where p.user_id = auth.uid() and p.workflow_stage = p_source_stage and p.id <> p_project_id
        except select unnest(source_ids)
      )
      or exists (
        select unnest(source_ids)
        except select p.id from public.projects p
        where p.user_id = auth.uid() and p.workflow_stage = p_source_stage and p.id <> p_project_id
      )
      or exists (
        select p.id from public.projects p
        where p.user_id = auth.uid() and p.workflow_stage = p_destination_stage
        union select p_project_id
        except select unnest(destination_ids)
      )
      or exists (
        select unnest(destination_ids)
        except (
          select p.id from public.projects p
          where p.user_id = auth.uid() and p.workflow_stage = p_destination_stage
          union select p_project_id
        )
      ) then
      raise exception using errcode = '22023', message = 'Project order does not match the workflow columns.';
    end if;

    update public.projects p
    set sort_order = (ordered.position - 1)::integer
    from unnest(source_ids) with ordinality as ordered(id, position)
    where p.id = ordered.id and p.user_id = auth.uid() and p.workflow_stage = p_source_stage;

    update public.projects p
    set workflow_stage = p_destination_stage,
        sort_order = (ordered.position - 1)::integer
    from unnest(destination_ids) with ordinality as ordered(id, position)
    where p.id = ordered.id and p.user_id = auth.uid()
      and (p.workflow_stage = p_destination_stage or p.id = p_project_id);
  end if;
end;
$$;

revoke all on function public.reorder_projects_in_workflow(uuid, text, text, uuid[], uuid[]) from public;

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
drop policy if exists "update own project screenshots" on public.project_screenshots;
drop policy if exists "own technologies" on public.technologies;
drop policy if exists "own project technologies" on public.project_technologies;
drop policy if exists "own github installations" on public.github_installations;
drop policy if exists "own project github links" on public.github_repository_links;
drop policy if exists "read own github installations" on public.github_installations;
drop policy if exists "own external files" on public.external_files;

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

create policy "update own project screenshots" on public.project_screenshots for update to authenticated
  using (user_id = auth.uid() and private.owns_project(project_id))
  with check (user_id = auth.uid() and private.owns_project(project_id));

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

create policy "own external files" on public.external_files for all to authenticated
  using (
    user_id = auth.uid()
    and (project_id is null or private.owns_project(project_id))
    and (
      task_id is null
      or exists (
        select 1 from public.tasks t
        where t.id = task_id and t.user_id = auth.uid()
          and t.project_id = external_files.project_id
          and private.owns_project(t.project_id)
      )
    )
  )
  with check (
    user_id = auth.uid()
    and (project_id is null or private.owns_project(project_id))
    and (
      task_id is null
      or exists (
        select 1 from public.tasks t
        where t.id = task_id and t.user_id = auth.uid()
          and t.project_id = external_files.project_id
          and private.owns_project(t.project_id)
      )
    )
  );

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

create or replace function private.can_read_public_project_screenshot(p_object_name text)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.project_screenshots s join public.projects p on p.id = s.project_id
    where p.user_id = private.canonical_portfolio_owner_id()
      and s.storage_path = p_object_name and s.is_public and p.visibility in ('Public', 'Unlisted')
  );
$$;
revoke all on function private.can_read_public_project_screenshot(text) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.can_read_public_project_screenshot(text) to anon, authenticated;
drop policy if exists "read explicitly public project screenshots" on storage.objects;
create policy "read explicitly public project screenshots" on storage.objects for select to anon, authenticated
  using (bucket_id = 'project-screenshots' and private.can_read_public_project_screenshot(name));

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
  updated_at timestamptz,
  public_accountability_health text,
  public_accountability_score smallint
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
      case
        when p_slug is null or not coalesce(s.show_public_accountability, false) then null
        when p.status in ('Completed', 'Blocked', 'On Hold', 'Cancelled') then p.status
        else latest.health
      end as public_accountability_health,
      case
        when p_slug is null
          or not coalesce(s.show_public_accountability, false)
          or not coalesce(s.show_public_accountability_score, false)
          or p.status in ('Completed', 'Blocked', 'On Hold', 'Cancelled') then null
        else latest.score
      end as public_accountability_score,
      case p.workflow_stage
        when 'idea' then 0 when 'planning' then 1 when 'research' then 2 when 'development' then 3
        when 'testing' then 4 when 'deployment' then 5 when 'maintenance' then 6 when 'completed' then 7
        else null
      end as stage_index
    from public.projects p
    left join public.project_settings s on s.project_id = p.id
    left join lateral (
      select snapshot.health, snapshot.score
      from public.accountability_snapshots snapshot
      where snapshot.project_id = p.id
        and snapshot.user_id = p.user_id
        and p_slug is not null
        and coalesce(s.show_public_accountability, false)
      order by snapshot.snapshot_date desc, snapshot.captured_at desc
      limit 1
    ) latest on true
    left join task_stats ts on ts.project_id = p.id
    left join milestone_stats ms on ms.project_id = p.id
    where (p.visibility = 'Public' or (p_include_unlisted and p.visibility = 'Unlisted'))
      and p.user_id = private.canonical_portfolio_owner_id()
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
    s.updated_at,
    s.public_accountability_health,
    s.public_accountability_score
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

create or replace function public.public_profile()
returns table (display_name text, headline text, bio text, avatar_url text, public_contact_email text,
  github_url text, linkedin_url text, website_url text)
language sql security definer stable set search_path = '' as $$
  select p.display_name, p.headline, p.bio, p.avatar_url,
    case when p.show_public_contact_email then p.public_contact_email end,
    p.public_github_url, p.public_linkedin_url, p.public_website_url
  from public.profiles p
  where p.id = private.canonical_portfolio_owner_id() and p.public_profile_enabled;
$$;

-- The public concierge has separate opt-in projections. Its context builder
-- consumes these safe RPC results and never reads private workspace tables.
create or replace function public.public_ai_profile()
returns table (display_name text, headline text, bio text, public_contact_email text,
  github_url text, linkedin_url text, website_url text)
language sql security definer stable set search_path = '' as $$
  select p.display_name, p.headline, p.bio,
    case when p.show_public_contact_email then p.public_contact_email end,
    p.public_github_url, p.public_linkedin_url, p.public_website_url
  from public.profiles p
  where p.id = private.canonical_portfolio_owner_id()
    and p.public_profile_enabled and p.public_ai_assistant_enabled;
$$;

create or replace function public.public_ai_project_list()
returns setof public.public_project_card
language sql security definer stable set search_path = '' as $$
  with active_profile as (
    select p.id from public.profiles p
    where p.id = private.canonical_portfolio_owner_id()
      and p.public_profile_enabled and p.public_ai_assistant_enabled
  )
  select projected.*
  from private.public_project_rows(null, false) projected
  join public.projects p on p.slug = projected.slug
  join active_profile on active_profile.id = p.user_id
  order by projected.is_featured desc, projected.updated_at desc
  limit 8;
$$;

create table if not exists private.public_ai_rate_limit_buckets (
  bucket_kind text not null check (bucket_kind in ('visitor_minute', 'global_day')),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  bucket_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_kind, subject_hash, bucket_start)
);
alter table private.public_ai_rate_limit_buckets enable row level security;
revoke all on private.public_ai_rate_limit_buckets from public, anon, authenticated, service_role;

create or replace function public.consume_public_ai_rate_limit(p_visitor_hash text, p_visitor_limit integer, p_daily_limit integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_minute_start timestamptz;
  v_day_start timestamptz;
  v_count integer;
begin
  if p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$' or p_visitor_limit < 1 or p_visitor_limit > 20
    or p_daily_limit < 1 or p_daily_limit > 100 then
    raise exception 'Invalid public AI rate limit parameters' using errcode = '22023';
  end if;
  v_minute_start := date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC';
  v_day_start := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  delete from private.public_ai_rate_limit_buckets where bucket_start < v_day_start - interval '1 day';

  insert into private.public_ai_rate_limit_buckets (bucket_kind, subject_hash, bucket_start, request_count, updated_at)
  values ('visitor_minute', p_visitor_hash, v_minute_start, 1, v_now)
  on conflict (bucket_kind, subject_hash, bucket_start) do update
    set request_count = private.public_ai_rate_limit_buckets.request_count + 1, updated_at = excluded.updated_at
    where private.public_ai_rate_limit_buckets.request_count < p_visitor_limit
  returning request_count into v_count;
  if not found then return false; end if;

  insert into private.public_ai_rate_limit_buckets (bucket_kind, subject_hash, bucket_start, request_count, updated_at)
  values ('global_day', repeat('0', 64), v_day_start, 1, v_now)
  on conflict (bucket_kind, subject_hash, bucket_start) do update
    set request_count = private.public_ai_rate_limit_buckets.request_count + 1, updated_at = excluded.updated_at
    where private.public_ai_rate_limit_buckets.request_count < p_daily_limit
  returning request_count into v_count;
  return found;
end;
$$;

create table if not exists private.public_ai_active_leases (
  visitor_hash text primary key check (visitor_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null
);
alter table private.public_ai_active_leases enable row level security;
revoke all on private.public_ai_active_leases from public, anon, authenticated, service_role;

create or replace function public.acquire_public_ai_lease(p_visitor_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_acquired boolean;
begin
  if p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid public AI visitor identifier' using errcode = '22023';
  end if;
  delete from private.public_ai_active_leases where expires_at <= now();
  insert into private.public_ai_active_leases (visitor_hash, expires_at)
  values (p_visitor_hash, now() + interval '5 minutes')
  on conflict (visitor_hash) do update
    set expires_at = excluded.expires_at
    where private.public_ai_active_leases.expires_at <= now()
  returning true into v_acquired;
  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_public_ai_lease(p_visitor_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid public AI visitor identifier' using errcode = '22023';
  end if;
  delete from private.public_ai_active_leases where visitor_hash = p_visitor_hash;
end;
$$;

create or replace function public.public_project_screenshots(p_slug text)
returns table (id uuid, project_slug text, storage_path text, caption text, created_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select s.id, p.slug, s.storage_path, s.caption, s.created_at
  from public.project_screenshots s join public.projects p on p.id = s.project_id
  where p.user_id = private.canonical_portfolio_owner_id()
    and s.is_public
    and ((p_slug is null and p.visibility = 'Public') or (p.slug = p_slug and p.visibility in ('Public', 'Unlisted')))
    and (p_slug is not null or s.id = (
      select cover.id from public.project_screenshots cover where cover.project_id = p.id and cover.is_public
      order by cover.sort_order, cover.created_at desc, cover.id limit 1
    ))
  order by s.sort_order, s.created_at desc, s.id;
$$;
revoke all on function public.public_profile() from public;
revoke all on function public.public_project_screenshots(text) from public;
revoke all on function public.public_ai_profile() from public;
revoke all on function public.public_ai_project_list() from public;
revoke all on function public.consume_public_ai_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.acquire_public_ai_lease(text) from public, anon, authenticated;
revoke all on function public.release_public_ai_lease(text) from public, anon, authenticated;
grant execute on function public.public_profile() to anon, authenticated;
grant execute on function public.public_project_screenshots(text) to anon, authenticated;
grant execute on function public.public_ai_profile() to anon, authenticated, service_role;
grant execute on function public.public_ai_project_list() to anon, authenticated, service_role;
grant execute on function public.consume_public_ai_rate_limit(text, integer, integer) to service_role;
grant execute on function public.acquire_public_ai_lease(text) to service_role;
grant execute on function public.release_public_ai_lease(text) to service_role;

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
grant execute on function public.reorder_projects_in_workflow(uuid, text, text, uuid[], uuid[]) to authenticated;
grant select, insert, update, delete on public.project_settings to authenticated;
grant select, insert, update, delete on public.milestones to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.plans to authenticated;
grant select, insert, update, delete on public.project_plan_items to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
grant select, insert, delete on public.project_screenshots to authenticated;
grant update (is_public) on public.project_screenshots to authenticated;
grant update (sort_order) on public.project_screenshots to authenticated;
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
create index if not exists projects_owner_workflow_sort_order_idx on public.projects(user_id, workflow_stage, sort_order, id);
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
create index if not exists tasks_project_status_sort_order_idx on public.tasks(project_id, status, sort_order, id);
create index if not exists project_screenshots_project_sort_order_idx on public.project_screenshots(project_id, sort_order, id);
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

-- Phase 6A private-AI limiter; counters contain only the authenticated user ID
-- and request-window totals. Keep this aligned with the Phase 6A migration.
create table if not exists private.private_ai_rate_limit_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_kind text not null check (bucket_kind in ('user_minute', 'user_day')),
  bucket_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket_kind, bucket_start)
);
alter table private.private_ai_rate_limit_buckets enable row level security;
revoke all on private.private_ai_rate_limit_buckets from public, anon, authenticated, service_role;
create index if not exists private_ai_rate_limit_buckets_bucket_start_idx on private.private_ai_rate_limit_buckets (bucket_start);
create index if not exists public_ai_rate_limit_buckets_bucket_start_idx on private.public_ai_rate_limit_buckets (bucket_start);
create index if not exists public_ai_active_leases_expires_at_idx on private.public_ai_active_leases (expires_at);

create or replace function public.consume_private_ai_rate_limit(p_user_id uuid, p_minute_limit integer, p_daily_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_minute_start timestamptz;
  v_day_start timestamptz;
  v_count integer;
begin
  if p_user_id is null
    or p_minute_limit is null or p_minute_limit < 1 or p_minute_limit > 20
    or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 1000 then
    raise exception 'Invalid private AI rate limit parameters' using errcode = '22023';
  end if;
  v_minute_start := date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC';
  v_day_start := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  delete from private.private_ai_rate_limit_buckets where bucket_start < v_day_start - interval '1 day';
  insert into private.private_ai_rate_limit_buckets (user_id, bucket_kind, bucket_start, request_count, updated_at)
  values (p_user_id, 'user_minute', v_minute_start, 1, v_now)
  on conflict (user_id, bucket_kind, bucket_start) do update
    set request_count = private.private_ai_rate_limit_buckets.request_count + 1,
        updated_at = excluded.updated_at
    where private.private_ai_rate_limit_buckets.request_count < p_minute_limit
  returning request_count into v_count;
  if not found then return false; end if;
  insert into private.private_ai_rate_limit_buckets (user_id, bucket_kind, bucket_start, request_count, updated_at)
  values (p_user_id, 'user_day', v_day_start, 1, v_now)
  on conflict (user_id, bucket_kind, bucket_start) do update
    set request_count = private.private_ai_rate_limit_buckets.request_count + 1,
        updated_at = excluded.updated_at
    where private.private_ai_rate_limit_buckets.request_count < p_daily_limit
  returning request_count into v_count;
  return found;
end;
$$;
revoke all on function public.consume_private_ai_rate_limit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_private_ai_rate_limit(uuid, integer, integer) to service_role;
comment on table private.private_ai_rate_limit_buckets is 'Private AI request counters only; no prompt, response, or secret content is stored.';
comment on function public.consume_private_ai_rate_limit(uuid, integer, integer) is 'Atomically enforces authenticated-user minute and UTC-day AI request limits; callable only by the server service role.';

-- Phase 6A.1: one bounded active private chat request per authenticated user.
-- No prompt, response, or uploaded file data is stored in this table.
create table if not exists private.private_ai_active_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lease_id uuid not null,
  expires_at timestamptz not null
);
alter table private.private_ai_active_leases enable row level security;
revoke all on private.private_ai_active_leases from public, anon, authenticated, service_role;

-- Drive refresh credentials are separate from public.external_files metadata.
-- The application encrypts the refresh token before calling the restricted
-- service-role RPCs below; plaintext tokens and access tokens are never stored.
create table if not exists private.google_drive_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_ciphertext text not null check (length(refresh_token_ciphertext) > 0),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.google_drive_connections enable row level security;
revoke all on private.google_drive_connections from public, anon, authenticated, service_role;
drop trigger if exists google_drive_connections_set_updated_at on private.google_drive_connections;
create trigger google_drive_connections_set_updated_at before update on private.google_drive_connections
  for each row execute function private.set_updated_at();
comment on table private.google_drive_connections is
  'Server-only Google Drive OAuth credentials. Refresh tokens must be encrypted by the application before storage; access tokens are not persisted.';
comment on column private.google_drive_connections.refresh_token_ciphertext is
  'Base64url-encoded authenticated-encryption envelope; never plaintext. Decryption key is server-only and selected by encryption_key_version.';

create or replace function public.upsert_google_drive_connection(p_user_id uuid, p_refresh_token_ciphertext text, p_encryption_key_version smallint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_refresh_token_ciphertext is null or length(p_refresh_token_ciphertext) = 0
    or p_encryption_key_version is null or p_encryption_key_version <= 0 then
    raise exception 'Invalid Google Drive connection data' using errcode = '22023';
  end if;
  insert into private.google_drive_connections (user_id, refresh_token_ciphertext, encryption_key_version)
  values (p_user_id, p_refresh_token_ciphertext, p_encryption_key_version)
  on conflict (user_id) do update set
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    encryption_key_version = excluded.encryption_key_version,
    updated_at = now();
end;
$$;

create or replace function public.get_google_drive_connection(p_user_id uuid)
returns table (user_id uuid, refresh_token_ciphertext text, encryption_key_version smallint, created_at timestamptz, updated_at timestamptz)
language sql security definer set search_path = '' as $$
  select c.user_id, c.refresh_token_ciphertext, c.encryption_key_version, c.created_at, c.updated_at
  from private.google_drive_connections c where p_user_id is not null and c.user_id = p_user_id;
$$;

create or replace function public.delete_google_drive_connection(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.google_drive_connections c where p_user_id is not null and c.user_id = p_user_id;
$$;

revoke all on function public.upsert_google_drive_connection(uuid, text, smallint) from public, anon, authenticated;
revoke all on function public.get_google_drive_connection(uuid) from public, anon, authenticated;
revoke all on function public.delete_google_drive_connection(uuid) from public, anon, authenticated;
grant execute on function public.upsert_google_drive_connection(uuid, text, smallint) to service_role;
grant execute on function public.get_google_drive_connection(uuid) to service_role;
grant execute on function public.delete_google_drive_connection(uuid) to service_role;
comment on function public.upsert_google_drive_connection(uuid, text, smallint) is
  'Stores an application-encrypted Google Drive refresh token for a user. Callable only by the server service role.';
comment on function public.get_google_drive_connection(uuid) is
  'Returns encrypted Google Drive refresh-token data to the server service role only.';
comment on function public.delete_google_drive_connection(uuid) is
  'Deletes Google Drive connection credentials. Callable only by the server service role.';
create index if not exists private_ai_active_leases_expires_at_idx on private.private_ai_active_leases (expires_at);

create or replace function public.acquire_private_ai_lease(p_user_id uuid, p_lease_id uuid, p_ttl_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_acquired boolean := false;
  v_now timestamptz := now();
begin
  if p_user_id is null or p_lease_id is null
    or p_ttl_seconds is null or p_ttl_seconds < 30 or p_ttl_seconds > 180 then
    raise exception 'Invalid private AI lease parameters' using errcode = '22023';
  end if;
  delete from private.private_ai_active_leases where expires_at <= v_now;
  insert into private.private_ai_active_leases (user_id, lease_id, expires_at)
  values (p_user_id, p_lease_id, v_now + make_interval(secs => p_ttl_seconds))
  on conflict (user_id) do update
    set lease_id = excluded.lease_id, expires_at = excluded.expires_at
    where private.private_ai_active_leases.expires_at <= v_now
  returning true into v_acquired;
  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_private_ai_lease(p_user_id uuid, p_lease_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_lease_id is null then
    raise exception 'Invalid private AI lease parameters' using errcode = '22023';
  end if;
  delete from private.private_ai_active_leases where user_id = p_user_id and lease_id = p_lease_id;
  return found;
end;
$$;
revoke all on function public.acquire_private_ai_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_private_ai_lease(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_private_ai_lease(uuid, uuid, integer) to service_role;
grant execute on function public.release_private_ai_lease(uuid, uuid) to service_role;
comment on table private.private_ai_active_leases is 'Short-lived private AI request leases only; no prompt, response, or uploaded file data is stored.';

-- Server-only state for Drive resumable uploads. Session URIs are bearer-like
-- capabilities and must never be returned to browser clients.
-- Invariants: owner comes from the verified Supabase session; the authenticated
-- server validates project/task ownership before creating a session; task_id
-- always belongs to project_id; file bytes stay in Drive, not Postgres; only a
-- verified completed Drive file is inserted into public.external_files.
create table if not exists private.google_drive_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  expected_name text not null check (length(btrim(expected_name)) between 1 and 255),
  expected_mime_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes > 0),
  google_account_sub text not null,
  google_account_email text not null,
  app_folder_id text not null,
  session_uri text not null,
  expires_at timestamptz not null,
  next_offset bigint not null default 0 check (next_offset >= 0),
  chunk_claim_id uuid,
  chunk_claim_expires_at timestamptz,
  status text not null default 'uploading' check (status in ('uploading', 'completed', 'expired')),
  drive_file_id text,
  external_file_id uuid references public.external_files(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_drive_upload_task_requires_project check (task_id is null or project_id is not null),
  constraint google_drive_upload_offset_within_size check (next_offset <= expected_size_bytes)
);
alter table private.google_drive_upload_sessions enable row level security;
revoke all on private.google_drive_upload_sessions from public, anon, authenticated, service_role;
create index if not exists google_drive_upload_sessions_owner_created_idx
  on private.google_drive_upload_sessions (user_id, created_at desc);
create index if not exists google_drive_upload_sessions_expiry_idx
  on private.google_drive_upload_sessions (expires_at) where status = 'uploading';
drop trigger if exists google_drive_upload_sessions_set_updated_at on private.google_drive_upload_sessions;
create trigger google_drive_upload_sessions_set_updated_at before update on private.google_drive_upload_sessions
  for each row execute function private.set_updated_at();
comment on table private.google_drive_upload_sessions is
  'Server-only Drive resumable upload state, including the secret session URI; no file bytes are stored.';
comment on column private.google_drive_upload_sessions.session_uri is
  'Google Drive resumable upload capability. Returned only through service-role RPC to server code; never to browser clients.';

create or replace function public.create_google_drive_upload_session(
  p_id uuid, p_user_id uuid, p_project_id uuid, p_task_id uuid,
  p_expected_name text, p_expected_mime_type text, p_expected_size_bytes bigint,
  p_google_account_sub text, p_google_account_email text,
  p_app_folder_id text, p_session_uri text, p_expires_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or p_user_id is null or length(btrim(p_expected_name)) not between 1 and 255
    or p_expected_mime_type is null or p_expected_size_bytes is null or p_expected_size_bytes <= 0
    or p_google_account_sub is null or p_google_account_email is null
    or p_app_folder_id is null or p_session_uri is null or p_expires_at <= now()
    or (p_task_id is not null and p_project_id is null) then
    raise exception 'Invalid Google Drive upload session' using errcode = '22023';
  end if;
  update private.google_drive_upload_sessions s set status = 'expired', session_uri = '',
    chunk_claim_id = null, chunk_claim_expires_at = null
  where s.status = 'uploading' and s.expires_at <= now();
  insert into private.google_drive_upload_sessions (
    id, user_id, project_id, task_id, expected_name, expected_mime_type,
    expected_size_bytes, google_account_sub, google_account_email,
    app_folder_id, session_uri, expires_at
  ) values (
    p_id, p_user_id, p_project_id, p_task_id, p_expected_name, p_expected_mime_type,
    p_expected_size_bytes, p_google_account_sub, p_google_account_email,
    p_app_folder_id, p_session_uri, p_expires_at
  );
end;
$$;

create or replace function public.get_google_drive_upload_session(p_user_id uuid, p_id uuid)
returns table (
  id uuid, user_id uuid, project_id uuid, task_id uuid, expected_name text,
  expected_mime_type text, expected_size_bytes bigint, google_account_sub text,
  google_account_email text, app_folder_id text, session_uri text,
  expires_at timestamptz, next_offset bigint, status text,
  drive_file_id text, external_file_id uuid
) language plpgsql security definer set search_path = '' as $$
begin
  update private.google_drive_upload_sessions s set status = 'expired', session_uri = '',
    chunk_claim_id = null, chunk_claim_expires_at = null
  where p_user_id is not null and p_id is not null and s.user_id = p_user_id and s.id = p_id
    and s.status = 'uploading' and s.expires_at <= now();
  return query select s.id, s.user_id, s.project_id, s.task_id, s.expected_name,
    s.expected_mime_type, s.expected_size_bytes, s.google_account_sub,
    s.google_account_email, s.app_folder_id, s.session_uri, s.expires_at,
    s.next_offset, s.status, s.drive_file_id, s.external_file_id
  from private.google_drive_upload_sessions s
  where p_user_id is not null and p_id is not null and s.user_id = p_user_id and s.id = p_id;
end;
$$;

create or replace function public.claim_google_drive_upload_chunk(
  p_user_id uuid, p_id uuid, p_expected_offset bigint, p_claim_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_id is null or p_expected_offset is null or p_claim_id is null then
    raise exception 'Invalid Google Drive upload chunk claim' using errcode = '22023';
  end if;
  update private.google_drive_upload_sessions s
    set chunk_claim_id = p_claim_id, chunk_claim_expires_at = now() + interval '2 minutes'
  where s.user_id = p_user_id and s.id = p_id and s.status = 'uploading'
    and s.expires_at > now() and s.next_offset = p_expected_offset
    and (s.chunk_claim_expires_at is null or s.chunk_claim_expires_at <= now());
  return found;
end;
$$;

create or replace function public.finish_google_drive_upload_chunk(
  p_user_id uuid, p_id uuid, p_claim_id uuid, p_next_offset bigint
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_id is null or p_claim_id is null or p_next_offset is null then
    raise exception 'Invalid Google Drive upload chunk result' using errcode = '22023';
  end if;
  update private.google_drive_upload_sessions s
    set next_offset = p_next_offset, chunk_claim_id = null, chunk_claim_expires_at = null
  where s.user_id = p_user_id and s.id = p_id and s.status = 'uploading'
    and s.chunk_claim_id = p_claim_id and p_next_offset between s.next_offset and s.expected_size_bytes;
  return found;
end;
$$;

create or replace function public.mark_google_drive_upload_completed(
  p_user_id uuid, p_id uuid, p_drive_file_id text, p_external_file_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_id is null or p_drive_file_id is null or p_external_file_id is null then
    raise exception 'Invalid Google Drive completed upload' using errcode = '22023';
  end if;
  update private.google_drive_upload_sessions s set status = 'completed',
    drive_file_id = p_drive_file_id, external_file_id = p_external_file_id,
    session_uri = '', chunk_claim_id = null, chunk_claim_expires_at = null
  where s.user_id = p_user_id and s.id = p_id and s.status = 'uploading'
    and s.next_offset = s.expected_size_bytes and s.expires_at > now();
  return found;
end;
$$;

revoke all on function public.create_google_drive_upload_session(uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_google_drive_upload_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_google_drive_upload_chunk(uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.finish_google_drive_upload_chunk(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.mark_google_drive_upload_completed(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_google_drive_upload_session(uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text, timestamptz) to service_role;
grant execute on function public.get_google_drive_upload_session(uuid, uuid) to service_role;
grant execute on function public.claim_google_drive_upload_chunk(uuid, uuid, bigint, uuid) to service_role;
grant execute on function public.finish_google_drive_upload_chunk(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.mark_google_drive_upload_completed(uuid, uuid, text, uuid) to service_role;
-- Folder metadata stays in external_files. Root is implicit; project/custom
-- folders use the Drive folder MIME type. Existing files remain in place.
alter table public.external_files
  add column parent_id uuid references public.external_files(id) deferrable initially deferred,
  add column is_project_folder boolean not null default false;
alter table public.external_files add constraint external_files_project_folder_check
  check (not is_project_folder or (mime_type = 'application/vnd.google-apps.folder' and project_id is not null and parent_id is null and task_id is null));
create index external_files_parent_idx on public.external_files(user_id, parent_id);

-- Invoker semantics retain RLS. Serialize hierarchy edits per owner so two
-- concurrent edits cannot create a cycle. Parent must be visible, active,
-- same owner/provider/project, and a folder. Maximum nesting is 20 levels.
create function private.assert_external_file_parent() returns trigger
language plpgsql set search_path = '' as $$
declare parent_row public.external_files; ancestor_id uuid; depth integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 610614));
  if exists(select 1 from public.external_files f where f.parent_id=new.id
    and (f.user_id<>new.user_id or f.provider<>new.provider or f.project_id is distinct from new.project_id
      or new.mime_type<>'application/vnd.google-apps.folder' or new.status<>'active')) then
    raise exception 'Folder children must retain their owner and project' using errcode='23514';
  end if;
  if new.parent_id is null then return new; end if;
  select * into parent_row from public.external_files where id = new.parent_id;
  if parent_row.id is null or parent_row.user_id <> new.user_id
    or parent_row.provider <> new.provider or parent_row.status <> 'active'
    or parent_row.mime_type <> 'application/vnd.google-apps.folder'
    or parent_row.project_id is distinct from new.project_id then
    raise exception 'Invalid external file parent' using errcode = '23514';
  end if;
  ancestor_id := new.parent_id;
  while ancestor_id is not null loop
    depth := depth + 1;
    if ancestor_id = new.id or depth > 20 then
      raise exception 'External file folder cycle or depth limit' using errcode = '23514';
    end if;
    select f.parent_id into ancestor_id from public.external_files f where f.id = ancestor_id;
  end loop;
  return new;
end; $$;
revoke all on function private.assert_external_file_parent() from public, anon, authenticated, service_role;
create trigger external_files_check_parent before insert or update of parent_id, user_id, project_id, provider, mime_type, status
  on public.external_files for each row execute function private.assert_external_file_parent();

-- Reserve a Google-generated ID before files.create. The unique logical key
-- and compare-and-swap replacement make retries/concurrent requests use the
-- same ID (Drive returns 409 instead of making duplicates). Account-bound,
-- service-only proof; user-writable metadata is never sufficient by itself.
create table private.google_drive_folder_registry (
  user_id uuid not null references auth.users(id) on delete cascade,
  google_account_sub text not null,
  logical_key text not null,
  metadata_id uuid not null default gen_random_uuid(),
  drive_file_id text not null,
  parent_drive_id text,
  created_at timestamptz not null default now(),
  primary key(user_id, google_account_sub, logical_key),
  unique(metadata_id),
  unique(user_id, google_account_sub, drive_file_id)
);
alter table private.google_drive_folder_registry enable row level security;
revoke all on private.google_drive_folder_registry from public, anon, authenticated, service_role;
create function public.reserve_google_drive_folder(
  p_user_id uuid, p_google_account_sub text, p_logical_key text,
  p_candidate_id text, p_parent_drive_id text, p_previous_drive_id text default null
) returns table(metadata_id uuid, drive_file_id text, parent_drive_id text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or nullif(p_google_account_sub,'') is null or nullif(p_logical_key,'') is null then
    raise exception 'Invalid folder reservation' using errcode = '22023';
  end if;
  if p_candidate_id is not null then
    insert into private.google_drive_folder_registry(user_id,google_account_sub,logical_key,drive_file_id,parent_drive_id,metadata_id)
      values(p_user_id,p_google_account_sub,p_logical_key,p_candidate_id,p_parent_drive_id,
        case when p_logical_key like 'custom:%' then substr(p_logical_key,8)::uuid else gen_random_uuid() end)
      on conflict(user_id,google_account_sub,logical_key) do nothing;
    if p_previous_drive_id is not null then
      update private.google_drive_folder_registry r set drive_file_id=p_candidate_id, parent_drive_id=p_parent_drive_id
        where r.user_id=p_user_id and r.google_account_sub=p_google_account_sub
          and r.logical_key=p_logical_key and r.drive_file_id=p_previous_drive_id;
    end if;
  end if;
  return query select r.metadata_id,r.drive_file_id,r.parent_drive_id
    from private.google_drive_folder_registry r where r.user_id=p_user_id
      and r.google_account_sub=p_google_account_sub and r.logical_key=p_logical_key;
end; $$;
revoke all on function public.reserve_google_drive_folder(uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.reserve_google_drive_folder(uuid,text,text,text,text,text) to service_role;

-- Destination is preserved alongside the existing server-only session. Old
-- sessions are supported; app_folder_id continues to mean actual Drive parent.
alter table private.google_drive_upload_sessions add column parent_id uuid
  references public.external_files(id) on delete set null;
create function public.set_google_drive_upload_parent(p_user_id uuid,p_id uuid,p_parent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from private.google_drive_upload_sessions s
    join public.external_files f on f.id=p_parent_id
    where s.user_id=p_user_id and s.id=p_id and s.status='uploading'
      and f.user_id=p_user_id and f.status='active' and f.mime_type='application/vnd.google-apps.folder'
      and f.project_id is not distinct from s.project_id) then
    raise exception 'Invalid upload folder' using errcode='23514';
  end if;
  update private.google_drive_upload_sessions s set parent_id=p_parent_id where s.user_id=p_user_id and s.id=p_id;
end; $$;
create function public.get_google_drive_upload_parent(p_user_id uuid,p_id uuid)
returns uuid language sql security definer set search_path = '' as $$
  select s.parent_id from private.google_drive_upload_sessions s where s.user_id=p_user_id and s.id=p_id;
$$;
revoke all on function public.set_google_drive_upload_parent(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_google_drive_upload_parent(uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_google_drive_upload_parent(uuid,uuid,uuid) to service_role;
grant execute on function public.get_google_drive_upload_parent(uuid,uuid) to service_role;
