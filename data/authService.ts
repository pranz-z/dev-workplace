import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export async function signInWithGithub() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { configured: false as const };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: `${window.location.origin}/auth/callback?next=/` },
  });
  if (error) throw error;
  return { configured: true as const };
}

export async function signOut() {
  const supabase = getSupabaseBrowserClient();
  if (supabase) await supabase.auth.signOut();
}
