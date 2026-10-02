import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { PublicAiProfileRow, PublicProjectCardRow } from "@/data/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { generatePublicAiAnswer } from "@/lib/public-ai/gemini";
import { createPublicAiHandlers, publicAiEnvironmentDependencies } from "@/lib/public-ai/handler";
import { VISITOR_REQUESTS_PER_MINUTE } from "@/lib/public-ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let anonymousClient: ReturnType<typeof createClient> | undefined;
function getPublicProjectionClient() {
  if (!anonymousClient) {
    const { url, key } = getSupabaseEnv();
    anonymousClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  }
  return anonymousClient;
}

const handlers = createPublicAiHandlers({
  ...publicAiEnvironmentDependencies(),
  async readProfile() {
    const { data, error } = await getPublicProjectionClient().rpc("public_ai_profile");
    if (error) throw error;
    return ((data ?? []) as PublicAiProfileRow[])[0] ?? null;
  },
  async readProjects() {
    const { data, error } = await getPublicProjectionClient().rpc("public_ai_project_list");
    if (error) throw error;
    return (data ?? []) as PublicProjectCardRow[];
  },
  async acquireLease(visitorHash) {
    const { data, error } = await getSupabaseAdminClient().rpc("acquire_public_ai_lease", { p_visitor_hash: visitorHash });
    if (error) throw error;
    if (typeof data !== "boolean") throw new Error("Public AI lease RPC returned an invalid result.");
    return data;
  },
  async releaseLease(visitorHash) {
    const { error } = await getSupabaseAdminClient().rpc("release_public_ai_lease", { p_visitor_hash: visitorHash });
    if (error) throw error;
  },
  async consumeRateLimit(visitorHash, dailyLimit) {
    const { data, error } = await getSupabaseAdminClient().rpc("consume_public_ai_rate_limit", {
      p_visitor_hash: visitorHash,
      p_visitor_limit: VISITOR_REQUESTS_PER_MINUTE,
      p_daily_limit: dailyLimit,
    });
    if (error) throw error;
    if (typeof data !== "boolean") throw new Error("Public AI rate-limit RPC returned an invalid result.");
    return data;
  },
  generate: generatePublicAiAnswer,
  ipFromRequest(request) {
    const direct = request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip");
    if (direct?.trim()) return direct.trim();
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  },
  hmac: createHmac,
});

export async function GET() {
  return handlers.get();
}

export async function POST(request: Request) {
  return handlers.post(request);
}
