import type { WorkspaceEntityRef } from "@/lib/ai/chat-contract";

export const WORKSPACE_AI_DRAG_TYPE = "application/x-developer-workplace-ai-context";

export function workspaceEntityDragPayload(entity: WorkspaceEntityRef): string {
  return JSON.stringify({ type: entity.type, id: entity.id });
}

export function parseWorkspaceEntityDragPayload(value: string): WorkspaceEntityRef | null {
  try {
    const candidate = JSON.parse(value) as Record<string, unknown>;
    if ((candidate.type === "project" || candidate.type === "task" || candidate.type === "plan") && typeof candidate.id === "string" && /^[0-9a-f-]{36}$/i.test(candidate.id)) {
      return { type: candidate.type, id: candidate.id };
    }
  } catch { /* Ignore unsupported drag data. */ }
  return null;
}
