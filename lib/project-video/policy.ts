export const MAX_PREVIEW_VIDEO_BYTES = 15 * 1024 * 1024;
export const PREVIEW_VIDEO_MIME = "video/mp4";
export const PREVIEW_URL_TTL_MS = 15 * 60 * 1000;
export const PREVIEW_UPLOAD_TTL_MS = 10 * 60 * 1000;
export const PREVIEW_PATH_PATTERN = /^portfolio-previews\/[a-f0-9]{48}\.mp4$/;

export function validatePreviewVideoFile(file: { name: string; type: string; size: number }): string | null {
  if (file.type !== PREVIEW_VIDEO_MIME || !/\.mp4$/i.test(file.name)) return "Choose an MP4 video with a .mp4 filename.";
  if (!file.name.trim() || file.name.length > 255 || /[\x00-\x1f\/\\]/.test(file.name)) return "Choose a valid MP4 filename.";
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_PREVIEW_VIDEO_BYTES) return "Choose a nonempty video up to 15 MB.";
  return null;
}

export interface PreviewVideoMetadata {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  enabled: boolean;
  updatedAt: string;
}

export interface PreviewVideoUrl {
  url: string;
  mimeType: string;
  expiresAt: number;
}
