-- Atomic reorder for tasks, milestones and plan checklist items.
-- Each call is one statement inside one transaction, so a failure can never
-- leave a half-applied order. SECURITY INVOKER keeps RLS as the ownership boundary.

create or replace function public.reorder_project_tasks(
  p_project_id uuid,
  p_moved_task_id uuid,
  p_moved_status text,
  p_task_ids uuid[],
  p_sort_orders integer[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_task_ids is null or p_sort_orders is null
    or cardinality(p_task_ids) = 0
    or cardinality(p_task_ids) <> cardinality(p_sort_orders)
    or cardinality(p_task_ids) <> (select count(distinct id) from unnest(p_task_ids) as ids(id))
    or not (p_moved_task_id = any(p_task_ids))
    or exists (select 1 from unnest(p_sort_orders) as orders(value) where orders.value is null or orders.value < 1) then
    raise exception using errcode = '22023', message = 'Invalid task order.';
  end if;

  update public.tasks t
  set sort_order = ordered.sort_order,
      status = case when t.id = p_moved_task_id then p_moved_status else t.status end,
      completed_at = case
        when t.id = p_moved_task_id and t.status is distinct from p_moved_status
          then case when p_moved_status = 'Completed' then now() else null end
        else t.completed_at
      end
  from unnest(p_task_ids, p_sort_orders) as ordered(id, sort_order)
  where t.id = ordered.id and t.project_id = p_project_id and t.user_id = auth.uid();

  get diagnostics updated_count = row_count;
  if updated_count <> cardinality(p_task_ids) then
    raise exception using errcode = '42501', message = 'Task order does not match the project.';
  end if;
end;
$$;

create or replace function public.reorder_project_milestones(
  p_project_id uuid,
  p_milestone_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_milestone_ids is null
    or cardinality(p_milestone_ids) = 0
    or cardinality(p_milestone_ids) <> (select count(distinct id) from unnest(p_milestone_ids) as ids(id)) then
    raise exception using errcode = '22023', message = 'Invalid milestone order.';
  end if;

  update public.milestones m
  set sort_order = ordered.position::integer
  from unnest(p_milestone_ids) with ordinality as ordered(id, position)
  where m.id = ordered.id and m.project_id = p_project_id;

  get diagnostics updated_count = row_count;
  if updated_count <> cardinality(p_milestone_ids) then
    raise exception using errcode = '42501', message = 'Milestone order does not match the project.';
  end if;
end;
$$;

create or replace function public.reorder_plan_items(
  p_plan_id uuid,
  p_item_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_item_ids is null
    or cardinality(p_item_ids) = 0
    or cardinality(p_item_ids) <> (select count(distinct id) from unnest(p_item_ids) as ids(id)) then
    raise exception using errcode = '22023', message = 'Invalid plan order.';
  end if;

  update public.project_plan_items i
  set sort_order = ordered.position::integer
  from unnest(p_item_ids) with ordinality as ordered(id, position)
  where i.id = ordered.id and i.plan_id = p_plan_id;

  get diagnostics updated_count = row_count;
  if updated_count <> cardinality(p_item_ids) then
    raise exception using errcode = '42501', message = 'Plan order does not match the plan.';
  end if;
end;
$$;

revoke all on function public.reorder_project_tasks(uuid, uuid, text, uuid[], integer[]) from public;
revoke all on function public.reorder_project_milestones(uuid, uuid[]) from public;
revoke all on function public.reorder_plan_items(uuid, uuid[]) from public;
grant execute on function public.reorder_project_tasks(uuid, uuid, text, uuid[], integer[]) to authenticated;
grant execute on function public.reorder_project_milestones(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_plan_items(uuid, uuid[]) to authenticated;
