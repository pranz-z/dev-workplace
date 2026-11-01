-- Supabase default privileges grant EXECUTE to anon on new public functions, which
-- "revoke all ... from public" does not remove. These reorder RPCs are for signed-in users only.
revoke execute on function public.reorder_project_tasks(uuid, uuid, text, uuid[], integer[]) from anon;
revoke execute on function public.reorder_project_milestones(uuid, uuid[]) from anon;
revoke execute on function public.reorder_plan_items(uuid, uuid[]) from anon;
