import "server-only";
import { AiError } from "@/lib/ai/errors";
import { MAX_AGENT_BODY_BYTES } from "@/lib/ai/agent/contract";

export async function boundedAgentBody(request: Request, signal: AbortSignal): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AiError("INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw new AiError("INVALID_INPUT");
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let total = 0, body = "";
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AGENT_BODY_BYTES) { await reader.cancel(); throw new AiError("INVALID_INPUT"); }
      body += decoder.decode(value, { stream: true });
    }
    signal.throwIfAborted();
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch (error) { if (error instanceof AiError) throw error; throw new AiError("INVALID_INPUT"); }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
