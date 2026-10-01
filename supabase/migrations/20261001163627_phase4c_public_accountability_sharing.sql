-- Phase 4C: optional, owner-controlled public accountability summaries.
-- The authenticated owner continues to control this through project_settings RLS.
alter table public.project_settings
  add column show_public_accountability boolean not null default false,
  add column show_public_accountability_score boolean not null default false;

-- The existing curated projection returns only a health label and an optional
-- score. No private factors, goals, reports, or snapshot rows are exposed.
alter type public.public_project_card
  add attribute public_accountability_health text,
  add attribute public_accountability_score smallint;

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
      end as stage_index,
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
      end as public_accountability_score
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
    s.updated_at,
    s.public_accountability_health,
    s.public_accountability_score
  from scored s
  order by s.is_featured desc, s.updated_at desc;
$$;

notify pgrst, 'reload schema';
