import { AiError } from "@/lib/ai/errors";

export const AI_ACTIONS = [
  "next_actions", "break_project", "break_task", "summarize_note", "extract_actions",
  "improve_description", "draft_case_study", "progress_summary", "ask_project",
] as const;
export type AiAction = (typeof AI_ACTIONS)[number];
export type PriorityLabel = "low" | "medium" | "high";

export type AiOutput =
  | { suggestions: Array<{ title: string; rationale: string; priority: PriorityLabel }> }
  | { tasks: Array<{ title: string; description: string; priority: PriorityLabel }> }
  | { summary: string }
  | { actions: Array<{ title: string; detail: string }> }
  | { description: string }
  | { summary: string; challenge: string; solution: string; outcome: string }
  | { summary: string; completedHighlights: string[]; attentionItems: string[]; suggestedNextSteps: string[] }
  | { answer: string };

export type JsonSchema = Record<string, unknown>;
const string = (maxLength: number): JsonSchema => ({ type: "string", maxLength });
const array = (items: JsonSchema, minItems: number, maxItems: number): JsonSchema => ({ type: "array", items, minItems, maxItems });
const object = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({
  type: "object", properties, required, additionalProperties: false,
});
const priority = { type: "string", enum: ["low", "medium", "high"] };

export const AI_OUTPUT_SCHEMAS: Record<AiAction, JsonSchema> = {
  next_actions: object({ suggestions: array(object({ title: string(140), rationale: string(500), priority }, ["title", "rationale", "priority"]), 3, 5) }, ["suggestions"]),
  break_project: object({ tasks: array(object({ title: string(140), description: string(600), priority }, ["title", "description", "priority"]), 5, 10) }, ["tasks"]),
  break_task: object({ tasks: array(object({ title: string(140), description: string(600), priority }, ["title", "description", "priority"]), 3, 7) }, ["tasks"]),
  summarize_note: object({ summary: string(2400) }, ["summary"]),
  extract_actions: object({ actions: array(object({ title: string(140), detail: string(500) }, ["title", "detail"]), 0, 10) }, ["actions"]),
  improve_description: object({ description: string(3000) }, ["description"]),
  draft_case_study: object({ summary: string(1000), challenge: string(1400), solution: string(1400), outcome: string(1000) }, ["summary", "challenge", "solution", "outcome"]),
  progress_summary: object({ summary: string(1800), completedHighlights: array(string(300), 0, 8), attentionItems: array(string(300), 0, 8), suggestedNextSteps: array(string(300), 0, 8) }, ["summary", "completedHighlights", "attentionItems", "suggestedNextSteps"]),
  ask_project: object({ answer: string(2200) }, ["answer"]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validArray(value: unknown, min: number, max: number, validate: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every(validate);
}

function validPriority(value: unknown): value is PriorityLabel {
  return value === "low" || value === "medium" || value === "high";
}

export function validateAiOutput(action: AiAction, value: unknown): AiOutput {
  if (!isRecord(value)) throw new AiError("MALFORMED_OUTPUT");
  const valid = ((): boolean => {
    switch (action) {
      case "next_actions":
        return hasExactKeys(value, ["suggestions"]) && validArray(value.suggestions, 3, 5, (item) => isRecord(item) && hasExactKeys(item, ["title", "rationale", "priority"]) && boundedString(item.title, 140) && boundedString(item.rationale, 500) && validPriority(item.priority));
      case "break_project":
        return hasExactKeys(value, ["tasks"]) && validArray(value.tasks, 5, 10, (item) => isRecord(item) && hasExactKeys(item, ["title", "description", "priority"]) && boundedString(item.title, 140) && typeof item.description === "string" && item.description.length <= 600 && validPriority(item.priority));
      case "break_task":
        return hasExactKeys(value, ["tasks"]) && validArray(value.tasks, 3, 7, (item) => isRecord(item) && hasExactKeys(item, ["title", "description", "priority"]) && boundedString(item.title, 140) && typeof item.description === "string" && item.description.length <= 600 && validPriority(item.priority));
      case "summarize_note": return hasExactKeys(value, ["summary"]) && boundedString(value.summary, 2400);
      case "extract_actions": return hasExactKeys(value, ["actions"]) && validArray(value.actions, 0, 10, (item) => isRecord(item) && hasExactKeys(item, ["title", "detail"]) && boundedString(item.title, 140) && typeof item.detail === "string" && item.detail.length <= 500);
      case "improve_description": return hasExactKeys(value, ["description"]) && boundedString(value.description, 3000);
      case "draft_case_study": return hasExactKeys(value, ["summary", "challenge", "solution", "outcome"]) && boundedString(value.summary, 1000) && typeof value.challenge === "string" && value.challenge.length <= 1400 && typeof value.solution === "string" && value.solution.length <= 1400 && typeof value.outcome === "string" && value.outcome.length <= 1000;
      case "progress_summary": return hasExactKeys(value, ["summary", "completedHighlights", "attentionItems", "suggestedNextSteps"]) && boundedString(value.summary, 1800)
        && validArray(value.completedHighlights, 0, 8, (item) => typeof item === "string" && item.length <= 300)
        && validArray(value.attentionItems, 0, 8, (item) => typeof item === "string" && item.length <= 300)
        && validArray(value.suggestedNextSteps, 0, 8, (item) => typeof item === "string" && item.length <= 300);
      case "ask_project": return hasExactKeys(value, ["answer"]) && boundedString(value.answer, 2200);
    }
  })();
  if (!valid) throw new AiError("MALFORMED_OUTPUT");
  return value as AiOutput;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const contextKeys = ["projectDetails", "tasks", "milestones", "plans", "notes", "github", "accountability"] as const;
export type AiContextSelection = Partial<Record<(typeof contextKeys)[number], boolean>>;

export interface AiRequestBody {
  action: AiAction;
  projectId?: string;
  taskId?: string;
  noteId?: string;
  question?: string;
  context?: AiContextSelection;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export function parseAiRequest(value: unknown): AiRequestBody {
  if (!isRecord(value) || !AI_ACTIONS.includes(value.action as AiAction)) throw new AiError("INVALID_INPUT");
  const action = value.action as AiAction;
  const projectId = value.projectId;
  const taskId = value.taskId;
  const noteId = value.noteId;
  if (projectId !== undefined && (typeof projectId !== "string" || !UUID.test(projectId))) throw new AiError("INVALID_INPUT");
  if (taskId !== undefined && (typeof taskId !== "string" || !UUID.test(taskId))) throw new AiError("INVALID_INPUT");
  if (noteId !== undefined && (typeof noteId !== "string" || !UUID.test(noteId))) throw new AiError("INVALID_INPUT");
  if (["next_actions", "break_project", "improve_description", "draft_case_study", "progress_summary", "ask_project"].includes(action) && !projectId) throw new AiError("INVALID_INPUT");
  if (action === "break_task" && !taskId) throw new AiError("INVALID_INPUT");
  if (["summarize_note", "extract_actions"].includes(action) && !noteId) throw new AiError("INVALID_INPUT");
  if (action === "ask_project" && !boundedString(value.question, 1000)) throw new AiError("INVALID_INPUT");
  let context: AiContextSelection | undefined;
  if (value.context !== undefined) {
    if (!isRecord(value.context) || Object.keys(value.context).some((key) => !contextKeys.includes(key as (typeof contextKeys)[number]))) throw new AiError("INVALID_INPUT");
    if (Object.values(value.context).some((entry) => typeof entry !== "boolean")) throw new AiError("INVALID_INPUT");
    context = value.context as AiContextSelection;
  }
  let history: AiRequestBody["history"];
  if (value.history !== undefined) {
    if (!validArray(value.history, 0, 6, (item) => isRecord(item) && (item.role === "user" || item.role === "assistant") && boundedString(item.content, 700))) throw new AiError("INVALID_INPUT");
    history = value.history as AiRequestBody["history"];
  }
  return { action, projectId: projectId as string | undefined, taskId: taskId as string | undefined, noteId: noteId as string | undefined, question: value.question as string | undefined, context, history };
}

export function sanitizeGithubActivity(value: unknown): Array<{ kind: string; title: string; occurredAt: string | null }> {
  if (!isRecord(value)) return [];
  const rows: Array<{ kind: string; title: string; occurredAt: string | null }> = [];
  const collections: Array<[string, unknown]> = [["commit", value.commits], ["pull request", value.pullRequests], ["issue", value.issues], ["release", value.releases]];
  for (const [kind, collection] of collections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection.slice(0, 8)) {
      if (!isRecord(item) || typeof item.title !== "string") continue;
      const date = item.occurredAt ?? item.updatedAt ?? item.publishedAt ?? item.createdAt;
      rows.push({ kind, title: item.title.slice(0, 180), occurredAt: typeof date === "string" ? date.slice(0, 40) : null });
    }
  }
  return rows.slice(0, 20);
}
