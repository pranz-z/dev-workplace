"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Archive, Check, ChevronRight, Code, Download, File as FileIcon, FileImage, FileText, FileUp, Folder, Grid2X2, List, MoreHorizontal, Plus, RefreshCw, Search, Unlink, Video, X } from "lucide-react";
import type { Project, Task } from "@/types";
import { WorkspaceDialog } from "@/components/workspace/WorkspaceDialog";
import { driveClientRequest, type WorkplaceDriveFile } from "@/lib/google-drive/client";
import { createDriveQueueItems, driveFolderTrail, DRIVE_FOLDER_TYPE, processDriveQueueItem, type DriveDestination, type DriveQueueItem } from "@/lib/google-drive/browser";
import { validateDriveFilename } from "@/lib/google-drive/validation";

const sizeLabel = (bytes: number | null) => bytes === null ? "—" : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(date));
function TypeIcon({ mime }: { mime: string }) {
  const Icon = mime.startsWith("image/") ? FileImage : mime.startsWith("video/") ? Video : /zip|gzip|tar|compressed/.test(mime) ? Archive : /json|javascript|xml/.test(mime) ? Code : /pdf|text|document/.test(mime) ? FileText : FileIcon;
  return <Icon size={19} aria-hidden="true" className="shrink-0" />;
}

export function DriveFiles({ projects, tasks, active, onOpenSettings }: { projects: Project[]; tasks: Task[]; active: boolean; onOpenSettings: () => void }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [files, setFiles] = useState<WorkplaceDriveFile[]>([]);
  const [count, setCount] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [newOpen, setNewOpen] = useState(false);
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<DriveQueueItem[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const folderRequest = useRef<string | null>(null);
  const navigationVersion = useRef(0);
  const dragDepth = useRef(0);
  const folderTrail = driveFolderTrail(files, folderId);
  const currentFolder = folderTrail.at(-1);
  const currentProject = projects.find((project) => project.id === (currentFolder?.project_id ?? projectId));
  const busy = queue.some((item) => item.state === "uploading" || item.state === "verifying" || item.state === "waiting");
  const destination: DriveDestination = { projectId: currentFolder?.project_id ?? projectId, parentId: folderId, taskId,
    label: currentFolder?.name ?? currentProject?.name ?? "Files" };

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const status = await driveClientRequest<{ connected: boolean }>("/api/drive/status", { signal });
      if (!signal?.aborted && mounted.current) setConnected(status.connected);
      const result = await driveClientRequest<{ files: WorkplaceDriveFile[]; count: number; nextOffset: number }>("/api/drive/files?limit=100", { signal });
      if (signal?.aborted || !mounted.current) return;
      setFiles(result.files); setCount(result.count); setNextOffset(result.nextOffset);
    } catch (cause) { if (!signal?.aborted && mounted.current) setError(cause instanceof Error ? cause.message : "Files could not be loaded."); }
    finally { if (!signal?.aborted && mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let saved: string | null = null;
    try { saved = localStorage.getItem("workplace-drive-view"); } catch { /* Storage may be disabled; list remains the default. */ }
    if (saved === "grid") { const timer = window.setTimeout(() => setView("grid"), 0); return () => { window.clearTimeout(timer); mounted.current = false; controller.current?.abort(); }; }
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController(); const timer = window.setTimeout(() => void refresh(abort.signal), 0);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [active, refresh]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setNewOpen(false); setActionsId(null); newButton.current?.focus(); } };
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setNewOpen(false);
      if (event.target instanceof Element && !event.target.closest("[data-drive-actions]")) setActionsId(null);
    };
    window.addEventListener("keydown", close); window.addEventListener("click", outside);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("click", outside); };
  }, []);
  useEffect(() => {
    if (newOpen) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [newOpen]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  useEffect(() => {
    if (running.current || connected !== true) return;
    const item = queue.find((entry) => entry.state === "waiting");
    if (!item) return;
    running.current = true;
    const abort = new AbortController(); controller.current = abort;
    const update = (patch: Partial<DriveQueueItem>) => { if (mounted.current) setQueue((items) => items.map((entry) => entry.id === item.id ? { ...entry, ...patch } : entry)); };
    const timer = window.setTimeout(() => {
      if (!mounted.current || abort.signal.aborted) { running.current = false; return; }
      update({ state: "uploading", error: "" });
      void processDriveQueueItem(item, abort.signal, (session) => update({ session }), (received) => update({ received }), () => update({ state: "verifying" }))
        .then((file) => { if (!mounted.current) return; update({ state: "complete", received: item.file.size }); setFiles((current) => [file, ...current.filter((entry) => entry.id !== file.id)]); setCount((current) => current + 1); void refresh(); })
        .catch((cause) => { if (!abort.signal.aborted) update({ state: "failed", error: cause instanceof Error ? cause.message : "Upload failed. Retry to resume." }); })
        .finally(() => { running.current = false; if (mounted.current) setQueue((current) => [...current]); });
    }, 0);
    // No dependency cleanup: progress must not abort the current upload.
    // The mount cleanup above cancels network activity on sign-out/unmount.
    void timer;
  }, [queue, connected, refresh]);

  const mergeFolder = (folder: WorkplaceDriveFile) => setFiles((current) => [folder, ...current.filter((entry) => entry.id !== folder.id)]);
  const openProject = async (project: Project) => {
    const version = ++navigationVersion.current;
    setProjectId(project.id); setFolderId(null); setTaskId(null); setSearch(""); setError("");
    if (!connected) return;
    setSyncing(true);
    try { const result = await driveClientRequest<{ folder: WorkplaceDriveFile }>("/api/drive/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure-project", projectId: project.id }) });
      if (mounted.current) { mergeFolder(result.folder); if (version === navigationVersion.current) setFolderId(result.folder.id); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Project folder unavailable. Retry synchronization."); }
    finally { if (mounted.current) setSyncing(false); }
  };
  const synchronize = async () => {
    if (syncing || !connected) return;
    setSyncing(true); setError("");
    try {
      // One owner-checked project per server request; sequential and explicit.
      for (const project of projects) {
        if (!mounted.current) break;
        const result = await driveClientRequest<{ folder: WorkplaceDriveFile }>("/api/drive/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure-project", projectId: project.id }) });
        if (mounted.current) mergeFolder(result.folder);
      }
      if (mounted.current) await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Folder synchronization failed. Retry safely."); }
    finally { if (mounted.current) setSyncing(false); }
  };
  const navigate = (folder: WorkplaceDriveFile | null) => { navigationVersion.current++; setFolderId(folder?.id ?? null); setProjectId(folder?.project_id ?? null); setTaskId(null); setSearch(""); setError(""); };
  const enqueue = (incoming: File[], target = destination) => {
    if (!connected) { setError("Connect Google Drive in Settings before uploading."); return; }
    if (!incoming.length) { setError("Drop files, not folders. Use File upload to select files."); return; }
    setQueue((current) => [...current, ...createDriveQueueItems(incoming, target)]); setDragging(false); dragDepth.current = 0;
  };
  const drop = (event: DragEvent, target = destination) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault(); event.stopPropagation(); setDragging(false); dragDepth.current = 0;
    const items = Array.from(event.dataTransfer.items);
    if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) { setError("Folder uploads are not supported. Select individual files."); return; }
    enqueue(Array.from(event.dataTransfer.files), target);
  };
  const createFolder = async (event: FormEvent) => {
    event.preventDefault(); const name = validateDriveFilename(folderName);
    if (!name) { setFolderError("Use a name of 1–255 characters without slashes or control characters."); return; }
    setCreating(true); setFolderError(""); folderRequest.current ??= crypto.randomUUID();
    try {
      const result = await driveClientRequest<{ folder: WorkplaceDriveFile }>("/api/drive/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name, requestId: folderRequest.current, projectId: destination.projectId, parentId: destination.parentId }) });
      mergeFolder(result.folder); setNewFolder(false); setFolderName(""); folderRequest.current = null; setCount((current) => current + 1); void refresh();
    } catch (cause) { setFolderError(cause instanceof Error ? cause.message : "Folder could not be created. Retry safely."); }
    finally { setCreating(false); }
  };
  const unlink = async (entry: WorkplaceDriveFile) => {
    setActionsId(null);
    if (!window.confirm(`Remove “${entry.name}” from Developer Workplace? It remains in Google Drive.${entry.mime_type === DRIVE_FOLDER_TYPE ? " Remove child associations first." : ""}`)) return;
    try { await driveClientRequest(`/api/drive/files/${encodeURIComponent(entry.id)}`, { method: "DELETE" }); setFiles((current) => current.filter((file) => file.id !== entry.id)); setCount((current) => Math.max(0, current - 1)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Association could not be removed."); }
  };
  const loadMore = async () => {
    setLoading(true);
    try { const result = await driveClientRequest<{ files: WorkplaceDriveFile[]; count: number; nextOffset: number }>(`/api/drive/files?limit=100&offset=${nextOffset}`); setFiles((current) => [...current, ...result.files.filter((entry) => !current.some((file) => file.id === entry.id))]); setCount(result.count); setNextOffset(result.nextOffset); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Files could not be loaded."); }
    finally { setLoading(false); }
  };
  const query = search.trim().toLowerCase();
  const matches = (entry: WorkplaceDriveFile) => [entry.name, projects.find((project) => project.id === entry.project_id)?.name, tasks.find((task) => task.id === entry.task_id)?.title].some((text) => text?.toLowerCase().includes(query));
  const visible = files.filter((entry) => !entry.is_project_folder && matches(entry) && (query ? true : folderId ? entry.parent_id === folderId || (currentFolder?.is_project_folder && entry.parent_id === null && entry.project_id === currentFolder.project_id) : projectId ? entry.project_id === projectId && (entry.parent_id === null || files.some((parent) => parent.id === entry.parent_id && parent.is_project_folder && parent.project_id === projectId)) : entry.parent_id === null));
  const customFolders = visible.filter((entry) => entry.mime_type === DRIVE_FOLDER_TYPE);
  const regularFiles = visible.filter((entry) => entry.mime_type !== DRIVE_FOLDER_TYPE);
  const root = !folderId && !projectId;
  const actionLink = (entry: WorkplaceDriveFile, mode: string) => `/api/drive/files/${encodeURIComponent(entry.id)}/access?mode=${mode}`;
  const renderActions = (entry: WorkplaceDriveFile) => <div data-drive-actions className="relative shrink-0"><button type="button" aria-label={`Actions for ${entry.name}`} aria-expanded={actionsId === entry.id} onClick={() => setActionsId(actionsId === entry.id ? null : entry.id)} className="dark-chip p-2 focus-visible:outline-2 focus-visible:outline-offset-2"><MoreHorizontal size={17} /></button>{actionsId === entry.id && <div className="dark-panel fixed inset-x-3 bottom-3 z-50 p-2 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-1 sm:w-52">{entry.mime_type !== DRIVE_FOLDER_TYPE && <><a className="flex items-center gap-2 rounded p-2 text-sm hover:bg-white/10" href={actionLink(entry, "preview")} target="_blank" rel="noopener noreferrer"><FileText size={15} />Preview</a><a className="flex items-center gap-2 rounded p-2 text-sm hover:bg-white/10" href={actionLink(entry, "download")} target="_blank" rel="noopener noreferrer"><Download size={15} />Download</a></>}<button type="button" onClick={() => void unlink(entry)} title="Removes this item from Developer Workplace. It remains in Google Drive." className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-white/10"><Unlink size={15} />Remove from Workplace</button></div>}</div>;

  return <section className="notebook-dense dark-panel relative min-w-0 space-y-5 p-3 sm:p-5" aria-label="Google Drive files" onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragLeave={(event) => { if (event.dataTransfer.types.includes("Files")) { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); } }} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = connected ? "copy" : "none"; } }} onDrop={drop}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold t-dark">Files</h2><p className="mt-1 text-sm t-dark-muted">Your private Drive, organized around your work.</p></div><button type="button" onClick={onOpenSettings} className="dark-chip px-3 py-2 text-sm">{connected === null ? "Check connection" : connected ? "Drive connected" : "Connect Google Drive"}</button></header>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div ref={menu} className="relative"><button ref={newButton} type="button" disabled={connected !== true || syncing} aria-haspopup="menu" aria-expanded={newOpen} onClick={() => setNewOpen(!newOpen)} className="ink-button primary inline-flex items-center gap-2 px-4 py-2 disabled:opacity-50"><Plus size={18} />New</button>{newOpen && <div role="menu" aria-label="New Drive item" className="dark-panel absolute left-0 top-full z-30 mt-2 w-48 p-2 shadow-lg" onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')); const index = items.indexOf(document.activeElement as HTMLElement); items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); } }}><button role="menuitem" type="button" onClick={() => { setNewOpen(false); setNewFolder(true); setFolderError(""); folderRequest.current = null; }} className="flex w-full items-center gap-2 rounded p-2 text-sm focus:bg-white/10"><Folder size={16} />New folder</button><button role="menuitem" type="button" onClick={() => { setNewOpen(false); fileInput.current?.click(); }} className="flex w-full items-center gap-2 rounded p-2 text-sm focus:bg-white/10"><FileUp size={16} />File upload</button></div>}</div>
      <label className="dark-chip flex min-w-0 flex-1 basis-40 items-center gap-2 px-3 py-2"><Search size={17} className="shrink-0" /><input aria-label="Search loaded files, projects, tasks, and folders" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files…" className="w-full min-w-0 bg-transparent text-sm outline-none" /></label>
      <button type="button" aria-label="Refresh files" title="Refresh files" disabled={loading} onClick={() => void refresh()} className="dark-chip p-2 disabled:opacity-50"><RefreshCw size={18} /></button>
      <div className="flex gap-1" aria-label="View mode">{(["list", "grid"] as const).map((mode) => <button key={mode} type="button" aria-label={`${mode} view`} aria-pressed={view === mode} onClick={() => { setView(mode); try { localStorage.setItem("workplace-drive-view", mode); } catch { /* Keep the current in-memory preference. */ } }} className={`dark-chip p-2 ${view === mode ? "ring-1 ring-current" : ""}`}>{mode === "list" ? <List size={18} /> : <Grid2X2 size={18} />}</button>)}</div>
      <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} onChange={(event) => { enqueue(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </div>
    <nav aria-label="File breadcrumbs" className="flex min-w-0 flex-wrap items-center gap-1 text-sm"><button type="button" onClick={() => navigate(null)} className="dark-chip px-2 py-1">Files</button>{!folderTrail.length && currentProject && <><ChevronRight size={14} /><span className="break-all">{currentProject.name}</span></>}{folderTrail.map((folder) => <span key={folder.id} className="flex min-w-0 items-center gap-1"><ChevronRight size={14} className="shrink-0" /><button type="button" onClick={() => navigate(folder)} className="dark-chip break-all px-2 py-1">{folder.is_project_folder ? currentProject?.name ?? folder.name : folder.name}</button></span>)}</nav>
    <div className="flex flex-wrap items-center gap-2 text-xs t-dark-muted"><span>Upload destination: {destination.label}</span>{!folderId && <label>Project <select aria-label="Upload project" value={projectId ?? ""} onChange={(event) => { setProjectId(event.target.value || null); setTaskId(null); }} className="dark-chip ml-1 max-w-44 p-1"><option value="">Unassigned</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}<label>Task <select aria-label="Upload task" value={taskId ?? ""} onChange={(event) => { const task = tasks.find((entry) => entry.id === event.target.value); setTaskId(task?.id ?? null); if (task && !folderId) setProjectId(task.projectId); }} className="dark-chip ml-1 max-w-44 p-1"><option value="">None</option>{tasks.filter((task) => destination.projectId ? task.projectId === destination.projectId : !folderId).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></div>
    {error && <p role="alert" className="text-sm text-[var(--accent-peach)]">{error}</p>}
    {connected === false && <div className="dark-inset p-4 text-sm">Connect Google Drive in Settings to create folders and upload. Existing Workplace metadata remains visible.</div>}
    {(root || query) && <section aria-label="Project folders"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold t-dark">Project folders</h3><button type="button" disabled={!connected || syncing || !projects.length} onClick={() => void synchronize()} className="dark-chip px-3 py-1 text-xs disabled:opacity-50">{syncing ? "Synchronizing…" : "Sync project folders"}</button></div>{!projects.length ? <p className="text-sm t-dark-muted">Create a Workplace project to organize files around it.</p> : <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2 lg:grid-cols-3">{projects.filter((project) => !query || project.name.toLowerCase().includes(query)).map((project) => <button key={project.id} type="button" disabled={syncing} onClick={() => void openProject(project)} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={(event) => drop(event, { projectId: project.id, parentId: null, taskId: null, label: project.name })} className="dark-inset flex min-w-0 items-center gap-3 p-4 text-left transition hover:ring-1 hover:ring-current focus-visible:outline-2"><Folder size={24} className="shrink-0 t-dark-muted" /><span className="min-w-0 break-words text-sm font-medium t-dark">{project.name}</span></button>)}</div>}</section>}
    {!!customFolders.length && <section aria-label="Custom folders"><h3 className="mb-3 font-semibold t-dark">Folders</h3><div className="grid gap-2 min-[390px]:grid-cols-2 lg:grid-cols-3">{customFolders.map((folder) => <div key={folder.id} className="dark-inset flex min-w-0 items-center justify-between gap-2 p-3"><button type="button" onClick={() => navigate(folder)} className="flex min-w-0 items-center gap-2 text-left text-sm"><Folder size={21} className="shrink-0" /><span className="break-all">{folder.name}</span></button>{renderActions(folder)}</div>)}</div></section>}
    <section aria-label="Files in current folder"><h3 className="mb-3 font-semibold t-dark">{query ? "Matching loaded files" : "Files"}</h3>{loading && <p role="status" className="text-sm t-dark-muted">Loading files…</p>}{!loading && !regularFiles.length && <div className="dark-inset p-6 text-center text-sm t-dark-muted">{query ? "No loaded files match your search." : "This folder is empty. Use New → File upload or drop files here."}</div>}
      <div className={view === "grid" ? "grid gap-2 min-[390px]:grid-cols-2 lg:grid-cols-3" : "space-y-1"}>{view === "list" && !!regularFiles.length && <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_5rem_2.5rem] gap-3 px-3 py-2 text-xs t-dark-muted lg:grid"><span>Name</span><span>Project / Location</span><span>Modified</span><span>Size</span><span className="sr-only">Actions</span></div>}{regularFiles.map((entry) => <article key={entry.id} className={view === "grid" ? "dark-inset min-w-0 p-3" : "dark-inset grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-x-3 gap-y-1 p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_5rem_2.5rem]"}><a href={actionLink(entry, "preview")} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 text-sm font-medium t-dark"><TypeIcon mime={entry.mime_type} /><span className="break-all">{entry.name}</span></a><p className={`min-w-0 break-words text-xs t-dark-muted ${view === "list" ? "col-start-1 row-start-2 lg:col-auto lg:row-auto" : "mt-2"}`}>{projects.find((project) => project.id === entry.project_id)?.name ?? "Unassigned"}{entry.task_id ? ` · ${tasks.find((task) => task.id === entry.task_id)?.title ?? "Task"}` : ""}{entry.project_id && !entry.parent_id ? " · Legacy root file" : ""}</p><p className={`text-xs t-dark-muted ${view === "list" ? "col-start-1 row-start-3 lg:col-auto lg:row-auto" : "mt-2"}`}>{dateLabel(entry.modified_at ?? entry.updated_at)}</p><p className={`text-xs t-dark-muted ${view === "list" ? "col-start-1 row-start-4 lg:col-auto lg:row-auto" : "mt-1"}`}>{sizeLabel(entry.size_bytes)}</p><div className={view === "list" ? "col-start-2 row-start-1 lg:col-auto lg:row-auto" : "mt-2 flex justify-end"}>{renderActions(entry)}</div></article>)}</div>
      {nextOffset < count && <button type="button" disabled={loading} onClick={() => void loadMore()} className="dark-chip mt-3 px-3 py-2 text-sm">Load more ({Math.max(0, count - nextOffset)} remaining)</button>}<p className="mt-3 text-xs t-dark-muted">Search covers loaded metadata only. Files stay private; removal leaves Drive content intact.</p>
    </section>
    {!!queue.length && <section aria-label="Upload queue" className="dark-inset p-3"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold t-dark">Uploads</h3><button type="button" onClick={() => setQueue((items) => items.filter((item) => item.state !== "complete"))} className="dark-chip px-2 py-1 text-xs">Clear completed</button></div><div className="mt-3 space-y-3">{queue.map((item) => <div key={item.id} className="min-w-0"><div className="flex items-start justify-between gap-2"><p className="min-w-0 break-all text-sm t-dark">{item.file.name}<span className="block text-xs t-dark-muted">{sizeLabel(item.file.size)} · {item.destination.label}</span></p>{item.state === "complete" && <Check size={17} aria-label="Complete" />}{item.state === "failed" && <div className="flex shrink-0 flex-wrap gap-1"><button type="button" onClick={() => setQueue((items) => items.map((entry) => entry.id === item.id ? { ...entry, state: "waiting", error: "" } : entry))} className="dark-chip px-2 py-1 text-xs">Retry</button>{item.session && <button type="button" onClick={() => setQueue((items) => items.map((entry) => entry.id === item.id ? { ...entry, session: null, received: 0, state: "waiting", error: "" } : entry))} className="dark-chip px-2 py-1 text-xs">Restart</button>}<button type="button" aria-label={`Dismiss ${item.file.name}`} onClick={() => setQueue((items) => items.filter((entry) => entry.id !== item.id))} className="dark-chip p-1"><X size={14} /></button></div>}</div><progress aria-label={`Upload progress for ${item.file.name}`} value={item.received} max={item.file.size || 1} className="mt-1 h-2 w-full accent-[var(--ink-green)]" /><p role="status" aria-live="polite" data-feedback={item.error ? "error" : item.state === "complete" ? "success" : undefined} className="text-xs t-dark-muted">{item.state} · {Math.floor(item.received / Math.max(1, item.file.size) * 100)}%{item.error ? ` · ${item.error}` : ""}</p></div>)}</div><p className="mt-3 text-xs t-dark-muted">One upload at a time, up to 1 GB each. Keep this page open; files and resumable retry state stay in memory only.</p></section>}
    {dragging && connected && <div className="pointer-events-none absolute inset-0 z-40 grid place-content-center rounded-xl border-2 border-dashed border-[var(--ink-green)] bg-[var(--surface-dark)]/95 p-4 text-center"><FileUp size={36} className="mx-auto mb-3" /><p className="text-xl font-semibold">Drop files to upload</p><p className="mt-2 break-all text-sm">{destination.label}</p></div>}
    {newFolder && <WorkspaceDialog label="Create Drive folder" onClose={() => { if (!creating) setNewFolder(false); }}><form onSubmit={(event) => void createFolder(event)} className="dark-panel w-full max-w-md space-y-4 p-5"><h3 className="text-xl font-semibold t-dark">New folder</h3><p className="text-sm t-dark-muted">Inside {destination.label}</p><label className="block text-sm">Folder name<input autoFocus value={folderName} disabled={creating} onChange={(event) => { setFolderName(event.target.value); folderRequest.current = null; }} maxLength={255} className="dark-chip mt-2 w-full p-3" /></label>{folderError && <p role="alert" className="text-sm text-[var(--accent-peach)]">{folderError}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={creating} onClick={() => setNewFolder(false)} className="dark-chip px-3 py-2">Cancel</button><button type="submit" disabled={creating} className="ink-button primary px-3 py-2">{creating ? "Creating…" : "Create folder"}</button></div></form></WorkspaceDialog>}
  </section>;
}
