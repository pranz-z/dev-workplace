import { NextResponse } from "next/server";
import { buildAiContext } from "@/lib/ai/context";
import { requireAuthenticatedAiUser } from "@/lib/ai/auth";
import { getGeminiConfiguration } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { generateStructuredResponse } from "@/lib/ai/gemini";
import { systemInstructionFor } from "@/lib/ai/prompts";
import { parseAiRequest, validateAiOutput } from "@/lib/ai/schemas";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 24_000;
const inFlight = new Set<string>();

function jsonError(error: AiError) {
  return NextResponse.json({ error: { code: error.code, message: error.message } }, {
    status: error.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return jsonError(new AiError("AI_NOT_CONFIGURED"));
  try { await requireAuthenticatedAiUser(supabase); }
  catch (error) { return jsonError(error instanceof AiError ? error : new AiError("UNAUTHENTICATED")); }
  const configuration = getGeminiConfiguration();
  return NextResponse.json({ configured: configuration.configured, model: configuration.model }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return jsonError(new AiError("AI_NOT_CONFIGURED"));
  let userId: string;
  try { userId = (await requireAuthenticatedAiUser(supabase)).id; }
  catch (error) { return jsonError(error instanceof AiError ? error : new AiError("UNAUTHENTICATED")); }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return jsonError(new AiError("INVALID_INPUT"));
  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return jsonError(new AiError("INVALID_INPUT"));
    raw = JSON.parse(text) as unknown;
  } catch {
    return jsonError(new AiError("INVALID_INPUT"));
  }

  let body;
  try {
    body = parseAiRequest(raw);
  } catch (error) {
    return jsonError(error instanceof AiError ? error : new AiError("INVALID_INPUT"));
  }
  if (!getGeminiConfiguration().configured) return jsonError(new AiError("AI_NOT_CONFIGURED"));

  const lockKey = `${userId}:${body.action}`;
  if (inFlight.has(lockKey)) return jsonError(new AiError("RATE_LIMITED"));
  inFlight.add(lockKey);
  const startedAt = Date.now();
  let category = "success";
  try {
    const context = await buildAiContext(supabase, userId, body);
    const rawOutput = await generateStructuredResponse(body.action, systemInstructionFor(body.action), context);
    const output = validateAiOutput(body.action, rawOutput);
    return NextResponse.json({ output }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const normalized = error instanceof AiError ? error : new AiError("UPSTREAM_ERROR");
    category = normalized.code;
    if (!(error instanceof AiError)) console.error("[ai] request failed", { action: body.action, category });
    return jsonError(normalized);
  } finally {
    inFlight.delete(lockKey);
    console.info("[ai] request finished", { action: body.action, durationMs: Date.now() - startedAt, category });
  }
}
