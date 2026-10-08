import "server-only";
import { NextResponse } from "next/server";
import { AiError } from "@/lib/ai/errors";
import { requireAuthenticatedAiUser } from "@/lib/ai/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { acquirePrivateAiLease, releasePrivateAiLease } from "@/lib/ai/private-concurrency";
import { boundedAgentBody } from "@/lib/ai/agent/request";
import { parseActionSelection, requireUuid } from "@/lib/ai/agent/proposal-schema";
import { applySelectedActions, cancelSelectedActions, loadProposalBatch } from "@/lib/ai/agent/store";

/** Only approval UI calls these handlers. No Gemini or tool-loop dependency. */
export async function handleAgentActions(request: Request, operation: "apply" | "cancel" | "read") {
  try {
    const userId = (await requireAuthenticatedAiUser(await getSupabaseServerClient())).id;
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) throw new AiError("FORBIDDEN");
    const admin = getSupabaseAdminClient();
    const { data: allowed, error: limitError } = await admin.rpc("consume_agent_action_limit", { p_user_id: userId });
    if (limitError || typeof allowed !== "boolean") throw new AiError("UPSTREAM_ERROR");
    if (!allowed) throw new AiError("RATE_LIMITED");
    if (operation === "read") {
      const runId = requireUuid(new URL(request.url).searchParams.get("runId"));
      return NextResponse.json({ proposalBatch: await loadProposalBatch(admin, userId, runId) }, { headers: { "Cache-Control": "no-store" } });
    }
    const selection = parseActionSelection(await boundedAgentBody(request, AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])));
    const leaseId = await acquirePrivateAiLease(userId);
    if (!leaseId) throw new AiError("RATE_LIMITED");
    try {
      const batch = await loadProposalBatch(admin, userId, selection.runId);
      if (selection.actionIds.some(id => !batch.actions.some(action => action.id === id))) throw new AiError("FORBIDDEN");
      if (operation === "cancel") return NextResponse.json({ proposalBatch: await cancelSelectedActions(admin, userId, batch.runId, selection.actionIds) }, { headers: { "Cache-Control": "no-store" } });
      const results = await applySelectedActions(admin, userId, batch, selection.actionIds);
      const refreshed = await loadProposalBatch(admin, userId, batch.runId);
      const confirmedResults = results.map(result => {
        const action = refreshed.actions.find(action => action.id === result.id);
        return action && action.status !== "pending" ? { ...result, status: action.status, entityId: action.taskId, errorCode: action.status === result.status ? result.errorCode : null } : result;
      });
      return NextResponse.json({ results: confirmedResults, proposalBatch: refreshed }, { headers: { "Cache-Control": "no-store" } });
    } finally { await releasePrivateAiLease(userId, leaseId); }
  } catch (error) {
    const safe = error instanceof AiError ? error : new AiError("UPSTREAM_ERROR");
    return NextResponse.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
  }
}
