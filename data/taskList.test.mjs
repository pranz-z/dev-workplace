import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const calendarSource = readFileSync(new URL("./workspaceCalendar.ts", import.meta.url), "utf8");
const calendarCompiled = ts.transpileModule(calendarSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const calendarUrl = `data:text/javascript;base64,${Buffer.from(calendarCompiled).toString("base64")}`;
const source = readFileSync(new URL("./taskList.ts", import.meta.url), "utf8").replace('"@/data/workspaceCalendar"', JSON.stringify(calendarUrl));
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { deriveTaskList, filterTasksByStatus, parseTaskListSort, parseTaskListStatusFilter, sortTaskList } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const task = (id, { projectId = "project-a", status = "Backlog", dueDate, createdAt = "2026-01-01T00:00:00.000Z", title = id } = {}) => ({
  id, projectId, title, description: "", status, priority: "Medium", dueDate, createdAt, updatedAt: createdAt, tags: [],
});

const tasks = [
  task("old", { createdAt: "2025-01-01T00:00:00.000Z", dueDate: "2026-04-01" }),
  task("new", { createdAt: "2026-01-01T00:00:00.000Z", status: "Completed", dueDate: "2026-02-01" }),
  task("mid", { createdAt: "2025-06-01T00:00:00.000Z", status: "In Progress", dueDate: "2026-03-01" }),
  task("undated", { createdAt: "2025-07-01T00:00:00.000Z", dueDate: undefined }),
];

test("creation sorts use createdAt newest first and oldest first", () => {
  assert.deepEqual(sortTaskList(tasks, "newest").map(({ id }) => id), ["new", "undated", "mid", "old"]);
  assert.deepEqual(sortTaskList(tasks, "oldest").map(({ id }) => id), ["old", "mid", "undated", "new"]);
});

test("due-date sorts put dated tasks first and undated tasks last", () => {
  assert.deepEqual(sortTaskList(tasks, "due-soonest").map(({ id }) => id), ["new", "mid", "old", "undated"]);
  assert.deepEqual(sortTaskList(tasks, "due-latest").map(({ id }) => id), ["old", "mid", "new", "undated"]);
});

test("workspace order preserves input order without mutating the original task array", () => {
  const input = [...tasks];
  assert.deepEqual(sortTaskList(input, "workspace").map(({ id }) => id), input.map(({ id }) => id));
  assert.notEqual(sortTaskList(input, "workspace"), input);
  assert.deepEqual(input.map(({ id }) => id), ["old", "new", "mid", "undated"]);
});

test("all, individual, completed and incomplete filters use task statuses", () => {
  assert.deepEqual(filterTasksByStatus(tasks, "all").map(({ id }) => id), ["old", "new", "mid", "undated"]);
  assert.deepEqual(filterTasksByStatus(tasks, ["Backlog"]).map(({ id }) => id), ["old", "undated"]);
  assert.deepEqual(filterTasksByStatus(tasks, "completed").map(({ id }) => id), ["new"]);
  assert.deepEqual(filterTasksByStatus(tasks, "incomplete").map(({ id }) => id), ["old", "mid", "undated"]);
  assert.deepEqual(filterTasksByStatus(tasks, ["In Progress"]).map(({ id }) => id), ["mid"]);
});

test("multiple status selection works", () => {
  assert.deepEqual(filterTasksByStatus(tasks, ["Backlog", "In Progress"]).map(({ id }) => id), ["old", "mid", "undated"]);
});

test("project filter, status filter and sorting compose in that order", () => {
  const inputs = [
    ...tasks,
    task("other-project", { projectId: "project-b", status: "Backlog", createdAt: "2026-05-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(deriveTaskList(inputs, { projectId: "project-a", statusFilter: ["Backlog", "In Progress"], sort: "due-latest" }).map(({ id }) => id), ["old", "mid", "undated"]);
  assert.deepEqual(deriveTaskList(inputs, { projectId: "project-b", statusFilter: "all", sort: "newest" }).map(({ id }) => id), ["other-project"]);
});

test("status changes, deletion, duplicate titles and empty results stay keyed by task ID", () => {
  const duplicateA = task("duplicate-a", { title: "Same title", status: "Backlog" });
  const duplicateB = task("duplicate-b", { title: "Same title", status: "Backlog" });
  assert.deepEqual(deriveTaskList([duplicateA, duplicateB], { projectId: "", statusFilter: ["Backlog"], sort: "workspace" }).map(({ id }) => id), ["duplicate-a", "duplicate-b"]);
  assert.deepEqual(deriveTaskList([{ ...duplicateA, status: "Completed" }, duplicateB], { projectId: "", statusFilter: ["Backlog"], sort: "workspace" }).map(({ id }) => id), ["duplicate-b"]);
  assert.deepEqual(deriveTaskList([{ ...duplicateA, status: "Completed" }, duplicateB], { projectId: "", statusFilter: "completed", sort: "workspace" }).map(({ id }) => id), ["duplicate-a"]);
  assert.deepEqual(deriveTaskList([duplicateB], { projectId: "", statusFilter: ["Backlog"], sort: "workspace" }).map(({ id }) => id), ["duplicate-b"]);
  assert.deepEqual(deriveTaskList([duplicateA], { projectId: "", statusFilter: "completed", sort: "workspace" }), []);
  assert.deepEqual(deriveTaskList([duplicateA], { projectId: "", statusFilter: "all", sort: "workspace" }).map(({ id }) => id), ["duplicate-a"]);
});

test("session preference parsers accept supported values and reset malformed values", () => {
  assert.equal(parseTaskListSort("newest"), "newest");
  assert.equal(parseTaskListSort("unknown"), "workspace");
  assert.deepEqual(parseTaskListStatusFilter(JSON.stringify(["Backlog", "Review"])), ["Backlog", "Review"]);
  assert.equal(parseTaskListStatusFilter("[]"), "all");
  assert.equal(parseTaskListStatusFilter("completed"), "completed");
  assert.equal(parseTaskListStatusFilter("not-json"), "all");
  assert.equal(parseTaskListStatusFilter(JSON.stringify(["Made up"])), "all");
});

test("the List view keys each task by ID and exposes a filtered empty state with a clear action", () => {
  const page = readFileSync(new URL("../app/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /visibleTasks\.map\(\(task\) => \(\s*<div key=\{task\.id\}/);
  assert.match(page, /updateTaskStatus\(task\.id, event\.target\.value as Task\["status"\]\)/);
  assert.match(page, /handleDeleteTask\(task\.id\)/);
  assert.match(page, /No tasks match these filters\./);
  assert.match(page, /Clear status filter/);
});
