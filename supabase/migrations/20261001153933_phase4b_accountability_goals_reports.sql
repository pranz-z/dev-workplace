alter table public.profiles add column if not exists time_zone text;

create table if not exists public.accountability_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  snapshot_date date not null,
  captured_at timestamptz not null default now(),
  score smallint check (score between 0 and 100),
  health text not null check (health in ('Active','Steady','Needs Attention','Stalled','Blocked','Completed','On Hold','Cancelled','Building Baseline')),
  factors jsonb not null default '[]'::jsonb check (jsonb_typeof(factors) = 'array'),
  github_status text not null check (github_status in ('not-connected','unavailable','available','not-relevant')),
  model_version smallint not null default 1 check (model_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id, snapshot_date)
);

create index if not exists accountability_snapshots_user_date_idx on public.accountability_snapshots (user_id, snapshot_date desc);
create index if not exists accountability_snapshots_project_date_idx on public.accountability_snapshots (project_id, snapshot_date desc);
alter table public.accountability_snapshots enable row level security;
revoke all on public.accountability_snapshots from anon;
grant select, insert, update, delete on public.accountability_snapshots to authenticated;
create policy "own accountability snapshots" on public.accountability_snapshots for all to authenticated
  using (user_id = (select auth.uid()) and private.owns_project(project_id))
  with check (user_id = (select auth.uid()) and private.owns_project(project_id));
create trigger accountability_snapshots_set_updated_at before update on public.accountability_snapshots
  for each row execute function private.set_updated_at();

create table if not exists public.accountability_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  metric text not null check (metric in ('tasks_completed','milestones_completed','plan_items_completed','manual')),
  target integer not null check (target > 0 and target <= 10000),
  period_start date not null,
  period_end date not null,
  status text not null default 'active' check (status in ('active','completed','closed')),
  manual_progress integer not null default 0 check (manual_progress >= 0 and manual_progress <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists accountability_goals_user_period_idx on public.accountability_goals (user_id, period_start, period_end);
create index if not exists accountability_goals_project_idx on public.accountability_goals (project_id);
alter table public.accountability_goals enable row level security;
revoke all on public.accountability_goals from anon;
grant select, insert, update, delete on public.accountability_goals to authenticated;
create policy "own accountability goals" on public.accountability_goals for all to authenticated
  using (user_id = (select auth.uid()) and (project_id is null or private.owns_project(project_id)))
  with check (user_id = (select auth.uid()) and (project_id is null or private.owns_project(project_id)));
create trigger accountability_goals_set_updated_at before update on public.accountability_goals
  for each row execute function private.set_updated_at();
