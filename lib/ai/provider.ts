import { AiError, normalizeGeminiError } from "@/lib/ai/errors";
import { AI_OUTPUT_SCHEMAS, type AiAction, type JsonSchema } from "@/lib/ai/schemas";

export interface GeminiProviderRequest {
  model: string;
  contents: string;
  config: {
    systemInstruction: string;
    responseMimeType: "application/json";
    responseJsonSchema: JsonSchema;
    maxOutputTokens: number;
  };
}

export interface GeminiProviderResponse {
  text?: string;
  blocked?: boolean;
}

export type GeminiProviderCall = (request: GeminiProviderRequest) => Promise<GeminiProviderResponse>;

export async function generateWithProvider(
  action: AiAction,
  systemInstruction: string,
  context: unknown,
  model: string,
  callProvider: GeminiProviderCall,
): Promise<unknown> {
  let response: GeminiProviderResponse;
  try {
    response = await callProvider({
      model,
      contents: JSON.stringify(context),
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: AI_OUTPUT_SCHEMAS[action],
        maxOutputTokens: 3000,
      },
    });
  } catch (error) {
    throw normalizeGeminiError(error);
  }
  if (response.blocked) throw new AiError("CONTENT_BLOCKED");
  if (typeof response.text !== "string" || response.text.length > 16000) throw new AiError("MALFORMED_OUTPUT");
  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    throw new AiError("MALFORMED_OUTPUT");
  }
}
