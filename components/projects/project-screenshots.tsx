"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { SortableList } from "@/components/dnd/SortableList";
import { addProjectScreenshot, deleteProjectScreenshot, reorderProjectScreenshots, setProjectScreenshotPublic, type ProjectScreenshot } from "@/data/projectScreenshotService";

interface ProjectScreenshotsProps {
  projectId: string;
  screenshots: ProjectScreenshot[];
  loading: boolean;
  loadError: string;
  onChange: (screenshots: ProjectScreenshot[]) => void;
  onRefresh: () => Promise<void>;
}

export function ProjectScreenshots({ projectId, screenshots, loading, loadError, onChange, onRefresh }: ProjectScreenshotsProps) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setError("");
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError("Choose an image to upload.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await addProjectScreenshot(projectId, file, caption);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange([...screenshots, result.data]);
      setFile(null);
      setCaption("");
      formRef.current?.reset();
    } catch {
      setError("Couldn't upload the screenshot. Check your connection and Supabase Storage setup.");
    } finally {
      setSaving(false);
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
      <form ref={formRef} onSubmit={(event) => void handleUpload(event)} className="grid gap-3 rounded-xl dark-inset p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="min-w-0 text-sm t-dark-muted">Image
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="mt-1 block w-full min-w-0 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-inherit" />
        </label>
        <label className="min-w-0 text-sm t-dark-muted">Caption (optional)
          <input value={caption} maxLength={200} onChange={(event) => setCaption(event.target.value)} className="mt-1 w-full min-w-0 dark-chip px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={saving || !file} className="ink-button primary px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"><ImagePlus size={15} className="mr-1 inline" />{saving ? "Saving…" : "Add screenshot"}</button>
      </form>
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
