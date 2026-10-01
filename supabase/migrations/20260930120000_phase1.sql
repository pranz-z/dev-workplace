-- Phase 1 baseline migration.
--
-- This migration is intentionally self-contained. Supabase remote migrations are
-- executed as plain SQL; psql meta-commands such as \ir are not supported in
-- the migration runner. The canonical final schema still lives in schema.sql for
-- documentation, but the migration files must not depend on it.

create extension if not exists "pgcrypto";
create schema if not exists private;

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

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  username text,
  github_username text,
  avatar_url text,
  bio text,
  public_profile_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  public_summary text,
  public_problem text,
  public_solution text,
  public_result text,
  repository_url text,
  demo_url text,
  docs_url text,
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

create unique index if not exists profiles_username_lower_key on public.profiles (lower(username)) where username is not null;
create unique index if not exists projects_slug_key_idx on public.projects (slug);

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

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  milestone_id uuid references public.milestones(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'Backlog',
  priority text not null default 'Medium',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.technologies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.project_technologies (
  project_id uuid not null references public.projects(id) on delete cascade,
  technology_id uuid not null references public.technologies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, technology_id)
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
for each row execute function private.set_updated_at();

drop trigger if exists project_settings_set_updated_at on public.project_settings;
create trigger project_settings_set_updated_at before update on public.project_settings
for each row execute function private.set_updated_at();

drop trigger if exists milestones_set_updated_at on public.milestones;
create trigger milestones_set_updated_at before update on public.milestones
for each row execute function private.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function private.set_updated_at();

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at before update on public.plans
for each row execute function private.set_updated_at();

drop trigger if exists project_plan_items_set_updated_at on public.project_plan_items;
create trigger project_plan_items_set_updated_at before update on public.project_plan_items
for each row execute function private.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at before update on public.notes
for each row execute function private.set_updated_at();

drop trigger if exists technologies_set_updated_at on public.technologies;
create trigger technologies_set_updated_at before update on public.technologies
for each row execute function private.set_updated_at();
