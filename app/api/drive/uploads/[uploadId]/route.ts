import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import {
  driveServiceErrorResponseStatus,
  getGoogleDriveUploadSession,
  GOOGLE_DRIVE_CHUNK_ALIGNMENT,
  GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE,
  isGoogleDriveUploadSessionUri,
  parseDriveContentRange,
  parseDriveReceivedOffset,
} from "@/lib/google-drive/files";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function releaseChunkClaim(userId: string, uploadId: string, claimId: string, nextOffset: number) {
  await getSupabaseAdminClient().rpc("finish_google_drive_upload_chunk", {
    p_user_id: userId,
    p_id: uploadId,
    p_claim_id: claimId,
    p_next_offset: nextOffset,
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ uploadId: string }> }) {
  const auth = await requireGoogleDriveUser();
  if ("response" in auth) return auth.response;
  const { uploadId } = await context.params;
  if (!UUID_PATTERN.test(uploadId)) return NextResponse.json({ error: "Upload session not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

  try {
    const session = await getGoogleDriveUploadSession(auth.user.id, uploadId);
    if (!session) return NextResponse.json({ error: "Upload session not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (session.status === "expired") return NextResponse.json({ error: "Upload session expired." }, { status: 410, headers: { "Cache-Control": "no-store" } });
    if (session.status !== "uploading") return NextResponse.json({ error: "Upload session not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (Date.parse(session.expires_at) <= Date.now() || !isGoogleDriveUploadSessionUri(session.session_uri)) {
      return NextResponse.json({ error: "Upload session expired." }, { status: 410, headers: { "Cache-Control": "no-store" } });
    }

    const range = parseDriveContentRange(request.headers.get("Content-Range"));
    const declaredLength = request.headers.get("Content-Length");
    const maxBytes = GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE;
    const contentLength = declaredLength === null ? null : Number(declaredLength);
    if (!range || (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxBytes))) {
      return NextResponse.json({ error: "Invalid upload chunk." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const total = Number(session.expected_size_bytes);
    const currentOffset = Number(session.next_offset);
    const chunkSize = range.end - range.start + 1;
    const finalChunk = range.end === total - 1;
    if (
      range.total !== total || range.start !== currentOffset || chunkSize > maxBytes
      || (!finalChunk && chunkSize % GOOGLE_DRIVE_CHUNK_ALIGNMENT !== 0)
      || (contentLength !== null && contentLength !== chunkSize)
    ) return NextResponse.json({ error: "Upload chunk does not match the expected position or size." }, { status: 409, headers: { "Cache-Control": "no-store" } });

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== chunkSize) return NextResponse.json({ error: "Upload chunk length does not match Content-Range." }, { status: 400, headers: { "Cache-Control": "no-store" } });

    const claimId = randomUUID();
    const admin = getSupabaseAdminClient();
    const { data: claimed, error: claimError } = await admin.rpc("claim_google_drive_upload_chunk", {
      p_user_id: auth.user.id,
      p_id: uploadId,
      p_expected_offset: currentOffset,
      p_claim_id: claimId,
    });
    if (claimError || claimed !== true) return NextResponse.json({ error: "Another upload chunk is being processed." }, { status: 409, headers: { "Cache-Control": "no-store" } });

    let response: Response;
    try {
      response = await fetch(session.session_uri, {
        method: "PUT",
        cache: "no-store",
        signal: AbortSignal.timeout(55_000),
        headers: {
          "Content-Length": String(bytes.byteLength),
          "Content-Range": `bytes ${range.start}-${range.end}/${range.total}`,
        },
        body: bytes,
        redirect: "manual",
      });
    } catch {
      await releaseChunkClaim(auth.user.id, uploadId, claimId, currentOffset);
      return NextResponse.json({ error: "Google Drive did not accept this upload chunk. Retry from the same offset." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }

    let nextOffset: number;
    let complete = false;
    if (response.status === 308) {
      const acceptedOffset = parseDriveReceivedOffset(response.headers.get("Range"), total);
      if (acceptedOffset === null || acceptedOffset < currentOffset || acceptedOffset > range.end + 1) {
        await releaseChunkClaim(auth.user.id, uploadId, claimId, currentOffset);
        return NextResponse.json({ error: "Google Drive returned an invalid upload position." }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
      nextOffset = acceptedOffset;
    } else if (response.status === 200 || response.status === 201) {
      nextOffset = total;
      complete = true;
    } else {
      await releaseChunkClaim(auth.user.id, uploadId, claimId, currentOffset);
      console.error("[google-drive] upload chunk rejected", { status: response.status });
      return NextResponse.json({ error: "Google Drive rejected this upload chunk." }, { status: response.status === 404 ? 410 : 502, headers: { "Cache-Control": "no-store" } });
    }

    const { data: advanced, error: advanceError } = await admin.rpc("finish_google_drive_upload_chunk", {
      p_user_id: auth.user.id,
      p_id: uploadId,
      p_claim_id: claimId,
      p_next_offset: nextOffset,
    });
    if (advanceError || advanced !== true) return NextResponse.json({ error: "Upload progress could not be saved." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ uploadId, nextOffset, totalBytes: total, complete }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "upload_chunk_failed";
    console.error("[google-drive] upload chunk failed", { code });
    return NextResponse.json({ error: "Google Drive upload chunk failed." }, { status: driveServiceErrorResponseStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
