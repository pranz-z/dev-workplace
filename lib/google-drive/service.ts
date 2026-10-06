import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_DRIVE_SCOPES = ["openid", "email", GOOGLE_DRIVE_FILE_SCOPE] as const;
export const GOOGLE_DRIVE_STATE_COOKIE = "google_drive_oauth_state";
export const GOOGLE_DRIVE_CALLBACK_PATH = "/api/drive/oauth-callback";
export const GOOGLE_DRIVE_STATE_MAX_AGE_SECONDS = 10 * 60;
export const GOOGLE_DRIVE_TOKEN_KEY_VERSION = 1;

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_32_BYTE_SECRET = /^[A-Za-z0-9_-]{43}$/;

export class GoogleDriveOAuthError extends Error {
  constructor(public readonly code: string, public readonly status = 502) {
    super(code);
    this.name = "GoogleDriveOAuthError";
  }
}

export interface GoogleDriveOAuthConfig {
  clientId: string;
  clientSecret: string;
  stateSigningKey: Buffer;
  tokenEncryptionKey: Buffer;
}

function readSecret(name: string): Buffer {
  const value = process.env[name]?.trim() ?? "";
  if (!BASE64URL_32_BYTE_SECRET.test(value)) throw new GoogleDriveOAuthError("configuration", 503);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) throw new GoogleDriveOAuthError("configuration", 503);
  return decoded;
}

export function getGoogleDriveOAuthConfig(): GoogleDriveOAuthConfig {
  const clientId = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret || /\s/.test(clientId) || /\s/.test(clientSecret)) {
    throw new GoogleDriveOAuthError("configuration", 503);
  }
  return {
    clientId,
    clientSecret,
    stateSigningKey: getGoogleDriveStateSigningKey(),
    tokenEncryptionKey: getGoogleDriveTokenEncryptionKey(),
  };
}

export function getGoogleDriveStateSigningKey(): Buffer {
  return readSecret("GOOGLE_DRIVE_OAUTH_STATE_SECRET");
}

export function getGoogleDriveTokenEncryptionKey(): Buffer {
  return readSecret("GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY");
}

export interface OAuthStatePayload {
  state: string;
  ownerId: string;
  issuedAt: number;
}

export function createSignedOAuthState(payload: OAuthStatePayload, key: Buffer): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function readSignedOAuthState(value: string | undefined, key: Buffer, now = Date.now()): OAuthStatePayload | null {
  if (!value || value.length > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;

  const expected = createHmac("sha256", key).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<OAuthStatePayload>;
    if (
      typeof payload.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.state)
      || typeof payload.ownerId !== "string" || !UUID_PATTERN.test(payload.ownerId)
      || typeof payload.issuedAt !== "number" || !Number.isSafeInteger(payload.issuedAt)
    ) return null;
    const ageMs = now - payload.issuedAt;
    if (ageMs < 0 || ageMs > GOOGLE_DRIVE_STATE_MAX_AGE_SECONDS * 1000) return null;
    return payload as OAuthStatePayload;
  } catch {
    return null;
  }
}

export function buildGoogleAuthorizationUrl(config: GoogleDriveOAuthConfig, redirectUri: string, state: string): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_DRIVE_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url;
}

interface GoogleTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
}

export interface ExchangedGoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  grantedScopes: string[];
}

export async function exchangeGoogleAuthorizationCode(code: string, redirectUri: string, config: GoogleDriveOAuthConfig): Promise<ExchangedGoogleTokens> {
  const form = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch {
    throw new GoogleDriveOAuthError("token_exchange_unavailable", 502);
  }

  if (!response.ok) throw new GoogleDriveOAuthError("token_exchange_rejected", 502);
  let tokens: GoogleTokenResponse;
  try { tokens = await response.json() as GoogleTokenResponse; }
  catch { throw new GoogleDriveOAuthError("token_exchange_invalid", 502); }

  if (typeof tokens.access_token !== "string" || tokens.access_token.length < 16 || tokens.access_token.length > 8192) {
    throw new GoogleDriveOAuthError("token_exchange_invalid", 502);
  }
  const grantedScopes = typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : [];
  if (!grantedScopes.includes(GOOGLE_DRIVE_FILE_SCOPE)) throw new GoogleDriveOAuthError("required_scope_missing", 403);
  if (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== "string" || !tokens.refresh_token || tokens.refresh_token.length > 8192)) {
    throw new GoogleDriveOAuthError("token_exchange_invalid", 502);
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
    grantedScopes,
  };
}

export async function verifyGoogleAccountIdentity(accessToken: string): Promise<{ subject: string; email: string }> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new GoogleDriveOAuthError("identity_check_unavailable", 502);
  }
  if (!response.ok) throw new GoogleDriveOAuthError("identity_check_rejected", 502);

  let identity: { sub?: unknown; email?: unknown; email_verified?: unknown };
  try { identity = await response.json() as typeof identity; }
  catch { throw new GoogleDriveOAuthError("identity_check_invalid", 502); }
  if (
    typeof identity.sub !== "string" || !identity.sub
    || typeof identity.email !== "string" || !identity.email
    || identity.email_verified !== true
  ) throw new GoogleDriveOAuthError("identity_check_invalid", 403);
  return { subject: identity.sub, email: identity.email };
}

export function encryptGoogleDriveRefreshToken(userId: string, refreshToken: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`google-drive-refresh:v${GOOGLE_DRIVE_TOKEN_KEY_VERSION}:${userId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptGoogleDriveRefreshToken(userId: string, ciphertext: string, keyVersion: number, key: Buffer): string {
  if (keyVersion !== GOOGLE_DRIVE_TOKEN_KEY_VERSION) throw new GoogleDriveOAuthError("encryption_key_version_unsupported", 503);
  let packed: Buffer;
  try { packed = Buffer.from(ciphertext, "base64url"); }
  catch { throw new GoogleDriveOAuthError("encrypted_token_invalid", 500); }
  if (packed.length < 29 || packed.length > 16 * 1024 || packed.toString("base64url") !== ciphertext) {
    throw new GoogleDriveOAuthError("encrypted_token_invalid", 500);
  }

  try {
    const nonce = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(`google-drive-refresh:v${keyVersion}:${userId}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new GoogleDriveOAuthError("encrypted_token_invalid", 500);
  }
}

export async function revokeGoogleDriveRefreshToken(refreshToken: string): Promise<boolean> {
  const form = new URLSearchParams({ token: refreshToken });
  try {
    const response = await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (response.ok) return true;
    if (response.status === 400) {
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      return body?.error === "invalid_token";
    }
    return false;
  } catch {
    return false;
  }
}
