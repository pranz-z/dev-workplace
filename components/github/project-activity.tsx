"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { GithubRepositoryActivity } from "@/data/githubActivityTypes";
import { calculateProjectAccountability } from "@/data/accountabilityService";
import { ProjectAccountabilityCard } from "@/components/accountability/project-accountability-card";
import type { Milestone, Plan, Project, Task } from "@/types";

interface GithubProjectActivityProps {
  projectId: string;
  project: Project;
  tasks: Task[];
  milestones: Milestone[];
  plans: Plan[];
  showAccountability: boolean;
}

const displayDate = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Not available";

function ActivityLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--ink-coral)] hover:underline">
    {children}<ExternalLink size={12} />
  </a>;
}

export function GithubProjectActivity({ projectId, project, tasks, milestones, plans, showAccountability }: GithubProjectActivityProps) {
  const [activity, setActivity] = useState<GithubRepositoryActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestInFlight = useRef(false);

  const loadActivity = useCallback(async (refresh = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setActivity(null);
    setLoading(true);
    setError("");
    try {
      const suffix = refresh ? "?refresh=1" : "";
      const response = await fetch(`/api/github/projects/${encodeURIComponent(projectId)}/activity${suffix}`, { cache: "no-store" });
      const result = await response.json() as GithubRepositoryActivity | { error?: string };
      if (!response.ok) throw new Error("error" in result ? result.error ?? "GitHub activity could not be loaded." : "GitHub activity could not be loaded.");
      setActivity(result as GithubRepositoryActivity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "GitHub activity could not be loaded.");
    } finally {
      setLoading(false);
      requestInFlight.current = false;
    }
  }, [projectId]);

  const accountability = calculateProjectAccountability({
    project,
    tasks,
    milestones,
    plans,
    github: activity ? { status: "available", activity } : { status: loading ? "loading" : "unavailable" },
  });

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadActivity(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadActivity]);

  return <div className="space-y-4">
    {showAccountability && <ProjectAccountabilityCard projectName={project.name} result={accountability} />}
    <section className="dark-panel p-4 md:p-5" aria-label="GitHub activity">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="eyebrow t-dark-soft">Connected repository</p>
        <h3 className="mt-1 text-lg font-semibold t-dark">GitHub activity</h3>
        {activity && <p className="mt-1 text-sm t-dark-muted">{activity.repository.fullName}{activity.repository.archived ? " · Archived" : ""}</p>}
      </div>
      <button type="button" onClick={() => void loadActivity(true)} disabled={loading} className="dark-chip inline-flex items-center gap-2 px-3 py-2 text-sm">
        <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh activity
      </button>
    </div>

    {error && <p role="alert" className="mt-4 rounded-lg bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
    {loading && !activity && <p role="status" className="mt-4 text-sm t-dark-muted">Loading recent repository activity…</p>}
    {!loading && activity && <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="dark-inset p-3"><p className="text-xs t-dark-muted">Last activity</p><p className="mt-1 text-sm font-medium t-dark">{displayDate(activity.summary.lastActivityAt)}</p></div>
        <div className="dark-inset p-3"><p className="text-xs t-dark-muted">Recent commits</p><p className="mt-1 text-sm font-medium t-dark">{activity.summary.recentCommitCount}</p></div>
        <div className="dark-inset p-3"><p className="text-xs t-dark-muted">Recent pull requests</p><p className="mt-1 text-sm font-medium t-dark">{activity.summary.recentPullRequestCount}</p></div>
        <div className="dark-inset p-3"><p className="text-xs t-dark-muted">Recent issues</p><p className="mt-1 text-sm font-medium t-dark">{activity.summary.recentIssueCount}</p></div>
      </div>
      <p className="mt-2 text-xs t-dark-muted">Repository updated {displayDate(activity.repository.updatedAt)} · fetched {displayDate(activity.fetchedAt)}</p>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <ActivityGroup title="Recent commits" empty="No commits visible on the default branch yet.">
          {activity.commits.map((commit) => <div key={commit.sha} className="dark-inset flex items-start justify-between gap-3 p-3">
            <div className="min-w-0"><ActivityLink href={commit.url}><span className="line-clamp-2 text-sm font-medium">{commit.title}</span></ActivityLink><p className="mt-1 text-xs t-dark-muted">{commit.author ?? "Unknown author"} · {commit.shortSha} · {displayDate(commit.occurredAt)}</p></div>
          </div>)}
        </ActivityGroup>

        <ActivityGroup title="Recent pull requests" empty="No pull requests yet.">
          {activity.pullRequests.map((pull) => <div key={pull.number} className="dark-inset p-3">
            <ActivityLink href={pull.url}><span className="text-sm font-medium">#{pull.number} {pull.title}</span></ActivityLink>
            <p className="mt-1 text-xs capitalize t-dark-muted">{pull.state}{pull.draft ? " · draft" : ""} · {pull.author ?? "Unknown author"} · updated {displayDate(pull.mergedAt ?? pull.updatedAt)}</p>
          </div>)}
        </ActivityGroup>

        <ActivityGroup title="Recent issues" empty="No issues yet.">
          {activity.issues.map((issue) => <div key={issue.number} className="dark-inset p-3">
            <ActivityLink href={issue.url}><span className="text-sm font-medium">#{issue.number} {issue.title}</span></ActivityLink>
            <p className="mt-1 text-xs capitalize t-dark-muted">{issue.state} · {issue.author ?? "Unknown author"} · updated {displayDate(issue.updatedAt)}</p>
          </div>)}
        </ActivityGroup>

        <ActivityGroup title="Recent releases" empty="No releases yet.">
          {activity.releases.map((release) => <div key={release.tagName} className="dark-inset p-3">
            <ActivityLink href={release.url}><span className="text-sm font-medium">{release.name || release.tagName}</span></ActivityLink>
            <p className="mt-1 text-xs t-dark-muted">{release.tagName}{release.prerelease ? " · prerelease" : ""}{release.draft ? " · draft" : ""} · {displayDate(release.publishedAt)}</p>
          </div>)}
        </ActivityGroup>
      </div>
    </>}
    {!loading && !activity && !error && <p role="status" className="mt-4 text-sm t-dark-muted">Repository activity is not available yet.</p>}
    </section>
  </div>;
}

function ActivityGroup({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return <div className="space-y-2">
    <h4 className="text-sm font-semibold t-dark">{title}</h4>
    {items.length ? items : <p className="dark-inset p-3 text-sm t-dark-muted">{empty}</p>}
  </div>;
}
