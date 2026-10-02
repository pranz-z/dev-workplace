import "server-only";

export interface GeminiConfiguration {
  configured: boolean;
  model: string | null;
  apiKey?: string;
}

export function getGeminiConfiguration(environment: NodeJS.ProcessEnv = process.env): GeminiConfiguration {
  const apiKey = environment.GEMINI_API_KEY?.trim();
  const model = environment.GEMINI_MODEL?.trim();
  const modelIsValid = Boolean(model && /^[A-Za-z0-9._-]{1,100}$/.test(model));
  if (!apiKey || !modelIsValid) return { configured: false, model: null };
  return { configured: true, model: model!, apiKey };
}
