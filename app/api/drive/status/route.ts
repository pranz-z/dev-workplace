import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import type { GoogleDriveConnectionCiphertextRow } from "@/data/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireGoogleDriveUser();
  if ("response" in auth) return auth.response;

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("get_google_drive_connection", { p_user_id: auth.user.id });
    if (error) throw error;
    const connection = (Array.isArray(data) ? data[0] : null) as GoogleDriveConnectionCiphertextRow | null;
    return NextResponse.json({
      connected: Boolean(connection),
      connectedAt: connection?.created_at ?? null,
      updatedAt: connection?.updated_at ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "unknown";
    console.error("[google-drive] status lookup failed", { code });
    return NextResponse.json({ error: "Google Drive connection status is unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
