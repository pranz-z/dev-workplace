export const GOOGLE_DRIVE_MAX_FILE_SIZE = 1024 * 1024 * 1024;
export const GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
export const GOOGLE_DRIVE_CHUNK_ALIGNMENT = 256 * 1024;
const UPLOAD_MARKER = "softwareWorkplaceUploadId";

export interface CompletedDriveFileShape {
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
}

export interface ExpectedDriveFileShape {
  id: string;
  expected_name: string;
  expected_mime_type: string;
  expected_size_bytes: number | string;
  google_account_email: string;
  app_folder_id: string;
}

export function createDriveUploadMarker(uploadId: string) {
  return { [UPLOAD_MARKER]: uploadId };
}

export function verifyCompletedDriveFile(
  file: CompletedDriveFileShape,
  session: ExpectedDriveFileShape,
): { id: string; modifiedAt: string | null } {
  const expectedSize = Number(session.expected_size_bytes);
  const parents = Array.isArray(file.parents) ? file.parents : [];
  const owners = Array.isArray(file.owners) ? file.owners : [];
  const ownedByMatchingGoogleAccount = file.ownedByMe === true && owners.some((owner) => {
    if (typeof owner !== "object" || owner === null) return false;
    const row = owner as { emailAddress?: unknown };
    return typeof row.emailAddress === "string" && row.emailAddress.toLowerCase() === session.google_account_email.toLowerCase();
  });
  const appProperties = typeof file.appProperties === "object" && file.appProperties !== null
    ? file.appProperties as Record<string, unknown>
    : {};
  if (
    typeof file.id !== "string" || !file.id
    || file.name !== session.expected_name
    || file.mimeType !== session.expected_mime_type
    || file.size !== String(expectedSize)
    || file.trashed !== false
    || !parents.includes(session.app_folder_id)
    || !ownedByMatchingGoogleAccount
    || appProperties[UPLOAD_MARKER] !== session.id
  ) throw new Error("drive_file_metadata_mismatch");
  return { id: file.id, modifiedAt: typeof file.modifiedTime === "string" ? file.modifiedTime : null };
}

export function validateDriveFilename(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.normalize("NFC").trim();
  if (!name || name.length > 255 || name === "." || name === ".." || /[\\/\u0000-\u001f\u007f]/u.test(name)) return null;
  return name;
}

export function validateDriveMimeType(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const mimeType = input.trim().toLowerCase();
  if (mimeType.length > 127 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)) return null;
  if (mimeType.startsWith("application/vnd.google-apps.")) return null;
  return mimeType;
}

export function validateDriveFileSize(input: unknown): number | null {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1 || input > GOOGLE_DRIVE_MAX_FILE_SIZE) return null;
  return input;
}

export function parseDriveContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const match = value?.match(/^bytes (0|[1-9]\d*)-(0|[1-9]\d*)\/(0|[1-9]\d*)$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || end < start || end >= total) return null;
  return { start, end, total };
}

export function parseDriveReceivedOffset(range: string | null, total: number): number | null {
  if (!range) return 0;
  const match = range.match(/^bytes=0-(0|[1-9]\d*)$/);
  if (!match) return null;
  const end = Number(match[1]);
  return Number.isSafeInteger(end) && end < total ? end + 1 : null;
}

export function isGoogleDriveUploadSessionUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.googleapis.com"
      && !url.username && !url.password && !url.port && !url.hash
      && url.pathname === "/upload/drive/v3/files" && url.searchParams.has("upload_id");
  } catch {
    return false;
  }
}
