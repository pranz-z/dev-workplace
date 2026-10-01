import { getWorkspaceContext, isUuid } from "@/data/context";
import { describeDatabaseError, serviceFail, serviceOk, type ServiceResult } from "@/data/serviceResult";
import type { ProjectScreenshotRow, PublicProjectScreenshotRow } from "@/data/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const BUCKET = "project-screenshots";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const SCREENSHOT_COLUMNS = "id, user_id, project_id, storage_path, caption, is_public, sort_order, created_at";

export interface ProjectScreenshot {
  id: string;
  projectId: string;
  storagePath: string;
  caption: string;
  isPublic: boolean;
  sortOrder: number;
  createdAt: string;
  signedUrl: string;
}

function mapScreenshot(row: ProjectScreenshotRow, signedUrl: string): ProjectScreenshot {
  return {
    id: row.id,
    projectId: row.project_id,
    storagePath: row.storage_path,
    caption: row.caption,
    isPublic: row.is_public,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    signedUrl,
  };
}

export async function listPublicProjectScreenshots(slug: string | null) {
  if (!isSupabaseConfigured()) return [];
  return listWithClient(getSupabaseBrowserClient(), slug);
}

async function listWithClient(supabase: import("@supabase/supabase-js").SupabaseClient, slug: string | null) {
  const { data, error } = await supabase.rpc("public_project_screenshots", { p_slug: slug });
  if (error) throw error;
  const rows = (data ?? []) as PublicProjectScreenshotRow[];
  if (rows.length === 0) return [];
  const { data: signedUrls, error: signedUrlError } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((row) => row.storage_path), 60 * 5);
  if (signedUrlError) throw signedUrlError;
  return rows.map((row, index) => {
    const signedUrl = signedUrls?.[index]?.signedUrl;
    if (!signedUrl) throw new Error("Couldn't create a temporary URL for a shared screenshot.");
    return { id: row.id, projectSlug: row.project_slug, caption: row.caption, createdAt: row.created_at, signedUrl };
  });
}

export async function listProjectScreenshots(projectId: string): Promise<ProjectScreenshot[]> {
  if (!isUuid(projectId)) throw new Error("That project is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) throw new Error("Sign in to view project screenshots.");

  const { data, error } = await context.supabase
    .from("project_screenshots")
    .select(SCREENSHOT_COLUMNS)
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[data] project screenshots list failed", { operation: "list_project_screenshots", code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw new Error("Couldn't load project screenshots. Apply the project screenshot migration and check the Supabase Storage policies.");
  }

  const rows = (data ?? []) as unknown as ProjectScreenshotRow[];
  const screenshots = await Promise.all(rows.map(async (row) => {
    const { data: signed, error: signedUrlError } = await context.supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 60 * 60);
    if (signedUrlError) {
      console.error("[data] project screenshot URL failed", { operation: "sign_project_screenshot", message: signedUrlError.message });
      throw new Error("Couldn't open a saved screenshot. Check the project screenshot Storage policies.");
    }
    return mapScreenshot(row, signed.signedUrl);
  }));
  return screenshots;
}

export async function addProjectScreenshot(
  projectId: string,
  file: File,
  caption: string,
): Promise<ServiceResult<ProjectScreenshot>> {
  if (!isUuid(projectId)) return serviceFail("That project is no longer available. Refresh and try again.");
  const extension = IMAGE_TYPES[file.type];
  if (!extension) return serviceFail("Choose a JPEG, PNG, or WebP image.");
  if (file.size === 0 || file.size > MAX_FILE_SIZE) return serviceFail("Choose an image smaller than 10 MB.");
  if (caption.trim().length > 200) return serviceFail("Keep the caption under 200 characters.");

  const context = await getWorkspaceContext();
  if (!context) return serviceFail("Sign in to add project screenshots.");

  const { data: last, error: orderError } = await context.supabase.from("project_screenshots")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) return serviceFail(describeDatabaseError(orderError, "Couldn't save the screenshot details."));

  const storagePath = `${context.userId}/${projectId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await context.supabase.storage.from(BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    console.error("[data] project screenshot upload failed", { operation: "upload_project_screenshot", message: uploadError.message });
    return serviceFail("Couldn't upload the screenshot. Apply the project screenshot migration and check the Supabase Storage policies.");
  }

  const { data, error } = await context.supabase
    .from("project_screenshots")
    .insert({ user_id: context.userId, project_id: projectId, storage_path: storagePath, caption: caption.trim(), sort_order: ((last as { sort_order?: number } | null)?.sort_order ?? -1) + 1 })
    .select(SCREENSHOT_COLUMNS)
    .single();

  if (error) {
    console.error("[data] project screenshot metadata insert failed", { operation: "insert_project_screenshot", code: error.code, message: error.message, details: error.details, hint: error.hint });
    const { error: cleanupError } = await context.supabase.storage.from(BUCKET).remove([storagePath]);
    if (cleanupError) console.error("[data] project screenshot cleanup failed", { operation: "cleanup_project_screenshot_upload", message: cleanupError.message });
    return serviceFail(describeDatabaseError(error, "Couldn't save the screenshot details."));
  }

  const row = data as unknown as ProjectScreenshotRow;
  const { data: signed, error: signedUrlError } = await context.supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);
  if (signedUrlError) {
    console.error("[data] project screenshot URL failed", { operation: "sign_project_screenshot", message: signedUrlError.message });
    return serviceFail("Screenshot saved, but couldn't open it. Refresh the project and check the Storage policies.");
  }
  return serviceOk(mapScreenshot(row, signed.signedUrl));
}

export async function setProjectScreenshotPublic(projectId: string, screenshotId: string, isPublic: boolean): Promise<ServiceResult<ProjectScreenshot>> {
  if (!isUuid(projectId) || !isUuid(screenshotId)) return serviceFail("That screenshot is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail("Sign in to update project screenshots.");
  const { data, error } = await context.supabase.from("project_screenshots")
    .update({ is_public: isPublic })
    .eq("id", screenshotId)
    .eq("project_id", projectId)
    .select(SCREENSHOT_COLUMNS)
    .single();
  if (error) return serviceFail(describeDatabaseError(error, "Couldn't update screenshot visibility."));
  const row = data as unknown as ProjectScreenshotRow;
  const { data: signed, error: signedError } = await context.supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 60 * 60);
  if (signedError) return serviceFail(describeDatabaseError(signedError, "Screenshot visibility was saved, but couldn't open the image."));
  return serviceOk(mapScreenshot(row, signed.signedUrl));
}

export async function reorderProjectScreenshots(projectId: string, screenshotIds: string[]): Promise<ServiceResult<ProjectScreenshot[]>> {
  if (!isUuid(projectId) || screenshotIds.some((id) => !isUuid(id)) || new Set(screenshotIds).size !== screenshotIds.length) {
    return serviceFail("That screenshot order is no longer available. Refresh and try again.");
  }
  const context = await getWorkspaceContext();
  if (!context) return serviceFail("Sign in to reorder project screenshots.");
  const results = await Promise.all(screenshotIds.map(async (id, index) => {
    const { data, error } = await context.supabase.from("project_screenshots")
      .update({ sort_order: index })
      .eq("project_id", projectId)
      .eq("user_id", context.userId)
      .eq("id", id)
      .select(SCREENSHOT_COLUMNS)
      .maybeSingle();
    if (error || !data) return { data: null, error };
    const row = data as unknown as ProjectScreenshotRow;
    const { data: signed, error: signedError } = await context.supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 60 * 60);
    return signedError ? { data: null, error: signedError } : { data: mapScreenshot(row, signed.signedUrl), error: null };
  }));
  const failed = results.find((result) => result.error || !result.data);
  if (failed?.error) return serviceFail(describeDatabaseError(failed.error, "Couldn't save screenshot order."));
  if (failed) return serviceFail("Couldn't save screenshot order. Refresh and try again.");
  return serviceOk(results.map((result) => result.data as ProjectScreenshot).sort((a, b) => a.sortOrder - b.sortOrder));
}

export async function deleteProjectScreenshot(projectId: string, screenshotId: string): Promise<ServiceResult<{ id: string }>> {
  if (!isUuid(projectId) || !isUuid(screenshotId)) return serviceFail("That screenshot is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail("Sign in to remove project screenshots.");

  const { data: row, error: readError } = await context.supabase
    .from("project_screenshots")
    .select("id, storage_path")
    .eq("id", screenshotId)
    .eq("project_id", projectId)
    .single();
  if (readError || !row) return serviceFail(describeDatabaseError(readError, "Couldn't find that screenshot."));

  const { error: storageError } = await context.supabase.storage.from(BUCKET).remove([row.storage_path]);
  if (storageError) {
    console.error("[data] project screenshot removal failed", { operation: "remove_project_screenshot_file", message: storageError.message });
    return serviceFail("Couldn't remove the screenshot file. Check the project screenshot Storage policies.");
  }

  const { error } = await context.supabase
    .from("project_screenshots")
    .delete()
    .eq("id", screenshotId)
    .eq("project_id", projectId);
  if (error) {
    console.error("[data] project screenshot metadata removal failed", { operation: "delete_project_screenshot_metadata", code: error.code, message: error.message, details: error.details, hint: error.hint });
    return serviceFail(describeDatabaseError(error, "Couldn't remove the screenshot details."));
  }
  return serviceOk({ id: screenshotId });
}
