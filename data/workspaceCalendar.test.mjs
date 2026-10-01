import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./workspaceCalendar.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const {
  calendarDatePatch,
  filterCalendarEvents,
  formatCalendarDate,
  getCalendarSummary,
  isCalendarEventOverdue,
  localCalendarDate,
  monthGridDates,
  normalizeCalendarEvents,
  shiftCalendarMonth,
  taskCalendarDate,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const project = (id, name, targetDate = "") => ({ id, name, title: name, targetDate, status: "In Development", priority: "High" });
const task = (id, projectId, dueDate, status = "In Progress") => ({ id, projectId, title: id, dueDate, status, priority: "Medium" });
const milestone = (id, projectId, targetDate, status = "active") => ({ id, projectId, title: id, targetDate, status });

test("October 2026 month layout starts Sunday and ends Saturday", () => {
  const dates = monthGridDates(2026, 9);
  assert.equal(dates.length, 35);
  assert.equal(dates[0], "2026-09-27");
  assert.equal(dates[4], "2026-10-01");
  assert.equal(dates.at(-1), "2026-10-31");
});

test("February month lengths and leap years are handled", () => {
  const normal = monthGridDates(2026, 1);
  const leap = monthGridDates(2024, 1);
  assert.equal(normal.filter((date) => date.startsWith("2026-02-")).length, 28);
  assert.equal(normal.length, 28);
  assert.equal(leap.filter((date) => date.startsWith("2024-02-")).length, 29);
  assert.equal(leap.length, 35);
  assert.equal(leap.at(-1), "2024-03-02");
});

test("month navigation crosses year boundaries and clamps shorter months", () => {
  assert.equal(shiftCalendarMonth("2026-12-31", 1), "2027-01-31");
  assert.equal(shiftCalendarMonth("2027-01-31", -1), "2026-12-31");
  assert.equal(shiftCalendarMonth("2024-01-31", 1), "2024-02-29");
});

test("date-only task values and date labels do not shift with timezone", () => {
  assert.equal(taskCalendarDate("2026-10-02", "America/Los_Angeles"), "2026-10-02");
  assert.equal(taskCalendarDate("2026-10-02T00:00:00.000Z", "America/Los_Angeles"), "2026-10-02");
  assert.equal(formatCalendarDate("2026-10-02", { dateStyle: "long" }), "October 2, 2026");
  assert.equal(localCalendarDate(new Date("2026-10-02T00:30:00Z"), "America/Los_Angeles"), "2026-10-01");
  assert.equal(localCalendarDate(new Date("2026-10-02T00:30:00Z"), "Asia/Manila"), "2026-10-02");
});

test("timed task timestamps use the profile timezone while date-input timestamps stay date-only", () => {
  assert.equal(taskCalendarDate("2026-10-02T02:30:00.000Z", "America/Los_Angeles"), "2026-10-01");
  assert.equal(taskCalendarDate("2026-10-02T00:00:00+00:00", "America/Los_Angeles"), "2026-10-02");
});

test("overdue excludes completed events and includes unfinished events before today", () => {
  const unfinished = { date: "2026-10-01", completed: false };
  const completed = { date: "2026-09-01", completed: true };
  assert.equal(isCalendarEventOverdue(unfinished, "2026-10-02"), true);
  assert.equal(isCalendarEventOverdue({ ...unfinished, date: "2026-10-02" }, "2026-10-02"), false);
  assert.equal(isCalendarEventOverdue(completed, "2026-10-02"), false);
  assert.deepEqual(getCalendarSummary([unfinished, completed, { date: null, completed: false }], "2026-10-02"), {
    dueToday: 0,
    thisWeek: 0,
    overdue: 1,
    unscheduled: 1,
  });
});

test("calendar normalization maps task, milestone, and project rows without storing events", () => {
  const events = normalizeCalendarEvents(
    [project("p1", "Alpha", "2026-10-30"), project("p2", "Beta")],
    [task("t1", "p1", "2026-10-05T00:00:00.000Z"), task("t2", "p2", null, "Completed")],
    [milestone("m1", "p1", "2026-10-10"), milestone("m2", "p2", null)],
    "UTC",
  );
  assert.deepEqual(events.map(({ entityType, date, projectTitle }) => [entityType, date, projectTitle]), [
    ["task", "2026-10-05", "Alpha"],
    ["task", null, "Beta"],
    ["milestone", "2026-10-10", "Alpha"],
    ["milestone", null, "Beta"],
    ["project", "2026-10-30", "Alpha"],
    ["project", null, "Beta"],
  ]);
});

test("project and event-type filters are applied to scheduled and unscheduled items", () => {
  const events = normalizeCalendarEvents(
    [project("p1", "Alpha"), project("p2", "Beta")],
    [task("t1", "p1", null), task("t2", "p2", "2026-10-05")],
    [milestone("m1", "p1", null)],
    "UTC",
  );
  const filtered = filterCalendarEvents(events, { projectId: "p1", enabledTypes: ["task"], showCompleted: false });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "task:t1");
});

test("rescheduling updates the existing nullable source date fields in YYYY-MM-DD form", () => {
  assert.deepEqual(calendarDatePatch("task", "2026-10-08"), { dueDate: "2026-10-08" });
  assert.deepEqual(calendarDatePatch("milestone", "2026-10-15"), { targetDate: "2026-10-15" });
  assert.deepEqual(calendarDatePatch("project", "2026-11-15"), { targetDate: "2026-11-15" });
  assert.deepEqual(calendarDatePatch("task", null), { dueDate: null });
  assert.deepEqual(calendarDatePatch("milestone", null), { targetDate: null });
  assert.deepEqual(calendarDatePatch("project", null), { targetDate: null });
  assert.throws(() => calendarDatePatch("task", "2026-02-30"), RangeError);
});
