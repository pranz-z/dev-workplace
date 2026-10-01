import { getWorkspaceContext, isUuid } from "@/data/context";
import { describeDatabaseError, serviceFail, serviceOk, type ServiceResult } from "@/data/serviceResult";
import type { ProjectScreenshotRow } from "@/data/database.types";

const BUCKET = "project-screenshots";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const SCREENSHOT_COLUMNS = "id, user_id, project_id, storage_path, caption, created_at";

export interface ProjectScreenshot {
  id: string;
  projectId: string;
  storagePath: string;
  caption: string;
  createdAt: string;
  signedUrl: string;
}

function mapScreenshot(row: ProjectScreenshotRow, signedUrl: string): ProjectScreenshot {
  return {
    id: row.id,
    projectId: row.project_id,
    storagePath: row.storage_path,
    caption: row.caption,
    createdAt: row.created_at,
    signedUrl,
  };
}

export async function listProjectScreenshots(projectId: string): Promise<ProjectScreenshot[]> {
  if (!isUuid(projectId)) throw new Error("That project is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) throw new Error("Sign in to view project screenshots.");

  const { data, error } = await context.supabase
    .from("project_screenshots")
    .select(SCREENSHOT_COLUMNS)
    .eq("project_id", projectId)
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
    .insert({ user_id: context.userId, project_id: projectId, storage_path: storagePath, caption: caption.trim() })
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
