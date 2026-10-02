import { NextResponse } from "next/server";
import { AiError } from "@/lib/ai/errors";
import { parseChatRequest } from "@/lib/ai/chat";
import { MAX_CHAT_MULTIPART_BYTES } from "@/lib/ai/chat-contract";
import { validateChatFiles } from "@/lib/ai/chat-files";
import { buildPrivateChatContext } from "@/lib/ai/chat-context";
import { generatePrivateChatResponse } from "@/lib/ai/chat-gemini";
import { requireAuthenticatedAiUser } from "@/lib/ai/auth";
import { getGeminiConfiguration } from "@/lib/ai/config";
import { getPrivateAiRateLimits } from "@/lib/ai/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: AiError) {
  return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
}

async function boundedFormData(request: Request): Promise<FormData> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_CHAT_MULTIPART_BYTES) throw new AiError("INVALID_ATTACHMENT");
  const reader = request.body?.getReader();
  if (!reader) throw new AiError("INVALID_INPUT");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CHAT_MULTIPART_BYTES) {
      await reader.cancel();
      throw new AiError("INVALID_ATTACHMENT");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) throw new AiError("INVALID_INPUT");
  return new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return jsonError(new AiError("AI_NOT_CONFIGURED"));
  let userId: string;
  try { userId = (await requireAuthenticatedAiUser(supabase)).id; }
  catch (error) { return jsonError(error instanceof AiError ? error : new AiError("UNAUTHENTICATED")); }

  let body;
  let files: File[];
  try {
    const form = await boundedFormData(request);
    if (form.getAll("request").length !== 1 || [...form.keys()].some((key) => key !== "request" && key !== "files")) throw new AiError("INVALID_INPUT");
    body = parseChatRequest(JSON.parse(String(form.get("request") ?? "")) as unknown);
    files = form.getAll("files").filter((item): item is File => typeof item !== "string" && typeof item.arrayBuffer === "function");
    if (files.length !== form.getAll("files").length) throw new AiError("INVALID_ATTACHMENT");
  } catch (error) {
    return jsonError(error instanceof AiError ? error : new AiError("INVALID_INPUT"));
  }
  try {
    const { requestsPerMinute, dailyLimit } = getPrivateAiRateLimits();
    const { data: allowed, error } = await getSupabaseAdminClient().rpc("consume_private_ai_rate_limit", {
      p_user_id: userId, p_minute_limit: requestsPerMinute, p_daily_limit: dailyLimit,
    });
    if (error || typeof allowed !== "boolean") {
      console.error("[ai-chat] persistent rate limit failed", { operation: "consume_private_ai_rate_limit", code: error?.code ?? "invalid_result" });
      throw new AiError("UPSTREAM_ERROR");
    }
    if (!allowed) throw new AiError("RATE_LIMITED");
    if (!getGeminiConfiguration().configured) throw new AiError("AI_NOT_CONFIGURED");
    const [context, attachments] = await Promise.all([
      buildPrivateChatContext(supabase, userId, body.workspaceContext),
      validateChatFiles(files),
    ]);
    const answer = await generatePrivateChatResponse(body.message, body.history, context, attachments);
    return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const normalized = error instanceof AiError ? error : new AiError("UPSTREAM_ERROR");
    if (!(error instanceof AiError)) console.error("[ai-chat] request failed", { operation: "chat", category: normalized.code });
    return jsonError(normalized);
  }
}
