import "server-only";
import { AiError } from "@/lib/ai/errors";
import { TASK_STATUSES } from "@/data/taskList";
import { isValidCalendarDate } from "@/data/workspaceCalendar";
import { MAX_PROPOSED_ACTIONS_PER_RUN, type TaskChanges } from "@/lib/ai/agent/contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function requireUuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) throw new AiError("INVALID_INPUT"); return value; }
function record(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiError("INVALID_INPUT"); return value as Record<string, unknown>; }
function keys(row: Record<string, unknown>, allowed: string[]) { if (Object.keys(row).some(key => !allowed.includes(key))) throw new AiError("INVALID_INPUT"); }
export function parseTaskChanges(value: unknown): TaskChanges {
  const row = record(value);
  keys(row, ["title", "description", "status", "priority", "dueDate", "milestoneId"]);
  if (!Object.keys(row).length) throw new AiError("INVALID_INPUT");
  const result: TaskChanges = {};
  if (Object.hasOwn(row, "title")) {
    if (typeof row.title !== "string" || !row.title.trim() || row.title.trim().length > 180) throw new AiError("INVALID_INPUT");
    result.title = row.title.trim();
  }
  if (Object.hasOwn(row, "description")) { if (typeof row.description !== "string" || row.description.length > 4000) throw new AiError("INVALID_INPUT"); result.description = row.description; }
  if (Object.hasOwn(row, "status")) { if (!TASK_STATUSES.includes(row.status as never)) throw new AiError("INVALID_INPUT"); result.status = row.status as TaskChanges["status"]; }
  if (Object.hasOwn(row, "priority")) { if (!["Low", "Medium", "High", "Critical"].includes(String(row.priority))) throw new AiError("INVALID_INPUT"); result.priority = row.priority as TaskChanges["priority"]; }
  if (Object.hasOwn(row, "dueDate")) { if (row.dueDate !== null && (typeof row.dueDate !== "string" || !isValidCalendarDate(row.dueDate))) throw new AiError("INVALID_INPUT"); result.dueDate = row.dueDate as string | null; }
  if (Object.hasOwn(row, "milestoneId")) result.milestoneId = row.milestoneId === null ? null : requireUuid(row.milestoneId);
  return result;
}
export type ProposalInput = { taskId: string; changes: TaskChanges } | ({ projectId: string; title: string } & TaskChanges);
export function parseProposalTool(name: string, value: unknown): ProposalInput {
  const row = record(value);
  if (name === "propose_update_task") {
    keys(row, ["taskId", "changes"]);
    return { taskId: requireUuid(row.taskId), changes: parseTaskChanges(row.changes) };
  }
  if (name !== "propose_create_task") throw new AiError("MALFORMED_OUTPUT");
  keys(row, ["projectId", "title", "description", "status", "priority", "dueDate", "milestoneId"]);
  const { projectId, ...fields } = row;
  const changes = parseTaskChanges(fields);
  if (!changes.title) throw new AiError("INVALID_INPUT");
  return { projectId: requireUuid(projectId), ...changes, title: changes.title };
}
export function parseActionSelection(value: unknown): { runId: string; actionIds: string[] } {
  const row = record(value); keys(row, ["runId", "actionIds"]);
  if (!Array.isArray(row.actionIds) || !row.actionIds.length || row.actionIds.length > MAX_PROPOSED_ACTIONS_PER_RUN || new Set(row.actionIds).size !== row.actionIds.length) throw new AiError("INVALID_INPUT");
  return { runId: requireUuid(row.runId), actionIds: row.actionIds.map(requireUuid) };
}
const fields = {
  title: { type: "string", maxLength: 180 }, description: { type: "string", maxLength: 4000 },
  status: { type: "string", enum: [...TASK_STATUSES] }, priority: { type: "string", enum: ["Low", "Medium", "High", "Critical"] },
  dueDate: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear" }, milestoneId: { type: ["string", "null"], description: "UUID of a milestone in the same project, or null" },
};
export const proposalTools = [
  { name: "propose_create_task", description: "Prepare a task creation for user review. Does NOT create a task. Never claim it was applied.", parametersJsonSchema: { type: "object", properties: { projectId: { type: "string" }, ...fields }, required: ["projectId", "title"], additionalProperties: false } },
  { name: "propose_update_task", description: "Prepare a task patch for user review. Does NOT update a task. Group fields for each task in one call.", parametersJsonSchema: { type: "object", properties: { taskId: { type: "string" }, changes: { type: "object", properties: fields, minProperties: 1, additionalProperties: false } }, required: ["taskId", "changes"], additionalProperties: false } },
];
