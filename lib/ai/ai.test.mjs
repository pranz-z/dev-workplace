import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path, source = readFileSync(new URL(path, import.meta.url), "utf8")) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const errorsUrl = moduleUrl(compile("./errors.ts"));
const selection = await import(moduleUrl(compile("./selection.ts")));
const schemaSource = readFileSync(new URL("./schemas.ts", import.meta.url), "utf8").replace('"@/lib/ai/errors"', JSON.stringify(errorsUrl));
const schemas = await import(moduleUrl(compile("./schemas.ts", schemaSource)));
const errors = await import(errorsUrl);
const config = await import(moduleUrl(compile("./config.ts").replace('import "server-only";', "")));
const rateLimitSource = readFileSync(new URL("./rate-limit.ts", import.meta.url), "utf8")
  .replace('import "server-only";', "")
  .replace('"@/lib/ai/errors"', JSON.stringify(errorsUrl));
const rateLimit = await import(moduleUrl(compile("./rate-limit.ts", rateLimitSource)));
const providerSource = readFileSync(new URL("./provider.ts", import.meta.url), "utf8")
  .replace('"@/lib/ai/errors"', JSON.stringify(errorsUrl))
  .replace('"@/lib/ai/schemas"', JSON.stringify(moduleUrl(compile("./schemas.ts", schemaSource))));
const provider = await import(moduleUrl(compile("./provider.ts", providerSource)));
const authSource = readFileSync(new URL("./auth.ts", import.meta.url)).toString().replace('"@/lib/ai/errors"', JSON.stringify(errorsUrl));
const auth = await import(moduleUrl(compile("./auth.ts", authSource)));
const githubContextStub = moduleUrl("export async function loadProjectGithubActivity() { return []; }");
const contextSource = readFileSync(new URL("./context.ts", import.meta.url), "utf8")
  .replace('import "server-only";', "")
  .replace('"@/lib/ai/errors"', JSON.stringify(errorsUrl))
  .replace('"@/lib/ai/schemas"', JSON.stringify(moduleUrl(compile("./schemas.ts", schemaSource))))
  .replace('"@/lib/ai/githubContext"', JSON.stringify(githubContextStub));
const contextModule = await import(moduleUrl(compile("./context.ts", contextSource)));

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const noteId = "55555555-5555-4555-8555-555555555555";
const projectRow = { id: projectId, user_id: ownerId, title: "Example", description: "A private project", project_type: "Personal", role: "Developer", team_size: 1, status: "In Development", workflow_stage: "development", current_objective: "Ship safely", next_action: "Review the build", priority: "Medium", target_date: null, public_problem: null, public_solution: null, public_result: null, public_summary: null };

function fakeSupabase({ tasks = [], notes = [], user = ownerId } = {}) {
  const calls = [];
  const tableRows = {
    projects: [projectRow],
    project_technologies: [],
    tasks,
    milestones: [],
    plans: [],
    plan_items: [],
    notes,
  };
  class Query {
    constructor(table) { this.table = table; this.filters = {}; }
    select() { return this; }
    eq(key, value) { this.filters[key] = value; return this; }
    in(key, value) { this.filters[key] = value; return this; }
    order() { return this; }
    limit() { return this; }
    matches(row) { return Object.entries(this.filters).every(([key, value]) => key === "status" && Array.isArray(value) ? value.includes(row[key]) : key === "plan_id" && Array.isArray(value) ? value.includes(row[key]) : row[key] === value); }
    rows() { return (tableRows[this.table] ?? []).filter((row) => this.matches(row)); }
    maybeSingle() { calls.push(this.table); return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
    then(resolve, reject) { calls.push(this.table); return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject); }
  }
  return { calls, client: { from(table) { return new Query(table); } }, user };
}

test("A: unauthenticated AI requests are rejected before context access", async () => {
  await assert.rejects(() => auth.requireAuthenticatedAiUser({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }), (error) => error.code === "UNAUTHENTICATED");
});

test("B: an owner-scoped project lookup rejects another user's project", async () => {
  const mock = fakeSupabase({ user: otherUserId });
  await assert.rejects(() => contextModule.buildAiContext(mock.client, otherUserId, { action: "improve_description", projectId }), (error) => error.code === "FORBIDDEN");
  assert.deepEqual(mock.calls, ["projects"]);
});

test("C: malformed requests and oversized user input are rejected", () => {
  assert.throws(() => schemas.parseAiRequest({ action: "next_actions" }), (error) => error.code === "INVALID_INPUT");
  assert.throws(() => schemas.parseAiRequest({ action: "ask_project", projectId, question: "x".repeat(1001) }), (error) => error.code === "INVALID_INPUT");
  assert.throws(() => schemas.parseAiRequest({ action: "break_task", taskId: "not-a-uuid" }), (error) => error.code === "INVALID_INPUT");
});

test("D: mocked Gemini call uses JSON schema and valid output is accepted", async () => {
  const expected = { suggestions: [1, 2, 3].map((n) => ({ title: `Action ${n}`, rationale: "Grounded in the project.", priority: "medium" })) };
  const result = await provider.generateWithProvider("next_actions", "system", { project: "minimum context" }, "test-model", async (request) => {
    assert.equal(request.model, "test-model");
    assert.equal(request.config.responseMimeType, "application/json");
    assert.equal(request.config.responseJsonSchema.type, "object");
    assert.equal(request.contents, JSON.stringify({ project: "minimum context" }));
    return { text: JSON.stringify(expected) };
  });
  assert.deepEqual(schemas.validateAiOutput("next_actions", result), {
    suggestions: [1, 2, 3].map((n) => ({ title: `Action ${n}`, rationale: "Grounded in the project.", priority: "medium" })),
  });
});

test("E: malformed mocked Gemini output is rejected without returning partial items", async () => {
  await assert.rejects(() => provider.generateWithProvider("break_project", "system", {}, "test-model", async () => ({ text: "not json" })), (error) => error.code === "MALFORMED_OUTPUT");
  const incomplete = await provider.generateWithProvider("break_project", "system", {}, "test-model", async () => ({ text: JSON.stringify({ tasks: [{ title: "Only one", description: "Partial", priority: "medium" }] }) }));
  assert.throws(() => schemas.validateAiOutput("break_project", incomplete), (error) => error.code === "MALFORMED_OUTPUT");
});

test("F and L: server path contains no workspace writes; proposals are preview data", () => {
  const route = readFileSync(new URL("../../app/api/ai/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /\.from\([^)]*\)\s*\.\s*(?:insert|update|delete)\s*\(/);
  assert.match(route, /validateAiOutput/);
  assert.match(route, /consume_private_ai_rate_limit/);
  assert.ok(route.indexOf("consume_private_ai_rate_limit") < route.indexOf("const context = await buildAiContext"));
});

test("public portfolio routes do not import or call the AI assistant", () => {
  const publicFiles = ["../../app/view/page.tsx", "../../app/view/project/[slug]/page.tsx"];
  for (const file of publicFiles) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /AiAssistant|\/api\/ai/);
  }
});

test("G: notes are excluded unless selected for an unrelated project action", async () => {
  const mock = fakeSupabase({ notes: [{ id: noteId, user_id: ownerId, project_id: projectId, title: "Private note", content: "Secret notes" }] });
  const result = await contextModule.buildAiContext(mock.client, ownerId, { action: "progress_summary", projectId, context: { tasks: false, milestones: false, notes: false, github: false } });
  assert.equal("notes" in result, false);
  assert.equal(mock.calls.includes("notes"), false);
});

test("H: GitHub activity is excluded by default and sanitizer strips non-allowlisted fields", () => {
  const rows = schemas.sanitizeGithubActivity({ commits: [{ title: "Safe title", occurredAt: "2026-01-01", author: "private author", token: "secret" }] });
  assert.deepEqual(rows, [{ kind: "commit", title: "Safe title", occurredAt: "2026-01-01" }]);
  assert.equal(JSON.stringify(rows).includes("secret"), false);
});

test("I: explicitly selected Notes and GitHub context are included in bounded form", async () => {
  const mock = fakeSupabase({ notes: [{ id: noteId, user_id: ownerId, project_id: projectId, title: "Context note", content: "Selected note" }] });
  const result = await contextModule.buildAiContext(mock.client, ownerId, {
    action: "ask_project", projectId, question: "What next?",
    context: { projectDetails: true, tasks: false, milestones: false, notes: true, github: true },
  }, async () => schemas.sanitizeGithubActivity({ commits: [{ title: "Commit title", occurredAt: "2026-02-01", token: "must not pass" }] }));
  assert.equal(result.notes[0].content, "Selected note");
  assert.deepEqual(result.githubActivity, [{ kind: "commit", title: "Commit title", occurredAt: "2026-02-01" }]);
  assert.equal(JSON.stringify(result).includes("must not pass"), false);
});

test("J: quota/rate failures become a safe normalized error", () => {
  const error = errors.normalizeGeminiError({ status: 429, message: "resource exhausted private detail" });
  assert.equal(error.code, "RATE_LIMITED");
  assert.equal(error.message, "The AI assistant has reached its current request limit. Try again later.");
  assert.equal(error.message.includes("private detail"), false);
});

test("K: missing or malformed Gemini configuration is reported without a secret", () => {
  assert.deepEqual(config.getGeminiConfiguration({}), { configured: false, model: null });
  assert.deepEqual(config.getGeminiConfiguration({ GEMINI_API_KEY: "key", GEMINI_MODEL: "invalid model" }), { configured: false, model: null });
  const configured = config.getGeminiConfiguration({ GEMINI_API_KEY: "server-secret", GEMINI_MODEL: "gemini-3.7-flash" });
  assert.equal(configured.configured, true);
  assert.equal(configured.model, "gemini-3.7-flash");
  assert.equal(JSON.stringify({ configured: configured.configured, model: configured.model }).includes("server-secret"), false);
});

test("private AI rate-limit configuration uses bounded server defaults and rejects invalid overrides", () => {
  const originalMinute = process.env.PRIVATE_AI_REQUESTS_PER_MINUTE;
  const originalDaily = process.env.PRIVATE_AI_DAILY_LIMIT;
  try {
    delete process.env.PRIVATE_AI_REQUESTS_PER_MINUTE;
    delete process.env.PRIVATE_AI_DAILY_LIMIT;
    assert.deepEqual(rateLimit.getPrivateAiRateLimits(), { requestsPerMinute: 10, dailyLimit: 100 });
    process.env.PRIVATE_AI_REQUESTS_PER_MINUTE = "20";
    process.env.PRIVATE_AI_DAILY_LIMIT = "1000";
    assert.deepEqual(rateLimit.getPrivateAiRateLimits(), { requestsPerMinute: 20, dailyLimit: 1000 });
    process.env.PRIVATE_AI_DAILY_LIMIT = "1001";
    assert.throws(() => rateLimit.getPrivateAiRateLimits(), (error) => error.code === "AI_NOT_CONFIGURED");
  } finally {
    if (originalMinute === undefined) delete process.env.PRIVATE_AI_REQUESTS_PER_MINUTE;
    else process.env.PRIVATE_AI_REQUESTS_PER_MINUTE = originalMinute;
    if (originalDaily === undefined) delete process.env.PRIVATE_AI_DAILY_LIMIT;
    else process.env.PRIVATE_AI_DAILY_LIMIT = originalDaily;
  }
});

test("M: progress result schema cannot represent or alter accountability scores", () => {
  const valid = { summary: "A clear summary.", completedHighlights: [], attentionItems: [], suggestedNextSteps: [] };
  assert.doesNotThrow(() => schemas.validateAiOutput("progress_summary", valid));
  assert.throws(() => schemas.validateAiOutput("progress_summary", { ...valid, accountabilityScore: 100 }), (error) => error.code === "MALFORMED_OUTPUT");
});

test("N: project context query caps result counts and trims long descriptions", async () => {
  const tasks = Array.from({ length: 35 }, (_, index) => ({ id: `task-${index}`, user_id: ownerId, project_id: projectId, title: "T".repeat(300), description: "D".repeat(900), status: "Backlog", priority: "Medium", due_date: null }));
  const mock = fakeSupabase({ tasks });
  const result = await contextModule.buildAiContext(mock.client, ownerId, { action: "next_actions", projectId });
  assert.equal(result.tasks.length, 30);
  assert.equal(result.tasks[0].title.length, 180);
  assert.equal(result.tasks[0].description.length, 600);
});

test("case-study output contains only preview fields and rejects fabricated extras", () => {
  const caseStudy = { summary: "Summary", challenge: "Challenge", solution: "Solution", outcome: "Outcome" };
  assert.deepEqual(schemas.validateAiOutput("draft_case_study", caseStudy), caseStudy);
  assert.throws(() => schemas.validateAiOutput("draft_case_study", { ...caseStudy, published: true }), (error) => error.code === "MALFORMED_OUTPUT");
});

test("AI proposal lists start with no selected items", () => {
  const suggestions = ["A", "B", "C"];
  const selected = selection.clearAiSelection();
  const component = readFileSync(new URL("../../components/ai/AiAssistant.tsx", import.meta.url), "utf8");
  assert.equal(suggestions.length, 3);
  assert.deepEqual(selected, []);
  assert.equal(selection.hasAiSelection(selected), false);
  assert.match(component, /const \[selected, setSelected\] = useState<number\[]>\(\[\]\);/);
  assert.doesNotMatch(component, /setSelected\(payload\.output\.(?:tasks|suggestions|actions)\.map/);
});

test("selecting one proposal selects only that item", () => {
  const selected = selection.toggleAiSelection([], 1);
  assert.deepEqual(selected, [1]);
});

test("regeneration, close, and discard clear proposal selection", () => {
  assert.deepEqual(selection.clearAiSelection(), []);
  const component = readFileSync(new URL("../../components/ai/AiAssistant.tsx", import.meta.url), "utf8");
  const generate = component.slice(component.indexOf("const generate = async () => {"), component.indexOf("const withNotice = async"));
  assert.match(generate, /setSelected\(clearAiSelection\(\)\);/);
  assert.match(component, /aria-label="Close AI assistant"[^\n]*setSelected\(clearAiSelection\(\)\)/);
  assert.match(component, /onClick=\{\(\) => \{ setOutput\(null\); setSelected\(clearAiSelection\(\)\); \}\} disabled=\{busy\} className="dark-chip px-3 py-2 text-sm">Discard result/);
});

test("bulk actions are unavailable with no selection", () => {
  assert.equal(selection.hasAiSelection([]), false);
  const component = readFileSync(new URL("../../components/ai/AiAssistant.tsx", import.meta.url), "utf8");
  assert.equal((component.match(/disabled=\{busy \|\| !hasAiSelection\(selected\)/g) ?? []).length, 2);
});

test("bulk creation receives only explicitly selected proposals", () => {
  const proposals = ["A", "B", "C"];
  const selected = selection.toggleAiSelection(selection.toggleAiSelection([], 0), 2);
  assert.deepEqual(selection.getSelectedAiItems(proposals, selected), ["A", "C"]);
});
