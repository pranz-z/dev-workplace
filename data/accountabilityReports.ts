import type { AccountabilityGoalRow, AccountabilitySnapshotRow } from "@/data/database.types";
import type { Milestone, Plan, Project, Task } from "@/types";

export interface ReportPeriod { start: string; end: string; label: string }
export interface GoalProgress { goal: AccountabilityGoalRow; progress: number; percentage: number }
export interface GithubReportSummary { projectId: string; status: "available" | "unavailable"; activityDays: string[]; pullRequestDays: string[]; issueDays: string[]; releaseDays: string[]; complete: boolean }

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone || timeZone.length > 100) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); return true; } catch { return false; }
}

export function localDateAt(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const parseDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

export function getWeekPeriod(now: Date, timeZone: string): ReportPeriod {
  const today = parseDate(localDateAt(now, timeZone));
  const offset = (today.getUTCDay() + 6) % 7;
  today.setUTCDate(today.getUTCDate() - offset);
  const end = new Date(today); end.setUTCDate(end.getUTCDate() + 6);
  return { start: dateOnly(today), end: dateOnly(end), label: `${dateOnly(today)} – ${dateOnly(end)}` };
}

export function getMonthPeriod(now: Date, timeZone: string, monthOffset = 0): ReportPeriod {
  const current = parseDate(localDateAt(now, timeZone));
  const first = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + monthOffset, 1));
  const end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { start: dateOnly(first), end: dateOnly(end), label: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(first) };
}

export function getSnapshotTrend(snapshots: AccountabilitySnapshotRow[], periodStart: string, periodEnd: string) {
  const points = snapshots.filter((item) => item.snapshot_date >= periodStart && item.snapshot_date <= periodEnd && item.score !== null && item.model_version === 1)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const byDay = new Map<string, number[]>();
  for (const point of points) byDay.set(point.snapshot_date, [...(byDay.get(point.snapshot_date) ?? []), point.score!]);
  const dailyAverages = [...byDay.values()].map((scores) => scores.reduce((sum, score) => sum + score, 0) / scores.length);
  if (dailyAverages.length < 3) return { state: "Insufficient history" as const, change: null, count: dailyAverages.length };
  const change = dailyAverages[dailyAverages.length - 1] - dailyAverages[0];
  return { state: change >= 5 ? "Improving" as const : change <= -5 ? "Declining" as const : "Stable" as const, change: Math.round(change), count: dailyAverages.length };
}

const within = (timestamp: string | undefined | null, period: ReportPeriod, timeZone: string) => Boolean(timestamp && localDateAt(new Date(timestamp), timeZone) >= period.start && localDateAt(new Date(timestamp), timeZone) <= period.end);

export function calculateGoalProgress(goal: AccountabilityGoalRow, tasks: Task[], milestones: Milestone[], plans: Plan[], timeZone: string): GoalProgress {
  if (goal.metric === "manual") return { goal, progress: goal.manual_progress, percentage: Math.min(100, goal.manual_progress / goal.target * 100) };
  const projectOk = (projectId: string) => goal.project_id === null || goal.project_id === projectId;
  let progress = 0;
  if (goal.metric === "tasks_completed") progress = tasks.filter((task) => projectOk(task.projectId) && task.status === "Completed" && within(task.completedAt, { start: goal.period_start, end: goal.period_end, label: "" }, timeZone)).length;
  if (goal.metric === "milestones_completed") progress = milestones.filter((item) => projectOk(item.projectId) && item.status === "completed" && within(item.lastUpdated, { start: goal.period_start, end: goal.period_end, label: "" }, timeZone)).length;
  if (goal.metric === "plan_items_completed") {
    const taskProject = new Map(tasks.map((task) => [task.id, task.projectId]));
    progress = plans.flatMap((plan) => plan.items ?? []).filter((item) => item.done && (!goal.project_id || item.projectId === goal.project_id || Boolean(item.taskId && taskProject.get(item.taskId) === goal.project_id)) && within(item.updatedAt, { start: goal.period_start, end: goal.period_end, label: "" }, timeZone)).length;
  }
  return { goal, progress, percentage: Math.min(100, progress / goal.target * 100) };
}

export function buildPeriodReport(period: ReportPeriod, timeZone: string, projects: Project[], tasks: Task[], milestones: Milestone[], plans: Plan[], goals: AccountabilityGoalRow[], snapshots: AccountabilitySnapshotRow[], now = new Date(), github: GithubReportSummary[] = []) {
  const inPeriod = (value?: string | null) => within(value, period, timeZone);
  const completedTasks = tasks.filter((task) => task.status === "Completed" && inPeriod(task.completedAt));
  const movedMilestones = milestones.filter((item) => inPeriod(item.lastUpdated));
  const completedMilestones = movedMilestones.filter((item) => item.status === "completed");
  const planItems = plans.flatMap((plan) => plan.items ?? []);
  const completedPlanItems = planItems.filter((item) => item.done && inPeriod(item.updatedAt));
  const projectStatus = new Map(projects.map((project) => [project.id, project.status]));
  const overdueTasks = tasks.filter((task) => task.status !== "Completed" && task.status !== "Blocked" && !["Completed", "On Hold", "Cancelled"].includes(projectStatus.get(task.projectId) ?? "") && task.dueDate && task.dueDate < localDateAt(now, timeZone));
  const snapshotPeriod = snapshots.filter((item) => item.snapshot_date >= period.start && item.snapshot_date <= period.end);
  const githubPeriod = github.map((item) => ({ ...item, activityDays: item.activityDays.filter((day) => day >= period.start && day <= period.end), pullRequestDays: item.pullRequestDays.filter((day) => day >= period.start && day <= period.end), issueDays: item.issueDays.filter((day) => day >= period.start && day <= period.end), releaseDays: item.releaseDays.filter((day) => day >= period.start && day <= period.end) }));
  const healthAttention = projects.filter((project) => !["Completed", "Cancelled", "On Hold"].includes(project.status) && (project.status === "Blocked" || overdueTasks.some((task) => task.projectId === project.id) || tasks.some((task) => task.projectId === project.id && task.status === "Blocked")));
  return {
    completedTasks: completedTasks.length, movedMilestones: movedMilestones.length, completedMilestones: completedMilestones.length,
    completedPlanItems: completedPlanItems.length, overdueTasks: overdueTasks.length,
    factualWins: [...completedTasks.map((task) => `Task completed: ${task.title}`), ...completedMilestones.map((item) => `Milestone completed: ${item.title}`), ...completedPlanItems.map((item) => `Checklist item completed: ${item.label}`)],
    goals: goals.filter((goal) => goal.status === "active" && goal.period_start <= period.end && goal.period_end >= period.start).map((goal) => calculateGoalProgress(goal, tasks, milestones, plans, timeZone)),
    projectsNeedingAttention: healthAttention, trend: getSnapshotTrend(snapshotPeriod, period.start, period.end),
    snapshots: snapshotPeriod, hasHistory: snapshotPeriod.length > 0,
    github: { activityDays: new Set(githubPeriod.flatMap((item) => item.activityDays)).size, pullRequests: githubPeriod.reduce((sum, item) => sum + item.pullRequestDays.length, 0), issues: githubPeriod.reduce((sum, item) => sum + item.issueDays.length, 0), releases: githubPeriod.reduce((sum, item) => sum + item.releaseDays.length, 0), unavailable: githubPeriod.filter((item) => item.status === "unavailable").length, partial: githubPeriod.some((item) => !item.complete) },
  };
}
