import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./taskKanban.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildTaskKanbanMove } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const statuses = ["Backlog", "Planned", "In Progress", "Review", "Testing", "Blocked", "Completed"];
const task = (id, status = "Backlog", sortOrder = 1, projectId = "p1") => ({ id, projectId, status, sortOrder });

test("Task Kanban move has one status-based completion path and no completion action", () => {
  const move = buildTaskKanbanMove([task("open")], statuses, "p1", "open", "column:Completed");
  assert.equal(move.destinationStatus, "Completed");
  assert.deepEqual(move.destinationTaskIds, ["open"]);
  assert.equal(move.sourceStatus, "Backlog");
});

test("same-column reorder can move first, middle, and last tasks without losing any card", () => {
  const tasks = [task("a", "Backlog", 1), task("b", "Backlog", 2), task("c", "Backlog", 3)];
  const toEnd = buildTaskKanbanMove(tasks, statuses, "p1", "a", "c");
  assert.deepEqual(toEnd.destinationTaskIds, ["b", "c", "a"]);
  assert.deepEqual(toEnd.sourceTaskIds, ["b", "c"]);
  assert.equal(new Set(toEnd.destinationTaskIds).size, 3);

  const toStart = buildTaskKanbanMove(tasks, statuses, "p1", "c", "a");
  assert.deepEqual(toStart.destinationTaskIds, ["c", "a", "b"]);
  const afterMiddle = buildTaskKanbanMove(tasks, statuses, "p1", "c", "a", true);
  assert.deepEqual(afterMiddle.destinationTaskIds, ["a", "c", "b"]);
  const afterLast = buildTaskKanbanMove(tasks, statuses, "p1", "a", "c", true);
  assert.deepEqual(afterLast.destinationTaskIds, ["b", "c", "a"]);
  assert.equal(buildTaskKanbanMove(tasks, statuses, "p1", "b", "b"), null);
});

test("cross-column move persists destination status and appends when the column is empty", () => {
  const tasks = [task("a", "Backlog", 1), task("b", "Backlog", 2), task("c", "In Progress", 1)];
  const move = buildTaskKanbanMove(tasks, statuses, "p1", "b", "column:Completed");
  assert.deepEqual(move, {
    taskId: "b",
    sourceStatus: "Backlog",
    destinationStatus: "Completed",
    sourceTaskIds: ["a"],
    destinationTaskIds: ["b"],
  });
});

test("cross-column drop can place a card after the last destination card", () => {
  const tasks = [task("source", "Backlog"), task("target", "In Progress", 2)];
  const move = buildTaskKanbanMove(tasks, statuses, "p1", "source", "target", true);
  assert.equal(move.destinationStatus, "In Progress");
  assert.deepEqual(move.destinationTaskIds, ["target", "source"]);
});

test("reopening a completed card targets the real In Progress status", () => {
  const move = buildTaskKanbanMove([task("done", "Completed")], statuses, "p1", "done", "column:In Progress");
  assert.equal(move.destinationStatus, "In Progress");
  assert.deepEqual(move.destinationTaskIds, ["done"]);
});

test("project filters cannot submit mixed or cross-project task order", () => {
  const visible = [task("a", "Backlog", 1), task("b", "Backlog", 2)];
  assert.equal(buildTaskKanbanMove(visible, statuses, "p1", "a", "b").destinationTaskIds.length, 2);
  assert.equal(buildTaskKanbanMove([...visible, task("hidden", "Backlog", 3, "p2")], statuses, "p1", "a", "b"), null);
  assert.equal(buildTaskKanbanMove(visible, statuses, "", "a", "b"), null);
});

test("unknown drag targets are ignored instead of altering status or order", () => {
  assert.equal(buildTaskKanbanMove([task("a")], statuses, "p1", "a", "missing"), null);
});
