import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getGeminiConfiguration } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { type AiAction } from "@/lib/ai/schemas";
import { generateWithProvider } from "@/lib/ai/provider";

export async function generateStructuredResponse(action: AiAction, systemInstruction: string, context: unknown): Promise<unknown> {
  const configuration = getGeminiConfiguration();
  if (!configuration.configured || !configuration.apiKey || !configuration.model) throw new AiError("AI_NOT_CONFIGURED");
  const startedAt = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey: configuration.apiKey });
    return await generateWithProvider(action, systemInstruction, context, configuration.model, async (parameters) => {
      const response = await ai.models.generateContent(parameters);
      const finishReason = response.candidates?.[0]?.finishReason;
      return {
        text: response.text,
        blocked: Boolean(response.promptFeedback?.blockReason)
          || finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "BLOCKLIST",
      };
    });
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw error;
  } finally {
    console.info("[ai] generation finished", {
      action,
      model: configuration.model,
      durationMs: Date.now() - startedAt,
    });
  }
}
