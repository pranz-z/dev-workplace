import { validatePreviewVideoFile, type PreviewVideoMetadata, type PreviewVideoUrl } from "@/lib/project-video/policy";

const endpoint = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/preview-video`;

async function videoRequest<T>(projectId: string, method = "GET", input?: object): Promise<T> {
  const response = await fetch(endpoint(projectId), {
    method, cache: "no-store", credentials: "same-origin",
    ...(input ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not update preview video.");
  return result as T;
}

export type PreviewVideoResult = { video: PreviewVideoMetadata | null; warning?: string };
export const getProjectPreviewVideo = (projectId: string) => videoRequest<PreviewVideoResult>(projectId);
export const setProjectPreviewVideoEnabled = (projectId: string, enabled: boolean) => videoRequest<PreviewVideoResult>(projectId, "PATCH", { enabled });
export const removeProjectPreviewVideo = (projectId: string) => videoRequest<PreviewVideoResult>(projectId, "DELETE");
export const getOwnerPreviewVideoUrl = (projectId: string) => videoRequest<PreviewVideoUrl>(projectId, "POST", { action: "preview" });

export async function uploadProjectPreviewVideo(projectId: string, file: File): Promise<PreviewVideoResult> {
  const error = validatePreviewVideoFile(file);
  if (error) throw new Error(error);
  const authority = await videoRequest<{ uploadId: string; url: string }>(projectId, "POST", { action: "begin", name: file.name, type: file.type, size: file.size });
  // The only request carrying the file body goes directly to Vercel Blob.
  const uploaded = await fetch(authority.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!uploaded.ok) throw new Error("Video upload failed. The existing preview is unchanged. Try again.");
  return videoRequest<PreviewVideoResult>(projectId, "POST", { action: "finalize", uploadId: authority.uploadId });
}
