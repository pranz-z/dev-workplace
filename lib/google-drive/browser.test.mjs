import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const validation = moduleUrl(compile("./validation.ts"));
const client = moduleUrl(compile("./client.ts").replace("@/lib/google-drive/validation", validation));
const browser = await import(moduleUrl(compile("./browser.ts").replace('"./client"', JSON.stringify(client)).replace('"./validation"', JSON.stringify(validation))));
test("multiple dropped files capture project UUID/context and invalid files fail independently", () => {
  const destination = { projectId: "project-uuid", parentId: "folder-uuid", taskId: "task-uuid", label: "Project" };
  const queue = browser.createDriveQueueItems([new File(["one"], "one.txt"), new File(["two"], "two.txt"), new File([], "empty.txt")], destination);
  assert.deepEqual(queue.map((item) => item.state), ["waiting", "waiting", "failed"]);
  destination.projectId = "different";
  assert.equal(queue[0].destination.projectId, "project-uuid"); assert.equal(queue[1].destination.parentId, "folder-uuid");
  assert.equal(new Set(queue.map((item) => item.id)).size, 3);
});
test("queue calls the existing upload pipeline with folder/project/task association", async () => {
  const original = globalThis.fetch; const calls = []; const progress = [];
  const item = browser.createDriveQueueItems([new File(["text"], "file.txt", { type: "text/plain" })], { projectId: "project", parentId: "folder", taskId: "task", label: "Assets" })[0];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json(url === "/api/drive/uploads" ? { uploadId: "session", chunkSize: 4194304 } : init.method === "PUT" ? { nextOffset: 4 } : { file: { id: "done" } }); };
  try {
    const result = await browser.processDriveQueueItem(item, new AbortController().signal, (session) => { item.session = session; }, (offset) => progress.push(offset), () => progress.push("verifying"));
    assert.equal(result.id, "done"); assert.equal(item.session.uploadId, "session");
    assert.deepEqual(JSON.parse(calls[0].init.body), { name: "file.txt", mimeType: "text/plain", sizeBytes: 4, projectId: "project", taskId: "task", parentId: "folder" });
    assert.deepEqual(progress, [4, "verifying"]);
    calls.length = 0; await browser.processDriveQueueItem(item, new AbortController().signal, () => {}, () => {}, () => {});
    assert.equal(calls.length, 1); assert.match(calls[0].url, /complete$/);
  } finally { globalThis.fetch = original; }
});
test("breadcrumbs follow persisted parents and terminate corrupt cycles", () => {
  const folders = [{ id: "project", name: "Project", parent_id: null, mime_type: browser.DRIVE_FOLDER_TYPE }, { id: "assets", name: "Assets", parent_id: "project", mime_type: browser.DRIVE_FOLDER_TYPE }];
  assert.deepEqual(browser.driveFolderTrail(folders, "assets").map((item) => item.name), ["Project", "Assets"]);
  folders[0].parent_id = "assets"; assert.equal(browser.driveFolderTrail(folders, "assets").length, 2);
});
