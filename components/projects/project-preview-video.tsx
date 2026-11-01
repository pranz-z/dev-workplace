"use client";

import { useEffect, useRef, useState } from "react";
import { getOwnerPreviewVideoUrl, getProjectPreviewVideo, removeProjectPreviewVideo, setProjectPreviewVideoEnabled, uploadProjectPreviewVideo, type PreviewVideoResult } from "@/data/projectPreviewVideoService";
import { validatePreviewVideoFile, type PreviewVideoMetadata, type PreviewVideoUrl } from "@/lib/project-video/policy";

export function ProjectPreviewVideo({ projectId }: { projectId: string }) {
  const [video, setVideo] = useState<PreviewVideoMetadata | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<PreviewVideoUrl | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    getProjectPreviewVideo(projectId).then(result => { if (mounted.current) setVideo(result.video); })
      .catch(() => { if (mounted.current) setError("Could not load preview video. Refresh this section to try again."); })
      .finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, [projectId]);

  async function run(action: () => Promise<PreviewVideoResult>, message: string) {
    if (lock.current || loading) return;
    lock.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      if (!mounted.current) return;
      setVideo(result.video); setPreview(null); setNotice(result.warning || message);
      setFile(null);
      if (input.current) input.current.value = "";
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "Could not update preview video."); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  async function openPreview() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const signed = preview && preview.expiresAt > Date.now() + 30_000 ? preview : await getOwnerPreviewVideoUrl(projectId);
      if (mounted.current) setPreview(signed);
    } catch { if (mounted.current) setError("Could not open the private preview. Try again."); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className="mt-4 space-y-3 dark-panel p-4" aria-label="Project preview video">
    <h3 className="text-lg font-semibold t-dark">Project preview video</h3>
    <p className="text-sm t-dark-muted">Recommended: MP4, 5–10 MB. The video plays silently when visitors hover your project card.</p>
    <p className="text-xs t-dark-muted">Maximum 15 MB. Uploads stay private until you enable the preview for a Public project.</p>
    {loading ? <p role="status">Loading preview video…</p> : video ? <div className="space-y-3">
      <p className="break-all text-sm t-dark">{video.fileName} · {(video.sizeBytes / 1024 / 1024).toFixed(2)} MB · {video.mimeType}</p>
      <label className="flex items-center gap-2 text-sm t-dark"><input type="checkbox" checked={video.enabled} disabled={busy} onChange={event => void run(() => setProjectPreviewVideoEnabled(projectId, event.target.checked), "Preview visibility saved.")} />Show video preview on public portfolio</label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="dark-chip px-3 py-2 text-sm" disabled={busy} onClick={() => void openPreview()}>Preview current video</button>
        <button type="button" className="dark-chip px-3 py-2 text-sm" disabled={busy} onClick={() => void run(() => removeProjectPreviewVideo(projectId), "Preview removed.")}>Remove video</button>
      </div>
      {preview && <video key={preview.url} src={preview.url} controls muted playsInline preload="none" className="aspect-video w-full rounded-xl bg-black object-contain" onError={() => { setPreview(null); setError("The private preview expired or could not load. Open it again to retry."); }} />}
    </div> : <p className="text-sm t-dark-muted">No preview video uploaded.</p>}
    <label className="block min-w-0 text-sm t-dark-muted">MP4 video
      <input ref={input} type="file" accept="video/mp4,.mp4" disabled={busy || loading} className="mt-1 block w-full min-w-0 text-xs" onChange={event => {
        const selected = event.target.files?.[0] ?? null;
        const invalid = selected ? validatePreviewVideoFile(selected) : null;
        setFile(invalid ? null : selected); setError(invalid || ""); setNotice("");
      }} />
    </label>
    {file && <p className="break-all text-sm t-dark-muted">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type}</p>}
    <button type="button" disabled={busy || loading || !file} className="ink-button primary px-3 py-2 text-sm disabled:opacity-50" onClick={() => { if (file) void run(() => uploadProjectPreviewVideo(projectId, file), "Video saved privately. Enable it when ready."); }}>{busy ? "Saving video…" : video ? "Replace video" : "Upload video"}</button>
    {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
    {notice && <p role="status" className="text-sm t-dark-muted">{notice}</p>}
    {!loading && <button type="button" disabled={busy} className="dark-chip ml-2 px-3 py-2 text-sm" onClick={() => void run(() => getProjectPreviewVideo(projectId), "Preview refreshed.")}>Refresh video</button>}
  </section>;
}
