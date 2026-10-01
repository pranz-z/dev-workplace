import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./accountabilityReports.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildPeriodReport, calculateGoalProgress, getMonthPeriod, getSnapshotTrend, getWeekPeriod, isValidTimeZone, localDateAt } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("weekly periods run Monday through Sunday in the user's timezone", () => {
  assert.deepEqual(getWeekPeriod(new Date("2026-10-04T23:30:00Z"), "Asia/Manila"), { start: "2026-10-05", end: "2026-10-11", label: "2026-10-05 – 2026-10-11" });
});

test("monthly periods use calendar months and timezone-local dates", () => {
  assert.equal(getMonthPeriod(new Date("2026-10-01T00:30:00Z"), "America/Los_Angeles").label, "September 2026");
  assert.equal(getMonthPeriod(new Date("2026-10-01T00:30:00Z"), "America/Los_Angeles", 1).label, "October 2026");
});

test("sparse snapshots do not claim a trend; changes within four points are stable", () => {
  const item = (snapshot_date, score) => ({ snapshot_date, score, model_version: 1 });
  assert.equal(getSnapshotTrend([item("2026-10-01", 70), item("2026-10-02", 72)], "2026-10-01", "2026-10-07").state, "Insufficient history");
  assert.equal(getSnapshotTrend([item("2026-10-01", 70), item("2026-10-03", 73), item("2026-10-05", 72)], "2026-10-01", "2026-10-07").state, "Stable");
  assert.equal(getSnapshotTrend([item("2026-10-01", 60), item("2026-10-03", 70), item("2026-10-05", 72)], "2026-10-01", "2026-10-07").state, "Improving");
  assert.equal(getSnapshotTrend([item("2026-10-01", 80), item("2026-10-03", 70), item("2026-10-05", 72)], "2026-10-01", "2026-10-07").state, "Declining");
});

test("automatic task goal progress uses completion dates and project scope", () => {
  const goal = { metric: "tasks_completed", project_id: "p1", period_start: "2026-10-01", period_end: "2026-10-07", target: 2 };
  const progress = calculateGoalProgress(goal, [
    { projectId: "p1", status: "Completed", completedAt: "2026-10-02T10:00:00Z" },
    { projectId: "p2", status: "Completed", completedAt: "2026-10-02T10:00:00Z" },
    { projectId: "p1", status: "Completed", completedAt: "2026-09-30T10:00:00Z" },
  ], [], [], "UTC");
  assert.equal(progress.progress, 1);
  assert.equal(progress.percentage, 50);
});

test("overdue report counts currently overdue unblocked work and excludes completed or held projects from attention", () => {
  const report = buildPeriodReport({ start: "2026-10-01", end: "2026-10-07", label: "week" }, "UTC", [
    { id: "done", name: "Done", status: "Completed" }, { id: "hold", name: "Hold", status: "On Hold" }, { id: "active", name: "Active", status: "In Development" },
  ], [
    { projectId: "done", status: "In Progress", dueDate: "2026-09-01" },
    { projectId: "hold", status: "In Progress", dueDate: "2026-09-01" },
    { projectId: "active", status: "In Progress", dueDate: "2026-09-01" },
    { projectId: "active", status: "Blocked", dueDate: "2026-09-01" },
  ], [], [], [], [], new Date("2026-10-07T12:00:00Z"));
  assert.equal(report.overdueTasks, 1);
  assert.deepEqual(report.projectsNeedingAttention.map(({ id }) => id), ["active"]);
});

test("timezone day boundaries use the validated IANA timezone", () => {
  const instant = new Date("2026-10-01T00:30:00Z");
  assert.equal(localDateAt(instant, "America/Los_Angeles"), "2026-09-30");
  assert.equal(localDateAt(instant, "Asia/Manila"), "2026-10-01");
  assert.equal(isValidTimeZone("../../etc/passwd"), false);
});

test("report GitHub activity days are deduplicated and unavailable data stays distinct", () => {
  const report = buildPeriodReport({ start: "2026-10-01", end: "2026-10-07", label: "week" }, "UTC", [], [], [], [], [], [], new Date("2026-10-07T12:00:00Z"), [
    { projectId: "p1", status: "available", activityDays: ["2026-10-02", "2026-10-02", "2026-10-04"], pullRequestDays: ["2026-10-02"], issueDays: [], releaseDays: [], complete: true },
    { projectId: "p2", status: "unavailable", activityDays: [], pullRequestDays: [], issueDays: [], releaseDays: [], complete: false },
  ]);
  assert.equal(report.github.activityDays, 2);
  assert.equal(report.github.pullRequests, 1);
  assert.equal(report.github.unavailable, 1);
});
