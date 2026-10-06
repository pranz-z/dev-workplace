import { NextResponse, type NextRequest } from "next/server";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import {
  createDriveUploadMarker,
  driveApiRequest,
  driveServiceErrorResponseStatus,
  getGoogleDriveAccess,
  GOOGLE_DRIVE_MAX_FILE_SIZE,
  GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE,
  isGoogleDriveUploadSessionUri,
  newGoogleDriveUploadId,
  validateDriveFileSize,
  validateDriveFilename,
  validateDriveMimeType,
} from "@/lib/google-drive/files";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveDriveDestination } from "@/lib/google-drive/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOOGLE_DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,modifiedTime,parents,ownedByMe,trashed,owners(emailAddress,me),appProperties";

function failureStatus(error: unknown) {
  return driveServiceErrorResponseStatus(error);
}

export async function POST(request: NextRequest) {
  const auth = await requireGoogleDriveUser();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid upload request." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const input = body as Record<string, unknown>;
  const name = validateDriveFilename(input.name);
  const mimeType = validateDriveMimeType(input.mimeType);
  const size = validateDriveFileSize(input.sizeBytes);
  if (!name || !mimeType || size === null) {
    return NextResponse.json({ error: `Provide a valid filename, MIME type, and file size up to ${GOOGLE_DRIVE_MAX_FILE_SIZE} bytes.` }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  let projectId: string | null = null;
  let taskId: string | null = null;
  const parentId = input.parentId ?? null;
  if (parentId !== null && (typeof parentId !== "string" || !UUID_PATTERN.test(parentId))) return NextResponse.json({ error: "Invalid folder association." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (input.projectId !== undefined && input.projectId !== null && input.projectId !== "") {
    if (typeof input.projectId !== "string" || !UUID_PATTERN.test(input.projectId)) return NextResponse.json({ error: "Invalid project association." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    projectId = input.projectId;
  }
  if (input.taskId !== undefined && input.taskId !== null && input.taskId !== "") {
    if (typeof input.taskId !== "string" || !UUID_PATTERN.test(input.taskId)) return NextResponse.json({ error: "Invalid task association." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    taskId = input.taskId;
  }

  if (taskId) {
    const { data: task, error } = await auth.supabase.from("tasks").select("id,project_id").eq("id", taskId).eq("user_id", auth.user.id).maybeSingle();
    if (error || !task) return NextResponse.json({ error: "The task association is unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (projectId && task.project_id !== projectId) return NextResponse.json({ error: "The task does not belong to the selected project." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    projectId = task.project_id;
  }
  if (projectId) {
    const { data: project, error } = await auth.supabase.from("projects").select("id").eq("id", projectId).eq("user_id", auth.user.id).maybeSingle();
    if (error || !project) return NextResponse.json({ error: "The project association is unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const { accessToken, identity } = await getGoogleDriveAccess(auth.user.id);
    const destination = await resolveDriveDestination({ supabase: auth.supabase, ownerId: auth.user.id, accessToken, identity }, projectId, parentId);
    const folderId = destination.driveId;
    projectId = destination.projectId;
    const uploadId = newGoogleDriveUploadId();
    const initiation = await driveApiRequest(accessToken, GOOGLE_DRIVE_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify({
        name,
        mimeType,
        parents: [folderId],
        appProperties: createDriveUploadMarker(uploadId),
      }),
    });
    if (!initiation.ok) throw new Error(`drive_upload_initiation_${initiation.status}`);
    const sessionUri = initiation.headers.get("Location");
    if (!sessionUri || !isGoogleDriveUploadSessionUri(sessionUri)) throw new Error("drive_upload_session_uri_invalid");

    const expiresAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await getSupabaseAdminClient().rpc("create_google_drive_upload_session", {
      p_id: uploadId,
      p_user_id: auth.user.id,
      p_project_id: projectId,
      p_task_id: taskId,
      p_expected_name: name,
      p_expected_mime_type: mimeType,
      p_expected_size_bytes: size,
      p_google_account_sub: identity.subject,
      p_google_account_email: identity.email,
      p_app_folder_id: folderId,
      p_session_uri: sessionUri,
      p_expires_at: expiresAt,
    });
    if (error) throw error;
    if (destination.parentId) {
      const { error: parentError } = await getSupabaseAdminClient().rpc("set_google_drive_upload_parent", {
        p_user_id: auth.user.id, p_id: uploadId, p_parent_id: destination.parentId,
      });
      if (parentError) throw parentError;
    }

    return NextResponse.json({
      uploadId,
      chunkSize: GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE,
      maxFileSize: GOOGLE_DRIVE_MAX_FILE_SIZE,
      expiresAt,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "upload_setup_failed";
    console.error("[google-drive] upload initiation failed", { code });
    return NextResponse.json({ error: "Google Drive upload could not be initiated." }, { status: failureStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
