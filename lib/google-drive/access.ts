import type { DriveFileMetadata, DriveUploadSession } from "./files";

// The metadata table is user writable. A completed server-created upload is
// required as independent proof that this association belongs to the app.
export function verifyDriveAccess(file: DriveFileMetadata, session: DriveUploadSession | null, row: { id: string; user_id: string; provider_file_id: string }, identity: { subject: string; email: string }) {
  const marker = (file.appProperties as Record<string, unknown> | undefined)?.softwareWorkplaceUploadId;
  const owners = file.owners as Array<{ emailAddress?: unknown; me?: unknown }> | undefined;
  return Boolean(session && session.user_id === row.user_id && session.status === "completed"
    && session.external_file_id === row.id && session.drive_file_id === row.provider_file_id
    && session.id === marker && session.google_account_sub === identity.subject
    && file.id === row.provider_file_id && file.ownedByMe === true && file.trashed === false
    && Array.isArray(owners) && owners.some((owner) => owner.me === true && owner.emailAddress === identity.email));
}

export function driveBrowserAccessUrl(file: DriveFileMetadata, mode: "preview" | "download"): string | null {
  const native = typeof file.mimeType === "string" && file.mimeType.startsWith("application/vnd.google-apps.");
  if (mode === "download" && (file.capabilities as { canDownload?: unknown } | undefined)?.canDownload !== true) return null;
  const link = mode === "download" && !native ? file.webContentLink : file.webViewLink;
  if (typeof link !== "string" || typeof file.id !== "string") return null;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
      || !["drive.google.com", "docs.google.com", "drive.usercontent.google.com"].includes(url.hostname)) return null;
    if (url.searchParams.has("access_token") || url.searchParams.has("token")) return null;
    if (url.searchParams.get("id") !== file.id && !url.pathname.split("/").some((segment, index, segments) => segment === file.id && segments[index - 1] === "d")) return null;
    return url.toString();
  } catch { return null; }
}
