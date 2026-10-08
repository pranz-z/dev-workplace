import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getGeminiConfiguration } from "@/lib/ai/config";
import { AiError, normalizeGeminiError } from "@/lib/ai/errors";
import { localCalendarDate } from "@/data/workspaceCalendar";
import { agentTools } from "@/lib/ai/agent/registry";
import { AGENT_SYSTEM_INSTRUCTION } from "@/lib/ai/agent/prompt";
import { runAgentLoop } from "@/lib/ai/agent/executor";
import type { AgentRequest } from "@/lib/ai/agent/contract";
import type { ToolContext } from "@/lib/ai/agent/tools";

export async function generateAgentResponse(request: AgentRequest, context: ToolContext) {
  const configuration = getGeminiConfiguration();
  if (!configuration.configured || !configuration.apiKey || !configuration.model) throw new AiError("AI_NOT_CONFIGURED");
  const ai = new GoogleGenAI({ apiKey: configuration.apiKey });
  try {
    return await runAgentLoop(request, context, async (contents) => {
      const response = await ai.models.generateContent({ model: configuration.model!, contents, config: {
        systemInstruction: `${AGENT_SYSTEM_INSTRUCTION}\nTimezone: ${context.timeZone}. Today: ${localCalendarDate(context.now, context.timeZone)}.`,
        tools: [{ functionDeclarations: agentTools }], maxOutputTokens: 1800, abortSignal: context.signal,
        automaticFunctionCalling: { disable: true },
      } });
      if (response.promptFeedback?.blockReason) throw new AiError("CONTENT_BLOCKED");
      const candidate = response.candidates?.[0];
      if (!candidate?.content || (candidate.finishReason && candidate.finishReason !== "STOP")) throw new AiError("MALFORMED_OUTPUT");
      return candidate.content;
    });
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw context.signal.aborted ? new AiError("UPSTREAM_ERROR") : normalizeGeminiError(error);
  }
}
