import type { GithubRepositoryActivity } from "@/data/githubActivityTypes";
import type { Milestone, Plan, Project, Task } from "@/types";

export const ACCOUNTABILITY_WINDOWS = { consistencyDays: 7, progressDays: 30 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Scores are normalized across available factors (workspace 40, milestones/plans 25,
 * GitHub 20, consistency 15). GitHub is excluded when unlinked, loading, or unavailable.
 * Workspace points: up to 15 for completed task ratio, 10 each for at most two recent
 * completions, 5 for a next action; each overdue non-blocked task subtracts 2 (max 8).
 * Milestones/plans: 10 for milestone completion ratio, 5 for recent milestone movement,
 * and 10 for linked active checklist completion. GitHub: 12 for any qualifying 30-day
 * event, 4 if one occurred in 7 days, 4 for two event kinds. Event count adds no points.
 * Consistency adds 2 per distinct active day (max 3 days in 7) and 3 per active week
 * (max 3 weeks in 30), so daily activity is not a target.
 * Planning/research exclude GitHub; maintenance allows 60 quiet days before Stalled.
 * Completed, on-hold, cancelled, and blocked projects have contextual health without an active score.
 * Otherwise overdue work means Needs Attention; progress within 7 days means Active,
 * within 30 days (60 in maintenance) means Steady, and older activity with open tasks is Stalled.
 */

export type ProjectHealth = "Active" | "Steady" | "Needs Attention" | "Stalled" | "Blocked" | "Completed" | "On Hold" | "Cancelled" | "Building Baseline";

export type GithubActivityInput =
  | { status: "not-connected" }
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "available"; activity: GithubRepositoryActivity };

export interface AccountabilityFactor {
  key: "workspace" | "milestones-plans" | "github" | "consistency";
  label: string;
  score: number;
  max: number;
  available: boolean;
}

export interface AccountabilityResult {
  score: number | null;
  health: ProjectHealth;
  baseline: boolean;
  factors: AccountabilityFactor[];
  reasons: Array<{ kind: "progress" | "attention" | "context"; text: string }>;
  githubStatus: GithubActivityInput["status"] | "not-relevant";
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
}

export interface AccountabilityProjectData {
  project: Project;
  tasks: Task[];
  milestones: Milestone[];
  plans: Plan[];
  github: GithubActivityInput;
}

const validTime = (value?: string | null): number | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

const isWithinDays = (value: string | null | undefined, now: Date, days: number) => {
  const time = validTime(value);
  const age = time === null ? null : now.getTime() - time;
  return age !== null && age >= 0 && age <= days * DAY_MS;
};

const daysOld = (value: string | null, now: Date) => {
  const time = validTime(value);
  return time === null ? null : Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function getGithubEvents(activity: GithubRepositoryActivity) {
  const events: Array<{ kind: string; at: string | null }> = [
    ...activity.commits.filter((commit) => commit.title.trim().length > 0 && commit.title !== "Commit").map((commit) => ({ kind: "commit", at: commit.occurredAt })),
    ...activity.pullRequests.filter((pull) => !pull.draft).map((pull) => ({ kind: "pull request", at: pull.mergedAt ?? pull.updatedAt })),
    ...activity.issues.filter((issue) => issue.closedAt !== null || issue.updatedAt !== issue.createdAt).map((issue) => ({ kind: "issue", at: issue.closedAt ?? issue.updatedAt })),
    ...activity.releases.filter((release) => !release.draft).map((release) => ({ kind: "release", at: release.publishedAt })),
  ];
  return events;
}

export function calculateProjectAccountability(data: AccountabilityProjectData, now = new Date()): AccountabilityResult {
  const { project, github } = data;
  const tasks = data.tasks.filter((task) => task.projectId === project.id);
  const milestones = data.milestones.filter((milestone) => milestone.projectId === project.id);
  const taskIds = new Set(tasks.map((task) => task.id));
  const planItems = data.plans
    .filter((plan) => plan.status !== "Paused" && plan.status !== "Cancelled" && plan.status !== "Completed")
    .flatMap((plan) => (plan.items ?? []).filter((item) => item.projectId ? item.projectId === project.id : Boolean(item.taskId && taskIds.has(item.taskId))));

  const recentCompletedTasks = tasks.filter((task) => task.status === "Completed" && isWithinDays(task.completedAt, now, ACCOUNTABILITY_WINDOWS.progressDays));
  const openTasks = tasks.filter((task) => task.status !== "Completed");
  const scorableTasks = tasks.filter((task) => task.status !== "Blocked");
  const overdueTasks = openTasks.filter((task) => {
    if (task.status === "Blocked") return false;
    const due = validTime(task.dueDate);
    return due !== null && due < now.getTime();
  });
  const blockedTasks = openTasks.filter((task) => task.status === "Blocked");
  const recentMilestoneMovement = milestones.some((milestone) => isWithinDays(milestone.lastUpdated, now, ACCOUNTABILITY_WINDOWS.progressDays));
  const completedMilestones = milestones.filter((milestone) => milestone.status === "completed").length;
  const completedPlanItems = planItems.filter((item) => item.done).length;
  const githubRelevant = !["IDEA", "PLANNING", "RESEARCH", "COMPLETED", "BLOCKED", "ON_HOLD", "CANCELLED"].includes(project.currentPhase)
    && !["Completed", "On Hold", "Blocked", "Cancelled"].includes(project.status);

  const githubEvents = github.status === "available" && githubRelevant ? getGithubEvents(github.activity) : [];
  const recentGithubEvents = githubEvents.filter((event) => isWithinDays(event.at, now, ACCOUNTABILITY_WINDOWS.progressDays));
  const githubActivityDays = githubEvents
    .filter((event) => isWithinDays(event.at, now, ACCOUNTABILITY_WINDOWS.progressDays))
    .map((event) => {
      const time = validTime(event.at);
      return time === null ? null : new Date(time).toISOString().slice(0, 10);
    })
    .filter((day): day is string => day !== null);

  const workspaceActivityDates = [
    ...recentCompletedTasks.map((task) => task.completedAt),
    ...milestones.filter((milestone) => isWithinDays(milestone.lastUpdated, now, ACCOUNTABILITY_WINDOWS.progressDays)).map((milestone) => milestone.lastUpdated),
    ...tasks.filter((task) => task.status !== "Completed" && isWithinDays(task.updatedAt, now, ACCOUNTABILITY_WINDOWS.progressDays)).map((task) => task.updatedAt),
    ...planItems.filter((item) => item.done && isWithinDays(item.updatedAt, now, ACCOUNTABILITY_WINDOWS.progressDays)).map((item) => item.updatedAt),
  ].filter((value): value is string => Boolean(value));
  const activityDates = [...workspaceActivityDates, ...githubActivityDays.map((day) => `${day}T00:00:00.000Z`)];
  const recentDays = new Set(activityDates.filter((date) => isWithinDays(date, now, ACCOUNTABILITY_WINDOWS.consistencyDays)).map((date) => new Date(date).toISOString().slice(0, 10)));
  const activeWeeks = new Set(activityDates.filter((date) => isWithinDays(date, now, ACCOUNTABILITY_WINDOWS.progressDays)).map((date) => {
    const time = validTime(date);
    return time === null ? "" : Math.floor((now.getTime() - time) / (7 * DAY_MS));
  }).filter((week) => week !== ""));

  const factors: AccountabilityFactor[] = [];
  const hasTaskData = scorableTasks.length > 0;
  const hasAction = project.nextAction.trim().length > 0;
  const workspaceAvailable = hasTaskData || hasAction;
  const taskCompletion = scorableTasks.length ? scorableTasks.filter((task) => task.status === "Completed").length / scorableTasks.length : 0;
  const workspaceBase = taskCompletion * 15 + Math.min(recentCompletedTasks.length, 2) * 10 + (hasAction ? 5 : 0);
  const workspaceMax = 40;
  const workspaceScore = clamp(workspaceBase - Math.min(overdueTasks.length, 4) * 2, 0, workspaceMax);
  factors.push({ key: "workspace", label: "Workspace follow-through", score: workspaceScore, max: workspaceMax, available: workspaceAvailable });

  const milestoneAvailable = milestones.length > 0 || planItems.length > 0;
  const milestoneScore = (milestones.length ? completedMilestones / milestones.length * 10 + (recentMilestoneMovement ? 5 : 0) : 0)
    + (planItems.length ? completedPlanItems / planItems.length * 10 : 0);
  factors.push({ key: "milestones-plans", label: "Milestones and plans", score: clamp(milestoneScore, 0, 25), max: 25, available: milestoneAvailable });

  const githubAvailable = githubRelevant && github.status === "available";
  const githubKinds = new Set(recentGithubEvents.map((event) => event.kind));
  const mostRecentGithubEvent = recentGithubEvents.map((event) => event.at).filter((value): value is string => Boolean(value)).sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  const githubScore = recentGithubEvents.length === 0 ? 0 : 12 + (isWithinDays(mostRecentGithubEvent, now, 7) ? 4 : 0) + (githubKinds.size >= 2 ? 4 : 0);
  factors.push({ key: "github", label: "Development activity", score: githubAvailable ? githubScore : 0, max: 20, available: githubAvailable });

  const consistencyScore = Math.min(recentDays.size, 3) * 2 + Math.min(activeWeeks.size, 3) * 3;
  const consistencyAvailable = workspaceAvailable || milestoneAvailable || githubAvailable;
  factors.push({ key: "consistency", label: "Activity consistency", score: clamp(consistencyScore, 0, 15), max: 15, available: consistencyAvailable });

  const availableFactors = factors.filter((factor) => factor.available);
  const maxAvailable = availableFactors.reduce((total, factor) => total + factor.max, 0);
  const rawScore = maxAvailable ? Math.round(availableFactors.reduce((total, factor) => total + factor.score, 0) / maxAvailable * 100) : null;
  const hasEvidence = scorableTasks.length > 0 || milestones.length > 0 || planItems.length > 0 || githubEvents.length > 0;
  const ageFromStart = daysOld(project.startDate || project.lastUpdated, now);
  const baseline = !hasEvidence && (ageFromStart === null || ageFromStart < ACCOUNTABILITY_WINDOWS.progressDays);
  const scoreActive = !["Completed", "On Hold", "Cancelled", "Blocked"].includes(project.status);
  const score = hasEvidence && scoreActive ? rawScore : null;

  const workspaceDates = [
    project.lastUpdated,
    ...tasks.map((task) => task.status === "Completed" ? task.completedAt : task.updatedAt ?? task.createdAt),
    ...milestones.map((milestone) => milestone.lastUpdated),
    ...planItems.map((item) => item.updatedAt),
  ].filter((value): value is string => Boolean(value));
  const activityTimestamps = [
    ...workspaceDates,
    ...(github.status === "available" && githubRelevant ? githubEvents.map((event) => event.at) : []),
  ].map(validTime).filter((time): time is number => time !== null && time <= now.getTime());
  const lastActivityAt = activityTimestamps.length ? new Date(Math.max(...activityTimestamps)).toISOString() : null;
  const daysSinceActivity = daysOld(lastActivityAt, now);

  let health: ProjectHealth;
  if (project.status === "Completed") health = "Completed";
  else if (project.status === "Cancelled") health = "Cancelled";
  else if (project.status === "On Hold") health = "On Hold";
  else if (project.status === "Blocked" || blockedTasks.length > 0) health = "Blocked";
  else if (baseline) health = "Building Baseline";
  else if (overdueTasks.length > 0) health = "Needs Attention";
  else if (daysSinceActivity !== null && daysSinceActivity <= 7) health = "Active";
  else if (daysSinceActivity !== null && daysSinceActivity <= (project.currentPhase === "MAINTENANCE" ? 60 : ACCOUNTABILITY_WINDOWS.progressDays)) health = "Steady";
  else if (openTasks.length > 0) health = "Stalled";
  else health = "Needs Attention";

  const reasons: AccountabilityResult["reasons"] = [];
  if (overdueTasks.length > 0) reasons.push({ kind: "attention", text: `${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"}` });
  if (health === "Stalled") reasons.push({ kind: "attention", text: `No workspace or repository progress in the last ${project.currentPhase === "MAINTENANCE" ? 60 : 30} days` });
  if (recentCompletedTasks.length > 0) reasons.push({ kind: "progress", text: `${recentCompletedTasks.length} task${recentCompletedTasks.length === 1 ? "" : "s"} completed in the last 30 days` });
  if (recentMilestoneMovement) reasons.push({ kind: "progress", text: "A milestone changed in the last 30 days" });
  if (completedPlanItems > 0) reasons.push({ kind: "progress", text: `${completedPlanItems} linked plan step${completedPlanItems === 1 ? "" : "s"} complete` });
  if (recentGithubEvents.length > 0) reasons.push({ kind: "progress", text: "Repository activity in the last 30 days" });
  if (blockedTasks.length > 0 && project.status !== "Blocked") reasons.push({ kind: "context", text: `${blockedTasks.length} task${blockedTasks.length === 1 ? " is" : "s are"} blocked; due dates are not penalized` });
  if (!githubRelevant) reasons.push({ kind: "context", text: "GitHub activity is not scored during this workflow phase" });
  else if (github.status === "not-connected") reasons.push({ kind: "context", text: "GitHub not connected; score uses workspace signals" });
  else if (github.status === "loading") reasons.push({ kind: "context", text: "GitHub activity has not loaded; it is excluded from the score" });
  else if (github.status === "unavailable") reasons.push({ kind: "context", text: "GitHub activity unavailable; score uses workspace signals" });
  if (baseline) reasons.push({ kind: "context", text: "Building a baseline from project activity" });
  if (!scoreActive) reasons.push({ kind: "context", text: `${project.status} project; no active score is shown` });
  if (reasons.length === 0) reasons.push({ kind: "context", text: "No recent progress signals in the last 30 days" });

  const githubStatus = githubRelevant ? github.status : "not-relevant";
  return { score, health, baseline, factors, reasons, githubStatus, lastActivityAt, daysSinceActivity };
}
