import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { GoogleDriveConnectionCiphertextRow } from "@/data/database.types";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import {
  decryptGoogleDriveRefreshToken,
  getGoogleDriveTokenEncryptionKey,
  GoogleDriveOAuthError,
  revokeGoogleDriveRefreshToken,
} from "@/lib/google-drive/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function DELETE() {
  const auth = await requireGoogleDriveUser();
  if ("response" in auth) return auth.response;

  const admin = getSupabaseAdminClient();
  let connection: GoogleDriveConnectionCiphertextRow | null = null;
  try {
    const { data, error } = await admin.rpc("get_google_drive_connection", { p_user_id: auth.user.id });
    if (error) throw error;
    connection = (Array.isArray(data) ? data[0] : null) as GoogleDriveConnectionCiphertextRow | null;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "unknown";
    console.error("[google-drive] disconnect lookup failed", { code });
    return NextResponse.json({ error: "Google Drive could not be disconnected." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  if (!connection) return NextResponse.json({ connected: false, revoked: true }, { headers: { "Cache-Control": "no-store" } });

  let revoked = false;
  try {
    const token = decryptGoogleDriveRefreshToken(
      auth.user.id,
      connection.refresh_token_ciphertext,
      connection.encryption_key_version,
      getGoogleDriveTokenEncryptionKey(),
    );
    revoked = await revokeGoogleDriveRefreshToken(token);
  } catch (error) {
    const code = error instanceof GoogleDriveOAuthError
      ? error.code
      : typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : "unknown";
    console.error("[google-drive] remote revocation was not completed", { code });
  }

  // Local credentials are always removed on an explicit disconnect. Google
  // revocation is attempted first; a failure is reported so the user can also
  // remove the app under Google Account security settings.
  try {
    const { error } = await admin.rpc("delete_google_drive_connection", { p_user_id: auth.user.id });
    if (error) throw error;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "unknown";
    console.error("[google-drive] local credential removal failed", { code });
    return NextResponse.json({ error: "Google Drive could not be disconnected." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ connected: false, revoked }, { headers: { "Cache-Control": "no-store" } });
}
