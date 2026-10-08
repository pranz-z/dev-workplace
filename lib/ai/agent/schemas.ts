import "server-only";
import { AiError } from "@/lib/ai/errors";
import { parseChatRequest } from "@/lib/ai/chat";
import { isValidCalendarDate } from "@/data/workspaceCalendar";
import { isValidTimeZone } from "@/data/accountabilityReports";
import { agentTools } from "@/lib/ai/agent/registry";
import type { AgentRequest } from "@/lib/ai/agent/contract";

export type ToolArguments = Record<string, string | number | boolean | string[]>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiError("INVALID_INPUT");
  return value as Record<string, unknown>;
}
export function validTimeZone(value: unknown): value is string {
  return typeof value === "string" && isValidTimeZone(value);
}
export function parseAgentRequest(value: unknown): AgentRequest {
  const row = object(value);
  if (Object.keys(row).some((key) => !["message", "history", "timeZone"].includes(key)) || !validTimeZone(row.timeZone)) throw new AiError("INVALID_INPUT");
  const parsed = parseChatRequest({ message: row.message, history: row.history });
  return { message: parsed.message, history: parsed.history, timeZone: row.timeZone };
}
export function parseToolArguments(name: string, value: unknown): ToolArguments {
  const definition = agentTools.find((tool) => tool.name === name);
  if (!definition) throw new AiError("MALFORMED_OUTPUT");
  const row = object(value);
  const { properties, required } = definition.parametersJsonSchema;
  if (required.some((key) => row[key] === undefined)) throw new AiError("INVALID_INPUT");
  for (const [key, value] of Object.entries(row)) {
    if (!Object.hasOwn(properties, key)) throw new AiError("INVALID_INPUT");
    const field = properties[key];
    const valid = field.type === "integer" ? Number.isInteger(value) && Number(value) >= (field.minimum ?? 1) && Number(value) <= (field.maximum ?? 50)
      : field.type === "array" ? Array.isArray(value) && value.length > 0 && value.length <= (field.maxItems ?? 3) && value.every((item) => field.items?.enum.includes(item))
      : typeof value === field.type && (typeof value !== "string" || (value.length > 0 && value.length <= (field.maxLength ?? 100) && (!field.enum || field.enum.includes(value))));
    if (!valid || (key.endsWith("Id") && !uuid.test(String(value))) || (["date", "startDate", "endDate", "dueFrom", "dueTo"].includes(key) && !isValidCalendarDate(String(value)))) throw new AiError("INVALID_INPUT");
  }
  if ((row.startDate && row.endDate && String(row.startDate) > String(row.endDate)) || (row.dueFrom && row.dueTo && String(row.dueFrom) > String(row.dueTo))) throw new AiError("INVALID_INPUT");
  if (name === "get_calendar_load" && (Date.parse(String(row.endDate)) - Date.parse(String(row.startDate))) / 86400000 >= 31) throw new AiError("INVALID_INPUT");
  return row as ToolArguments;
}
