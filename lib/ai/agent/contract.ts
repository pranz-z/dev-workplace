import type { ChatTurn } from "@/lib/ai/chat-contract";

export const MAX_AGENT_ROUNDS = 6;
export const MAX_TOOL_CALLS = 10;
export const AGENT_TIMEOUT_MS = 50_000;
export const MAX_AGENT_BODY_BYTES = 32_000;
export const MAX_PROPOSED_ACTIONS_PER_RUN = 10;
export type ActionStatus = "pending" | "applied" | "cancelled" | "conflict" | "failed";
export const UNDO_REASONS = ['AVAILABLE','PENDING_INVERSE','ALREADY_REVERSED','ENTITY_MISSING','STATE_CHANGED','UNSUPPORTED_ACTION','NOT_APPLIED','LINK_UNAVAILABLE','SLOT_PAST','SLOT_OCCUPIED','HISTORY_INCOMPLETE'] as const;
export type UndoReason = typeof UNDO_REASONS[number];
export interface AgentActionReference { runId:string; actionId:string; createdAt:string }
export interface UndoEligibility {
 state:'available'|'unsafe'|'already_reversed'|'entity_missing'|'state_changed'|'unsupported';
 reason:UndoReason; explanation:string; inverseSummary?:string;
 existingInverse?:AgentActionReference & {status:'pending'|'applied'};
}
export type TaskChanges = { title?: string; description?: string; status?: import("@/types").TaskStatus; priority?: import("@/types").Priority; dueDate?: string | null; milestoneId?: string | null };
export type ProposalChanges = Omit<TaskChanges,'status'> & {status?:TaskChanges['status']|'scheduled'|'completed'|'cancelled';targetDate?:string|null;startAt?:string;endAt?:string;projectId?:string|null;taskId?:string|null;kind?:'focus'|'task'|'break'|'custom'};
export interface ProposalDraft { undoOf?: AgentActionReference | null; id: string; type: "create_task" | "update_task" | "reschedule_milestone" | "reschedule_project" | 'create_time_block' | 'update_time_block' | 'cancel_time_block'; entityId?: string | null; taskId: string | null; projectId: string|null; title: string; payload: ProposalChanges; before: ProposalChanges; expectedUpdatedAt: string | null; diff: Array<{ field: keyof ProposalChanges; before: string | null; after: string | null }>; status: ActionStatus }
export interface ProposalBatch { runId: string; actions: ProposalDraft[] }
export interface ActionResult { id: string; status: ActionStatus; errorCode?: string | null; entityId?: string | null }
export interface AgentRequest { message: string; history: ChatTurn[]; timeZone: string }
export interface ToolActivity { tool: string; status: "success"; summary: string }
export interface AgentResponse { answer: string; toolActivity: ToolActivity[]; proposalBatch?: ProposalBatch }
