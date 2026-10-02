import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./focusSession.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const {
  DEFAULT_FOCUS_DURATION_MINUTES,
  MAX_FOCUS_DURATION_MINUTES,
  MIN_FOCUS_DURATION_MINUTES,
  adjustFocusDuration,
  adjustPausedFocusSession,
  createFocusSession,
  formatFocusDuration,
  getEligibleFocusTasks,
  getFocusRemainingSeconds,
  parseFocusDuration,
  pauseFocusSession,
  readFocusSessionSnapshot,
  resumeFocusSession,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("default duration and display formatting use standard countdown formats", () => {
  assert.equal(DEFAULT_FOCUS_DURATION_MINUTES, 25);
  assert.equal(formatFocusDuration(25 * 60), "25:00");
  assert.equal(formatFocusDuration(5 * 60), "05:00");
  assert.equal(formatFocusDuration(60 * 60), "01:00:00");
  assert.equal(formatFocusDuration(90 * 60), "01:30:00");
  assert.equal(formatFocusDuration(Number.NaN), "00:00");
});

test("custom duration accepts bounded whole minutes and rejects unsafe values", () => {
  assert.equal(parseFocusDuration("45"), 45);
  for (const value of ["0", "-5", "abc", "9999", "1.5", "Infinity"]) assert.equal(parseFocusDuration(value), null);
  assert.equal(parseFocusDuration(MIN_FOCUS_DURATION_MINUTES), MIN_FOCUS_DURATION_MINUTES);
  assert.equal(parseFocusDuration(MAX_FOCUS_DURATION_MINUTES), MAX_FOCUS_DURATION_MINUTES);
});

test("duration step controls respect configured bounds", () => {
  assert.equal(adjustFocusDuration(25, 5), 30);
  assert.equal(adjustFocusDuration(25, -5), 20);
  assert.equal(adjustFocusDuration(MIN_FOCUS_DURATION_MINUTES, -5), MIN_FOCUS_DURATION_MINUTES);
  assert.equal(adjustFocusDuration(MAX_FOCUS_DURATION_MINUTES, 5), MAX_FOCUS_DURATION_MINUTES);
});

test("focus task candidates exclude completed tasks and are reasonably bounded", () => {
  const tasks = Array.from({ length: 80 }, (_, index) => ({ id: String(index), status: index === 0 ? "Completed" : "In Progress" }));
  const eligible = getEligibleFocusTasks(tasks);
  assert.equal(eligible.length, 75);
  assert.equal(eligible.some((task) => task.status === "Completed"), false);
});

test("starting a 45-minute session stores authoritative start and end timestamps", () => {
  const now = 1_800_000_000_000;
  const session = createFocusSession("task-1", 45, now);
  assert.deepEqual(session, { status: "running", taskId: "task-1", startedAt: now, endsAt: now + 45 * 60_000 });
  assert.equal(getFocusRemainingSeconds(session, now + 12_345), 44 * 60 + 48);
  assert.equal(createFocusSession(null, 0, now), null);
});

test("pause freezes exact remaining time, paused adjustments apply, and resume reanchors endsAt", () => {
  const now = 1_800_000_000_000;
  const started = createFocusSession("task-1", 25, now);
  const paused = pauseFocusSession(started, now + 6 * 60_000 + 18_000);
  assert.deepEqual(paused, { status: "paused", taskId: "task-1", remainingSeconds: 18 * 60 + 42 });
  assert.equal(getFocusRemainingSeconds(paused, now + 60 * 60_000), 18 * 60 + 42);
  const longer = adjustPausedFocusSession(paused, 5);
  assert.equal(longer.remainingSeconds, 23 * 60 + 42);
  const shorter = adjustPausedFocusSession(longer, -5);
  assert.equal(shorter.remainingSeconds, 18 * 60 + 42);
  const resumedAt = now + 90 * 60_000;
  const resumed = resumeFocusSession(longer, resumedAt);
  assert.deepEqual(resumed, { status: "running", taskId: "task-1", startedAt: resumedAt, endsAt: resumedAt + longer.remainingSeconds * 1000 });
});

test("paused remaining time cannot exceed duration bounds or reach zero", () => {
  const nearlyDone = { status: "paused", taskId: null, remainingSeconds: 2 };
  assert.equal(adjustPausedFocusSession(nearlyDone, -5).remainingSeconds, 1);
  const long = { status: "paused", taskId: null, remainingSeconds: 10_700 };
  assert.equal(adjustPausedFocusSession(long, 5).remainingSeconds, MAX_FOCUS_DURATION_MINUTES * 60);
});

test("expired sessions complete and task selection is metadata only", () => {
  const session = createFocusSession("task-1", 1, 10_000);
  assert.equal(getFocusRemainingSeconds(session, 70_000), 0);
  assert.deepEqual(pauseFocusSession(session, 70_000), { status: "completed", taskId: "task-1" });
  assert.equal(session.status, "running");
});

test("snapshot validation keeps only bounded timer and task-id metadata", () => {
  assert.deepEqual(readFocusSessionSnapshot({ durationMinutes: 45, selectedTaskId: "task-1", session: { status: "paused", taskId: "task-1", remainingSeconds: 1200 } }), {
    durationMinutes: 45,
    selectedTaskId: "task-1",
    session: { status: "paused", taskId: "task-1", remainingSeconds: 1200 },
  });
  assert.deepEqual(readFocusSessionSnapshot({ durationMinutes: 9999, selectedTaskId: "task-1", session: null }), null);
  assert.equal(readFocusSessionSnapshot({ durationMinutes: 25, selectedTaskId: "task-1", session: { status: "paused", taskId: "task-1", remainingSeconds: Number.NaN } }).session, null);
});
