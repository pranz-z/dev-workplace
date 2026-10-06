import type { BrowserDriveUpload, WorkplaceDriveFile } from "./client";
import { checkDriveUpload, driveClientRequest, uploadDriveChunks } from "./client";
import { validateDriveFilename, validateDriveFileSize, validateDriveMimeType } from "./validation";

export const DRIVE_FOLDER_TYPE = "application/vnd.google-apps.folder";
export interface DriveDestination { projectId: string | null; parentId: string | null; taskId: string | null; label: string }
export interface DriveQueueItem {
  id: string; file: File; destination: DriveDestination; received: number;
  state: "waiting" | "uploading" | "verifying" | "complete" | "failed";
  session: BrowserDriveUpload | null; error: string;
}
export function createDriveQueueItems(files: File[], destination: DriveDestination): DriveQueueItem[] {
  return files.map((file) => {
    const valid = validateDriveFilename(file.name) && validateDriveMimeType(file.type || "application/octet-stream") && validateDriveFileSize(file.size) !== null;
    return { id: crypto.randomUUID(), file, destination: { ...destination }, received: 0, state: valid ? "waiting" : "failed", session: null,
      error: valid ? "" : "Choose a non-empty file up to 1 GB with a valid filename and file type." };
  });
}
export async function processDriveQueueItem(item: DriveQueueItem, signal: AbortSignal, onSession: (session: BrowserDriveUpload) => void, onProgress: (offset: number) => void, onVerifying: () => void): Promise<WorkplaceDriveFile> {
  if (!validateDriveFilename(item.file.name) || !validateDriveMimeType(item.file.type || "application/octet-stream") || validateDriveFileSize(item.file.size) === null) throw new Error("Invalid file. Choose a non-empty file up to 1 GB.");
  let session = item.session;
  let offset = 0;
  if (session) {
    const checked = await checkDriveUpload(session.uploadId, item.file.size, signal);
    if (checked.file) return checked.file;
    offset = checked.nextOffset; onProgress(offset);
  } else {
    session = await driveClientRequest<BrowserDriveUpload>("/api/drive/uploads", { method: "POST", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: item.file.name, mimeType: item.file.type || "application/octet-stream", sizeBytes: item.file.size,
        projectId: item.destination.projectId, taskId: item.destination.taskId, parentId: item.destination.parentId }) });
    onSession(session);
  }
  const result = await uploadDriveChunks(item.file, session, offset, (next) => { onProgress(next); if (next === item.file.size) onVerifying(); }, signal);
  if (!result.file) throw new Error("Upload incomplete. Retry to continue from the confirmed position.");
  return result.file;
}

export function driveFolderTrail(files: WorkplaceDriveFile[], folderId: string | null): WorkplaceDriveFile[] {
  const trail: WorkplaceDriveFile[] = []; const seen = new Set<string>();
  let id = folderId;
  while (id && trail.length < 21 && !seen.has(id)) {
    seen.add(id); const folder = files.find((file) => file.id === id && file.mime_type === DRIVE_FOLDER_TYPE);
    if (!folder) break;
    trail.unshift(folder); id = folder.parent_id;
  }
  return trail;
}
