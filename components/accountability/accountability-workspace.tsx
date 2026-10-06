"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { buildPeriodReport, calculateGoalProgress, getMonthPeriod, getWeekPeriod, isValidTimeZone, localDateAt, type GithubReportSummary } from "@/data/accountabilityReports";
import { captureDailyAccountabilitySnapshots, deleteAccountabilityGoal, getProfileTimeZone, listAccountabilityData, saveAccountabilityGoal, saveTimeZone, setAccountabilityGoalStatus, type GoalDraft } from "@/data/accountabilityDataService";
import { calculateProjectAccountability } from "@/data/accountabilityService";
import { listLinkedGithubProjectIds } from "@/data/githubRepositoryLinkService";
import type { Project, Task, Milestone, Plan } from "@/types";
import type { AccountabilityGoalRow, AccountabilitySnapshotRow } from "@/data/database.types";

type Props = { projects: Project[]; tasks: Task[]; milestones: Milestone[]; plans: Plan[]; selectedTab?: Tab; onTabChange?: (tab: Tab) => void };
type Tab = "Overview" | "Goals" | "Weekly" | "Monthly";

const dateNow = () => new Date().toISOString().slice(0, 10);

export function AccountabilityWorkspace({ projects, tasks, milestones, plans, selectedTab, onTabChange }: Props) {
  const [localTab, setLocalTab] = useState<Tab>("Overview");
  const tab = selectedTab ?? localTab;
  const changeTab = onTabChange ?? setLocalTab;
  const [timeZone, setTimeZone] = useState("");
  const [goals, setGoals] = useState<AccountabilityGoalRow[]>([]);
  const [snapshots, setSnapshots] = useState<AccountabilitySnapshotRow[]>([]);
  const [githubReports, setGithubReports] = useState<GithubReportSummary[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const githubCache = useRef(new Map<string, GithubReportSummary>());
  const [monthOffset, setMonthOffset] = useState(0);
  const [editing, setEditing] = useState<AccountabilityGoalRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", project_id: "", metric: "tasks_completed" as GoalDraft["metric"], target: "4", period_start: dateNow(), period_end: dateNow(), manual_progress: "0" });

  const persistTimeZone = (value: string) => {
    void saveTimeZone(value).then((saved) => { if (!saved) setError("Timezone preference could not be saved."); });
  };

  const refresh = useCallback(async () => {
    try {
      const data = await listAccountabilityData();
      setGoals(data.goals); setSnapshots(data.snapshots); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Accountability data could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  useEffect(() => {
    let active = true;
    void getProfileTimeZone().then((saved) => {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const candidate = isValidTimeZone(saved) ? saved : detected;
      if (!active || !isValidTimeZone(candidate)) return;
      setTimeZone(candidate);
      if (!saved) persistTimeZone(candidate);
    }).catch(() => {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (active && isValidTimeZone(detected)) setTimeZone(detected);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!timeZone || loading) return;
    let cancelled = false;
    void (async () => {
      try {
        const today = localDateAt(new Date(), timeZone);
        const dailySnapshots = projects.map((project) => {
          const result = calculateProjectAccountability({ project, tasks, milestones, plans, github: project.health.github ? { status: "unavailable" } : { status: "not-connected" } });
          return { project_id: project.id, snapshot_date: today, captured_at: new Date().toISOString(), score: result.score, health: result.health, factors: result.factors.map(({ key, score, available }) => ({ key, score, available })), github_status: result.githubStatus === "loading" ? "unavailable" as const : result.githubStatus, model_version: 1 };
        });
        if (!cancelled) await captureDailyAccountabilitySnapshots(dailySnapshots);
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "Today's accountability snapshot could not be saved."); }
    })();
    return () => { cancelled = true; };
  }, [timeZone, loading, projects, tasks, milestones, plans]);

  const monthlyPeriod = useMemo(() => timeZone ? getMonthPeriod(new Date(), timeZone, monthOffset) : null, [timeZone, monthOffset]);
  const requestRange = useMemo(() => {
    if (!timeZone || !monthlyPeriod) return null;
    const week = getWeekPeriod(new Date(), timeZone);
    const today = localDateAt(new Date(), timeZone);
    const selectedOffset = tab === "Monthly" ? monthOffset : 0;
    const selectedMonth = getMonthPeriod(new Date(), timeZone, selectedOffset);
    const start = selectedOffset === 0 ? (week.start < selectedMonth.start ? week.start : selectedMonth.start) : selectedMonth.start;
    const end = selectedOffset === 0 ? today : (selectedMonth.end < today ? selectedMonth.end : today);
    return { start, end };
  }, [timeZone, monthlyPeriod, monthOffset, tab]);

  useEffect(() => {
    if (!timeZone || !requestRange || loading || !(tab === "Weekly" || tab === "Monthly")) return;
    let cancelled = false;
    void (async () => {
      try {
        const linkedIds = await listLinkedGithubProjectIds();
        const linked = projects.filter((project) => linkedIds.includes(project.id) && !["IDEA", "PLANNING", "RESEARCH", "COMPLETED", "BLOCKED", "ON_HOLD", "CANCELLED"].includes(project.currentPhase) && !["Completed", "Blocked", "On Hold", "Cancelled"].includes(project.status));
        const cachePrefix = `${requestRange.start}:${requestRange.end}:${timeZone}:`;
        if (!cancelled) setGithubLoading(linked.length > 0);
        const results: GithubReportSummary[] = [];
        let next = 0;
        const worker = async () => {
          while (next < linked.length) {
            const project = linked[next++];
            const cached = githubCache.current.get(`${cachePrefix}${project.id}`);
            if (cached) { results.push(cached); continue; }
            try {
              const query = new URLSearchParams({ report: "1", since: requestRange.start, until: requestRange.end, timeZone });
              const response = await fetch(`/api/github/projects/${encodeURIComponent(project.id)}/activity?${query}`, { cache: "no-store" });
              if (!response.ok) throw new Error("GitHub report activity is unavailable.");
              const data = await response.json() as Omit<GithubReportSummary, "projectId" | "status">;
              const summary = { projectId: project.id, status: "available" as const, ...data };
              results.push(summary);
            } catch {
              const summary = { projectId: project.id, status: "unavailable" as const, activityDays: [], pullRequestDays: [], issueDays: [], releaseDays: [], complete: false };
              githubCache.current.set(`${cachePrefix}${project.id}`, summary); results.push(summary);
            }
          }
        };
        await Promise.all([worker(), worker()]);
        if (!cancelled) { setGithubReports(results); setGithubLoading(false); }
      } catch {
        if (!cancelled) { setGithubReports([]); setGithubLoading(false); setError("GitHub report activity could not be checked."); }
      }
    })();
    return () => { cancelled = true; };
  }, [timeZone, requestRange, loading, tab, projects]);

  const weekly = useMemo(() => timeZone ? buildPeriodReport(getWeekPeriod(new Date(), timeZone), timeZone, projects, tasks, milestones, plans, goals, snapshots, new Date(), githubReports) : null, [timeZone, projects, tasks, milestones, plans, goals, snapshots, githubReports]);
  const monthly = useMemo(() => timeZone && monthlyPeriod ? buildPeriodReport(monthlyPeriod, timeZone, projects, tasks, milestones, plans, goals, snapshots, new Date(), githubReports) : null, [timeZone, monthlyPeriod, projects, tasks, milestones, plans, goals, snapshots, githubReports]);

  const beginEdit = (goal?: AccountabilityGoalRow) => {
    setEditing(goal ?? null); setFormOpen(true);
    const today = timeZone ? localDateAt(new Date(), timeZone) : dateNow();
    setForm(goal ? { title: goal.title, description: goal.description ?? "", project_id: goal.project_id ?? "", metric: goal.metric, target: String(goal.target), period_start: goal.period_start, period_end: goal.period_end, manual_progress: String(goal.manual_progress) } : { title: "", description: "", project_id: "", metric: "tasks_completed", target: "4", period_start: today, period_end: today, manual_progress: "0" });
  };
  const submitGoal = async (event: FormEvent) => {
    event.preventDefault(); if (saveLock.current) return;
    saveLock.current = true; setSaving(true); setError("");
    try {
      const draft: GoalDraft = { title: form.title, description: form.description || null, project_id: form.project_id || null, metric: form.metric, target: Number(form.target), period_start: form.period_start, period_end: form.period_end, manual_progress: Number(form.manual_progress) };
      const result = await saveAccountabilityGoal(draft, editing?.id);
      if (!result.ok) { setError(result.error); return; }
      setEditing(null); setFormOpen(false); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Goal could not be saved."); }
    finally { saveLock.current = false; setSaving(false); }
  };
  const statusAction = async (goal: AccountabilityGoalRow, status: AccountabilityGoalRow["status"]) => {
    const result = await setAccountabilityGoalStatus(goal.id, status); if (!result.ok) setError(result.error); else await refresh();
  };
  const report = tab === "Monthly" ? monthly : weekly;

  return <div className="notebook-dense space-y-5">
    <section className="dark-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow t-mood">Private workspace</p><h1 className="mt-1 text-2xl font-semibold t-dark">Accountability</h1><p className="mt-1 text-sm t-dark-muted">Factual project progress, personal goals, and reports.</p></div><label className="text-xs t-dark-muted">Report timezone <input list="accountability-timezones" className="dark-chip ml-2 px-2 py-1" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} onBlur={() => { if (isValidTimeZone(timeZone)) persistTimeZone(timeZone); else setError("Enter a valid IANA timezone, such as Europe/Paris."); }} /><datalist id="accountability-timezones">{["America/Los_Angeles","America/New_York","Europe/London","Europe/Berlin","Asia/Manila","Asia/Tokyo","Australia/Sydney"].map((zone) => <option key={zone} value={zone} />)}</datalist></label></div>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Accountability sections">{(["Overview","Goals","Weekly","Monthly"] as const).map((item) => <button key={item} type="button" aria-pressed={tab === item} onClick={() => changeTab(item)} className={`dark-chip px-3 py-1.5 text-sm ${tab === item ? "ring-1 ring-[var(--accent-lavender)]" : ""}`}>{item}</button>)}</nav>
    </section>
    {error && <p role="alert" className="dark-panel p-3 text-sm text-[var(--accent-peach)]">{error}</p>}
    {loading && <p className="dark-panel p-4 text-sm t-dark-muted">Loading private accountability data…</p>}
    {!loading && tab === "Overview" && <div className="grid gap-4 md:grid-cols-2"><section className="dark-panel p-4"><h2 className="font-semibold t-dark">This week</h2><p className="mt-2 text-sm t-dark-muted">{weekly?.completedTasks ?? 0} tasks completed · {weekly?.completedMilestones ?? 0} milestones completed · {weekly?.completedPlanItems ?? 0} checklist items completed</p><p className="mt-2 text-sm t-dark-muted">{weekly?.goals.length ?? 0} active goals · {weekly?.projectsNeedingAttention.length ?? 0} projects needing attention</p><button onClick={() => changeTab("Weekly")} className="mt-3 dark-chip px-3 py-1.5 text-sm">Open weekly report</button></section><section className="dark-panel p-4"><h2 className="font-semibold t-dark">History</h2><p className="mt-2 text-sm t-dark-muted">{snapshots.length} daily project snapshots. One saved per project per local calendar day. Score model v1.</p><p className="mt-2 text-sm t-dark-muted">{timeZone || "Timezone unavailable"}</p><button onClick={() => changeTab("Monthly")} className="mt-3 dark-chip px-3 py-1.5 text-sm">Open monthly report</button></section><section className="dark-panel p-4 md:col-span-2"><h2 className="font-semibold t-dark">Current project health</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{projects.map((project) => { const result = calculateProjectAccountability({ project, tasks, milestones, plans, github: project.health.github ? { status: "unavailable" } : { status: "not-connected" } }); return <p key={project.id} className="dark-inset flex justify-between gap-3 p-3 text-sm t-dark"><span>{project.name}</span><span>{result.score === null ? result.health : `${result.score} · ${result.health}`}</span></p>; })}</div></section></div>}
    {!loading && tab === "Goals" && <section className="dark-panel p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-semibold t-dark">Goals</h2><p className="text-sm t-dark-muted">Measure tasks, milestones, checklist outcomes, or explicitly manual progress.</p></div><button type="button" onClick={() => beginEdit()} className="ink-button primary px-3 py-2 text-sm">New goal</button></div>
      {formOpen ? <form onSubmit={submitGoal} className="mt-4 grid gap-3 rounded-xl border border-[var(--edge-dark)] p-3 md:grid-cols-2"><label className="text-sm t-dark-muted">Title<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="dark-chip mt-1 w-full px-3 py-2" /></label><label className="text-sm t-dark-muted">Project scope<select value={form.project_id} onChange={(event) => setForm({ ...form, project_id: event.target.value })} className="dark-chip mt-1 w-full px-3 py-2"><option value="">Entire workspace</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="text-sm t-dark-muted">Measure<select value={form.metric} onChange={(event) => setForm({ ...form, metric: event.target.value as GoalDraft["metric"] })} className="dark-chip mt-1 w-full px-3 py-2"><option value="tasks_completed">Tasks completed</option><option value="milestones_completed">Milestones completed</option><option value="plan_items_completed">Checklist items completed</option><option value="manual">Manual goal progress</option></select></label><label className="text-sm t-dark-muted">Target<input type="number" min="1" max="10000" required value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} className="dark-chip mt-1 w-full px-3 py-2" /></label><label className="text-sm t-dark-muted">Start<input type="date" required value={form.period_start} onChange={(event) => setForm({ ...form, period_start: event.target.value })} className="dark-chip mt-1 w-full px-3 py-2" /></label><label className="text-sm t-dark-muted">End<input type="date" min={form.period_start} required value={form.period_end} onChange={(event) => setForm({ ...form, period_end: event.target.value })} className="dark-chip mt-1 w-full px-3 py-2" /></label><label className="text-sm t-dark-muted md:col-span-2">Description (optional)<input maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="dark-chip mt-1 w-full px-3 py-2" /></label>{form.metric === "manual" && <label className="text-sm t-dark-muted">Current manual progress<input type="number" min="0" max="10000" value={form.manual_progress} onChange={(event) => setForm({ ...form, manual_progress: event.target.value })} className="dark-chip mt-1 w-full px-3 py-2" /></label>}<div className="flex gap-2 md:col-span-2"><button disabled={saving} className="ink-button primary px-3 py-2 text-sm">{saving ? "Saving…" : editing ? "Save goal" : "Create goal"}</button><button type="button" onClick={() => { setEditing(null); setFormOpen(false); }} className="dark-chip px-3 py-2 text-sm">Cancel</button></div></form> : null}
      <div className="mt-4 space-y-3">{goals.map((goal) => { const value = calculateGoalProgress(goal, tasks, milestones, plans, timeZone).progress; return <article key={goal.id} className="dark-inset p-3"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-medium t-dark">{goal.title}</h3><p className="text-xs t-dark-muted">{goal.metric.replaceAll("_", " ")} · {goal.period_start} to {goal.period_end} · {goal.project_id ? projects.find((p) => p.id === goal.project_id)?.name ?? "Project" : "Workspace"}</p></div><span className="text-sm t-dark">{value} / {goal.target}{value > goal.target ? " · target exceeded" : ""}</span></div><div className="mt-2 h-2 overflow-hidden rounded bg-black/20"><div className="h-full bg-[var(--accent-lavender)]" style={{ width: `${Math.min(100, value / goal.target * 100)}%` }} /></div><div className="mt-3 flex flex-wrap gap-2 text-xs"><button onClick={() => beginEdit(goal)} className="dark-chip px-2 py-1">Edit</button>{goal.status === "active" && <><button onClick={() => void statusAction(goal,"completed")} className="dark-chip px-2 py-1">Complete</button><button onClick={() => void statusAction(goal,"closed")} className="dark-chip px-2 py-1">Close</button></>}{goal.status !== "active" && <button onClick={() => void statusAction(goal,"active")} className="dark-chip px-2 py-1">Reopen</button>}<button onClick={async () => { if (window.confirm("Delete this goal?")) { const result = await deleteAccountabilityGoal(goal.id); if (!result.ok) setError(result.error); else await refresh(); } }} className="dark-chip px-2 py-1">Delete</button><span className="self-center t-dark-muted">{goal.status}</span></div></article>; })}{goals.length === 0 && <p className="text-sm t-dark-muted">No goals yet.</p>}</div>
    </section>}
    {!loading && (tab === "Weekly" || tab === "Monthly") && report && <section className="dark-panel p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow t-mood">{tab === "Weekly" ? "Monday–Sunday report" : "Calendar month report"}</p><h2 className="mt-1 text-xl font-semibold t-dark">{tab === "Monthly" ? monthlyPeriod?.label : `${reportPeriodLabel(weekly?.snapshots ?? [], timeZone)}`}</h2></div>{tab === "Monthly" && <div className="flex gap-2"><button disabled={monthOffset <= -24} onClick={() => setMonthOffset((value) => value - 1)} className="dark-chip px-3 py-1.5 text-sm">Earlier</button><button disabled={monthOffset >= 0} onClick={() => setMonthOffset((value) => value + 1)} className="dark-chip px-3 py-1.5 text-sm">Later</button></div>}</div>
      <p className="mt-3 text-sm t-dark-muted">{report.hasHistory ? `${report.snapshots.length} project snapshots recorded in this period.` : "No accountability history is available for this period."} Trend: {report.trend.state}{report.trend.change === null ? "" : ` (${report.trend.change > 0 ? "+" : ""}${report.trend.change} points)`}.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Tasks completed",report.completedTasks],["Milestones completed",`${report.completedMilestones}/${report.movedMilestones}`],["Checklist items completed",report.completedPlanItems],["Currently overdue tasks",report.overdueTasks]].map(([label,value])=><div key={label} className="dark-inset p-3"><p className="text-xs t-dark-muted">{label}</p><p className="mt-1 text-xl font-semibold t-dark">{value}</p></div>)}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-2"><div><h3 className="font-medium t-dark">Goals</h3>{report.goals.length ? report.goals.map(({ goal, progress }) => <p key={goal.id} className="mt-2 text-sm t-dark-muted">{goal.title}: {progress} / {goal.target}{progress > goal.target ? " (target exceeded)" : ""}</p>) : <p className="mt-2 text-sm t-dark-muted">No active goals overlap this period.</p>}</div><div><h3 className="font-medium t-dark">Needs attention</h3>{report.projectsNeedingAttention.length ? report.projectsNeedingAttention.map((project) => { const blocked = tasks.filter((task) => task.projectId === project.id && task.status === "Blocked").length; return <p key={project.id} className="mt-2 text-sm t-dark-muted">{project.name}: {project.status === "Blocked" ? "blocked" : `${blocked ? `${blocked} blocked task(s); ` : ""}has overdue work`}</p>; }) : <p className="mt-2 text-sm t-dark-muted">No blocked projects or overdue tasks.</p>}</div><div><h3 className="font-medium t-dark">Factual wins</h3>{report.factualWins.length ? report.factualWins.slice(0, 6).map((win) => <p key={win} className="mt-2 text-sm t-dark-muted">{win}</p>) : <p className="mt-2 text-sm t-dark-muted">No completed outcome was recorded in this period.</p>}</div></div><div className="mt-4 dark-inset p-3"><h3 className="font-medium t-dark">Repository activity</h3>{githubLoading && <p className="mt-1 text-sm t-dark-muted">Loading authorized repository summaries…</p>}<p className="mt-1 text-sm t-dark-muted">{report.github.activityDays} meaningful activity days · {report.github.pullRequests} pull requests · {report.github.issues} issues · {report.github.releases} releases</p>{report.github.unavailable > 0 && <p className="mt-1 text-xs t-dark-muted">Repository activity was unavailable for {report.github.unavailable} linked project(s); those sources are not treated as zero.</p>}{report.github.partial && <p className="mt-1 text-xs t-dark-muted">GitHub results reached the bounded pagination limit, so counts may be incomplete.</p>}</div></section>}
  </div>;
}

function reportPeriodLabel(_snapshots: AccountabilitySnapshotRow[], timeZone: string) {
  const period = getWeekPeriod(new Date(), timeZone);
  return `${period.start} – ${period.end}`;
}
