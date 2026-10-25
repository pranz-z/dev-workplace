import "server-only";
import { randomBytes } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/data/context";
import type { ProjectPreviewVideoRow, PublicProjectPreviewVideoRow } from "@/data/database.types";
import { isValidSlug } from "@/lib/slug";
import { cleanupPreviewBlob, signPreviewRead, signPreviewUpload, verifyPreviewBlob } from "./blob";
import { validatePreviewVideoFile, type PreviewVideoMetadata } from "./policy";

export const videoJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
class VideoError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function metadata(row: ProjectPreviewVideoRow | null): PreviewVideoMetadata | null {
  return row?.blob_pathname ? { fileName: row.file_name, mimeType: row.mime_type, sizeBytes: row.size_bytes, enabled: row.enabled, updatedAt: row.updated_at } : null;
}

async function readInput(request: Request): Promise<Record<string, unknown>> {
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > 4096) throw new VideoError("Video metadata request is too large.", 413);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new VideoError("Send video metadata as JSON.", 400);
  // Never accept video bytes in an application route, even with a forged Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new VideoError("Missing video metadata.", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); throw new VideoError("Video metadata request is too large.", 413); }
      chunks.push(value);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid");
    return input as Record<string, unknown>;
  } catch (error) {
    if (error instanceof VideoError) throw error;
    throw new VideoError("Invalid video metadata.", 400);
  } finally { reader.releaseLock(); }
}

async function owner(projectId: string) {
  if (!isUuid(projectId)) throw new VideoError("Project unavailable.", 404);
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new VideoError("Supabase is not configured.", 503);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new VideoError("Sign in to manage preview videos.", 401);
  const project = await supabase.from("projects").select("id").eq("id", projectId).eq("user_id", data.user.id).maybeSingle();
  if (project.error) throw new VideoError("Could not load project.", 503);
  if (!project.data) throw new VideoError("Project unavailable.", 404);
  return { supabase, userId: data.user.id };
}

async function manage(userId: string, projectId: string, action: string, input = {}) {
  const { data, error } = await getSupabaseAdminClient().rpc("manage_project_preview_video", { p_user_id: userId, p_project_id: projectId, p_action: action, p_input: input });
  if (error) throw new VideoError("Video operation could not be saved. Refresh and try again.", error.code === "22023" || error.code === "23514" ? 400 : 503);
  return data;
}

export async function ownerPreviewRequest(request: Request, projectId: string): Promise<Response> {
  try {
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) throw new VideoError("Invalid request origin.", 403);
    }
    const { supabase, userId } = await owner(projectId);
    if (request.method === "GET") {
      const { data, error } = await supabase.from("project_preview_videos").select("*").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
      if (error) throw new VideoError("Could not load preview video metadata.", 503);
      return videoJson({ video: metadata(data as ProjectPreviewVideoRow | null) });
    }
    if (request.method === "DELETE") {
      const result = await manage(userId, projectId, "remove");
      return videoJson({ video: null, warning: await cleanupPreviewBlob(result.oldPath) });
    }
    const input = await readInput(request);
    if (request.method === "PATCH") {
      if (typeof input.enabled !== "boolean") throw new VideoError("Choose a preview visibility.", 400);
      const result = await manage(userId, projectId, "enabled", { enabled: input.enabled });
      return videoJson({ video: metadata(result.video) });
    }
    if (input.action === "begin") {
      if (typeof input.name !== "string" || typeof input.type !== "string" || typeof input.size !== "number") throw new VideoError("Invalid video metadata.", 400);
      const invalid = validatePreviewVideoFile({ name: input.name, type: input.type, size: input.size });
      if (invalid) throw new VideoError(invalid, 400);
      const pathname = `portfolio-previews/${randomBytes(24).toString("hex")}.mp4`;
      const result = await manage(userId, projectId, "begin", { pathname, name: input.name, type: input.type, size: input.size });
      const signed = await signPreviewUpload(pathname);
      return videoJson({ uploadId: result.uploadId, ...signed }, 201);
    }
    if (input.action === "finalize") {
      if (typeof input.uploadId !== "string" || !isUuid(input.uploadId)) throw new VideoError("Invalid upload.", 400);
      const intent = await manage(userId, projectId, "intent", { uploadId: input.uploadId });
      // Idempotent recovery after a successful save whose HTTP response was lost.
      if (intent.video) return videoJson({ video: metadata(intent.video) });
      const verified = await verifyPreviewBlob(intent.blob_pathname, intent.size_bytes, intent.mime_type);
      const result = await manage(userId, projectId, "finalize", { uploadId: input.uploadId, ...verified });
      return videoJson({ video: metadata(result.video), warning: await cleanupPreviewBlob(result.oldPath) });
    }
    if (input.action === "preview") {
      const { data, error } = await supabase.from("project_preview_videos").select("blob_pathname,mime_type").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
      if (error) throw new VideoError("Could not load video.", 503);
      if (!data) throw new VideoError("Preview unavailable.", 404);
      return videoJson(await signPreviewRead(data.blob_pathname, data.mime_type));
    }
    throw new VideoError("Invalid video operation.", 400);
  } catch (error) {
    return videoJson({ error: error instanceof VideoError ? error.message : "Preview video is unavailable. Check the private Blob store configuration and try again." }, error instanceof VideoError ? error.status : 503);
  }
}

export async function publicPreviewRequest(slug: string): Promise<Response> {
  try {
    if (!isValidSlug(slug)) return videoJson({ error: "Preview unavailable." }, 404);
    const supabase = await getSupabaseServerClient();
    if (!supabase) return videoJson({ error: "Preview unavailable." }, 503);
    const { data, error } = await supabase.rpc("public_project_preview_video", { p_slug: slug });
    if (error) return videoJson({ error: "Preview unavailable." }, 503);
    const row = (data as PublicProjectPreviewVideoRow[] | null)?.[0];
    if (!row) return videoJson({ error: "Preview unavailable." }, 404);
    return videoJson(await signPreviewRead(row.blob_pathname, row.mime_type));
  } catch { return videoJson({ error: "Preview unavailable." }, 503); }
}
