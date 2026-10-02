export type AiErrorCode =
  | "AI_NOT_CONFIGURED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "CONTENT_BLOCKED"
  | "MALFORMED_OUTPUT"
  | "UPSTREAM_ERROR";

const safeMessages: Record<AiErrorCode, string> = {
  AI_NOT_CONFIGURED: "AI features are not configured yet.",
  UNAUTHENTICATED: "Sign in to use the AI assistant.",
  FORBIDDEN: "That workspace item is not available.",
  INVALID_INPUT: "Check the request and try again.",
  RATE_LIMITED: "Gemini is temporarily rate-limited or the configured quota has been reached. Try again later.",
  MODEL_UNAVAILABLE: "The configured Gemini model is temporarily unavailable. Try again later.",
  CONTENT_BLOCKED: "Gemini could not process this request. Review the selected content and try again.",
  MALFORMED_OUTPUT: "Gemini returned a response that could not be safely used. Please regenerate.",
  UPSTREAM_ERROR: "The AI assistant is temporarily unavailable. Try again later.",
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;

  constructor(code: AiErrorCode) {
    super(safeMessages[code]);
    this.name = "AiError";
    this.code = code;
    this.status = code === "UNAUTHENTICATED" ? 401
      : code === "FORBIDDEN" ? 403
        : code === "INVALID_INPUT" || code === "MALFORMED_OUTPUT" ? 400
          : code === "AI_NOT_CONFIGURED" || code === "MODEL_UNAVAILABLE" ? 503
            : code === "RATE_LIMITED" ? 429 : 502;
  }
}

export function normalizeGeminiError(error: unknown): AiError {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  const code = typeof candidate?.code === "number" ? candidate.code : undefined;
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  if (status === 429 || code === 429 || /resource exhausted|quota|rate.?limit/.test(message)) return new AiError("RATE_LIMITED");
  if (status === 404 || /model.*(not found|unavailable)|not supported for generatecontent/.test(message)) return new AiError("MODEL_UNAVAILABLE");
  if (/safety|blocked|recitation/.test(message)) return new AiError("CONTENT_BLOCKED");
  return new AiError("UPSTREAM_ERROR");
}

export function aiErrorMessage(code: AiErrorCode): string {
  return safeMessages[code];
}
