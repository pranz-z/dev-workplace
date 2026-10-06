"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Unlink } from "lucide-react";
import type { Project } from "@/types";
import { GithubProjectActivity } from "@/components/github/project-activity";
import { calculateProjectAccountability } from "@/data/accountabilityService";
import { ProjectAccountabilityCard } from "@/components/accountability/project-accountability-card";
import type { Milestone, Plan, Task } from "@/types";

interface Repository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  private: boolean;
  url: string;
  language: string | null;
  defaultBranch: string;
  updatedAt: string;
  installationRecordId: string;
  accountLogin: string;
  linkedProjectId: string | null;
}

type LinkedRepository = Omit<Repository, "installationRecordId" | "accountLogin" | "linkedProjectId" | "updatedAt"> & { projectId: string; updatedAt: string | null };

interface RepositoryBrowserProps {
  projects: Project[];
  projectId?: string;
  onLinked?: () => void;
  onClose?: () => void;
  tasks?: Task[];
  milestones?: Milestone[];
  plans?: Plan[];
  showAccountability?: boolean;
}

const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));

export function GithubRepositoryBrowser({ projects, projectId, onLinked, onClose, tasks = [], milestones = [], plans = [], showAccountability = false }: RepositoryBrowserProps) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [projectRepository, setProjectRepository] = useState<LinkedRepository | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<"all" | "public" | "private">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [attachProjectIds, setAttachProjectIds] = useState<Record<number, string>>({});
  const [repositoryErrors, setRepositoryErrors] = useState<Record<number, string>>({});

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      if (projectId) {
        const response = await fetch(`/api/github/link?projectId=${encodeURIComponent(projectId)}${force ? "&refresh=1" : ""}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Repository status could not be loaded.");
        setProjectRepository(data.repository);
        return;
      }
      const response = await fetch("/api/github/repositories", { cache: "no-store" });
      const data = await response.json();
      if (typeof data.connected === "boolean") setConnected(data.connected);
      if (!response.ok) throw new Error(data.error ?? "Repositories could not be loaded.");
      setRepositories(data.repositories ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Repositories could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const filtered = useMemo(() => repositories.filter((repository) => {
    const matchesQuery = `${repository.fullName} ${repository.description ?? ""} ${repository.language ?? ""}`.toLowerCase().includes(search.toLowerCase());
    const matchesVisibility = visibility === "all" || (visibility === "private") === repository.private;
    return matchesQuery && matchesVisibility;
  }), [repositories, search, visibility]);
  const selected = repositories.find((repository) => repository.id === selectedId) ?? null;
  const linkedForProject = projectRepository;
  const availableProjects = projects.filter((project) => !repositories.some((repository) => repository.linkedProjectId === project.id));

  const linkRepository = async (repository: Repository, mode: "import" | "attach", targetProjectId?: string) => {
    setBusy(true);
    setRepositoryErrors((current) => ({ ...current, [repository.id]: "" }));
    try {
      const response = await fetch("/api/github/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: repository.id, installationRecordId: repository.installationRecordId, mode, ...(targetProjectId ? { projectId: targetProjectId } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The repository could not be linked.");
      setRepositoryErrors((current) => {
        const next = { ...current };
        delete next[repository.id];
        return next;
      });
      await refresh();
      onLinked?.();
    } catch (cause) {
      setRepositoryErrors((current) => ({
        ...current,
        [repository.id]: cause instanceof Error ? cause.message : "The repository could not be linked.",
      }));
    } finally {
      setBusy(false);
    }
  };

  const unlinkProject = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/github/link?projectId=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The repository could not be unlinked.");
      await refresh();
      onLinked?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The repository could not be unlinked.");
    } finally {
      setBusy(false);
    }
  };

  if (projectId) {
    const project = projects.find((item) => item.id === projectId);
    const accountability = project ? calculateProjectAccountability({
      project,
      tasks,
      milestones,
      plans,
      github: { status: "not-connected" },
    }) : null;
    return <div className="notebook-dense space-y-4">
      {showAccountability && !loading && !linkedForProject && project && accountability && <ProjectAccountabilityCard projectName={project.name} result={accountability} />}
      <section className="dark-panel p-4" aria-label="GitHub repository">
      <div className="flex items-center justify-between gap-3">
        <div><p className="eyebrow t-dark-soft">GitHub repository</p><h3 className="mt-1 text-lg font-semibold t-dark">{linkedForProject?.fullName ?? "No repository linked"}</h3></div>
        {linkedForProject && <><button type="button" disabled={busy || loading} onClick={() => void refresh(true)} className="dark-chip inline-flex items-center gap-2 px-3 py-2 text-sm"><RefreshCw size={14} /> Refresh</button><button type="button" disabled={busy} onClick={() => void unlinkProject(projectId)} className="dark-chip inline-flex items-center gap-2 px-3 py-2 text-sm"><Unlink size={14} /> Unlink</button></>}
      </div>
      {error && <p role="status" className="mt-3 text-sm notebook-feedback-error">{error}</p>}
      {linkedForProject && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm t-dark-muted">
        <span>{linkedForProject.private ? "Private" : "Public"}</span><span>{linkedForProject.language ?? "Language not specified"}</span><span>Default branch: {linkedForProject.defaultBranch}</span><span>Updated {linkedForProject.updatedAt ? dateLabel(linkedForProject.updatedAt) : "unknown"}</span>
        <a href={linkedForProject.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--ink-coral)]">Open GitHub <ExternalLink size={13} /></a>
      </div>}
      {!linkedForProject && error && <button type="button" onClick={() => void refresh()} className="mt-2 text-sm text-[var(--ink-coral)]">Refresh repository status</button>}
      </section>
      {linkedForProject && project && <GithubProjectActivity key={projectId} projectId={projectId} project={project} tasks={tasks} milestones={milestones} plans={plans} showAccountability={showAccountability} />}
    </div>;
  }

  return <div className="notebook-dense space-y-5">
    <div className="dark-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow t-mood">GitHub App</p><h2 className="mt-2 text-2xl font-semibold t-dark">Repository access</h2><p className="mt-1 text-sm t-dark-muted">{connected ? "Connected repositories authorized for this workspace." : "Repository access is separate from GitHub sign in."}</p></div>
        <div className="flex gap-2">
          {connected && <button type="button" onClick={() => void refresh()} disabled={loading} className="dark-chip inline-flex items-center gap-2 px-3 py-2 text-sm"><RefreshCw size={14} /> Refresh</button>}
          {!connected && <a href="/api/github/connect" className="ink-button coral rounded-xl px-3 py-2 text-sm">Connect GitHub</a>}
          {onClose && <button type="button" onClick={onClose} className="dark-chip px-3 py-2 text-sm">Close</button>}
        </div>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg notebook-feedback-error p-3 text-sm">{error}</p>}
    </div>

    {connected && <>
      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search repositories" className="min-w-56 flex-1 dark-chip px-3 py-2 text-sm" aria-label="Search repositories" />
        <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} className="dark-chip px-3 py-2 text-sm" aria-label="Filter repository visibility"><option value="all">All repositories</option><option value="public">Public</option><option value="private">Private</option></select>
      </div>
      {loading ? <p className="dark-panel p-4 text-sm t-dark-muted">Loading authorized repositories…</p> : filtered.length === 0 ? <p className="dark-panel p-4 text-sm t-dark-muted">{repositories.length ? "No repositories match this search." : "This GitHub installation has no accessible repositories."}</p> :
        <div className="grid gap-4 xl:grid-cols-2">{filtered.map((repository) => <article key={`${repository.installationRecordId}:${repository.id}`} className={`dark-panel p-4 ${selectedId === repository.id ? "ring-1 ring-[var(--ink-coral)]" : ""}`}>
          <button type="button" onClick={() => setSelectedId(repository.id)} className="block w-full text-left">
            <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold t-dark">{repository.fullName}</h3><p className="mt-1 text-sm t-dark-muted">{repository.description || "No description"}</p></div><span className="dark-chip shrink-0 px-2 py-1 text-xs">{repository.private ? "Private" : "Public"}</span></div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs t-dark-muted"><span>{repository.language ?? "Language not specified"}</span><span>{repository.defaultBranch}</span><span>Updated {dateLabel(repository.updatedAt)}</span><span>Owner: {repository.owner}</span></div>
          </button>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {repository.linkedProjectId ? <span className="dark-chip px-2 py-1 text-xs">Already linked{projects.find((project) => project.id === repository.linkedProjectId) ? `: ${projects.find((project) => project.id === repository.linkedProjectId)?.name}` : ""}</span> : <>
              <button type="button" disabled={busy} onClick={() => void linkRepository(repository, "import")} className="ink-button primary rounded-xl px-3 py-2 text-sm">Import as project</button>
              {availableProjects.length > 0 && <><select value={attachProjectIds[repository.id] ?? ""} onChange={(event) => setAttachProjectIds((current) => ({ ...current, [repository.id]: event.target.value }))} className="dark-chip min-w-40 px-2 py-2 text-sm" aria-label={`Project to attach ${repository.fullName}`}><option value="">Choose project…</option>{availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button type="button" disabled={busy || !attachProjectIds[repository.id]} onClick={() => void linkRepository(repository, "attach", attachProjectIds[repository.id])} className="dark-chip px-3 py-2 text-sm">Attach</button></>}
            </>}
            <a href={repository.url} target="_blank" rel="noopener noreferrer" className="dark-chip inline-flex items-center gap-1 px-3 py-2 text-sm">Preview <ExternalLink size={13} /></a>
          </div>
          {repositoryErrors[repository.id] && <p role="alert" className="mt-3 text-sm notebook-feedback-error">{repositoryErrors[repository.id]}</p>}
          {selected?.id === repository.id && <div className="mt-3 rounded-xl bg-black/10 p-3 text-sm t-dark-muted"><p className="font-medium t-dark">Repository preview</p><p className="mt-1">{repository.description || "No description provided by GitHub."}</p><p className="mt-2">{repository.private ? "Private repository" : "Public repository"} · {repository.language ?? "Primary language not specified"} · default branch {repository.defaultBranch} · updated {dateLabel(repository.updatedAt)}</p></div>}
        </article>)}</div>}
    </>}
  </div>;
}
