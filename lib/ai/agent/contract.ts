import type { ChatTurn } from "@/lib/ai/chat-contract";

export const MAX_AGENT_ROUNDS = 6;
export const MAX_TOOL_CALLS = 10;
export const AGENT_TIMEOUT_MS = 50_000;
export const MAX_AGENT_BODY_BYTES = 32_000;
export interface AgentRequest { message: string; history: ChatTurn[]; timeZone: string }
export interface ToolActivity { tool: string; status: "success"; summary: string }
export interface AgentResponse { answer: string; toolActivity: ToolActivity[] }
