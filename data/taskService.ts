import type { Priority, Task, TaskStatus } from "@/types";
import { getWorkspaceContext, isUuid } from "@/data/context";
import { mapTaskRow } from "@/data/mappers";
import type { TaskRow } from "@/data/database.types";
import {
  DELETE_FAILED_MESSAGE,
  describeDatabaseError,
  SAVE_FAILED_MESSAGE,
  serviceFail,
  serviceOk,
  type ServiceResult,
} from "@/data/serviceResult";
import { fetchAllRows } from "@/data/pagedQuery";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type WorkspaceClient = NonNullable<Awaited<ReturnType<typeof getWorkspaceContext>>>["supabase"];

const TASK_COLUMNS = "id, user_id, project_id, milestone_id, title, description, status, sort_order, priority, due_date, created_at, updated_at, completed_at";

export async function listTasks(): Promise<Task[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();
  const rows = await fetchAllRows((from, to) => supabase.from("tasks").select(TASK_COLUMNS)
    .order("sort_order", { ascending: true }).order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to));
  return rows.map((row) => mapTaskRow(row as TaskRow));
}

export interface TaskInput {
  projectId: string;
  milestoneId?: string | null;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: string | null;
}

export async function createTask(input: TaskInput): Promise<ServiceResult<Task>> {
  const title = input.title.trim();
  if (title.length === 0) return serviceFail("Give the task a title first.");
  if (!isUuid(input.projectId) || (input.milestoneId && !isUuid(input.milestoneId))) {
    return serviceFail("That project or milestone is no longer available. Refresh and try again.");
  }

  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const status = input.status ?? "Backlog";
  const { data: last, error: orderError } = await context.supabase
    .from("tasks")
    .select("sort_order")
    .eq("project_id", input.projectId)
    .eq("status", status)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) return serviceFail(describeDatabaseError(orderError, SAVE_FAILED_MESSAGE));

  const { data, error } = await context.supabase
    .from("tasks")
    .insert({
      user_id: context.userId,
      project_id: input.projectId,
      milestone_id: input.milestoneId ?? null,
      title,
      description: input.description ?? "",
      status,
      sort_order: ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 1,
      priority: input.priority ?? "Medium",
      due_date: input.dueDate ?? null,
      // The database enforces (status = 'Completed') = (completed_at is not null).
      completed_at: status === "Completed" ? new Date().toISOString() : null,
    })
    .select(TASK_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapTaskRow(data as TaskRow));
}

/**
 * The columns a status write must set. Re-saving a task that is already completed
 * sets nothing, so editing it never rewrites the date it was really finished.
 */
async function completionColumns(supabase: WorkspaceClient, taskId: string, status: TaskStatus) {
  if (status !== "Completed") return { columns: { completed_at: null }, error: null };
  const { data, error } = await supabase.from("tasks").select("status").eq("id", taskId).maybeSingle();
  if (error) return { columns: {}, error };
  const alreadyCompleted = (data as { status: TaskStatus } | null)?.status === "Completed";
  return { columns: alreadyCompleted ? {} : { completed_at: new Date().toISOString() }, error: null };
}

export interface TaskPatch {
  projectId?: string;
  title?: string;
  description?: string;
  priority?: Priority;
  status?: TaskStatus;
  dueDate?: string | null;
  milestoneId?: string | null;
}

export async function updateTask(taskId: string, patch: TaskPatch): Promise<ServiceResult<Task>> {
  if (!isUuid(taskId) || (patch.projectId && !isUuid(patch.projectId)) || (patch.milestoneId && !isUuid(patch.milestoneId))) {
    return serviceFail("That task or milestone is no longer available. Refresh and try again.");
  }
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0) return serviceFail("Give the task a title first.");
    payload.title = title;
  }
  if (patch.projectId !== undefined) {
    payload.project_id = patch.projectId;
    // A milestone belongs to one project, so moving a task elsewhere detaches it
    // unless the caller names a milestone in the destination project.
    if (patch.milestoneId === undefined) {
      const { data: current, error: currentError } = await context.supabase.from("tasks").select("project_id").eq("id", taskId).maybeSingle();
      if (currentError) return serviceFail(describeDatabaseError(currentError, SAVE_FAILED_MESSAGE));
      if (!current) return serviceFail(SAVE_FAILED_MESSAGE);
      if ((current as { project_id: string }).project_id !== patch.projectId) {
        payload.milestone_id = null;
        const { data: last, error: orderError } = await context.supabase
          .from("tasks")
          .select("sort_order")
          .eq("project_id", patch.projectId)
          .eq("status", patch.status ?? "Backlog")
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (orderError) return serviceFail(describeDatabaseError(orderError, SAVE_FAILED_MESSAGE));
        payload.sort_order = ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 1;
      }
    }
  }
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.status !== undefined) {
    const completion = await completionColumns(context.supabase, taskId, patch.status);
    if (completion.error) return serviceFail(describeDatabaseError(completion.error, SAVE_FAILED_MESSAGE));
    payload.status = patch.status;
    Object.assign(payload, completion.columns);
  }
  if (patch.dueDate !== undefined) payload.due_date = patch.dueDate ?? null;
  if (patch.milestoneId !== undefined) payload.milestone_id = patch.milestoneId ?? null;
  if (Object.keys(payload).length === 0) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase.from("tasks").update(payload).eq("id", taskId).select(TASK_COLUMNS).single();
  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapTaskRow(data as TaskRow));
}

/**
 * Status transitions own `completed_at`: completing sets it once, and an
 * un-complete always clears it (the check constraint would reject anything else).
 */
export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<ServiceResult<Task>> {
  if (!isUuid(taskId)) return serviceFail("That task is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const completion = await completionColumns(context.supabase, taskId, status);
  if (completion.error) return serviceFail(describeDatabaseError(completion.error, SAVE_FAILED_MESSAGE));

  const { data, error } = await context.supabase
    .from("tasks")
    .update({ status, ...completion.columns })
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapTaskRow(data as TaskRow));
}

export async function completeTask(taskId: string): Promise<ServiceResult<Task>> {
  return setTaskStatus(taskId, "Completed");
}

export async function reopenTask(taskId: string): Promise<ServiceResult<Task>> {
  return setTaskStatus(taskId, "In Progress");
}

export interface TaskOrderUpdate {
  id: string;
  status: TaskStatus;
  sortOrder: number;
}

/** Persist a bounded reorder within one project; RLS remains the ownership boundary. */
export async function reorderProjectTasks(projectId: string, movedTaskId: string, sourceStatus: TaskStatus, updates: TaskOrderUpdate[]): Promise<ServiceResult<{ id: string }>> {
  if (!isUuid(projectId) || !isUuid(movedTaskId) || !updates.some((item) => item.id === movedTaskId)
    || new Set(updates.map((item) => item.id)).size !== updates.length
    || updates.some((item) => !isUuid(item.id) || !Number.isInteger(item.sortOrder) || item.sortOrder < 1)) {
    return serviceFail("That task order is no longer available. Refresh and try again.");
  }
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const moved = updates.find((item) => item.id === movedTaskId);
  const { error } = await context.supabase.rpc("reorder_project_tasks", {
    p_project_id: projectId,
    p_moved_task_id: movedTaskId,
    p_moved_status: moved?.status ?? sourceStatus,
    p_task_ids: updates.map((item) => item.id),
    p_sort_orders: updates.map((item) => item.sortOrder),
  });
  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk({ id: projectId });
}

export async function deleteTask(taskId: string): Promise<ServiceResult<{ id: string }>> {
  if (!isUuid(taskId)) return serviceFail("That task is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(DELETE_FAILED_MESSAGE);

  const { error } = await context.supabase.from("tasks").delete().eq("id", taskId);
  if (error) return serviceFail(describeDatabaseError(error, DELETE_FAILED_MESSAGE));
  return serviceOk({ id: taskId });
}
