import "server-only";
import { del, head, issueSignedToken, presignUrl } from "@vercel/blob";
import { MAX_PREVIEW_VIDEO_BYTES, PREVIEW_PATH_PATTERN, PREVIEW_UPLOAD_TTL_MS, PREVIEW_URL_TTL_MS, PREVIEW_VIDEO_MIME } from "./policy";

function checkPath(pathname: string) {
  if (!PREVIEW_PATH_PATTERN.test(pathname)) throw new Error("Invalid preview pathname.");
}

export async function signPreviewUpload(pathname: string) {
  checkPath(pathname);
  const expiresAt = Date.now() + PREVIEW_UPLOAD_TTL_MS;
  const constraints = { pathname, allowedContentTypes: [PREVIEW_VIDEO_MIME], maximumSizeInBytes: MAX_PREVIEW_VIDEO_BYTES, validUntil: expiresAt };
  // SDK resolves BLOB_STORE_ID + VERCEL_OIDC_TOKEN. Signing material never leaves this module.
  const token = await issueSignedToken({ ...constraints, operations: ["put"] });
  const { presignedUrl } = await presignUrl(token, { ...constraints, operation: "put", access: "private", addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 });
  return { url: presignedUrl, expiresAt: Math.min(expiresAt, token.validUntil) };
}

export async function signPreviewRead(pathname: string, mimeType: string) {
  checkPath(pathname);
  const expiresAt = Date.now() + PREVIEW_URL_TTL_MS;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil: expiresAt });
  const { presignedUrl } = await presignUrl(token, { pathname, operation: "get", access: "private", validUntil: expiresAt });
  return { url: presignedUrl, mimeType, expiresAt: Math.min(expiresAt, token.validUntil) };
}

export async function verifyPreviewBlob(pathname: string, size: number, mimeType: string) {
  checkPath(pathname);
  const blob = await head(pathname);
  if (blob.pathname !== pathname || blob.size !== size || blob.contentType !== mimeType || size <= 0 || size > MAX_PREVIEW_VIDEO_BYTES || mimeType !== PREVIEW_VIDEO_MIME) {
    throw new Error("Uploaded video does not match the authorized file.");
  }
  return { pathname: blob.pathname, sizeBytes: blob.size, mimeType: blob.contentType };
}

export async function cleanupPreviewBlob(pathname: string | null | undefined): Promise<string | undefined> {
  if (!pathname) return;
  try { checkPath(pathname); await del(pathname); }
  catch { return "The preview was saved or removed, but an old private video could not be cleaned up."; }
}
