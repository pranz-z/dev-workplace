-- Phase 3A: GitHub App installations and safe project/repository links.
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

alter table public.github_installations enable row level security;
alter table public.github_repository_links enable row level security;

drop policy if exists "own github installations" on public.github_installations;
drop policy if exists "read own github installations" on public.github_installations;
create policy "read own github installations" on public.github_installations
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "own project github links" on public.github_repository_links;
create policy "own project github links" on public.github_repository_links
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
    and exists (select 1 from public.github_installations i where i.id = installation_record_id and i.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
    and exists (select 1 from public.github_installations i where i.id = installation_record_id and i.user_id = (select auth.uid()))
  );

revoke all on public.github_installations from anon, authenticated;
grant select on public.github_installations to authenticated;
grant select, insert, update, delete on public.github_repository_links to authenticated;
revoke all on public.github_repository_links from anon;
grant all on public.github_installations to service_role;

drop trigger if exists github_installations_set_updated_at on public.github_installations;
create trigger github_installations_set_updated_at before update on public.github_installations
  for each row execute function private.set_updated_at();

-- The public projection only includes a repository URL when the owner enabled
-- repository display, and suppresses linked private repositories.
create or replace function private.public_project_rows(p_slug text default null, p_include_unlisted boolean default false)
returns setof public.public_project_card
language sql
security definer
stable
set search_path = ''
as $$
  with task_stats as (
    select t.project_id, count(*)::int as total, count(*) filter (where t.status = 'Completed')::int as completed
    from public.tasks t group by t.project_id
  ),
  milestone_stats as (
    select m.project_id, count(*)::int as total, count(*) filter (where m.status = 'completed')::int as completed
    from public.milestones m group by m.project_id
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
      coalesce(ts.total, 0) as total_tasks, coalesce(ts.completed, 0) as completed_tasks,
      coalesce(ms.total, 0) as total_milestones, coalesce(ms.completed, 0) as completed_milestones,
      coalesce(s.show_github_activity, false) as show_github_activity,
      coalesce(s.show_commit_count, false) as show_commit_count,
      coalesce(s.show_streak, false) as show_streak,
      coalesce(s.show_accountability, false) as show_accountability,
      coalesce(s.show_live_demo, false) as show_live_demo,
      coalesce(s.show_repository, false) as show_repository,
      case p.workflow_stage
        when 'idea' then 0 when 'planning' then 1 when 'research' then 2 when 'development' then 3
        when 'testing' then 4 when 'deployment' then 5 when 'maintenance' then 6 when 'completed' then 7
        else null end as stage_index
    from public.projects p
    left join public.project_settings s on s.project_id = p.id
    left join task_stats ts on ts.project_id = p.id
    left join milestone_stats ms on ms.project_id = p.id
    where (p.visibility = 'Public' or (p_include_unlisted and p.visibility = 'Unlisted'))
      and (p_slug is null or p.slug = p_slug)
  ),
  scored as (
    select b.*,
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
    coalesce((select array_agg(t.name order by t.name) from public.project_technologies pt
      join public.technologies t on t.id = pt.technology_id where pt.project_id = s.id), '{}'::text[]),
    s.total_tasks, s.completed_tasks, s.total_milestones, s.completed_milestones,
    case when (s.workflow_weight + s.task_weight + s.milestone_weight) = 0 then 0
      else round(((s.workflow_value * s.workflow_weight + s.task_value * s.task_weight + s.milestone_value * s.milestone_weight)
        / (s.workflow_weight + s.task_weight + s.milestone_weight)) * 100)::int end,
    s.updated_at
  from scored s order by s.is_featured desc, s.updated_at desc;
$$;

revoke all on function private.public_project_rows(text, boolean) from public, anon, authenticated;
