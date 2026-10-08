import "server-only";

type Field = { type: "string" | "integer" | "boolean" | "array"; description?: string; enum?: string[]; items?: { type: "string"; enum: string[] }; minimum?: number; maximum?: number; maxLength?: number; maxItems?: number };
const id: Field = { type: "string", description: "Internal UUID", maxLength: 36 };
const date: Field = { type: "string", description: "Valid YYYY-MM-DD calendar date", maxLength: 10 };
const status: Field = { type: "string", maxLength: 40 };
const priority: Field = { type: "string", enum: ["Low", "Medium", "High", "Critical"] };
const limit: Field = { type: "integer", minimum: 1, maximum: 50, description: "Maximum summaries, default 20" };
const includeCompleted: Field = { type: "boolean" };
const projectId = id;
function tool(name: string, description: string, properties: Record<string, Field>, required: string[] = []) {
  return { name, description, parametersJsonSchema: { type: "object", properties, required, additionalProperties: false } };
}
export const agentTools = [
  tool("get_calendar_load", "Read incomplete task, milestone and project counts per day (maximum 31 days). Advisory load, not hourly conflicts. Use before spreading work.", { startDate: date, endDate: date, projectId }, ["startDate", "endDate"]),
  tool("list_projects", "Find owned projects. Bounded summaries; use get_project for detail.", { status, priority, visibility: { type: "string", enum: ["Private", "Public", "Unlisted"] }, limit }),
  tool("get_project", "Read one owned project with technologies.", { projectId }, ["projectId"]),
  tool("list_tasks", "Read owned tasks; excludes completed by default.", { projectId, milestoneId: id, status, priority, dueFrom: date, dueTo: date, includeCompleted, unscheduledOnly: { type: "boolean" }, limit }),
  tool("get_task", "Read one owned task and its owned project title.", { taskId: id }, ["taskId"]),
  tool("list_overdue_tasks", "Read incomplete tasks before today using Calendar timezone rules.", { projectId, limit }),
  tool("list_tasks_due_between", "Read tasks in an inclusive Calendar date range.", { startDate: date, endDate: date, projectId, includeCompleted, limit }, ["startDate", "endDate"]),
  tool("list_unscheduled_tasks", "Read incomplete tasks without a valid Calendar due date.", { projectId, priority, limit }),
  tool("list_milestones", "Read milestones of owned projects.", { projectId, status, startDate: date, endDate: date, includeCompleted, limit }),
  tool("list_plans", "Read owned plan summaries.", { status, startDate: date, endDate: date, includeCompleted, limit }),
  tool("get_plan", "Read one owned plan with bounded checklist.", { planId: id }, ["planId"]),
  tool("get_calendar_summary", "Calendar counts: due today, through Saturday, overdue and unscheduled. Optional date changes the reference day.", { date, projectId }),
  tool("list_calendar_items", "Read normalized task, milestone and project calendar items in an inclusive date range.", { startDate: date, endDate: date, projectId, entityTypes: { type: "array", maxItems: 3, items: { type: "string", enum: ["task", "milestone", "project"] } }, includeCompleted, limit }, ["startDate", "endDate"]),
];
