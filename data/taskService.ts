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
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const TASK_COLUMNS = "id, user_id, project_id, milestone_id, title, description, status, priority, due_date, created_at, updated_at, completed_at";

export async function listTasks(): Promise<Task[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.from("tasks").select(TASK_COLUMNS).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapTaskRow(row as TaskRow));
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
  const { data, error } = await context.supabase
    .from("tasks")
    .insert({
      user_id: context.userId,
      project_id: input.projectId,
      milestone_id: input.milestoneId ?? null,
      title,
      description: input.description ?? "",
      status,
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
  if (patch.projectId !== undefined) payload.project_id = patch.projectId;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.status !== undefined) {
    payload.status = patch.status;
    payload.completed_at = patch.status === "Completed" ? new Date().toISOString() : null;
  }
  if (patch.dueDate !== undefined) payload.due_date = patch.dueDate ?? null;
  if (patch.milestoneId !== undefined) payload.milestone_id = patch.milestoneId ?? null;
  if (Object.keys(payload).length === 0) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase.from("tasks").update(payload).eq("id", taskId).select(TASK_COLUMNS).single();
  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapTaskRow(data as TaskRow));
}

/**
 * Status transitions own `completed_at`, so an un-complete always clears the
 * timestamp (the check constraint would reject anything else).
 */
export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<ServiceResult<Task>> {
  if (!isUuid(taskId)) return serviceFail("That task is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase
    .from("tasks")
    .update({ status, completed_at: status === "Completed" ? new Date().toISOString() : null })
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

export async function deleteTask(taskId: string): Promise<ServiceResult<{ id: string }>> {
  if (!isUuid(taskId)) return serviceFail("That task is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(DELETE_FAILED_MESSAGE);

  const { error } = await context.supabase.from("tasks").delete().eq("id", taskId);
  if (error) return serviceFail(describeDatabaseError(error, DELETE_FAILED_MESSAGE));
  return serviceOk({ id: taskId });
}
