import type { Milestone, Project, Task } from "@/types";

export type CalendarEventType = "task" | "milestone" | "project";

export interface WorkspaceCalendarEvent {
  id: string;
  entityId: string;
  entityType: CalendarEventType;
  projectId: string;
  projectTitle: string;
  title: string;
  date: string | null;
  completed: boolean;
  status?: string;
  priority?: string;
}

export interface CalendarSummary {
  dueToday: number;
  thisWeek: number;
  overdue: number;
  unscheduled: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UTC_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?(?:Z|\+00:00)$/;

export function isValidCalendarDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function localCalendarDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Preserve date-only values, including UTC-midnight task timestamps created by the date input. */
export function taskCalendarDate(value: string | undefined, timeZone: string): string | null {
  if (!value) return null;
  if (isValidCalendarDate(value)) return value;
  const utcMidnight = UTC_MIDNIGHT.exec(value);
  if (utcMidnight && isValidCalendarDate(utcMidnight[1])) return utcMidnight[1];
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return localCalendarDate(timestamp, timeZone);
}

export function normalizeCalendarEvents(
  projects: Project[],
  tasks: Task[],
  milestones: Milestone[],
  timeZone: string,
): WorkspaceCalendarEvent[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const events: WorkspaceCalendarEvent[] = [];

  for (const task of tasks) {
    const project = projectById.get(task.projectId);
    if (!project) continue;
    events.push({
      id: `task:${task.id}`,
      entityId: task.id,
      entityType: "task",
      projectId: project.id,
      projectTitle: project.name,
      title: task.title,
      date: taskCalendarDate(task.dueDate, timeZone),
      completed: task.status === "Completed",
      status: task.status,
      priority: task.priority,
    });
  }

  for (const milestone of milestones) {
    const project = projectById.get(milestone.projectId);
    if (!project) continue;
    events.push({
      id: `milestone:${milestone.id}`,
      entityId: milestone.id,
      entityType: "milestone",
      projectId: project.id,
      projectTitle: project.name,
      title: milestone.title,
      date: milestone.targetDate && isValidCalendarDate(milestone.targetDate) ? milestone.targetDate : null,
      completed: milestone.status === "completed",
      status: milestone.status,
    });
  }

  for (const project of projects) {
    events.push({
      id: `project:${project.id}`,
      entityId: project.id,
      entityType: "project",
      projectId: project.id,
      projectTitle: project.name,
      title: project.name,
      date: project.targetDate && isValidCalendarDate(project.targetDate) ? project.targetDate : null,
      completed: project.status === "Completed",
      status: project.status,
      priority: project.priority,
    });
  }

  return events;
}

export function filterCalendarEvents(
  events: WorkspaceCalendarEvent[],
  options: { projectId: string; enabledTypes: CalendarEventType[]; showCompleted: boolean },
): WorkspaceCalendarEvent[] {
  const enabled = new Set(options.enabledTypes);
  return events.filter((event) =>
    (!options.projectId || event.projectId === options.projectId)
    && enabled.has(event.entityType)
    && (options.showCompleted || !event.completed),
  );
}

export function monthGridDates(year: number, monthIndex: number): string[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const start = new Date(Date.UTC(year, monthIndex, 1 - first.getUTCDay()));
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 6 - last.getUTCDay()));
  const dates: string[] = [];
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

export function shiftCalendarMonth(dateOnly: string, monthDelta: number): string {
  if (!isValidCalendarDate(dateOnly)) throw new RangeError("A valid calendar date is required.");
  const [year, month, day] = dateOnly.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + monthDelta, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

export function formatCalendarDate(value: string, options: Intl.DateTimeFormatOptions = {}): string {
  if (!isValidCalendarDate(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function isCalendarEventOverdue(event: WorkspaceCalendarEvent, today: string): boolean {
  return Boolean(event.date && event.date < today && !event.completed);
}

export function getCalendarSummary(events: WorkspaceCalendarEvent[], today: string): CalendarSummary {
  const todayDay = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const daysUntilSaturday = 6 - todayDay;
  const endOfWeek = new Date(`${today}T00:00:00.000Z`);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysUntilSaturday);
  const weekEnd = endOfWeek.toISOString().slice(0, 10);
  const active = events.filter((event) => !event.completed);
  return {
    dueToday: active.filter((event) => event.date === today).length,
    thisWeek: active.filter((event) => event.date && event.date >= today && event.date <= weekEnd).length,
    overdue: active.filter((event) => isCalendarEventOverdue(event, today)).length,
    unscheduled: events.filter((event) => event.date === null).length,
  };
}

export function calendarDatePatch(type: CalendarEventType, date: string | null) {
  if (date !== null && !isValidCalendarDate(date)) throw new RangeError("A valid calendar date is required.");
  if (type === "task") return { dueDate: date };
  if (type === "milestone") return { targetDate: date };
  return { targetDate: date };
}
