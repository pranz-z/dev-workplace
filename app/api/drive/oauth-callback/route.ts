import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import {
  encryptGoogleDriveRefreshToken,
  exchangeGoogleAuthorizationCode,
  getGoogleDriveOAuthConfig,
  GOOGLE_DRIVE_CALLBACK_PATH,
  GOOGLE_DRIVE_STATE_COOKIE,
  GoogleDriveOAuthError,
  readSignedOAuthState,
  verifyGoogleAccountIdentity,
} from "@/lib/google-drive/service";
import { getGoogleDriveAccess } from "@/lib/google-drive/files";
import { getApplicationOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function finish(request: NextRequest, origin: string | null, result: string) {
  if (!origin) {
    const response = NextResponse.json({ error: "Google Drive authorization could not be completed." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    response.cookies.set(GOOGLE_DRIVE_STATE_COOKIE, "", { path: GOOGLE_DRIVE_CALLBACK_PATH, maxAge: 0 });
    return response;
  }
  const response = NextResponse.redirect(new URL(`/app?drive_${result}`, origin), { status: 303 });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(GOOGLE_DRIVE_STATE_COOKIE, "", { path: GOOGLE_DRIVE_CALLBACK_PATH, maxAge: 0 });
  return response;
}

function logCallbackFailure(operation: string, error: unknown) {
  const code = error instanceof GoogleDriveOAuthError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "unknown";
  console.error("[google-drive] OAuth callback failed", { operation, code });
}

export async function GET(request: NextRequest) {
  const origin = getApplicationOrigin();
  const finishAt = (result: string) => finish(request, origin, result);
  const params = request.nextUrl.searchParams;
  const stateValues = params.getAll("state");
  const codeValues = params.getAll("code");
  const providerErrors = params.getAll("error");

  let config;
  try { config = getGoogleDriveOAuthConfig(); }
  catch { return finishAt("error=configuration"); }

  const transaction = readSignedOAuthState(request.cookies.get(GOOGLE_DRIVE_STATE_COOKIE)?.value, config.stateSigningKey);
  if (!transaction || stateValues.length !== 1 || stateValues[0] !== transaction.state) return finishAt("error=verification");
  if (providerErrors.length > 1 || providerErrors.length === 1 || params.has("error_description")) return finishAt("error=cancelled");
  if (codeValues.length !== 1 || !codeValues[0] || params.has("access_token")) return finishAt("error=verification");

  const auth = await requireGoogleDriveUser();
  if (!("user" in auth)) return finishAt(auth.response.status === 401 ? "error=session" : "error=configuration");
  if (auth.user.id !== transaction.ownerId) return finishAt("error=session");

  const redirectUri = origin ? new URL(GOOGLE_DRIVE_CALLBACK_PATH, origin).toString() : "";
  let operation = "exchange_authorization_code";
  try {
    const tokens = await exchangeGoogleAuthorizationCode(codeValues[0], redirectUri, config);
    operation = "verify_google_account_identity";
    const identity = await verifyGoogleAccountIdentity(tokens.accessToken);
    // Verify identity before persisting credentials or retaining an older grant.

    const admin = getSupabaseAdminClient();
    if (tokens.refreshToken) {
      operation = "encrypt_refresh_token";
      const ciphertext = encryptGoogleDriveRefreshToken(auth.user.id, tokens.refreshToken, config.tokenEncryptionKey);
      operation = "store_encrypted_refresh_token";
      const { error } = await admin.rpc("upsert_google_drive_connection", {
        p_user_id: auth.user.id,
        p_refresh_token_ciphertext: ciphertext,
        p_encryption_key_version: 1,
      });
      if (error) throw error;
    } else {
      // Google normally returns a refresh token only on the first grant. Consent
      // is requested above; retain a prior grant only for the same Google account.
      operation = "check_existing_connection";
      const existing = await getGoogleDriveAccess(auth.user.id).catch(() => null);
      if (!existing || existing.identity.subject !== identity.subject) throw new GoogleDriveOAuthError("refresh_token_missing", 409);
    }
    return finishAt("connected=1");
  } catch (error) {
    logCallbackFailure(operation, error);
    return finishAt(error instanceof GoogleDriveOAuthError && error.code === "refresh_token_missing" ? "error=reauthorize" : "error=connection");
  }
}
