import "server-only";
import { randomUUID } from "node:crypto";
import { AiError } from "@/lib/ai/errors";
import { taskCalendarDate } from "@/data/workspaceCalendar";
import { MAX_PROPOSED_ACTIONS_PER_RUN, type ProposalDraft, type TaskChanges } from "@/lib/ai/agent/contract";
import { parseProposalTool } from "@/lib/ai/agent/proposal-schema";
import type { ToolContext } from "@/lib/ai/agent/tools";

function excerpt(value: unknown, limit: number) { const text = String(value ?? ""); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text; }

export async function collectProposal(name: string, input: unknown, context: ToolContext, drafts: ProposalDraft[]) {
  const parsed = parseProposalTool(name, input);
  if ("entityType" in parsed) {
    const milestone = parsed.entityType === "milestone";
    let query = context.supabase.from(milestone ? "milestones" : "projects").select(milestone ? "id,title,project_id,target_date,updated_at,projects!inner(id,user_id)" : "id,title,target_date,updated_at").eq("id", parsed.entityId);
    query = query.eq(milestone ? "projects.user_id" : "user_id", context.userId);
    const { data, error } = await query.abortSignal(context.signal).maybeSingle();
    if (error) throw new AiError("UPSTREAM_ERROR");
    if (!data) throw new AiError("FORBIDDEN");
    const row = data as unknown as { id: string; title: string; project_id: string; target_date: string | null; updated_at: string };
    const before = { targetDate: row.target_date ?? null };
    const type = milestone ? "reschedule_milestone" : "reschedule_project";
    const existing = drafts.find(draft => draft.type === type && draft.entityId === parsed.entityId);
    if (existing && existing.expectedUpdatedAt !== row.updated_at) throw new AiError("FORBIDDEN");
    if (before.targetDate === parsed.targetDate) throw new AiError("INVALID_INPUT");
    const payload = { targetDate: parsed.targetDate };
    const diff = [{ field: "targetDate" as const, before: before.targetDate, after: parsed.targetDate }];
    if (existing) { existing.payload = payload; existing.diff = diff; }
    else {
      if (drafts.length >= MAX_PROPOSED_ACTIONS_PER_RUN) throw new AiError("AGENT_LIMIT_REACHED");
      drafts.push({ id: randomUUID(), type, entityId: parsed.entityId, taskId: null, projectId: milestone ? row.project_id : row.id, title: excerpt(row.title, 180), payload, before, expectedUpdatedAt: row.updated_at, diff, status: "pending" });
    }
    return { pendingApproval: true, summary: "Prepared a date proposal. No workspace change has occurred.", proposedActions: drafts.length };
  }
  let projectId: string, title: string, before: TaskChanges = {}, version: string | null = null, taskId: string | null = null;
  let changes: TaskChanges;
  let newMilestoneTitle: string | null = null;
  if ("taskId" in parsed) {
    taskId = parsed.taskId; changes = parsed.changes;
    const { data, error } = await context.supabase.from("tasks").select("id,title,description,status,priority,due_date,milestone_id,updated_at,project_id,projects!inner(id,user_id,title)").eq("id", taskId).eq("user_id", context.userId).eq("projects.user_id", context.userId).abortSignal(context.signal).maybeSingle();
    if (error) throw new AiError("UPSTREAM_ERROR");
    if (!data) throw new AiError("FORBIDDEN");
    projectId = data.project_id; title = data.title; version = data.updated_at;
    before = { title: excerpt(data.title, 180), description: excerpt(data.description, 4000), status: data.status, priority: data.priority, dueDate: taskCalendarDate(data.due_date ?? undefined, context.timeZone), milestoneId: data.milestone_id };
  } else {
    const { projectId: id, ...fields } = parsed;
    projectId = id; title = parsed.title;
    const { data, error } = await context.supabase.from("projects").select("id").eq("id", id).eq("user_id", context.userId).abortSignal(context.signal).maybeSingle();
    if (error) throw new AiError("UPSTREAM_ERROR");
    if (!data) throw new AiError("FORBIDDEN");
    changes = { description: "", status: "Backlog", priority: "Medium", dueDate: null, milestoneId: null, ...fields };
  }
  if (changes.milestoneId) {
    const { data, error } = await context.supabase.from("milestones").select("id,title").eq("id", changes.milestoneId).eq("project_id", projectId).abortSignal(context.signal).maybeSingle();
    if (error) throw new AiError("UPSTREAM_ERROR");
    if (!data) throw new AiError("FORBIDDEN");
    newMilestoneTitle = String(data.title ?? "Milestone").slice(0, 180);
  }
  const existing = taskId ? drafts.find(draft => draft.taskId === taskId) : undefined;
  if (existing && existing.expectedUpdatedAt !== version) throw new AiError("FORBIDDEN");
  const payload = { ...existing?.payload, ...changes };
  const diff = (Object.keys(payload) as Array<keyof TaskChanges>).filter(field => taskId ? before[field] !== payload[field] : payload[field] !== null && payload[field] !== "").map(field => ({ field, before: before[field] ?? null, after: payload[field] ?? null }));
  const milestoneDiff = diff.find(item => item.field === "milestoneId");
  if (milestoneDiff) {
    if (before.milestoneId) {
      const { data, error } = await context.supabase.from("milestones").select("title").eq("id", before.milestoneId).eq("project_id", projectId).abortSignal(context.signal).maybeSingle();
      if (error) throw new AiError("UPSTREAM_ERROR");
      milestoneDiff.before = String(data?.title ?? "Unavailable milestone").slice(0, 180);
    }
    milestoneDiff.after = Object.hasOwn(changes, "milestoneId") ? newMilestoneTitle : existing?.diff.find(item => item.field === "milestoneId")?.after ?? null;
  }
  if (!diff.length) throw new AiError("INVALID_INPUT");
  if (existing) { existing.payload = payload; existing.diff = diff; }
  else {
    if (drafts.length >= MAX_PROPOSED_ACTIONS_PER_RUN) throw new AiError("AGENT_LIMIT_REACHED");
    drafts.push({ id: randomUUID(), type: taskId ? "update_task" : "create_task", taskId, projectId, title: excerpt(title, 180), payload, before, expectedUpdatedAt: version, diff, status: "pending" });
  }
  return { pendingApproval: true, summary: "Prepared a task proposal. No workspace change has occurred.", proposedActions: drafts.length };
}
