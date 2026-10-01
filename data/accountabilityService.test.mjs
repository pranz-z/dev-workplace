import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./accountabilityService.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { calculateProjectAccountability } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const now = new Date("2026-10-01T12:00:00.000Z");
const recent = "2026-09-30T10:00:00.000Z";
const old = "2026-08-01T10:00:00.000Z";

function project(overrides = {}) {
  return {
    id: "project-1",
    name: "Example project",
    status: "In Development",
    currentPhase: "DEVELOPMENT",
    nextAction: "Ship the next slice",
    startDate: "2026-08-01",
    lastUpdated: recent,
    githubConnected: false,
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: "task-1",
    projectId: "project-1",
    status: "Completed",
    createdAt: old,
    completedAt: recent,
    ...overrides,
  };
}

function activity({ commits = [], pullRequests = [], issues = [], releases = [], lastActivityAt = recent } = {}) {
  return {
    summary: { lastActivityAt, recentCommitCount: commits.length, recentPullRequestCount: pullRequests.length, recentIssueCount: issues.length, latestReleaseAt: null },
    commits,
    pullRequests,
    issues,
    releases,
  };
}

const commit = (sha, occurredAt = recent, title = "Implement feature") => ({ sha, occurredAt, title });

test("recent workspace and repository progress produce strong signals for an active project", () => {
  const result = calculateProjectAccountability({
    project: project(),
    tasks: [task(), task({ id: "task-2", status: "In Progress", completedAt: undefined, updatedAt: recent })],
    milestones: [{ id: "milestone-1", projectId: "project-1", status: "completed", lastUpdated: recent }],
    plans: [{ id: "plan-1", status: "Active", items: [{ id: "step-1", projectId: "project-1", done: true, updatedAt: recent }] }],
    github: { status: "available", activity: activity({ commits: [commit("recent", "2026-09-29T10:00:00.000Z")], pullRequests: [{ number: 1, state: "merged", updatedAt: recent, mergedAt: recent }] }) },
  }, now);

  assert.equal(result.health, "Active");
  assert.ok(result.score >= 70);
  assert.ok(result.reasons.some((reason) => reason.text.includes("task completed")));
  assert.ok(result.reasons.some((reason) => reason.text.includes("Repository activity")));
});

test("overdue unfinished work and old progress need attention", () => {
  const result = calculateProjectAccountability({
    project: project({ lastUpdated: old, nextAction: "" }),
    tasks: [task({ status: "In Progress", dueDate: "2026-08-15", completedAt: undefined, createdAt: old, updatedAt: old })],
    milestones: [],
    plans: [],
    github: { status: "available", activity: activity({ commits: [commit("old", old)], lastActivityAt: old }) },
  }, now);

  assert.equal(result.health, "Needs Attention");
  assert.ok(result.score < 50);
  assert.ok(result.reasons.some((reason) => reason.text === "1 overdue task"));
});

test("new empty projects show a baseline instead of a misleading zero", () => {
  const result = calculateProjectAccountability({
    project: project({ startDate: "2026-09-30", lastUpdated: recent }),
    tasks: [], milestones: [], plans: [], github: { status: "not-connected" },
  }, now);

  assert.equal(result.score, null);
  assert.equal(result.baseline, true);
  assert.equal(result.health, "Building Baseline");
});

test("completed projects keep completed health without needing recent commits", () => {
  const result = calculateProjectAccountability({
    project: project({ status: "Completed", lastUpdated: old }),
    tasks: [], milestones: [], plans: [], github: { status: "available", activity: activity({ commits: [commit("old", old)], lastActivityAt: old }) },
  }, now);

  assert.equal(result.health, "Completed");
});

test("on-hold inactivity does not become stalled", () => {
  const result = calculateProjectAccountability({
    project: project({ status: "On Hold", lastUpdated: old }),
    tasks: [task({ status: "In Progress", createdAt: old, updatedAt: old, completedAt: undefined })],
    milestones: [], plans: [], github: { status: "not-connected" },
  }, now);

  assert.equal(result.health, "On Hold");
  assert.equal(result.score, null);
});

test("planning phase does not require or score repository activity", () => {
  const input = {
    project: project({ currentPhase: "PLANNING" }),
    tasks: [task({ status: "In Progress", completedAt: undefined, updatedAt: recent })],
    milestones: [], plans: [],
  };
  const withoutGithub = calculateProjectAccountability({ ...input, github: { status: "not-connected" } }, now);
  const withGithub = calculateProjectAccountability({ ...input, github: { status: "available", activity: activity({ commits: [commit("recent")] }) } }, now);

  assert.equal(withGithub.githubStatus, "not-relevant");
  assert.equal(withGithub.factors.find((factor) => factor.key === "github").available, false);
  assert.equal(withGithub.score, withoutGithub.score);
});

test("maintenance projects tolerate a longer quiet period", () => {
  const result = calculateProjectAccountability({
    project: project({ currentPhase: "MAINTENANCE", lastUpdated: "2026-08-17T10:00:00.000Z" }),
    tasks: [task({ status: "In Progress", createdAt: old, updatedAt: "2026-08-17T10:00:00.000Z", completedAt: undefined })],
    milestones: [], plans: [], github: { status: "not-connected" },
  }, now);

  assert.equal(result.health, "Steady");
});

test("projects without GitHub receive a workspace-normalized score", () => {
  const result = calculateProjectAccountability({
    project: project(), tasks: [task()], milestones: [], plans: [], github: { status: "not-connected" },
  }, now);

  assert.equal(typeof result.score, "number");
  assert.equal(result.factors.find((factor) => factor.key === "github").available, false);
  assert.ok(result.reasons.some((reason) => reason.text.includes("GitHub not connected")));
});

test("repeated commits on one day have bounded contribution", () => {
  const scoreFor = (commits) => calculateProjectAccountability({
    project: project(), tasks: [], milestones: [], plans: [],
    github: { status: "available", activity: activity({ commits }) },
  }, now).score;

  assert.equal(scoreFor([commit("one")]), scoreFor(Array.from({ length: 10 }, (_, index) => commit(String(index)))));
});

test("empty commit messages do not count as development progress", () => {
  const scoreFor = (commits) => calculateProjectAccountability({
    project: project(), tasks: [], milestones: [], plans: [],
    github: { status: "available", activity: activity({ commits }) },
  }, now).score;

  assert.equal(scoreFor([commit("empty", recent, "Commit")]), scoreFor([]));
});

test("blocked project or task context is represented as blocked", () => {
  const projectResult = calculateProjectAccountability({
    project: project({ status: "Blocked" }), tasks: [], milestones: [], plans: [], github: { status: "not-connected" },
  }, now);
  const taskResult = calculateProjectAccountability({
    project: project(), tasks: [task({ status: "Blocked", completedAt: undefined })], milestones: [], plans: [], github: { status: "not-connected" },
  }, now);

  assert.equal(projectResult.health, "Blocked");
  assert.equal(taskResult.health, "Blocked");
});

test("unavailable GitHub data is excluded and distinguished from no repository activity", () => {
  const result = calculateProjectAccountability({
    project: project({ githubConnected: true }), tasks: [task()], milestones: [], plans: [], github: { status: "unavailable" },
  }, now);

  assert.equal(result.githubStatus, "unavailable");
  assert.equal(result.factors.find((factor) => factor.key === "github").available, false);
  assert.ok(result.reasons.some((reason) => reason.text.includes("unavailable")));
});
