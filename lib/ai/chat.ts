import "server-only";
import { AiError } from "@/lib/ai/errors";
import { MAX_CHAT_ENTITIES, MAX_CHAT_HISTORY_MESSAGES, MAX_CHAT_MESSAGE_LENGTH, type ChatTurn, type ParsedChatRequest, type WorkspaceEntityRef } from "@/lib/ai/chat-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseWorkspaceEntityReferences(value: unknown): WorkspaceEntityRef[] {
  if (!Array.isArray(value) || value.length > 64) throw new AiError("INVALID_INPUT");
  const result: WorkspaceEntityRef[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new AiError("INVALID_INPUT");
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "type" && key !== "id") || !(record.type === "project" || record.type === "task" || record.type === "plan") || typeof record.id !== "string" || !UUID.test(record.id)) throw new AiError("INVALID_INPUT");
    const key = `${record.type}:${record.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ type: record.type, id: record.id });
      if (result.length > MAX_CHAT_ENTITIES) throw new AiError("INVALID_INPUT");
    }
  }
  return result;
}

export function parseChatRequest(value: unknown): ParsedChatRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiError("INVALID_INPUT");
  const record = value as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (!message || message.length > MAX_CHAT_MESSAGE_LENGTH) throw new AiError("INVALID_INPUT");
  if (Object.keys(record).some((key) => !["message", "history", "workspaceContext"].includes(key))) throw new AiError("INVALID_INPUT");
  if (record.history !== undefined && (!Array.isArray(record.history) || record.history.length > 100)) throw new AiError("INVALID_INPUT");
  const history = ((record.history ?? []) as unknown[]).filter((turn): turn is Record<string, unknown> => Boolean(turn) && typeof turn === "object" && !Array.isArray(turn))
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string")
    .slice(-MAX_CHAT_HISTORY_MESSAGES).map((turn) => ({ role: turn.role as ChatTurn["role"], content: (turn.content as string).slice(0, 1000) }));
  return { message, history, workspaceContext: parseWorkspaceEntityReferences(record.workspaceContext ?? []) };
}

