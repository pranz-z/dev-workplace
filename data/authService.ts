import { buildAuthCallbackUrl, sanitizeNextPath } from "@/lib/auth/redirects";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * Starts the Supabase GitHub OAuth flow.
 * GitHub is used as an identity provider only: no repository scopes are requested in
 * this phase, and repository access stays a separate opt-in step.
 */
export async function signInWithGithub(nextPath = "/app") {
  if (!isSupabaseConfigured()) return { configured: false as const };
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: buildAuthCallbackUrl(sanitizeNextPath(nextPath)) },
  });
  if (error) throw error;
  return { configured: true as const };
}

