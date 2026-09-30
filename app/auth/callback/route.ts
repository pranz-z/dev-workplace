import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const supabase = await getSupabaseServerClient();

  if (code && supabase) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const metadata = data.user.user_metadata ?? {};
      await supabase.from("profiles").upsert({
        id: data.user.id,
        username: metadata.user_name ?? metadata.preferred_username ?? data.user.email?.split("@")[0] ?? null,
        github_username: metadata.user_name ?? metadata.preferred_username ?? null,
        display_name: metadata.full_name ?? metadata.name ?? null,
        avatar_url: metadata.avatar_url ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
    }
  }
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/app", url.origin));
}
