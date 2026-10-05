import type { Task, TaskStatus } from "@/types";
import { taskCalendarDate } from "@/data/workspaceCalendar";

export const TASK_STATUSES = ["Backlog", "Planned", "In Progress", "Review", "Testing", "Blocked", "Completed"] as const satisfies readonly TaskStatus[];

export type TaskListSort = "workspace" | "newest" | "oldest" | "due-soonest" | "due-latest";
export type TaskListStatusFilter = "all" | "incomplete" | "completed" | TaskStatus[];

export interface TaskListOptions {
  projectId: string;
  statusFilter: TaskListStatusFilter;
  sort: TaskListSort;
}

export function parseTaskListSort(value: string | null): TaskListSort {
  return value === "newest" || value === "oldest" || value === "due-soonest" || value === "due-latest" || value === "workspace"
    ? value
    : "workspace";
}

export function parseTaskListStatusFilter(value: string | null): TaskListStatusFilter {
  if (value === "incomplete" || value === "completed") return value;
  if (!value) return "all";
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length === 0) return "all";
    if (Array.isArray(parsed) && parsed.every((status) => typeof status === "string" && TASK_STATUSES.includes(status as TaskStatus))) {
      return [...new Set(parsed)] as TaskStatus[];
    }
  } catch {
    // Invalid session preferences fall back to showing all tasks.
  }
  return "all";
}

export function filterTasksByStatus(tasks: Task[], statusFilter: TaskListStatusFilter): Task[] {
  if (statusFilter === "all") return [...tasks];
  if (statusFilter === "completed") return tasks.filter((task) => task.status === "Completed");
  if (statusFilter === "incomplete") return tasks.filter((task) => task.status !== "Completed");
  const selected = new Set(statusFilter);
  return tasks.filter((task) => selected.has(task.status));
}

export function sortTaskList(tasks: Task[], sort: TaskListSort): Task[] {
  const sorted = [...tasks];
  if (sort === "workspace") return sorted;

  return sorted.sort((a, b) => {
    if (sort === "newest" || sort === "oldest") {
      const aCreated = Date.parse(a.createdAt);
      const bCreated = Date.parse(b.createdAt);
      if (Number.isFinite(aCreated) && Number.isFinite(bCreated) && aCreated !== bCreated) {
        return sort === "newest" ? bCreated - aCreated : aCreated - bCreated;
      }
      if (Number.isFinite(aCreated) !== Number.isFinite(bCreated)) return Number.isFinite(aCreated) ? -1 : 1;
    } else {
      const aDate = taskCalendarDate(a.dueDate, "UTC");
      const bDate = taskCalendarDate(b.dueDate, "UTC");
      if (aDate === null && bDate !== null) return 1;
      if (aDate !== null && bDate === null) return -1;
      if (aDate !== null && bDate !== null && aDate !== bDate) {
        const result = aDate.localeCompare(bDate);
        return sort === "due-soonest" ? result : -result;
      }
    }
    return a.id.localeCompare(b.id);
  });
}

export function deriveTaskList(tasks: Task[], { projectId, statusFilter, sort }: TaskListOptions): Task[] {
  const projectTasks = projectId ? tasks.filter((task) => task.projectId === projectId) : [...tasks];
  return sortTaskList(filterTasksByStatus(projectTasks, statusFilter), sort);
}
