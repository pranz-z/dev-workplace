import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  let source = readFileSync(new URL(`../../../${path}.ts`, import.meta.url), "utf8").replace(/import "server-only";/g, "");
  source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/"@\/([^"\n]+)"/g, (_, dependency) => JSON.stringify(load(dependency)));
  const result = url(source);
  cache.set(path, result);
  return result;
}

let transport;
try { transport = await import(load("lib/ai/agent/gemini-transport")); } catch { transport = null; }
const { classifyGeminiFailure, retryGeminiTransport } = transport ?? {};

test("retry transport implementation is present", () => {
  assert.ok(transport, "Agent transport retry helper does not exist yet");
});

test("Gemini SDK exposes HTTP status but drops response headers and error code", { skip: !transport }, async () => {
  const ai = new GoogleGenAI({
    apiKey: "test-key-never-sent",
    httpOptions: { fetch: async () => new Response(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "safe fixture" } }), { status: 503, statusText: "Service Unavailable", headers: { "retry-after": "1" } }) },
  });
  await assert.rejects(ai.models.generateContent({ model: "fixture-model", contents: "Reply with OK." }), (error) => {
    assert.equal(error.name, "ApiError");
    assert.equal(error.status, 503);
    assert.equal(error.code, undefined);
    assert.equal(error.response, undefined);
    return true;
  });
});

test("503 then success retries once and returns the successful transport result", { skip: !transport }, async () => {
  const errors = [];
  const delays = [];
  let calls = 0;
  const result = await retryGeminiTransport(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("private provider body"), { name: "ApiError", status: 503 });
    return "response";
  }, { deadlineAt: 100_000, now: () => 1_000, random: () => 0, sleep: async (delay) => delays.push(delay), log: (_message, fields) => errors.push(fields) });
  assert.equal(result, "response");
  assert.equal(calls, 2);
  assert.equal(errors[0].upstreamStatus, 503);
  assert.equal(errors[0].attempt, 1);
  assert.equal(errors[0].retryable, true);
  assert.equal(errors[0].terminalReason, "retry_scheduled");
  assert.deepEqual(delays, [500]);
});

test("502 then 503 then success uses at most three transport attempts", { skip: !transport }, async () => {
  const statuses = [502, 503];
  const delays = [];
  let calls = 0;
  const result = await retryGeminiTransport(async () => {
    calls++;
    if (statuses.length) throw Object.assign(new Error("provider unavailable"), { status: statuses.shift() });
    return "ok";
  }, { deadlineAt: 100_000, now: () => 1_000, random: () => 1, sleep: async (delay) => delays.push(delay) });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1_000, 2_500]);
});

test("three transient failures stop after three calls and preserve the final provider error", { skip: !transport }, async () => {
  let calls = 0;
  const last = Object.assign(new Error("private provider body"), { status: 503 });
  await assert.rejects(retryGeminiTransport(async () => { calls++; throw last; }, {
    deadlineAt: 100_000, now: () => 1_000, random: () => 0, sleep: async () => {},
  }), (error) => error === last);
  assert.equal(calls, 3);
});

test("permanent HTTP failures and unqualified 429 are never retried", { skip: !transport }, async () => {
  for (const status of [408, 500, 502, 503, 504]) assert.equal(classifyGeminiFailure({ status }).retryable, true);
  for (const status of [400, 401, 403, 404, 429]) {
    let calls = 0;
    const error = Object.assign(new Error("private provider detail"), { status });
    assert.equal(classifyGeminiFailure(error).retryable, false);
    await assert.rejects(retryGeminiTransport(async () => { calls++; throw error; }, {
      deadlineAt: 100_000, now: () => 1_000, random: () => 0, sleep: async () => {},
    }), (caught) => caught === error);
    assert.equal(calls, 1, `HTTP ${status} call count`);
  }
});

test("an identified network interruption retries and succeeds", { skip: !transport }, async () => {
  let calls = 0;
  const networkError = new TypeError("fetch failed", { cause: Object.assign(new Error("private socket detail"), { code: "ECONNRESET" }) });
  const result = await retryGeminiTransport(async () => {
    calls++;
    if (calls === 1) throw networkError;
    return "recovered";
  }, { deadlineAt: 100_000, now: () => 1_000, random: () => 0, sleep: async () => {} });
  assert.equal(result, "recovered");
  assert.equal(calls, 2);
  assert.equal(classifyGeminiFailure(networkError).category, "transport");
  assert.equal(classifyGeminiFailure(new TypeError("Failed to parse response")).retryable, false);
});

test("an aborted Agent request never starts another transport attempt", { skip: !transport }, async () => {
  let calls = 0;
  const controller = new AbortController();
  const error = Object.assign(new Error("private provider detail"), { status: 503 });
  await assert.rejects(retryGeminiTransport(async () => {
    calls++;
    controller.abort(new DOMException("The operation was aborted", "AbortError"));
    throw error;
  }, { signal: controller.signal, deadlineAt: 100_000, now: () => 1_000, random: () => 0, sleep: async () => {} }));
  assert.equal(calls, 1);
});

test("abort during or immediately after retry wait prevents another request", { skip: !transport }, async () => {
  for (const timing of ["during", "after"]) {
    let calls = 0;
    const controller = new AbortController();
    const reason = new DOMException("The operation was aborted", "AbortError");
    const sleep = timing === "during"
      ? async (_delay, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        controller.abort(reason);
      })
      : async () => { controller.abort(reason); };
    await assert.rejects(retryGeminiTransport(async () => {
      calls++;
      throw Object.assign(new Error("temporary"), { status: 503 });
    }, { signal: controller.signal, deadlineAt: 100_000, now: () => 1_000, random: () => 0, sleep }), (error) => error === reason);
    assert.equal(calls, 1, `${timing} wait abort`);
  }
});

test("insufficient remaining deadline budget prevents another transport attempt", { skip: !transport }, async () => {
  let calls = 0;
  await assert.rejects(retryGeminiTransport(async () => {
    calls++;
    throw Object.assign(new Error("temporary"), { status: 503 });
  }, { deadlineAt: 10_999, now: () => 1_000, random: () => 0, sleep: async () => {} }));
  assert.equal(calls, 1);
});

test("pre-wait exact delay-plus-budget boundary blocks retry", { skip: !transport }, async () => {
  const clock = { now: 1_000, calls: 0, sleeps: [] };
  await assert.rejects(retryGeminiTransport(async () => {
    clock.calls++;
    throw Object.assign(new Error("temporary"), { status: 503 });
  }, { deadlineAt: 11_500, now: () => clock.now, random: () => 0, sleep: async (delay) => clock.sleeps.push(delay) }));
  assert.equal(clock.calls, 1);
  assert.deepEqual(clock.sleeps, []);
});

test("pre-wait one millisecond above delay-plus-budget allows retry", { skip: !transport }, async () => {
  const clock = { now: 1_000, calls: 0, sleeps: [] };
  const result = await retryGeminiTransport(async () => {
    clock.calls++;
    if (clock.calls === 1) throw Object.assign(new Error("temporary"), { status: 503 });
    return "ok";
  }, { deadlineAt: 11_501, now: () => clock.now, random: () => 0, sleep: async (delay) => clock.sleeps.push(delay) });
  assert.equal(result, "ok");
  assert.equal(clock.calls, 2);
  assert.deepEqual(clock.sleeps, [500]);
});

test("post-wait exact 10-second boundary blocks retry", { skip: !transport }, async () => {
  const clock = { now: 1_000, calls: 0, sleeps: [] };
  await assert.rejects(retryGeminiTransport(async () => {
    clock.calls++;
    throw Object.assign(new Error("temporary"), { status: 503 });
  }, { deadlineAt: 11_502, now: () => clock.now, random: () => 0, sleep: async (delay) => { clock.sleeps.push(delay); clock.now += delay + 2; } }));
  assert.equal(clock.calls, 1);
  assert.deepEqual(clock.sleeps, [500]);
});

test("post-wait one millisecond above 10 seconds allows retry", { skip: !transport }, async () => {
  const clock = { now: 1_000, calls: 0, sleeps: [] };
  const result = await retryGeminiTransport(async () => {
    clock.calls++;
    if (clock.calls === 1) throw Object.assign(new Error("temporary"), { status: 503 });
    return "ok";
  }, { deadlineAt: 11_503, now: () => clock.now, random: () => 0, sleep: async (delay) => { clock.sleeps.push(delay); clock.now += delay + 2; } });
  assert.equal(result, "ok");
  assert.equal(clock.calls, 2);
  assert.deepEqual(clock.sleeps, [500]);
});

test("Production Agent adapter retries one 503 and returns its successful answer", { skip: !transport }, async () => {
  const state = { calls: 0, responses: [Object.assign(new Error("provider detail"), { status: 503 }), { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Milestone is active." }] } }] }] };
  globalThis.__agentTestGeminiState = state;
  const originalWarn = console.warn;
  console.warn = () => {};
  let source = readFileSync(new URL("./gemini.ts", import.meta.url), "utf8").replace('import "server-only";', "");
  source = source.replace('"@google/genai"', JSON.stringify(url(`export class GoogleGenAI { constructor() { this.models = { generateContent: async () => { const state = globalThis.__agentTestGeminiState; state.calls++; const response = state.responses.shift(); if (response instanceof Error) throw response; return response; } }; } }`)));
  source = source.replace('"@/lib/ai/config"', JSON.stringify(url('export const getGeminiConfiguration = () => ({ configured: true, apiKey: "test-key-never-sent", model: "fixture-model" });')));
  source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/"@\/([^"\n]+)"/g, (_, dependency) => JSON.stringify(load(dependency)));
  try {
    const { generateAgentResponse } = await import(url(source));
    const result = await generateAgentResponse({ message: "Read the milestone", history: [], timeZone: "UTC" }, {
      supabase: {}, userId: "owner", timeZone: "UTC", now: new Date("2026-10-14T00:00:00Z"), signal: new AbortController().signal, deadlineAt: Date.now() + 30_000,
    });
    assert.equal(result.answer, "Milestone is active.");
    assert.equal(state.calls, 2);
  } finally {
    console.warn = originalWarn;
    delete globalThis.__agentTestGeminiState;
  }
});

test("Agent fallback deadline is shared by every model round", { skip: !transport }, async () => {
  const state = { calls: 0 };
  globalThis.__agentTestGeminiState = state;
  const originalWarn = console.warn;
  const originalNow = Date.now;
  Date.now = () => state.calls === 0 ? 1_000 : 50_000;
  console.warn = () => {};
  let source = readFileSync(new URL("./gemini.ts", import.meta.url), "utf8").replace('import "server-only";', "");
  source = source.replace('"@google/genai"', JSON.stringify(url(`export class GoogleGenAI { constructor() { this.models = { generateContent: async () => { const state = globalThis.__agentTestGeminiState; state.calls++; if (state.calls === 1) return { candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "list_projects", args: {} } }] } }] }; throw Object.assign(new Error("temporary"), { status: 503 }); } }; } }`)));
  source = source.replace('"@/lib/ai/config"', JSON.stringify(url('export const getGeminiConfiguration = () => ({ configured: true, apiKey: "test-key-never-sent", model: "fixture-model" });')));
  source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/"@\/([^"\n]+)"/g, (_, dependency) => JSON.stringify(load(dependency)));
  const from = () => ({ select() { return this; }, order() { return this; }, abortSignal() { return this; }, eq() { return this; }, async range() { return { data: [], error: null }; } });
  try {
    const { generateAgentResponse } = await import(url(source));
    await assert.rejects(generateAgentResponse({ message: "List projects", history: [], timeZone: "UTC" }, {
      supabase: { from }, userId: "owner", timeZone: "UTC", now: new Date("2026-10-14T00:00:00Z"), signal: new AbortController().signal,
    }), (error) => error.code === "UPSTREAM_ERROR");
    assert.equal(state.calls, 2);
  } finally {
    Date.now = originalNow;
    console.warn = originalWarn;
    delete globalThis.__agentTestGeminiState;
  }
});

test("successful HTTP response with malformed model output is not retried", { skip: !transport }, async () => {
  let source = readFileSync(new URL("./gemini.ts", import.meta.url), "utf8").replace('import "server-only";', "");
  globalThis.__agentTestGeminiState = { calls: 0, responses: [{ candidates: [] }] };
  source = source.replace('"@google/genai"', JSON.stringify(url(`export class GoogleGenAI { constructor() { this.models = { generateContent: async () => { globalThis.__agentTestGeminiState.calls++; return globalThis.__agentTestGeminiState.responses.shift(); } }; } }`)));
  source = source.replace('"@/lib/ai/config"', JSON.stringify(url('export const getGeminiConfiguration = () => ({ configured: true, apiKey: "test-key-never-sent", model: "fixture-model" });')));
  source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/"@\/([^"\n]+)"/g, (_, dependency) => JSON.stringify(load(dependency)));
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { generateAgentResponse } = await import(url(source));
    await assert.rejects(generateAgentResponse({ message: "Read", history: [], timeZone: "UTC" }, {
      supabase: {}, userId: "owner", timeZone: "UTC", now: new Date("2026-10-14T00:00:00Z"), signal: new AbortController().signal,
    }), (error) => error.code === "MALFORMED_OUTPUT");
    assert.equal(globalThis.__agentTestGeminiState.calls, 1);
  } finally {
    console.warn = originalWarn;
    delete globalThis.__agentTestGeminiState;
  }
});

test("successful tool response executes once; a later round retries without replaying it", { skip: !transport }, async () => {
  const { runAgentLoop } = await import(load("lib/ai/agent/executor"));
  let modelCalls = 0;
  let toolCalls = 0;
  const result = await runAgentLoop({ message: "List projects", history: [], timeZone: "UTC" }, { signal: new AbortController().signal, timeZone: "UTC" }, async () => retryGeminiTransport(async () => {
    modelCalls++;
    if (modelCalls === 1) return { parts: [{ functionCall: { name: "list_projects", args: {} } }] };
    if (modelCalls === 2) throw Object.assign(new Error("temporary"), { status: 503 });
    return { parts: [{ text: "done" }] };
  }, { deadlineAt: 100_000, now: () => 1_000, random: () => 0, sleep: async () => {} }), async () => { toolCalls++; return { items: [] }; });
  assert.equal(result.answer, "done");
  assert.equal(modelCalls, 3);
  assert.equal(toolCalls, 1);
});

test("proposal tool output is collected once when only the following round retries", { skip: !transport }, async () => {
  const { runAgentLoop } = await import(load("lib/ai/agent/executor"));
  const projectId = "22222222-2222-4222-8222-222222222222";
  let modelCalls = 0;
  let reads = 0;
  const supabase = { from(table) { assert.equal(table, "projects"); return { select() { return this; }, eq() { return this; }, abortSignal() { return this; }, async maybeSingle() { reads++; return { data: { id: projectId, title: "Workspace", target_date: null, updated_at: "2026-10-14T00:00:00Z" }, error: null }; } }; } };
  const result = await runAgentLoop({ message: "Move the project target date", history: [], timeZone: "UTC" }, { signal: new AbortController().signal, timeZone: "UTC", now: new Date("2026-10-14T00:00:00Z"), userId: "owner", supabase }, async () => retryGeminiTransport(async () => {
    modelCalls++;
    if (modelCalls === 1) return { parts: [{ functionCall: { name: "propose_reschedule_project", args: { projectId, targetDate: "2026-10-20" } } }] };
    if (modelCalls === 2) throw Object.assign(new Error("temporary"), { status: 503 });
    return { parts: [{ text: "Prepared a proposal." }] };
  }, { deadlineAt: 100_000, now: () => 1_000, random: () => 0, sleep: async () => {} }));
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].type, "reschedule_project");
  assert.equal(reads, 1);
  assert.equal(modelCalls, 3);
});

test("diagnostic fields never include prompt, key, workspace, or raw provider message", { skip: !transport }, async () => {
  const logs = [];
  const error = Object.assign(new Error("PROMPT-SECRET KEY-SECRET WORKSPACE-SECRET"), { status: 503, code: "UPSTREAM_SECRET" });
  await assert.rejects(retryGeminiTransport(async () => { throw error; }, {
    signal: new AbortController().signal,
    deadlineAt: 100_000,
    now: () => 1_000,
    random: () => 0,
    sleep: async () => {},
    log: (message, fields) => logs.push({ message, fields }),
  }));
  const serialized = JSON.stringify(logs);
  for (const secret of ["PROMPT-SECRET", "KEY-SECRET", "WORKSPACE-SECRET", "UPSTREAM_SECRET"]) assert.equal(serialized.includes(secret), false);
  assert.equal(logs[0].fields.upstreamStatus, 503);
  assert.equal(logs[0].fields.sdkErrorCode, null);
  assert.equal(typeof logs[0].fields.elapsedMs, "number");
  assert.equal(typeof logs[0].fields.remainingDeadlineMs, "number");
});
