import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";

let browserClient: SupabaseClient | undefined;

/**
 * Cookie-based Supabase client for browser code (createBrowserClient).
 * Exposes the single shared instance; throws a clear developer error instead of
 * silently creating a client with missing environment values.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() can only run in the browser. Use getSupabaseServerClient() for server code.");
  }
  if (!browserClient) {
    const { url, key } = getSupabaseEnv();
    browserClient = createBrowserClient(url, key);
  }
  return browserClient;
}
