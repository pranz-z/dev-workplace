import "server-only";
import type { Content, Part } from "@google/genai";
import { AiError } from "@/lib/ai/errors";
import { MAX_AGENT_ROUNDS, MAX_TOOL_CALLS, type AgentRequest, type AgentResponse } from "@/lib/ai/agent/contract";
import { parseToolArguments } from "@/lib/ai/agent/schemas";
import { executeReadTool, type ToolContext } from "@/lib/ai/agent/tools";

type Model = (contents: Content[]) => Promise<Content>;
export async function runAgentLoop(request: AgentRequest, context: ToolContext, generate: Model, execute: typeof executeReadTool = executeReadTool): Promise<AgentResponse> {
  const contents: Content[] = [...request.history.map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.content }] })), { role: "user", parts: [{ text: request.message }] }];
  const toolActivity: AgentResponse["toolActivity"] = [];
  let calls = 0;
  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    context.signal.throwIfAborted();
    const response = await generate(contents);
    if (!response.parts?.length) throw new AiError("MALFORMED_OUTPUT");
    const functions = response.parts.filter((part) => part.functionCall).map((part) => part.functionCall!);
    if (!functions.length) {
      const answer = response.parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("").trim();
      if (!answer || answer.length > 6000) throw new AiError("MALFORMED_OUTPUT");
      return { answer, toolActivity };
    }
    calls += functions.length;
    if (calls > MAX_TOOL_CALLS || round === MAX_AGENT_ROUNDS - 1) throw new AiError("AGENT_LIMIT_REACHED");
    // Validate the entire round before any database reads.
    const validated = functions.map((call) => {
      if (typeof call.name !== "string") throw new AiError("MALFORMED_OUTPUT");
      return { call, args: parseToolArguments(call.name, call.args ?? {}) };
    });
    // Preserve original model parts, including Gemini thought signatures.
    contents.push({ ...response, role: "model" });
    const parts: Part[] = [];
    for (const { call, args } of validated) {
      context.signal.throwIfAborted();
      const result = await execute(call.name!, args, context);
      if (JSON.stringify(result).length > 60_000) throw new AiError("MALFORMED_OUTPUT");
      parts.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { untrustedWorkspaceData: result } } });
      const count = Array.isArray(result.items) ? result.items.length : undefined;
      toolActivity.push({ tool: call.name!, status: "success", summary: count === undefined ? "Reviewed workspace data" : `Found ${count} item${count === 1 ? "" : "s"}${result.truncated ? " (partial results)" : ""}` });
    }
    contents.push({ role: "user", parts });
  }
  throw new AiError("AGENT_LIMIT_REACHED");
}
