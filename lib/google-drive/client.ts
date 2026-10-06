import type { ExternalFileRow } from "@/data/database.types";
import { GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE } from "@/lib/google-drive/validation";

export type WorkplaceDriveFile = Pick<ExternalFileRow, "id" | "name" | "mime_type" | "size_bytes" | "modified_at" | "status" | "project_id" | "task_id" | "parent_id" | "is_project_folder" | "created_at" | "updated_at">;
export interface BrowserDriveUpload { uploadId: string; chunkSize: number; expiresAt: string }

export async function driveClientRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Google Drive request failed. Try again.");
  return data as T;
}

/** Checks Google's confirmed position, including a chunk whose response was lost. */
export async function checkDriveUpload(uploadId: string, size: number, signal: AbortSignal): Promise<{ file?: WorkplaceDriveFile; nextOffset: number }> {
  const response = await fetch(`/api/drive/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: "POST", cache: "no-store", credentials: "same-origin", signal,
  });
  const data = await response.json().catch(() => null);
  if (response.ok && data?.file) return { file: data.file, nextOffset: size };
  if (response.status === 409 && Number.isSafeInteger(data?.nextOffset) && data.nextOffset >= 0 && data.nextOffset < size) {
    return { nextOffset: data.nextOffset };
  }
  throw new Error(data?.error ?? "Upload could not be confirmed. Retry when your connection is available.");
}

export async function uploadDriveChunks(file: File, session: BrowserDriveUpload, startOffset: number, onProgress: (offset: number) => void, signal: AbortSignal) {
  let offset = startOffset;
  const chunkSize = Math.min(session.chunkSize, GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE);
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const response = await driveClientRequest<{ nextOffset: number }>(`/api/drive/uploads/${encodeURIComponent(session.uploadId)}`, {
      method: "PUT", signal,
      headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${offset}-${end - 1}/${file.size}` },
      body: file.slice(offset, end),
    });
    if (!Number.isSafeInteger(response.nextOffset) || response.nextOffset <= offset || response.nextOffset > end) {
      throw new Error("Upload made no progress. Retry to check the confirmed position.");
    }
    offset = response.nextOffset;
    onProgress(offset);
  }
  return checkDriveUpload(session.uploadId, file.size, signal);
}
