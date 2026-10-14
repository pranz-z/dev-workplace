import "server-only";

const MAX_ATTEMPTS = 3;
const MIN_NEXT_CALL_BUDGET_MS = 10_000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 500, 502, 503, 504]);
const NETWORK_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_BODY_TIMEOUT",
]);
const SAFE_ERROR_NAMES = new Set(["ApiError", "TypeError", "Error", "AbortError"]);

type FailureCategory = "http" | "transport" | "other";

export function classifyGeminiFailure(error: unknown): {
  category: FailureCategory;
  upstreamStatus: number | null;
  retryable: boolean;
} {
  const candidate = error as { status?: unknown; cause?: { code?: unknown }; name?: unknown; message?: unknown } | null;
  const statusValue = candidate?.status;
  const status = Number.isInteger(statusValue) && Number(statusValue) >= 100 && Number(statusValue) <= 599
    ? Number(statusValue)
    : null;
  if (status !== null) {
    return {
      category: "http",
      upstreamStatus: status,
      retryable: RETRYABLE_HTTP_STATUSES.has(status),
    };
  }

  const networkCode = typeof candidate?.cause?.code === "string" ? candidate.cause.code : "";
  const identifiedNetworkFailure = candidate?.name === "TypeError"
    && candidate?.message === "fetch failed"
    && NETWORK_CODES.has(networkCode);
  return { category: identifiedNetworkFailure ? "transport" : "other", upstreamStatus: null, retryable: identifiedNetworkFailure };
}

function delayForRetry(attempt: number, random: () => number) {
  const jitter = Math.min(0.999999, Math.max(0, random()));
  return attempt === 1 ? 500 + Math.floor(jitter * 501) : 1_500 + Math.floor(jitter * 1_001);
}

function sleepWithAbort(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function safeErrorName(error: unknown) {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && SAFE_ERROR_NAMES.has(name) ? name : "Error";
}

function safeNetworkCode(error: unknown) {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" && NETWORK_CODES.has(code) ? code : null;
}

export async function retryGeminiTransport<T>(
  generate: () => Promise<T>,
  options: {
    deadlineAt: number;
    signal?: AbortSignal;
    now?: () => number;
    random?: () => number;
    sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
    log?: (message: string, fields: Record<string, string | number | boolean | null>) => void;
  },
): Promise<T> {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? sleepWithAbort;
  const startedAt = now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await generate();
    } catch (error) {
      const failure = classifyGeminiFailure(error);
      const delayMs = attempt < MAX_ATTEMPTS && failure.retryable ? delayForRetry(attempt, random) : 0;
      const remainingDeadlineMs = Math.max(0, options.deadlineAt - now());
      const enoughBudget = delayMs > 0 && remainingDeadlineMs > delayMs + MIN_NEXT_CALL_BUDGET_MS;
      const retry = attempt < MAX_ATTEMPTS && failure.retryable && enoughBudget && !options.signal?.aborted;
      const terminalReason = options.signal?.aborted
        ? "aborted"
        : !failure.retryable ? "non_retryable"
          : attempt >= MAX_ATTEMPTS ? "attempt_limit"
            : !enoughBudget ? "insufficient_deadline"
              : "retry_scheduled";
      const errorName = safeErrorName(error);
      const fields = {
        category: failure.category,
        upstreamStatus: failure.upstreamStatus,
        sdkErrorName: errorName,
        sdkErrorCode: safeNetworkCode(error),
        attempt,
        retryable: failure.retryable,
        elapsedMs: Math.max(0, now() - startedAt),
        remainingDeadlineMs,
        terminalReason,
      };
      try { (options.log ?? console.warn)("[ai-agent] Gemini transport attempt failed", fields); } catch { /* Diagnostics must not change the Agent result. */ }

      if (!retry) throw error;
      await sleep(delayMs, options.signal);
      options.signal?.throwIfAborted();
      if (options.deadlineAt - now() <= MIN_NEXT_CALL_BUDGET_MS) throw error;
    }
  }

  throw new Error("Gemini transport attempt limit reached");
}
