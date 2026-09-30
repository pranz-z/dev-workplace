import type { AccountabilityScore, GithubActivityEvent, GithubProjectHealthItem, Project } from "@/types";

const DAY = 24 * 60 * 60 * 1000;

const daysBetween = (from: string | undefined, now: Date) => {
  if (!from) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / DAY));
};

const scoreState = (total: number): AccountabilityScore["state"] => {
  if (total < 25) return "Inactive";
  if (total < 50) return "Getting Started";
  if (total < 70) return "Steady";
  if (total < 85) return "Active";
  return "Locked In";
};

const getActivityDays = (events: GithubActivityEvent[], now: Date) =>
  new Set(
    events
      .filter((event) => event.meaningful)
      .map((event) => new Date(event.occurredAt))
      .filter((date) => date <= now)
      .map((date) => date.toISOString().slice(0, 10)),
  );

const getStreaks = (days: Set<string>, now: Date) => {
  const sortedDays = [...days].sort((a, b) => b.localeCompare(a));
  const recentDay = sortedDays[0] ? new Date(`${sortedDays[0]}T00:00:00`) : undefined;
  const recentGap = recentDay ? Math.floor((now.getTime() - recentDay.getTime()) / DAY) : Number.POSITIVE_INFINITY;
  let current = recentGap <= 1 ? 1 : 0;
  let longest = 0;
  let run = sortedDays.length > 0 ? 1 : 0;

  for (let index = 1; index < sortedDays.length; index += 1) {
    const previous = new Date(`${sortedDays[index - 1]}T00:00:00`);
    const next = new Date(`${sortedDays[index]}T00:00:00`);
    const gap = Math.floor((previous.getTime() - next.getTime()) / DAY);
    if (gap <= 2) {
      run += 1;
      if (index < sortedDays.length && current > 0) current += 1;
    } else {
      longest = Math.max(longest, run);
      run = 1;
      if (current > 0) current = 0;
    }
  }

  return { current, longest: Math.max(longest, run) };
};

const getProjectHealthItems = (projects: Project[], events: GithubActivityEvent[], now: Date): GithubProjectHealthItem[] =>
  projects.map((project) => {
    if (project.status === "Completed" || project.status === "On Hold" || project.status === "Cancelled" || project.status === "Planning") {
      return { projectId: project.id, lastActivityAt: project.lastUpdated, health: "Exempt", score: 100 };
    }

    const projectEvents = events.filter((event) => event.projectId === project.id);
    const lastActivityAt = projectEvents.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0]?.occurredAt ?? project.lastUpdated;
    const age = daysBetween(lastActivityAt, now);
    const health: GithubProjectHealthItem["health"] = age <= 7 ? "Healthy" : age <= 21 ? "Needs Attention" : "Dormant";
    return { projectId: project.id, lastActivityAt, health, score: health === "Healthy" ? 100 : health === "Needs Attention" ? 55 : 15 };
  });

export function calculateAccountabilityScore(
  projects: Project[],
  events: GithubActivityEvent[],
  now = new Date(),
): AccountabilityScore {
  const meaningfulEvents = events.filter((event) => event.meaningful && new Date(event.occurredAt) <= now);
  const activityDays = getActivityDays(meaningfulEvents, now);
  const activeDaysThisWeek = [...activityDays].filter((day) => daysBetween(day, now) < 7).length;
  const recentEvents = meaningfulEvents.filter((event) => daysBetween(event.occurredAt, now) < 30).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const projectHealth = getProjectHealthItems(projects, meaningfulEvents, now);
  const eligibleProjects = projectHealth.filter((item) => item.health !== "Exempt");
  const healthyProjects = eligibleProjects.filter((item) => item.health === "Healthy").length;
  const newProjectsThisMonth = projects.filter((project) => daysBetween(project.startDate, now) < 31).length;
  const documentationUpdates = meaningfulEvents.filter((event) => event.type === "documentation" && daysBetween(event.occurredAt, now) < 30).length;
  const updatedProjects = new Set(recentEvents.map((event) => event.projectId).filter(Boolean)).size;
  const commits = meaningfulEvents.filter((event) => event.type === "commit").length;
  const streaks = getStreaks(activityDays, now);
  const consistency = Math.min(40, Math.round((activeDaysThisWeek / 7) * 40));
  const maintenance = eligibleProjects.length === 0 ? 25 : Math.round((healthyProjects / eligibleProjects.length) * 25);
  const newProjects = Math.min(15, newProjectsThisMonth * 8);
  const documentation = Math.min(10, documentationUpdates * 3);
  const momentum = Math.min(10, recentEvents.filter((event) => daysBetween(event.occurredAt, now) < 3).length * 2);
  const total = consistency + maintenance + newProjects + documentation + momentum;

  return {
    total,
    state: scoreState(total),
    consistency,
    maintenance,
    newProjects,
    documentation,
    momentum,
    activeDaysThisWeek,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    projectHealth,
    updatedProjects,
    newProjectsThisMonth,
    documentationUpdates,
    commits,
    recentEvents: recentEvents.slice(0, 6),
  };
}

export const getProjectHealth = (projects: Project[], events: GithubActivityEvent[], now = new Date()) =>
  calculateAccountabilityScore(projects, events, now).projectHealth;