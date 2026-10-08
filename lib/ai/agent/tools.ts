import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, Task, Milestone } from "@/types";
import { AiError } from "@/lib/ai/errors";
import { filterCalendarEvents, getCalendarSummary, isCalendarEventOverdue, localCalendarDate, normalizeCalendarEvents, taskCalendarDate, type CalendarEventType } from "@/data/workspaceCalendar";
import { parseToolArguments, type ToolArguments } from "@/lib/ai/agent/schemas";

export interface ToolContext { supabase: SupabaseClient; userId: string; timeZone: string; now: Date; signal: AbortSignal }
type Row = Record<string, unknown>;
const PROJECT_COLUMNS = "id,title,status,priority,workflow_stage,target_date,current_objective,next_action,visibility";
const TASK_COLUMNS = "id,title,project_id,status,priority,due_date,projects!inner(id,title,user_id)";
const MILESTONE_COLUMNS = "id,title,project_id,status,target_date,projects!inner(id,title,user_id)";
const PLAN_COLUMNS = "id,title,status,target_date";
const SCAN_LIMIT = 1000;
const text = (value: unknown, length = 180) => String(value ?? "").slice(0, length);
const relatedProject = (row: Row) => row.projects as Row;
function readFailure() { throw new AiError("UPSTREAM_ERROR"); }

// Only fixed, server-selected tables and columns reach this helper.
async function read(context: ToolContext, table: "projects" | "tasks" | "milestones" | "plans", columns: string, args: ToolArguments = {}, resourceId?: string) {
  const rows: Row[] = [];
  for (let offset = 0; offset <= SCAN_LIMIT; offset += 200) {
    let query = context.supabase.from(table).select(columns).order("id", { ascending: true }).abortSignal(context.signal);
    query = table === "milestones" ? query.eq("projects.user_id", context.userId) : query.eq("user_id", context.userId);
    if (table === "tasks") query = query.eq("projects.user_id", context.userId);
    if (resourceId) query = query.eq("id", resourceId);
    if (args.projectId && (table === "tasks" || table === "milestones")) query = query.eq("project_id", args.projectId);
    if (args.projectId && table === "projects") query = query.eq("id", args.projectId);
    for (const field of ["status", "priority", "visibility"]) if (args[field]) query = query.eq(field, args[field]);
    const size = Math.min(200, SCAN_LIMIT + 1 - offset);
    const { data, error } = await query.range(offset, offset + size - 1);
    if (error) readFailure();
    rows.push(...(data ?? []) as unknown as Row[]);
    if ((data?.length ?? 0) < size || resourceId) break;
  }
  return { rows: rows.slice(0, SCAN_LIMIT), truncated: rows.length > SCAN_LIMIT };
}
async function ownedProject(context: ToolContext, projectId: string) {
  const result = await read(context, "projects", PROJECT_COLUMNS, {}, projectId);
  if (!result.rows[0]) throw new AiError("FORBIDDEN");
  return result.rows[0];
}
function projectSummary(row: Row) {
  return { id: text(row.id, 36), title: text(row.title), status: text(row.status, 40), priority: text(row.priority, 20), workflowStage: text(row.workflow_stage, 40), targetDate: text(row.target_date, 10), objective: text(row.current_objective, 500), nextAction: text(row.next_action, 300) };
}
function taskSummary(row: Row, zone: string) {
  return { id: text(row.id, 36), title: text(row.title), projectId: text(row.project_id, 36), projectTitle: text(relatedProject(row)?.title), status: text(row.status, 40), priority: text(row.priority, 20), dueDate: taskCalendarDate(typeof row.due_date === "string" ? row.due_date : undefined, zone) };
}
function planSummary(row: Row) { return { id: text(row.id, 36), title: text(row.title), status: text(row.status, 40), targetDate: text(row.target_date, 10) }; }
function bounded<T>(items: T[], args: ToolArguments, scanTruncated: boolean) {
  const limit = Number(args.limit ?? 20);
  return { items: items.slice(0, limit), truncated: scanTruncated || items.length > limit, scope: scanTruncated ? "Partial scan: at most 1000 owned rows per entity type. Results and counts may be incomplete." : "Matching owned records; truncated indicates additional matches." };
}
function within(date: string | null, from: unknown, to: unknown) { return (!from && !to) || Boolean(date && (!from || date >= String(from)) && (!to || date <= String(to))); }

export async function executeReadTool(name: string, input: unknown, context: ToolContext): Promise<Record<string, unknown>> {
  const args = parseToolArguments(name, input);
  context.signal.throwIfAborted();
  if (args.projectId) await ownedProject(context, String(args.projectId));
  if (name === "list_projects" || name === "get_project") {
    const result = await read(context, "projects", `${PROJECT_COLUMNS}${name === "get_project" ? ",description" : ""}`, args, name === "get_project" ? String(args.projectId) : undefined);
    if (name === "list_projects") return bounded(result.rows.map(projectSummary), args, result.truncated);
    const row = result.rows[0];
    if (!row) throw new AiError("FORBIDDEN");
    const { data, error } = await context.supabase.from("project_technologies").select("technologies(name)").eq("project_id", row.id).limit(21).abortSignal(context.signal);
    if (error) readFailure();
    const technologies = ((data ?? []) as unknown as Array<{ technologies: { name: string } | null }>).slice(0, 20).map((row) => text(row.technologies?.name, 60));
    return { ...projectSummary(row), description: text(row.description, 1500), technologies, technologiesTruncated: (data?.length ?? 0) > 20 };
  }
  if (["list_tasks", "get_task", "list_overdue_tasks", "list_tasks_due_between", "list_unscheduled_tasks"].includes(name)) {
    const result = await read(context, "tasks", `${TASK_COLUMNS}${name === "get_task" ? ",description" : ""}`, args, name === "get_task" ? String(args.taskId) : undefined);
    if (name === "get_task") {
      const row = result.rows[0];
      if (!row) throw new AiError("FORBIDDEN");
      return { ...taskSummary(row, context.timeZone), description: text(row.description, 1200) };
    }
    const today = localCalendarDate(context.now, context.timeZone);
    const items = result.rows.map((row) => taskSummary(row, context.timeZone)).filter((row) => {
      if (!args.includeCompleted && row.status === "Completed") return false;
      if ((name === "list_unscheduled_tasks" || args.unscheduledOnly) && row.dueDate !== null) return false;
      if (name === "list_overdue_tasks" && !isCalendarEventOverdue({ id: row.id, entityId: row.id, entityType: "task", title: row.title, projectId: row.projectId, projectTitle: row.projectTitle, date: row.dueDate, completed: row.status === "Completed" }, today)) return false;
      return within(row.dueDate, args.startDate ?? args.dueFrom, args.endDate ?? args.dueTo);
    });
    return bounded(items, args, result.truncated);
  }
  if (name === "list_plans" || name === "get_plan") {
    const result = await read(context, "plans", `${PLAN_COLUMNS}${name === "get_plan" ? ",description" : ""}`, args, name === "get_plan" ? String(args.planId) : undefined);
    if (name === "list_plans") return bounded(result.rows.filter((row) => (args.includeCompleted || row.status !== "Completed") && within(text(row.target_date, 10) || null, args.startDate, args.endDate)).map(planSummary), args, result.truncated);
    const row = result.rows[0];
    if (!row) throw new AiError("FORBIDDEN");
    const { data, error } = await context.supabase.from("project_plan_items").select("label,done").eq("plan_id", row.id).order("sort_order", { ascending: true }).limit(21).abortSignal(context.signal);
    if (error) readFailure();
    return { ...planSummary(row), goal: text(row.description, 1000), checklist: ((data ?? []) as unknown as Row[]).slice(0, 20).map((item) => ({ label: text(item.label, 160), done: item.done === true })), checklistTruncated: (data?.length ?? 0) > 20 };
  }
  if (name === "list_milestones") {
    const result = await read(context, "milestones", MILESTONE_COLUMNS, args);
    return bounded(result.rows.filter((row) => (args.includeCompleted || row.status !== "completed") && within(text(row.target_date, 10) || null, args.startDate, args.endDate)).map((row) => ({ id: text(row.id, 36), title: text(row.title), projectId: text(row.project_id, 36), projectTitle: text(relatedProject(row)?.title), status: text(row.status, 40), targetDate: text(row.target_date, 10) })), args, result.truncated);
  }
  // Calendar alone loads all three bounded projections; other tools read only their entity.
  const projects = await read(context, "projects", PROJECT_COLUMNS, args);
  const tasks = await read(context, "tasks", TASK_COLUMNS, args);
  const milestones = await read(context, "milestones", MILESTONE_COLUMNS, args);
  // Calendar consumes only these fields from its existing view models.
  const events = normalizeCalendarEvents(
    projects.rows.map((row) => ({ id: row.id, name: text(row.title), status: row.status, priority: row.priority, targetDate: row.target_date })) as Project[],
    tasks.rows.map((row) => ({ id: row.id, title: text(row.title), projectId: row.project_id, status: row.status, priority: row.priority, dueDate: row.due_date ?? undefined })) as Task[],
    milestones.rows.map((row) => ({ id: row.id, title: text(row.title), projectId: row.project_id, status: row.status, targetDate: row.target_date ?? undefined })) as Milestone[], context.timeZone,
  );
  const truncated = projects.truncated || tasks.truncated || milestones.truncated;
  if (name === "get_calendar_summary") return { summary: getCalendarSummary(events, String(args.date ?? localCalendarDate(context.now, context.timeZone))), truncated, scope: truncated ? "Partial workspace counts (scan limit reached)." : "Owned workspace Calendar counts." };
  const filtered = filterCalendarEvents(events, { projectId: String(args.projectId ?? ""), enabledTypes: (args.entityTypes ?? ["task", "milestone", "project"]) as CalendarEventType[], showCompleted: args.includeCompleted === true });
  return bounded(filtered.filter((event) => within(event.date, args.startDate, args.endDate)).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id)), args, truncated);
}
