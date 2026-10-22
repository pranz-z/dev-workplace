"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { SortableList } from "@/components/dnd/SortableList";
import { addProjectScreenshot, deleteProjectScreenshot, reorderProjectScreenshots, setProjectScreenshotPublic, validateProjectScreenshotFile, type ProjectScreenshot } from "@/data/projectScreenshotService";

interface ProjectScreenshotsProps {
  projectId: string;
  screenshots: ProjectScreenshot[];
  loading: boolean;
  loadError: string;
  onChange: (screenshots: ProjectScreenshot[]) => void;
  onRefresh: () => Promise<void>;
}

interface SelectedScreenshot {
  id: string;
  file: File;
  previewUrl: string | null;
  error: string;
}

export function ProjectScreenshots({ projectId, screenshots, loading, loadError, onChange, onRefresh }: ProjectScreenshotsProps) {
  const [files, setFiles] = useState<SelectedScreenshot[]>([]);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [notice, setNotice] = useState("");
  const uploadLock = useRef(false);
  const mounted = useRef(true);
  const previewUrls = useRef(new Set<string>());
  const uploadableCount = files.filter((item) => !validateProjectScreenshotFile(item.file)).length;

  useEffect(() => {
    mounted.current = true;
    const urls = previewUrls.current;
    return () => {
      mounted.current = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const releasePreview = (item: SelectedScreenshot) => {
    if (item.previewUrl && previewUrls.current.delete(item.previewUrl)) URL.revokeObjectURL(item.previewUrl);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (saving || uploadLock.current) return;
    const selected = Array.from(event.target.files ?? []);
    if (!selected.length) return;
    files.forEach(releasePreview);
    setFiles(selected.map((file) => {
      const validationError = validateProjectScreenshotFile(file);
      const previewUrl = validationError ? null : URL.createObjectURL(file);
      if (previewUrl) previewUrls.current.add(previewUrl);
      return { id: crypto.randomUUID(), file, previewUrl, error: validationError ?? "" };
    }));
    event.target.value = "";
    setError("");
    setNotice("");
  };

  const removeSelectedFile = (item: SelectedScreenshot) => {
    if (saving || uploadLock.current) return;
    releasePreview(item);
    setFiles((current) => current.filter((file) => file.id !== item.id));
    setNotice("");
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || loading || uploadLock.current) return;
    const batch = files.filter((item) => !validateProjectScreenshotFile(item.file));
    if (!batch.length) {
      setError("Choose a JPEG, PNG, or WebP image to upload.");
      return;
    }
    uploadLock.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    const updated = [...screenshots];
    let uploaded = 0;
    let refreshNeeded = false;
    try {
      for (const [index, item] of batch.entries()) {
        if (!mounted.current) return;
        setProgress({ current: index + 1, total: batch.length });
        let itemError = "";
        let saved = false;
        try {
          const result = await addProjectScreenshot(projectId, item.file, caption);
          if (!mounted.current) return;
          if (result.ok) {
            updated.push(result.data);
            onChange([...updated]);
            saved = true;
          } else {
            itemError = result.error;
            saved = "saved" in result && result.saved;
            if (saved) refreshNeeded = true;
          }
        } catch {
          itemError = "Couldn't upload this screenshot. Check your connection and try again.";
        }
        if (!mounted.current) return;
        if (saved) {
          uploaded++;
          releasePreview(item);
          setFiles((current) => current.filter((file) => file.id !== item.id));
          if (itemError) setError(itemError);
        } else {
          setFiles((current) => current.map((file) => file.id === item.id ? { ...file, error: itemError } : file));
        }
      }
      if (refreshNeeded) {
        try { await onRefresh(); } catch { if (mounted.current) setError("Screenshots were saved, but the gallery couldn't refresh. Refresh screenshots before uploading more."); }
      }
      if (!mounted.current) return;
      setNotice(`Uploaded ${uploaded} of ${batch.length} screenshots.${uploaded < batch.length ? " Failed files remain selected for retry." : ""}`);
      if (uploaded === files.length) setCaption("");
    } finally {
      uploadLock.current = false;
      if (mounted.current) {
        setSaving(false);
        setProgress(null);
      }
    }
  };

  const handleRemove = async (screenshot: ProjectScreenshot) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await deleteProjectScreenshot(projectId, screenshot.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange(screenshots.filter((item) => item.id !== screenshot.id));
    } catch {
      setError("Couldn't remove the screenshot. Check your connection and Supabase Storage setup.");
    } finally {
      setSaving(false);
    }
  };

  const handleVisibility = async (screenshot: ProjectScreenshot) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await setProjectScreenshotPublic(projectId, screenshot.id, !screenshot.isPublic);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange(screenshots.map((item) => item.id === screenshot.id ? result.data : item));
    } catch {
      setError("Couldn't update screenshot visibility.");
    } finally {
      setSaving(false);
    }
  };

  const handleReorder = async (ordered: ProjectScreenshot[]) => {
    if (saving) return;
    setSaving(true);
    setError("");
    onChange(ordered.map((item, index) => ({ ...item, sortOrder: index })));
    try {
      const result = await reorderProjectScreenshots(projectId, ordered.map((item) => item.id));
      if (!result.ok) {
        await onRefresh();
        setError(result.error);
        return;
      }
      onChange(result.data);
    } catch {
      try { await onRefresh(); } catch { /* The parent records its own refresh error. */ }
      setError("Couldn't save screenshot order. The gallery was refreshed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 dark-panel p-4" aria-labelledby="project-screenshots-title">
      <div>
        <h3 id="project-screenshots-title" className="text-lg font-semibold t-dark">Project screenshots</h3>
        <p className="mt-1 text-sm t-dark-muted">Images are private by default. Share individual screenshots on public project pages when they are ready.</p>
      </div>
      <form onSubmit={(event) => void handleUpload(event)} className="grid gap-3 rounded-xl dark-inset p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="min-w-0 text-sm t-dark-muted">Images
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={saving} onChange={handleFileChange} className="mt-1 block w-full min-w-0 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-inherit" />
        </label>
        <label className="min-w-0 text-sm t-dark-muted">Caption for all (optional)
          <input value={caption} disabled={saving} maxLength={200} onChange={(event) => setCaption(event.target.value)} className="mt-1 w-full min-w-0 dark-chip px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={saving || loading || !uploadableCount} className="ink-button primary px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"><ImagePlus size={15} className="mr-1 inline" />{progress ? `Uploading ${progress.current} of ${progress.total}…` : "Upload screenshots"}</button>
        {files.length > 0 && <div className="min-w-0 space-y-2 sm:col-span-3">
          <p className="text-sm t-dark">Selected screenshots ({files.length})</p>
          <ul className="space-y-2">{files.map((item) => <li key={item.id} className="flex min-w-0 items-start gap-3 rounded-lg dark-chip p-2">
            {item.previewUrl && <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt="" className="h-14 w-16 shrink-0 rounded object-cover" />
            </>}
            <div className="min-w-0 flex-1"><p className="break-all text-sm t-dark">{item.file.name}</p><p className="text-xs t-dark-muted">{(item.file.size / 1024 / 1024).toFixed(2)} MB</p>{item.error && <p role="alert" className="break-words text-sm t-dark">{item.error}</p>}</div>
            <button type="button" disabled={saving} onClick={() => removeSelectedFile(item)} aria-label={`Remove selected screenshot: ${item.file.name}`} className="dark-chip shrink-0 px-2 py-2 text-xs disabled:opacity-50">Remove</button>
          </li>)}</ul>
        </div>}
      </form>
      {(progress || notice) && <p role="status" className="text-sm t-dark-muted">{progress ? `Uploading screenshot ${progress.current} of ${progress.total}…` : notice}</p>}
      {(error || loadError) && <p role="alert" className="text-sm text-amber-300">{error || loadError}</p>}
      {loading ? <p role="status" className="text-sm t-dark-muted">Loading screenshots…</p> : screenshots.length ? (
        <SortableList
          items={screenshots}
          getId={(item) => item.id}
          className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          layout="grid"
          disabled={saving}
          onReorder={(items) => void handleReorder(items)}
          renderItem={(screenshot, dragHandle) => (
            <article className="min-w-0 overflow-hidden rounded-xl dark-inset">
              {/* Signed URLs are temporary and scoped to the authenticated user's private bucket access. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshot.signedUrl} alt={screenshot.caption || "Project screenshot"} className="aspect-video w-full object-cover" />
              <div className="flex items-start justify-between gap-2 p-3">
                <p className="min-w-0 break-words text-sm t-dark-soft">{screenshot.caption || "No caption"}</p>
                <div className="flex shrink-0 items-center gap-1">
                  {dragHandle}
                  <button type="button" onClick={() => void handleVisibility(screenshot)} disabled={saving} aria-pressed={screenshot.isPublic} className="dark-chip px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-coral)] disabled:opacity-50">{screenshot.isPublic ? "Public" : "Private"}</button>
                  <button type="button" onClick={() => void handleRemove(screenshot)} disabled={saving} aria-label={`Remove screenshot${screenshot.caption ? `: ${screenshot.caption}` : ""}`} className="dark-chip p-2 transition-colors hover:text-[var(--accent-coral)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-coral)] disabled:opacity-50"><Trash2 size={14} /></button>
                </div>
              </div>
            </article>
          )}
        />
      ) : (
        <div className="rounded-xl dark-inset p-4 text-sm t-dark-muted">
          <p>No screenshots yet.</p>
          <p className="mt-1 text-xs">Apply the project screenshot migration and Storage policies before uploading.</p>
        </div>
      )}
      <button type="button" onClick={() => void onRefresh()} disabled={loading || saving} className="dark-chip px-3 py-2 text-sm disabled:opacity-50">Refresh screenshots</button>
    </section>
  );
}
