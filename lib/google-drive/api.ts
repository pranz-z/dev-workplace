import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type GoogleDriveUserAuth = { user: User; supabase: SupabaseClient } | { response: NextResponse };

export async function requireGoogleDriveUser(): Promise<GoogleDriveUserAuth> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return { response: NextResponse.json({ error: "Supabase is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } }) } as const;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { response: NextResponse.json({ error: "Sign in to connect Google Drive." }, { status: 401, headers: { "Cache-Control": "no-store" } }) } as const;
  }
  return { user: data.user, supabase } as const;
}

export function googleDriveErrorResponse() {
  return NextResponse.json({ error: "Google Drive authorization could not be completed." }, {
    status: 502,
    headers: { "Cache-Control": "no-store" },
  });
}
