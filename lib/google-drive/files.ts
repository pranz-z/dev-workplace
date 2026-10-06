import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { GoogleDriveConnectionCiphertextRow } from "@/data/database.types";
import {
  decryptGoogleDriveRefreshToken,
  getGoogleDriveOAuthConfig,
  GoogleDriveOAuthError,
  verifyGoogleAccountIdentity,
} from "@/lib/google-drive/service";
export {
  GOOGLE_DRIVE_MAX_FILE_SIZE,
  GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE,
  GOOGLE_DRIVE_CHUNK_ALIGNMENT,
  validateDriveFileSize,
  validateDriveFilename,
  validateDriveMimeType,
  parseDriveContentRange,
  parseDriveReceivedOffset,
  isGoogleDriveUploadSessionUri,
  verifyCompletedDriveFile,
  createDriveUploadMarker,
} from "@/lib/google-drive/validation";

const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";
const APP_FOLDER_MARKER = "softwareWorkplaceManaged";
const APP_FOLDER_VALUE = "google-drive-files-v1";

export interface DriveUploadSession {
  id: string;
  user_id: string;
  project_id: string | null;
  task_id: string | null;
  expected_name: string;
  expected_mime_type: string;
  expected_size_bytes: number | string;
  google_account_sub: string;
  google_account_email: string;
  app_folder_id: string;
  session_uri: string;
  expires_at: string;
  next_offset: number | string;
  status: "uploading" | "completed" | "expired";
  drive_file_id: string | null;
  external_file_id: string | null;
}

export interface DriveFileMetadata {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  size?: unknown;
  modifiedTime?: unknown;
  parents?: unknown;
  ownedByMe?: unknown;
  trashed?: unknown;
  owners?: unknown;
  appProperties?: unknown;
  webViewLink?: unknown;
  webContentLink?: unknown;
  capabilities?: unknown;
}

export class GoogleDriveFileError extends Error {
  constructor(public readonly code: string, public readonly status = 502) {
    super(code);
    this.name = "GoogleDriveFileError";
  }
}

export async function getGoogleDriveUploadSession(userId: string, uploadId: string): Promise<DriveUploadSession | null> {
  const { data, error } = await getSupabaseAdminClient().rpc("get_google_drive_upload_session", {
    p_user_id: userId,
    p_id: uploadId,
  });
  if (error) throw new GoogleDriveFileError("upload_session_unavailable", 502);
  return (Array.isArray(data) ? data[0] : null) as DriveUploadSession | null;
}

export async function getGoogleDriveAccess(userId: string) {
  const config = getGoogleDriveOAuthConfig();
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_google_drive_connection", { p_user_id: userId });
  const connection = (Array.isArray(data) ? data[0] : null) as GoogleDriveConnectionCiphertextRow | null;
  if (error) throw new GoogleDriveFileError("connection_lookup_failed", 502);
  if (!connection) throw new GoogleDriveFileError("not_connected", 409);

  const refreshToken = decryptGoogleDriveRefreshToken(
    userId,
    connection.refresh_token_ciphertext,
    connection.encryption_key_version,
    config.tokenEncryptionKey,
  );
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GoogleDriveFileError("google_token_unavailable", 502);
  }
  if (!tokenResponse.ok) throw new GoogleDriveFileError("google_reauthorization_required", tokenResponse.status === 400 ? 409 : 502);
  const tokenBody = await tokenResponse.json().catch(() => null) as { access_token?: unknown; scope?: unknown } | null;
  if (typeof tokenBody?.access_token !== "string" || tokenBody.access_token.length < 16 || tokenBody.access_token.length > 8192) {
    throw new GoogleDriveFileError("google_token_invalid", 502);
  }
  if (typeof tokenBody.scope === "string" && !tokenBody.scope.split(/\s+/).includes("https://www.googleapis.com/auth/drive.file")) {
    throw new GoogleDriveFileError("google_scope_missing", 403);
  }
  const identity = await verifyGoogleAccountIdentity(tokenBody.access_token);
  return { accessToken: tokenBody.access_token, identity };
}

export async function driveApiRequest(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  let target: URL;
  try { target = new URL(url); }
  catch { throw new GoogleDriveFileError("drive_request_invalid", 500); }
  if (target.protocol !== "https:" || target.hostname !== "www.googleapis.com" || target.username || target.password || target.port) throw new GoogleDriveFileError("drive_request_invalid", 500);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  try {
    return await fetch(target, {
      ...init,
      cache: "no-store",
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(55_000),
      headers,
    });
  } catch {
    throw new GoogleDriveFileError("drive_unavailable", 502);
  }
}

export async function ensureGoogleDriveAppFolder(accessToken: string): Promise<string> {
  const query = new URL(`${GOOGLE_DRIVE_API}/files`);
  query.searchParams.set("q", `appProperties has { key='${APP_FOLDER_MARKER}' and value='${APP_FOLDER_VALUE}' } and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  query.searchParams.set("pageSize", "10");
  query.searchParams.set("fields", "files(id,ownedByMe,owners(emailAddress,me))");
  const listing = await driveApiRequest(accessToken, query.toString());
  if (!listing.ok) throw new GoogleDriveFileError("drive_folder_lookup_failed", 502);
  const result = await listing.json().catch(() => null) as { files?: Array<{ id?: unknown; ownedByMe?: unknown }> } | null;
  const folder = result?.files?.find((file) => typeof file.id === "string" && file.ownedByMe === true);
  if (folder && typeof folder.id === "string") return folder.id;

  const created = await driveApiRequest(accessToken, `${GOOGLE_DRIVE_API}/files?fields=id,ownedByMe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Developer Workplace",
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { [APP_FOLDER_MARKER]: APP_FOLDER_VALUE },
    }),
  });
  if (!created.ok) throw new GoogleDriveFileError("drive_folder_create_failed", 502);
  const body = await created.json().catch(() => null) as { id?: unknown; ownedByMe?: unknown } | null;
  if (typeof body?.id !== "string" || body.ownedByMe !== true) throw new GoogleDriveFileError("drive_folder_invalid", 502);
  return body.id;
}

export async function readDriveFile(accessToken: string, fileId: string): Promise<DriveFileMetadata> {
  const url = new URL(`${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,parents,ownedByMe,trashed,owners(emailAddress,me),appProperties,webViewLink,webContentLink,capabilities(canDownload)");
  const response = await driveApiRequest(accessToken, url.toString());
  if (!response.ok) throw new GoogleDriveFileError("drive_file_verification_failed", 502);
  return await response.json() as DriveFileMetadata;
}

export function newGoogleDriveUploadId(): string {
  return randomUUID();
}

export function driveServiceErrorResponseStatus(error: unknown): number {
  if (error instanceof GoogleDriveOAuthError || error instanceof GoogleDriveFileError) return error.status;
  if (error instanceof Error && error.message === "drive_file_metadata_mismatch") return 409;
  return 502;
}
