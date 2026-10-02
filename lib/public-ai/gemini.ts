import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getGeminiConfiguration } from "@/lib/ai/config";
import {
  MAX_ANSWER_LENGTH,
  PublicAiError,
  PUBLIC_AI_SYSTEM_INSTRUCTION,
  validatePublicAiAnswer,
  type PublicDeveloperContext,
} from "@/lib/public-ai/service";

const responseSchema = {
  type: "object",
  properties: {
    answer: { type: "string", minLength: 1, maxLength: MAX_ANSWER_LENGTH },
    relatedProjectSlugs: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 3 },
  },
  required: ["answer", "relatedProjectSlugs"],
  additionalProperties: false,
};

export async function generatePublicAiAnswer(question: string, context: PublicDeveloperContext) {
  const configuration = getGeminiConfiguration();
  if (!configuration.configured || !configuration.apiKey || !configuration.model) throw new PublicAiError("UNAVAILABLE");
  try {
    const ai = new GoogleGenAI({ apiKey: configuration.apiKey });
    const response = await ai.models.generateContent({
      model: configuration.model,
      contents: JSON.stringify({ visitorQuestion: question, publicDeveloperContext: context }),
      config: {
        systemInstruction: PUBLIC_AI_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema,
        maxOutputTokens: 700,
      },
    });
    if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === "SAFETY") throw new PublicAiError("UNAVAILABLE");
    if (typeof response.text !== "string" || response.text.length > 2_400) throw new PublicAiError("MALFORMED_OUTPUT");
    return validatePublicAiAnswer(JSON.parse(response.text) as unknown, context);
  } catch (error) {
    if (error instanceof PublicAiError) throw error;
    throw new PublicAiError("UNAVAILABLE");
  }
}
