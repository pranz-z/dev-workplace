import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { driveApiRequest, ensureGoogleDriveAppFolder, GoogleDriveFileError } from "@/lib/google-drive/files";
import { DRIVE_FOLDER_MIME, DRIVE_MANAGED_MARKER, ensureRegisteredDriveFolder, reserveDriveFolder, type FolderReservation } from "@/lib/google-drive/folder-provider";
import type { WorkplaceDriveFile } from "@/lib/google-drive/client";

export const DRIVE_METADATA_FIELDS = "id,name,mime_type,size_bytes,modified_at,status,project_id,task_id,parent_id,is_project_folder,created_at,updated_at";
export const DRIVE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface FolderContext { supabase: SupabaseClient; ownerId: string; accessToken: string; identity: { subject: string; email: string } }

export async function ownedDriveProject(context: Pick<FolderContext, "supabase" | "ownerId">, projectId: string) {
  if (!DRIVE_UUID.test(projectId)) throw new GoogleDriveFileError("invalid_project", 400);
  const { data, error } = await context.supabase.from("projects").select("id,title").eq("id", projectId).eq("user_id", context.ownerId).maybeSingle();
  if (error || !data) throw new GoogleDriveFileError("project_unavailable", 404);
  return { id: data.id as string, name: data.title as string };
}

async function saveFolder(context: FolderContext, reservation: FolderReservation, name: string, projectId: string | null, parentId: string | null, projectFolder: boolean) {
  const { data, error } = await context.supabase.from("external_files").upsert({
    id: reservation.metadata_id, user_id: context.ownerId, provider: "google_drive", provider_file_id: reservation.drive_file_id,
    name, mime_type: DRIVE_FOLDER_MIME, size_bytes: null, status: "active", project_id: projectId,
    task_id: null, parent_id: parentId, is_project_folder: projectFolder,
  }, { onConflict: "id" }).select(DRIVE_METADATA_FIELDS).single();
  if (error || !data) throw new GoogleDriveFileError("folder_metadata_unavailable", 502);
  return data as WorkplaceDriveFile;
}

export async function ensureGoogleDriveProjectFolder(context: FolderContext, appFolderId: string, projectId: string, projectName: string) {
  // Recheck at the helper boundary: names and ownership come from PostgreSQL.
  const project = await ownedDriveProject(context, projectId);
  projectId = project.id;
  projectName = project.name;
  const rootResponse = await driveApiRequest(context.accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(appFolderId)}?fields=id,mimeType,ownedByMe,trashed,appProperties`);
  const root = rootResponse.ok ? await rootResponse.json() : null;
  if (!root || root.id !== appFolderId || root.mimeType !== DRIVE_FOLDER_MIME || root.ownedByMe !== true
    || root.trashed !== false || root.appProperties?.softwareWorkplaceManaged !== DRIVE_MANAGED_MARKER
    || root.appProperties?.softwareWorkplaceResourceType === "project-folder") {
    throw new GoogleDriveFileError("managed_root_unverified", 403);
  }
  const reservation = await ensureRegisteredDriveFolder(context.accessToken, context.ownerId, context.identity.subject,
    `project:${projectId}`, projectName, appFolderId, {
      softwareWorkplaceManaged: DRIVE_MANAGED_MARKER,
      softwareWorkplaceResourceType: "project-folder",
      softwareWorkplaceProjectId: projectId,
    }, driveApiRequest);
  return saveFolder(context, reservation, projectName, projectId, null, true);
}

export async function ensureOwnedDriveFolder(context: FolderContext, id: string, depth = 0): Promise<WorkplaceDriveFile & { driveId: string }> {
  if (depth > 20) throw new GoogleDriveFileError("folder_depth_limit", 400);
  const { data: row, error } = await context.supabase.from("external_files").select(`${DRIVE_METADATA_FIELDS},provider_file_id,user_id`)
    .eq("id", id).eq("user_id", context.ownerId).eq("provider", "google_drive").eq("status", "active").maybeSingle();
  if (error || !row || row.mime_type !== DRIVE_FOLDER_MIME) throw new GoogleDriveFileError("folder_unavailable", 404);
  const key = row.is_project_folder ? `project:${row.project_id}` : `custom:${row.id}`;
  const existing = await reserveDriveFolder(context.ownerId, context.identity.subject, key);
  if (!existing || existing.metadata_id !== row.id || existing.drive_file_id !== row.provider_file_id) throw new GoogleDriveFileError("folder_unverified", 403);
  if (row.is_project_folder) {
    const project = await ownedDriveProject(context, row.project_id);
    const root = await ensureGoogleDriveAppFolder(context.accessToken, context.ownerId, context.identity.subject);
    const folder = await ensureGoogleDriveProjectFolder(context, root, project.id, project.name);
    const registry = await reserveDriveFolder(context.ownerId, context.identity.subject, key);
    return { ...folder, driveId: registry!.drive_file_id };
  }
  const parent = row.parent_id ? await ensureOwnedDriveFolder(context, row.parent_id, depth + 1) : null;
  if (parent?.project_id !== undefined && parent.project_id !== row.project_id) throw new GoogleDriveFileError("folder_project_mismatch", 403);
  if (row.project_id) await ownedDriveProject(context, row.project_id);
  const root = parent ? parent.driveId : await ensureGoogleDriveAppFolder(context.accessToken, context.ownerId, context.identity.subject);
  const reservation = await ensureRegisteredDriveFolder(context.accessToken, context.ownerId, context.identity.subject, key, row.name,
    root, { softwareWorkplaceFolderId: row.id }, driveApiRequest);
  const saved = await saveFolder(context, reservation, row.name, row.project_id, row.parent_id, false);
  return { ...saved, driveId: reservation.drive_file_id };
}

export async function resolveDriveDestination(context: FolderContext, projectId: string | null, parentId: string | null) {
  if (parentId) {
    const folder = await ensureOwnedDriveFolder(context, parentId);
    if (projectId && folder.project_id !== projectId) throw new GoogleDriveFileError("folder_project_mismatch", 400);
    return { driveId: folder.driveId, parentId: folder.id, projectId: folder.project_id };
  }
  const root = await ensureGoogleDriveAppFolder(context.accessToken, context.ownerId, context.identity.subject);
  if (!projectId) return { driveId: root, parentId: null, projectId: null };
  const project = await ownedDriveProject(context, projectId);
  const folder = await ensureGoogleDriveProjectFolder(context, root, project.id, project.name);
  const registry = await reserveDriveFolder(context.ownerId, context.identity.subject, `project:${projectId}`);
  return { driveId: registry!.drive_file_id, parentId: folder.id, projectId };
}

export async function createCustomDriveFolder(context: FolderContext, name: string, projectId: string | null, parentId: string | null, requestId: string) {
  const destination = await resolveDriveDestination(context, projectId, parentId);
  const key = `custom:${requestId}`;
  const existing = await reserveDriveFolder(context.ownerId, context.identity.subject, key);
  if (existing && existing.parent_drive_id !== destination.driveId) throw new GoogleDriveFileError("folder_retry_destination_changed", 409);
  // Reservation metadata_id is canonical. Request UUID gives idempotent retries.
  const reservation = await ensureRegisteredDriveFolder(context.accessToken, context.ownerId, context.identity.subject, key, name,
    destination.driveId, { softwareWorkplaceFolderId: existing?.metadata_id ?? requestId }, driveApiRequest);
  return saveFolder(context, reservation, name, destination.projectId, destination.parentId, false);
}
