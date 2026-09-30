create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  github_username text,
  display_name text,
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
  github_repository_id bigint,
  github_repository_owner text,
  github_repository_name text,
  title text not null,
  description text not null default '',
  project_type text not null default 'Personal',
  status text not null default 'Planning',
  workflow_stage text not null default 'PLANNING',
  priority text not null default 'Medium',
  is_featured boolean not null default false,
  visibility text not null default 'Private' check (visibility in ('Private', 'Public', 'Unlisted')),
  start_date date,
  target_date date,
  role text,
  team_size integer,
  current_objective text not null default '',
  next_action text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text unique;
alter table public.projects add column if not exists slug text;
alter table public.projects add column if not exists current_objective text not null default '';
alter table public.projects add column if not exists next_action text not null default '';
update public.projects set slug = coalesce(nullif(lower(regexp_replace(title, '[^a-zA-Z0-9]+', '-', 'g')), ''), id::text) where slug is null or slug = '';
alter table public.projects alter column slug set not null;
create unique index if not exists projects_user_slug_idx on public.projects(user_id, slug);

create table if not exists public.project_metadata (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  custom_color text,
  custom_icon text,
  custom_order integer,
  cover_image_url text,
  current_objective text,
  next_action text
);

create table if not exists public.project_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  show_github_activity boolean not null default false,
  show_commit_count boolean not null default false,
  show_streak boolean not null default false,
  show_accountability boolean not null default false,
  show_live_demo boolean not null default false,
  show_repository boolean not null default false
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
  due_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.tasks add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.tasks add column if not exists completed_at timestamptz;
update public.tasks set user_id = projects.user_id from public.projects where public.tasks.project_id = projects.id and public.tasks.user_id is null;
alter table public.tasks alter column user_id set not null;

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
  sort_order integer not null default 0
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
  unique (user_id, name)
);

create table if not exists public.project_technologies (
  project_id uuid not null references public.projects(id) on delete cascade,
  technology_id uuid not null references public.technologies(id) on delete cascade,
  primary key (project_id, technology_id)
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_metadata enable row level security;
alter table public.project_settings enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.project_plan_items enable row level security;
alter table public.plans enable row level security;
alter table public.notes enable row level security;
alter table public.technologies enable row level security;
alter table public.project_technologies enable row level security;

create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "public profile" on public.profiles for select using (public_profile_enabled = true);
create policy "own projects" on public.projects for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "public projects are readable" on public.projects for select using (visibility in ('Public', 'Unlisted'));
create policy "own project metadata" on public.project_metadata for all using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())) with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "own project settings" on public.project_settings for all using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())) with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "own milestones" on public.milestones for all using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())) with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "own tasks" on public.tasks for all using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())) with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "own project plan items" on public.project_plan_items for all using (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid())) with check (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid()));
create policy "own plans" on public.plans for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notes" on public.notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own technologies" on public.technologies for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own project technologies" on public.project_technologies for all using (exists (select 1 from public.projects p join public.technologies t on t.id = technology_id where p.id = project_id and p.user_id = auth.uid() and t.user_id = auth.uid())) with check (exists (select 1 from public.projects p join public.technologies t on t.id = technology_id where p.id = project_id and p.user_id = auth.uid() and t.user_id = auth.uid()));
