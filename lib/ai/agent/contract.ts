import type { ChatTurn } from "@/lib/ai/chat-contract";

export const MAX_AGENT_ROUNDS = 6;
export const MAX_TOOL_CALLS = 10;
export const AGENT_TIMEOUT_MS = 50_000;
export const MAX_AGENT_BODY_BYTES = 32_000;
export const MAX_PROPOSED_ACTIONS_PER_RUN = 10;
export type ActionStatus = "pending" | "applied" | "cancelled" | "conflict" | "failed";
export type TaskChanges = { title?: string; description?: string; status?: import("@/types").TaskStatus; priority?: import("@/types").Priority; dueDate?: string | null; milestoneId?: string | null };
export interface ProposalDraft { id: string; type: "create_task" | "update_task"; taskId: string | null; projectId: string; title: string; payload: TaskChanges; before: TaskChanges; expectedUpdatedAt: string | null; diff: Array<{ field: keyof TaskChanges; before: string | null; after: string | null }>; status: ActionStatus }
export interface ProposalBatch { runId: string; actions: ProposalDraft[] }
export interface ActionResult { id: string; status: ActionStatus; errorCode?: string | null; entityId?: string | null }
export interface AgentRequest { message: string; history: ChatTurn[]; timeZone: string }
export interface ToolActivity { tool: string; status: "success"; summary: string }
export interface AgentResponse { answer: string; toolActivity: ToolActivity[]; proposalBatch?: ProposalBatch }
