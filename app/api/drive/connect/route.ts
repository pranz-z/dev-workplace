import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import {
  buildGoogleAuthorizationUrl,
  createSignedOAuthState,
  getGoogleDriveOAuthConfig,
  GOOGLE_DRIVE_CALLBACK_PATH,
  GOOGLE_DRIVE_STATE_COOKIE,
  GOOGLE_DRIVE_STATE_MAX_AGE_SECONDS,
  GoogleDriveOAuthError,
} from "@/lib/google-drive/service";
import { getApplicationOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireGoogleDriveUser();
  if ("response" in auth) return auth.response;

  const origin = getApplicationOrigin();
  if (!origin) return NextResponse.json({ error: "Google Drive connection is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  try {
    const config = getGoogleDriveOAuthConfig();
    const state = randomBytes(32).toString("base64url");
    const signedState = createSignedOAuthState({ state, ownerId: auth.user.id, issuedAt: Date.now() }, config.stateSigningKey);
    const callbackUri = new URL(GOOGLE_DRIVE_CALLBACK_PATH, origin).toString();
    const authorizationUrl = buildGoogleAuthorizationUrl(config, callbackUri, state);
    const response = NextResponse.redirect(authorizationUrl, { status: 302 });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(GOOGLE_DRIVE_STATE_COOKIE, signedState, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: GOOGLE_DRIVE_CALLBACK_PATH,
      maxAge: GOOGLE_DRIVE_STATE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const status = error instanceof GoogleDriveOAuthError ? error.status : 503;
    return NextResponse.json({ error: "Google Drive connection is not configured." }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
