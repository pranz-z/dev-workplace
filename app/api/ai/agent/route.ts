import { NextResponse } from "next/server";
import { AiError } from "@/lib/ai/errors";
import { requireAuthenticatedAiUser } from "@/lib/ai/auth";
import { getGeminiConfiguration } from "@/lib/ai/config";
import { getPrivateAiRateLimits } from "@/lib/ai/rate-limit";
import { acquirePrivateAiLease, releasePrivateAiLease } from "@/lib/ai/private-concurrency";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { AGENT_TIMEOUT_MS } from "@/lib/ai/agent/contract";
import { parseAgentRequest, validTimeZone } from "@/lib/ai/agent/schemas";
import { boundedAgentBody } from "@/lib/ai/agent/request";
import { saveProposalBatch } from "@/lib/ai/agent/store";
import { generateAgentResponse } from "@/lib/ai/agent/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(AGENT_TIMEOUT_MS)]);
  try {
    const supabase = await getSupabaseServerClient();
    const userId = (await requireAuthenticatedAiUser(supabase)).id;
    const { requestsPerMinute, dailyLimit } = getPrivateAiRateLimits();
    const { data: allowed, error } = await getSupabaseAdminClient().rpc("consume_private_ai_rate_limit", { p_user_id: userId, p_minute_limit: requestsPerMinute, p_daily_limit: dailyLimit }).abortSignal(signal);
    if (error || typeof allowed !== "boolean") throw new AiError("UPSTREAM_ERROR");
    if (!allowed) throw new AiError("RATE_LIMITED");
    const leaseId = await acquirePrivateAiLease(userId);
    if (!leaseId) throw new AiError("RATE_LIMITED");
    try {
      if (!getGeminiConfiguration().configured) throw new AiError("AI_NOT_CONFIGURED");
      const body = parseAgentRequest(await boundedAgentBody(request, signal));
      const { data: profile, error: profileError } = await supabase!.from("profiles").select("time_zone").eq("id", userId).abortSignal(signal).maybeSingle();
      if (profileError) throw new AiError("UPSTREAM_ERROR");
      const timeZone = validTimeZone(profile?.time_zone) ? profile.time_zone : body.timeZone;
      const { drafts, ...result } = await generateAgentResponse(body, { supabase: supabase!, userId, timeZone, now: new Date(), signal });
      if (drafts?.length) result.proposalBatch = await saveProposalBatch(getSupabaseAdminClient(), userId, drafts);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } finally { await releasePrivateAiLease(userId, leaseId); }
  } catch (error) {
    const normalized = error instanceof AiError ? error : new AiError("UPSTREAM_ERROR");
    return NextResponse.json({ error: { code: normalized.code, message: normalized.message } }, { status: normalized.status, headers: { "Cache-Control": "no-store" } });
  }
}
