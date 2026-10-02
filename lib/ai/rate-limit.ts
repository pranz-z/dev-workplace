import "server-only";

import { AiError } from "@/lib/ai/errors";

const DEFAULT_REQUESTS_PER_MINUTE = 10;
const DEFAULT_DAILY_LIMIT = 100;

function readBoundedLimit(name: string, fallback: number, maximum: number): number {
  const configured = process.env[name]?.trim();
  if (!configured) return fallback;
  if (!/^\d+$/.test(configured)) throw new AiError("AI_NOT_CONFIGURED");
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new AiError("AI_NOT_CONFIGURED");
  return value;
}

export function getPrivateAiRateLimits() {
  return {
    requestsPerMinute: readBoundedLimit("PRIVATE_AI_REQUESTS_PER_MINUTE", DEFAULT_REQUESTS_PER_MINUTE, 20),
    dailyLimit: readBoundedLimit("PRIVATE_AI_DAILY_LIMIT", DEFAULT_DAILY_LIMIT, 1000),
  };
}
