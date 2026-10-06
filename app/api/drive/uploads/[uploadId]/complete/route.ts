import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import {
  driveServiceErrorResponseStatus,
  getGoogleDriveAccess,
  getGoogleDriveUploadSession,
  isGoogleDriveUploadSessionUri,
  parseDriveReceivedOffset,
  readDriveFile,
  verifyCompletedDriveFile,
} from "@/lib/google-drive/files";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { DRIVE_METADATA_FIELDS } from "@/lib/google-drive/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function reconcileUploadOffset(userId: string, uploadId: string, storedOffset: number, confirmedOffset: number) {
  if (storedOffset === confirmedOffset) return;
  if (confirmedOffset < storedOffset) throw new Error("drive_upload_position_invalid");
  const admin = getSupabaseAdminClient();
  const claimId = randomUUID();
  const { data: claimed, error: claimError } = await admin.rpc("claim_google_drive_upload_chunk", {
    p_user_id: userId, p_id: uploadId, p_expected_offset: storedOffset, p_claim_id: claimId,
  });
  if (claimError || claimed !== true) throw new Error("drive_upload_position_busy");
  const { data: advanced, error: advanceError } = await admin.rpc("finish_google_drive_upload_chunk", {
    p_user_id: userId, p_id: uploadId, p_claim_id: claimId, p_next_offset: confirmedOffset,
  });
  if (advanceError || advanced !== true) throw new Error("drive_upload_position_save_failed");
}

export async function POST(_request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const auth = await requireGoogleDriveUser();
  if ("response" in auth) return auth.response;
  const { uploadId } = await context.params;
  if (!UUID_PATTERN.test(uploadId)) return NextResponse.json({ error: "Upload session not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

  try {
    const session = await getGoogleDriveUploadSession(auth.user.id, uploadId);
    if (!session) return NextResponse.json({ error: "Upload session not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (session.status === "completed" && session.external_file_id) {
      const { data, error } = await auth.supabase.from("external_files").select(DRIVE_METADATA_FIELDS).eq("id", session.external_file_id).eq("provider", "google_drive").maybeSingle();
      if (error) throw error;
      return data
        ? NextResponse.json({ file: data }, { headers: { "Cache-Control": "no-store" } })
        : NextResponse.json({ error: "Completed file association is unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (session.status === "expired") return NextResponse.json({ error: "Upload session expired." }, { status: 410, headers: { "Cache-Control": "no-store" } });
    if (session.status !== "uploading" || Date.parse(session.expires_at) <= Date.now() || !isGoogleDriveUploadSessionUri(session.session_uri)) {
      return NextResponse.json({ error: "Upload session expired." }, { status: 410, headers: { "Cache-Control": "no-store" } });
    }
    const total = Number(session.expected_size_bytes);
    const { accessToken, identity } = await getGoogleDriveAccess(auth.user.id);
    if (identity.subject !== session.google_account_sub || identity.email.toLowerCase() !== session.google_account_email.toLowerCase()) {
      return NextResponse.json({ error: "Google Drive account changed during upload." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    let statusResponse: Response;
    try {
      statusResponse = await fetch(session.session_uri, {
        method: "PUT",
        cache: "no-store",
        signal: AbortSignal.timeout(55_000),
        headers: { "Content-Length": "0", "Content-Range": `bytes */${total}` },
        redirect: "manual",
      });
    } catch {
      throw new Error("drive_upload_status_unavailable");
    }
    if (statusResponse.status === 308) {
      const nextOffset = parseDriveReceivedOffset(statusResponse.headers.get("Range"), total);
      if (nextOffset === null) throw new Error("drive_upload_position_invalid");
      await reconcileUploadOffset(auth.user.id, uploadId, Number(session.next_offset), nextOffset);
      return NextResponse.json({ error: "Upload has not completed.", nextOffset }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (statusResponse.status === 404) return NextResponse.json({ error: "Upload session expired." }, { status: 410, headers: { "Cache-Control": "no-store" } });
    if (statusResponse.status !== 200 && statusResponse.status !== 201) throw new Error(`drive_upload_status_${statusResponse.status}`);
    const responseFile = await statusResponse.json().catch(() => null) as { id?: unknown } | null;
    const driveFileId = typeof responseFile?.id === "string" ? responseFile.id : session.drive_file_id;
    if (!driveFileId) throw new Error("drive_upload_result_missing_id");

    const file = await readDriveFile(accessToken, driveFileId);
    const verified = verifyCompletedDriveFile(file, { ...session, drive_file_id: driveFileId });
    await reconcileUploadOffset(auth.user.id, uploadId, Number(session.next_offset), total);
    const { data: parentId, error: parentError } = await getSupabaseAdminClient().rpc("get_google_drive_upload_parent", { p_user_id: auth.user.id, p_id: uploadId });
    if (parentError) throw parentError;
    const { data: externalFile, error: insertError } = await auth.supabase
      .from("external_files")
      .upsert({
        user_id: auth.user.id,
        provider: "google_drive",
        provider_file_id: verified.id,
        name: session.expected_name,
        mime_type: session.expected_mime_type,
        size_bytes: total,
        modified_at: verified.modifiedAt,
        status: "active",
        project_id: session.project_id,
        task_id: session.task_id,
        parent_id: parentId ?? null,
      }, { onConflict: "user_id,provider,provider_file_id" })
      .select(DRIVE_METADATA_FIELDS)
      .single();
    if (insertError || !externalFile) throw insertError ?? new Error("external_file_insert_failed");

    const { data: marked, error: markError } = await getSupabaseAdminClient().rpc("mark_google_drive_upload_completed", {
      p_user_id: auth.user.id,
      p_id: uploadId,
      p_drive_file_id: verified.id,
      p_external_file_id: externalFile.id,
    });
    if (markError || marked !== true) throw markError ?? new Error("upload_completion_state_failed");
    return NextResponse.json({ file: externalFile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "upload_confirmation_failed";
    console.error("[google-drive] upload confirmation failed", { code });
    return NextResponse.json({ error: "Google Drive upload could not be confirmed." }, { status: driveServiceErrorResponseStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
