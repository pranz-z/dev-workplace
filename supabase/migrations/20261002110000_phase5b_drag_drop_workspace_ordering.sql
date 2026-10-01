-- Phase 5B: persist task and screenshot order within each project.
alter table public.tasks
  add column if not exists sort_order integer not null default 0;

with ranked as (
  select id, (row_number() over (partition by project_id, status order by created_at, id) - 1)::integer as position
  from public.tasks
)
update public.tasks t set sort_order = ranked.position
from ranked where ranked.id = t.id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_sort_order_check' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_sort_order_check check (sort_order >= 0);
  end if;
end $$;

create index if not exists tasks_project_status_sort_order_idx
  on public.tasks(project_id, status, sort_order, id);

alter table public.project_screenshots
  add column if not exists sort_order integer not null default 0;

with ranked as (
  select id, (row_number() over (partition by project_id order by created_at desc, id) - 1)::integer as position
  from public.project_screenshots
)
update public.project_screenshots s set sort_order = ranked.position
from ranked where ranked.id = s.id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_screenshots_sort_order_check' and conrelid = 'public.project_screenshots'::regclass) then
    alter table public.project_screenshots add constraint project_screenshots_sort_order_check check (sort_order >= 0);
  end if;
end $$;

create index if not exists project_screenshots_project_sort_order_idx
  on public.project_screenshots(project_id, sort_order, id);

-- Phase 5A intentionally limited metadata updates to `is_public`; grant only
-- the additional order column needed by the authenticated owner workflow.
grant update (sort_order) on public.project_screenshots to authenticated;

create or replace function public.public_project_screenshots(p_slug text)
returns table (id uuid, project_slug text, storage_path text, caption text, created_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, p.slug, s.storage_path, s.caption, s.created_at
  from public.project_screenshots s
  join public.projects p on p.id = s.project_id
  where s.is_public
    and ((p_slug is null and p.visibility = 'Public')
      or (p.slug = p_slug and p.visibility in ('Public', 'Unlisted')))
    and (p_slug is not null or s.id = (
      select cover.id from public.project_screenshots cover
      where cover.project_id = p.id and cover.is_public
      order by cover.sort_order, cover.created_at desc, cover.id
      limit 1
    ))
  order by s.sort_order, s.created_at desc, s.id;
$$;
