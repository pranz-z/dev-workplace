-- Phase 5B extension: persist project order within the owner's workflow stages.
alter table public.projects
  add column if not exists sort_order integer not null default 0;

with ranked as (
  select id,
    (row_number() over (partition by user_id, workflow_stage order by updated_at desc, created_at, id) - 1)::integer as position
  from public.projects
)
update public.projects p set sort_order = ranked.position
from ranked where ranked.id = p.id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_sort_order_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_sort_order_check check (sort_order >= 0);
  end if;
end $$;

create index if not exists projects_owner_workflow_sort_order_idx
  on public.projects(user_id, workflow_stage, sort_order, id);

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
grant execute on function public.reorder_projects_in_workflow(uuid, text, text, uuid[], uuid[]) to authenticated;
