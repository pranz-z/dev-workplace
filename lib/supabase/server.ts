import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * Cookie-based Supabase client for server code (createServerClient).
 * Returns null when the environment is missing so callers can answer with a friendly
 * configuration error instead of creating an invalid client.
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null;

  const { url, key } = getSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components cannot always write cookies; proxy.ts refreshes the session.
        }
      },
    },
  });
}

