import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface WorkspaceContext {
  supabase: SupabaseClient;
  userId: string;
}

/**
 * Every authenticated write goes through this guard, so a service can never
 * silently operate without a session (or without Supabase being configured).
 * Returns null and logs why - callers turn that into a user-facing message.
 */
export async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  if (!isSupabaseConfigured()) {
    console.info("[data] Supabase is not configured; workspace writes are disabled.");
    return null;
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    console.error("[data] no authenticated session for this write", { code: error?.code ?? "missing_user" });
    return null;
  }

  return { supabase, userId: data.user.id };
}

/** Postgres uuid guard - keeps user-supplied route params out of queries. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string | undefined | null): value is string => typeof value === "string" && UUID_PATTERN.test(value);
