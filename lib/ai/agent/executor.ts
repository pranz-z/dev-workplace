import "server-only";
import type { Content, Part } from "@google/genai";
import { AiError } from "@/lib/ai/errors";
import { MAX_AGENT_ROUNDS, MAX_TOOL_CALLS, type AgentRequest, type AgentResponse } from "@/lib/ai/agent/contract";
import { parseToolArguments } from "@/lib/ai/agent/schemas";
import { executeReadTool, type ToolContext } from "@/lib/ai/agent/tools";
import { collectProposal } from "@/lib/ai/agent/proposals";
import { proposalTools, parseProposalTool } from "@/lib/ai/agent/proposal-schema";
import { proposalSummary, type CalendarLoadDay } from "@/lib/ai/agent/schedule-summary";
import type { ProposalDraft } from "@/lib/ai/agent/contract";

type Model = (contents: Content[]) => Promise<Content>;
export async function runAgentLoop(request: AgentRequest, context: ToolContext, generate: Model, execute: typeof executeReadTool = executeReadTool): Promise<AgentResponse & { drafts?: ProposalDraft[] }> {
  const contents: Content[] = [...request.history.map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.content }] })), { role: "user", parts: [{ text: request.message }] }];
  const toolActivity: AgentResponse["toolActivity"] = [];
  let calls = 0;
  const drafts: ProposalDraft[] = [];
  const load = new Map<string, CalendarLoadDay>();
  let partial = false;
  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    context.signal.throwIfAborted();
    const response = await generate(contents);
    if (!response.parts?.length) throw new AiError("MALFORMED_OUTPUT");
    const functions = response.parts.filter((part) => part.functionCall).map((part) => part.functionCall!);
    if (!functions.length) {
      const answer = response.parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("").trim();
      if (!answer || answer.length > 6000) throw new AiError("MALFORMED_OUTPUT");
      return { answer: drafts.length ? proposalSummary(drafts, [...load.values()], partial) : answer, toolActivity, ...(drafts.length ? { drafts } : {}) };
    }
    calls += functions.length;
    if (calls > MAX_TOOL_CALLS || round === MAX_AGENT_ROUNDS - 1) throw new AiError("AGENT_LIMIT_REACHED");
    // Validate the entire round before any database reads.
    const validated = functions.map((call) => {
      if (typeof call.name !== "string") throw new AiError("MALFORMED_OUTPUT");
      if (proposalTools.some(tool => tool.name === call.name)) { parseProposalTool(call.name, call.args ?? {}); return { call, args: call.args ?? {}, proposal: true }; }
      return { call, args: parseToolArguments(call.name, call.args ?? {}), proposal: false };
    });
    // Preserve original model parts, including Gemini thought signatures.
    contents.push({ ...response, role: "model" });
    const parts: Part[] = [];
    for (const { call, args, proposal } of validated) {
      context.signal.throwIfAborted();
      const result: Record<string, unknown> = proposal ? await collectProposal(call.name!, args, context, drafts) : await execute(call.name!, args, context);
      if (result.truncated === true) partial = true;
      if (call.name === "get_calendar_load" && Array.isArray(result.items)) for (const day of result.items as CalendarLoadDay[]) load.set(day.date, day);
      if (JSON.stringify(result).length > 60_000) throw new AiError("MALFORMED_OUTPUT");
      parts.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { untrustedWorkspaceData: result } } });
      const count = Array.isArray(result.items) ? result.items.length : undefined;
      toolActivity.push({ tool: call.name!, status: "success", summary: count === undefined ? "Reviewed workspace data" : `Found ${count} item${count === 1 ? "" : "s"}${result.truncated ? " (partial results)" : ""}` });
    }
    contents.push({ role: "user", parts });
  }
  throw new AiError("AGENT_LIMIT_REACHED");
}
