import { NextResponse } from "next/server";
import { sanitizeNextPath } from "@/lib/auth/redirects";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getApplicationOrigin } from "@/lib/site-origin";

/**
 * OAuth authorization-code callback (PKCE). Supabase keeps the session in the supported
 * cookie flow; no tokens are ever written into the URL manually or into local storage.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = sanitizeNextPath(url.searchParams.get("next"));
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  const origin = getApplicationOrigin();
  if (!origin) return NextResponse.json({ error: "Application origin is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const redirectToLogin = (errorCode: string) => NextResponse.redirect(new URL(`/login?error=${errorCode}`, origin));

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    console.error("[auth/callback] Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.");
    return redirectToLogin("config");
  }

  if (providerError) {
    console.warn("[auth/callback] Identity provider sign-in was rejected.");
    return redirectToLogin("oauth");
  }

  if (!code) {
    console.error("[auth/callback] Missing authorization code on the callback request.");
    return redirectToLogin("callback");
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("[auth/callback] Code exchange failed.", { code: error?.code ?? "unknown" });
    return redirectToLogin("callback");
  }

  try {
    const metadata = data.user.user_metadata ?? {};
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: data.user.id,
      username: metadata.user_name ?? metadata.preferred_username ?? data.user.email?.split("@")[0] ?? null,
      github_username: metadata.user_name ?? metadata.preferred_username ?? null,
      display_name: metadata.full_name ?? metadata.name ?? null,
      avatar_url: metadata.avatar_url ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (profileError) console.error("[auth/callback] Profile sync skipped.", { code: profileError.code ?? "unknown" });
  } catch {
    // The workspace still works when the optional profile mirror cannot be written.
    console.error("[auth/callback] Profile sync failed.", { operation: "sync_user_profile" });
  }

  return NextResponse.redirect(new URL(nextPath, origin));
}

