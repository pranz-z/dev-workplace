import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path, source = readFileSync(new URL(path, import.meta.url), "utf8")) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const errorsUrl = moduleUrl(compile("./errors.ts"));
const contractUrl = moduleUrl(compile("./chat-contract.ts"));
const chatSource = compile("./chat.ts").replace('import "server-only";', "").replace('"@/lib/ai/errors"', JSON.stringify(errorsUrl)).replace('"@/lib/ai/chat-contract"', JSON.stringify(contractUrl));
const chat = await import(moduleUrl(chatSource));
const dragSource = compile("./chat-drag.ts");
const drag = await import(moduleUrl(dragSource));
const chatFilesSource = compile("./chat-files.ts").replace('import "server-only";', "").replace('"@/lib/ai/errors"', JSON.stringify(errorsUrl)).replace('"@/lib/ai/chat-contract"', JSON.stringify(contractUrl));
const chatFiles = await import(moduleUrl(chatFilesSource));
const contextSource = compile("./chat-context.ts").replace('import "server-only";', "").replace('"@/lib/ai/errors"', JSON.stringify(errorsUrl));
const contextBuilder = await import(moduleUrl(contextSource));
const { greetingPeriodAt, greetingPeriodLabel, safeTimeZone } = await import(moduleUrl(compile("../workspace-greeting.ts")));

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  other: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  task: "44444444-4444-4444-8444-444444444444",
  plan: "55555555-5555-4555-8555-555555555555",
};

test("greeting covers local morning, afternoon, evening, and profile timezone", () => {
  assert.equal(greetingPeriodLabel(greetingPeriodAt(new Date("2026-10-02T09:00:00Z"), "UTC")), "Good morning");
  assert.equal(greetingPeriodLabel(greetingPeriodAt(new Date("2026-10-02T14:00:00Z"), "UTC")), "Good afternoon");
  assert.equal(greetingPeriodLabel(greetingPeriodAt(new Date("2026-10-02T20:00:00Z"), "UTC")), "Good evening");
  assert.equal(greetingPeriodLabel(greetingPeriodAt(new Date("2026-10-02T13:00:00Z"), "America/Los_Angeles")), "Good morning");
  assert.equal(safeTimeZone("not/a-zone", "Asia/Manila"), "Asia/Manila");
});

test("private chat validates messages, deduplicates IDs, and caps workspace context/history", () => {
  const context = Array.from({ length: 8 }, (_, index) => ({ type: "project", id: `${index + 1}1111111-1111-4111-8111-111111111111` }));
  const parsed = chat.parseChatRequest({ message: " Compare these ", history: Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `turn ${index}` })), workspaceContext: [...context, context[0]] });
  assert.equal(parsed.message, "Compare these");
  assert.equal(parsed.history.length, 8);
  assert.equal(parsed.history[0].content, "turn 2");
  assert.equal(parsed.workspaceContext.length, 8);
  assert.throws(() => chat.parseChatRequest({ message: "", history: [], workspaceContext: [] }), { code: "INVALID_INPUT" });
  assert.throws(() => chat.parseChatRequest({ message: "x", workspaceContext: Array.from({ length: 9 }, (_, i) => ({ type: "project", id: `${i + 1}1111111-1111-4111-8111-111111111111` })) }), { code: "INVALID_INPUT" });
});

test("workspace drag payload carries only the entity type and real ID", () => {
  const reference = { type: "project", id: ids.project };
  const payload = JSON.parse(drag.workspaceEntityDragPayload(reference));
  assert.deepEqual(payload, reference);
  assert.deepEqual(drag.parseWorkspaceEntityDragPayload(JSON.stringify(payload)), reference);
});

function fakeSupabase(overrides = {}) {
  const rows = {
    projects: overrides.projects ?? [{ id: ids.project, user_id: ids.user, title: "Private project", description: "Description", status: "Active", workflow_stage: "development", role: "Developer", project_type: "Web", current_objective: "Ship safely", next_action: "Review", priority: "High", target_date: null }],
    tasks: overrides.tasks ?? [{ id: ids.task, user_id: ids.user, project_id: ids.project, title: "Private task", description: "Task detail", status: "Planned", priority: "Medium", due_date: null }],
    plans: overrides.plans ?? [{ id: ids.plan, user_id: ids.user, title: "Launch plan", description: "Goal", status: "Active", target_date: null }],
    project_plan_items: [{ plan_id: ids.plan, label: "Review", done: false }],
  };
  return { from(table) {
    const filters = [];
    const builder = {
      select() { return builder; }, eq(key, value) { filters.push([key, value]); return builder; }, order() { return builder; }, limit() { return builder; },
      maybeSingle() { return Promise.resolve(run(true)); },
      then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject); },
    };
    function run(single) {
      const matching = (rows[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
      return { data: single ? matching[0] ?? null : matching, error: null };
    }
    return builder;
  } };
}

test("private context re-fetches and checks project, task, parent project, and plan ownership", async () => {
  const context = await contextBuilder.buildPrivateChatContext(fakeSupabase(), ids.user, [
    { type: "project", id: ids.project }, { type: "task", id: ids.task }, { type: "plan", id: ids.plan },
  ]);
  assert.deepEqual(context.map((item) => item.type), ["project", "task", "plan"]);
  assert.equal(JSON.stringify(context).includes(ids.user), false);
  await assert.rejects(contextBuilder.buildPrivateChatContext(fakeSupabase({ tasks: [{ id: ids.task, user_id: ids.other, project_id: ids.project, title: "Other", description: "", status: "Planned", priority: "Low", due_date: null }] }), ids.user, [{ type: "task", id: ids.task }]), { code: "FORBIDDEN" });
  await assert.rejects(contextBuilder.buildPrivateChatContext(fakeSupabase({ tasks: [{ id: ids.task, user_id: ids.user, project_id: ids.project, title: "Task", description: "", status: "Planned", priority: "Low", due_date: null }], projects: [{ id: ids.project, user_id: ids.other, title: "Other project" }] }), ids.user, [{ type: "task", id: ids.task }]), { code: "FORBIDDEN" });
  await assert.rejects(contextBuilder.buildPrivateChatContext(fakeSupabase({ projects: [{ id: ids.project, user_id: ids.other, title: "Other project" }] }), ids.user, [{ type: "project", id: ids.project }]), { code: "FORBIDDEN" });
  await assert.rejects(contextBuilder.buildPrivateChatContext(fakeSupabase({ plans: [{ id: ids.plan, user_id: ids.other, title: "Other plan" }] }), ids.user, [{ type: "plan", id: ids.plan }]), { code: "FORBIDDEN" });
});

test("file validation accepts text and supported images while rejecting unsupported, oversized, too many, and aggregate payloads", async () => {
  const accepted = await chatFiles.validateChatFiles([new File(["hello"], "readme.md", { type: "text/markdown" })]);
  assert.equal(accepted[0].text, "hello");
  await assert.rejects(chatFiles.validateChatFiles([new File(["no"], "tool.exe", { type: "application/octet-stream" })]), { code: "INVALID_ATTACHMENT" });
  await assert.rejects(chatFiles.validateChatFiles([new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" })]), { code: "INVALID_ATTACHMENT" });
  await assert.rejects(chatFiles.validateChatFiles(Array.from({ length: 6 }, (_, i) => new File(["x"], `${i}.txt`, { type: "text/plain" }))), { code: "INVALID_ATTACHMENT" });
  await assert.rejects(chatFiles.validateChatFiles(Array.from({ length: 3 }, (_, i) => new File([new Uint8Array(1_500_000)], `${i}.txt`, { type: "text/plain" }))), { code: "INVALID_ATTACHMENT" });
  const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "tiny.png", { type: "image/png" });
  assert.equal((await chatFiles.validateChatFiles([png]))[0].mimeType, "image/png");
});

test("chat security routes require authenticated rate-limited private requests and do not write workspace data", () => {
  const route = readFileSync(new URL("../../app/api/ai/chat/route.ts", import.meta.url), "utf8");
  const builder = readFileSync(new URL("./chat-context.ts", import.meta.url), "utf8");
  const gemini = readFileSync(new URL("./chat-gemini.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../../components/ai/WorkspaceAiChat.tsx", import.meta.url), "utf8");
  assert.match(route, /requireAuthenticatedAiUser/);
  assert.match(route, /consume_private_ai_rate_limit/);
  assert.match(route, /buildPrivateChatContext/);
  assert.match(builder, /\.eq\("user_id", userId\)/);
  assert.doesNotMatch(builder, /\.from\([^\n]+\)\.(?:insert|update|upsert|delete)/);
  assert.match(gemini, /untrusted reference data/);
  assert.doesNotMatch(gemini, /console\.(?:log|info|error)/);
  const dropHandler = client.slice(client.indexOf("const handleDrop"), client.indexOf("const clearChat"));
  assert.doesNotMatch(dropHandler, /fetch\(/);
  assert.match(client, /type="file"/);
  assert.match(client, /Add context/);
});

test("public chat keeps public limiter and independent context; shared UI is presentation-only", () => {
  const route = readFileSync(new URL("../../app/api/public-ai/route.ts", import.meta.url), "utf8");
  const publicHandler = readFileSync(new URL("../public-ai/handler.ts", import.meta.url), "utf8");
  const presentation = readFileSync(new URL("../../components/ai/ChatPresentation.tsx", import.meta.url), "utf8");
  assert.match(route, /consumePublicAiRateLimit|PUBLIC_AI_DAILY_LIMIT|consume_public_ai/);
  assert.match(publicHandler, /buildPublicDeveloperContext/);
  assert.match(publicHandler, /body\.history\.map/);
  assert.doesNotMatch(publicHandler, /chat-context|private workspace/);
  assert.doesNotMatch(presentation, /fetch\(|api\/ai|Supabase|local file/i);
});
