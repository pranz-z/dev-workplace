"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { FileUp, RefreshCw, Unlink } from "lucide-react";
import type { Project, Task } from "@/types";
import { checkDriveUpload, driveClientRequest, uploadDriveChunks, type BrowserDriveUpload, type WorkplaceDriveFile } from "@/lib/google-drive/client";
import { validateDriveFilename, validateDriveMimeType, validateDriveFileSize } from "@/lib/google-drive/validation";

const sizeLabel = (bytes: number | null) => bytes === null ? "Size unavailable" : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(date));
type UploadState = "idle" | "uploading" | "confirming" | "failed" | "complete";

export function DriveFiles({ projects, tasks, active, onOpenSettings }: { projects: Project[]; tasks: Task[]; active: boolean; onOpenSettings: () => void }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [files, setFiles] = useState<WorkplaceDriveFile[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [session, setSession] = useState<BrowserDriveUpload | null>(null);
  const [received, setReceived] = useState(0);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busy = uploadState === "uploading" || uploadState === "confirming";
  const locked = busy || session !== null;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setLoadError("");
    const results = await Promise.allSettled([
      driveClientRequest<{ connected: boolean }>("/api/drive/status", { signal }),
      driveClientRequest<{ files: WorkplaceDriveFile[]; count: number }>("/api/drive/files", { signal }),
    ]);
    if (signal?.aborted || !mounted.current) return;
    if (results[0].status === "fulfilled") setConnected(results[0].value.connected);
    else setConnected(null);
    if (results[1].status === "fulfilled") { setFiles(results[1].value.files); setCount(results[1].value.count); }
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") setLoadError(failure.reason instanceof Error ? failure.reason.message : "Files could not be loaded.");
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; uploadController.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void refresh(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active, refresh]);
  useEffect(() => {
    if (!busy) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [busy]);

  const resetUpload = (clearFile: boolean) => {
    setSession(null); setReceived(0); setUploadState("idle"); setUploadError("");
    if (clearFile) { setFile(null); if (fileInput.current) fileInput.current.value = ""; }
  };

  const upload = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!file || busy) return;
    const name = validateDriveFilename(file.name);
    const mimeType = validateDriveMimeType(file.type || "application/octet-stream");
    if (!name || !mimeType || validateDriveFileSize(file.size) === null) {
      setUploadError("Choose a non-empty file up to 1 GB with a valid filename and file type.");
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    setUploadError(""); setUploadState("uploading");
    try {
      let currentSession = session;
      let offset = 0;
      let completedFile: WorkplaceDriveFile | undefined;
      if (currentSession) {
        const checked = await checkDriveUpload(currentSession.uploadId, file.size, controller.signal);
        offset = checked.nextOffset; completedFile = checked.file;
        setReceived(offset);
      } else {
        currentSession = await driveClientRequest<BrowserDriveUpload>("/api/drive/uploads", {
          method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, mimeType, sizeBytes: file.size, projectId: projectId || null, taskId: taskId || null }),
        });
        setSession(currentSession);
      }
      if (!completedFile) {
        const result = await uploadDriveChunks(file, currentSession, offset, (next) => {
          if (!mounted.current) return;
          setReceived(next);
          if (next === file.size) setUploadState("confirming");
        }, controller.signal);
        completedFile = result.file;
        if (!completedFile) throw new Error("Upload is incomplete. Retry to continue from the confirmed position.");
      }
      if (!mounted.current) return;
      setReceived(file.size); setUploadState("complete");
      await refresh();
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return;
      setUploadState("failed");
      setUploadError(cause instanceof Error ? cause.message : "Upload failed. Check your connection and retry.");
    } finally { if (uploadController.current === controller) uploadController.current = null; }
  };

  const loadMore = async () => {
    setLoading(true); setLoadError("");
    try {
      const result = await driveClientRequest<{ files: WorkplaceDriveFile[]; count: number }>(`/api/drive/files?offset=${files.length}`);
      setFiles((current) => [...current, ...result.files.filter((entry) => !current.some((existing) => existing.id === entry.id))]);
      setCount(result.count);
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : "Files could not be loaded."); }
    finally { setLoading(false); }
  };

  const unlink = async (entry: WorkplaceDriveFile) => {
    if (!window.confirm(`Unlink “${entry.name}” from Workplace? The file will remain in Google Drive.`)) return;
    setRemovingId(entry.id); setLoadError("");
    try {
      await driveClientRequest(`/api/drive/files/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      await refresh();
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : "File could not be unlinked."); }
    finally { setRemovingId(null); }
  };

  return <div className="space-y-5">
    <section className="dark-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold t-dark">Files</h2><p className="mt-1 text-sm t-dark-muted">Private workspace files stored in Google Drive.</p></div><button type="button" disabled={loading || busy} onClick={() => void refresh()} className="dark-chip inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} />Refresh</button></div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span className="t-dark-muted">{connected === null ? "Connection status unavailable" : connected ? "Google Drive connected" : "Google Drive disconnected"}</span><button type="button" onClick={onOpenSettings} className="dark-chip px-3 py-2">Manage connection</button></div>
      <form onSubmit={(event) => void upload(event)} className="mt-5 space-y-4">
        <label className="block text-sm t-dark">File<input ref={fileInput} type="file" disabled={locked || connected !== true} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setUploadError(""); setReceived(0); setUploadState("idle"); }} className="mt-2 block w-full dark-chip p-3 disabled:opacity-50" /></label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm t-dark">Project (optional)<select value={projectId} disabled={locked} onChange={(event) => { setProjectId(event.target.value); setTaskId(""); }} className="dark-chip mt-2 w-full min-w-0 p-2 disabled:opacity-50"><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="block text-sm t-dark">Task (optional)<select value={taskId} disabled={locked} onChange={(event) => { const selected = tasks.find((task) => task.id === event.target.value); setTaskId(selected?.id ?? ""); if (selected) setProjectId(selected.projectId); }} className="dark-chip mt-2 w-full min-w-0 p-2 disabled:opacity-50"><option value="">No task</option>{tasks.filter((task) => !projectId || task.projectId === projectId).map((task) => <option key={task.id} value={task.id}>{task.title}{!projectId ? ` · ${projects.find((project) => project.id === task.projectId)?.name ?? "Project"}` : ""}</option>)}</select></label>
        </div>
        <p className="text-xs t-dark-muted">Up to 1 GB per file. Keep this tab open while uploading; retries retain the selected file until the page is reloaded.</p>
        {file && <div className="dark-inset p-3"><p className="break-all text-sm t-dark">{file.name} · {sizeLabel(file.size)}</p><progress aria-label={`Upload progress for ${file.name}`} value={received} max={file.size || 1} className="mt-2 h-2 w-full accent-[var(--ink-green)]" /><p role="status" className="mt-2 text-sm t-dark-muted">{uploadState === "complete" ? "Upload complete. File added to Workplace." : uploadState === "confirming" ? "Upload received. Verifying file…" : `${Math.floor(received / Math.max(file.size, 1) * 100)}% received${busy ? " · Uploading…" : ""}`}</p></div>}
        {uploadError && <p role="alert" className="text-sm text-[var(--accent-peach)]">{uploadError}</p>}
        <div className="flex flex-wrap gap-2">
          {uploadState !== "complete" && <button type="submit" disabled={!file || busy || connected !== true} className="ink-button primary inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"><FileUp size={16} />{busy ? "Uploading…" : session ? "Retry upload" : "Upload file"}</button>}
          {!busy && file && <button type="button" onClick={() => resetUpload(true)} className="dark-chip px-3 py-2 text-sm">Choose another file</button>}
          {!busy && session && uploadState === "failed" && <button type="button" onClick={() => resetUpload(false)} className="dark-chip px-3 py-2 text-sm">Start a new upload</button>}
        </div>
      </form>
    </section>
    <section className="dark-panel p-5" aria-labelledby="drive-files-heading">
      <h3 id="drive-files-heading" className="text-lg font-semibold t-dark">Your files <span className="text-sm t-dark-muted">({count})</span></h3>
      {loadError && <p role="alert" className="mt-3 text-sm text-[var(--accent-peach)]">{loadError}</p>}
      {loading && <p role="status" className="mt-3 text-sm t-dark-muted">Loading files…</p>}
      {!loading && !loadError && files.length === 0 && <p className="mt-4 text-sm t-dark-muted">No files yet. Connect Google Drive and upload a file to get started.</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">{files.map((entry) => <article key={entry.id} className="dark-inset min-w-0 p-4"><div className="flex items-start justify-between gap-3"><h4 className="min-w-0 break-all font-medium t-dark">{entry.name}</h4><button type="button" disabled={removingId !== null} aria-label={`Remove ${entry.name} from Workplace`} title="Remove from Workplace" onClick={() => void unlink(entry)} className="dark-chip shrink-0 p-2 disabled:opacity-50"><Unlink size={16} /><span className="ml-2 text-xs">Remove from Workplace</span></button></div><div className="mt-3 flex flex-wrap gap-2"><a href={`/api/drive/files/${encodeURIComponent(entry.id)}/access?mode=preview`} target="_blank" rel="noopener noreferrer" className="dark-chip px-3 py-2 text-sm">Preview</a><a href={`/api/drive/files/${encodeURIComponent(entry.id)}/access?mode=download`} target="_blank" rel="noopener noreferrer" className="dark-chip px-3 py-2 text-sm">Download</a></div><p className="mt-2 break-all text-xs t-dark-muted">{entry.mime_type} · {sizeLabel(entry.size_bytes)}</p><p className="mt-2 text-xs t-dark-muted">Added {dateLabel(entry.created_at)}{entry.modified_at ? ` · Modified ${dateLabel(entry.modified_at)}` : ""}</p><p className="mt-2 text-sm t-dark-muted">{entry.project_id ? projects.find((project) => project.id === entry.project_id)?.name ?? "Project unavailable" : "No project"}{entry.task_id ? ` · ${tasks.find((task) => task.id === entry.task_id)?.title ?? "Task unavailable"}` : ""}</p></article>)}</div>
      {files.length < count && <button type="button" disabled={loading} onClick={() => void loadMore()} className="dark-chip mt-4 px-3 py-2 text-sm disabled:opacity-50">Load more files</button>}
      <p className="mt-4 text-xs t-dark-muted">Unlinking removes the Workplace association. Your file stays in Google Drive.</p>
    </section>
  </div>;
}
