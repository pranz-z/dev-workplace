import { NextResponse } from "next/server";
import { GithubIntegrationError } from "@/data/githubAppService";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function requireGithubUser() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { response: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { response: NextResponse.json({ error: "Sign in to connect GitHub repositories." }, { status: 401 }) } as const;
  return { supabase, user: data.user } as const;
}

export function githubErrorResponse(error: unknown) {
  if (error instanceof GithubIntegrationError) return NextResponse.json({ error: error.message }, { status: error.status });
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "unknown";
  console.error("[github] repository integration request failed", { code });
  return NextResponse.json({ error: "GitHub repository access could not be completed. Try again shortly." }, { status: 502 });
}
