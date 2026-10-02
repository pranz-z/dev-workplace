import "server-only";
import { randomUUID } from "node:crypto";
import { AiError } from "@/lib/ai/errors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const PRIVATE_AI_LEASE_TTL_SECONDS = 90;

export async function acquirePrivateAiLease(userId: string): Promise<string | null> {
  const leaseId = randomUUID();
  const { data, error } = await getSupabaseAdminClient().rpc("acquire_private_ai_lease", {
    p_user_id: userId,
    p_lease_id: leaseId,
    p_ttl_seconds: PRIVATE_AI_LEASE_TTL_SECONDS,
  });
  if (error || typeof data !== "boolean") {
    console.error("[ai] private request lease failed", { operation: "acquire_private_ai_lease", code: error?.code ?? "invalid_result" });
    throw new AiError("UPSTREAM_ERROR");
  }
  return data ? leaseId : null;
}

export async function releasePrivateAiLease(userId: string, leaseId: string): Promise<void> {
  try {
    const { error } = await getSupabaseAdminClient().rpc("release_private_ai_lease", {
      p_user_id: userId,
      p_lease_id: leaseId,
    });
    if (error) console.error("[ai] private request lease release failed", { operation: "release_private_ai_lease", code: error.code ?? "unknown" });
  } catch {
    console.error("[ai] private request lease release failed", { operation: "release_private_ai_lease", code: "unknown" });
  }
}
