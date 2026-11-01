-- A time block's foreign key includes the task's project, so moving a task that
-- had a block was rejected. Let the block follow the task to its new project.
alter table public.workspace_time_blocks
  drop constraint workspace_time_blocks_task_id_user_id_project_id_fkey,
  add constraint workspace_time_blocks_task_id_user_id_project_id_fkey
    foreign key (task_id, user_id, project_id)
    references public.tasks (id, user_id, project_id)
    on update cascade
    on delete set null (task_id);
