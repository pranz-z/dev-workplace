import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createServer } from "node:http";
import { chromium } from "playwright";

const source = readFileSync(new URL("./content-security-policy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const policyModule = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");

function directives(policy) {
  return Object.fromEntries(policy.split(";").map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, values];
  }));
}

test("video CSP allows only the configured private store and the signed PUT API path", () => {
  const base = directives(policyModule.buildContentSecurityPolicy({ development: false }));
  const policy = directives(policyModule.buildContentSecurityPolicy({ development: false, blobStoreId: "store_Example123" }));
  assert.deepEqual(policy["media-src"], ["'self'", "https://example123.private.blob.vercel-storage.com"]);
  assert.deepEqual(policy["connect-src"], ["'self'", "https://vercel.com/api/blob/"]);
  for (const key of ["default-src", "script-src", "img-src"]) assert.deepEqual(policy[key], base[key]);
  for (const blobStoreId of [undefined, "bad.host", "*", "x; script-src *"]) {
    assert.deepEqual(directives(policyModule.buildContentSecurityPolicy({ development: false, blobStoreId }))["media-src"], ["'self'"]);
  }
});

test("browser CSP permits the SDK's trailing-slash PUT URL and blocks unrelated Vercel paths", async () => {
  const policy = policyModule.buildContentSecurityPolicy({ development: false, blobStoreId: "store_example123" });
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.setHeader("Content-Security-Policy", policy);
    response.end("<!doctype html><title>Blob upload CSP regression</title>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let intercepted = 0;
    await page.route("https://vercel.com/**", route => {
      intercepted++;
      return route.fulfill({ status: 200, body: "ok", headers: { "access-control-allow-origin": "*" } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const allowed = await page.evaluate(async () => {
      try { return (await fetch("https://vercel.com/api/blob/?pathname=portfolio-previews%2Ftest.mp4", { method: "PUT", body: "test" })).ok; }
      catch { return false; }
    });
    assert.equal(allowed, true, "the actual SDK upload URL must pass CSP");
    const before = intercepted;
    const unrelated = await page.evaluate(async () => {
      try { await fetch("https://vercel.com/api/unrelated"); return true; }
      catch { return false; }
    });
    assert.equal(unrelated, false);
    assert.equal(intercepted, before, "unrelated Vercel paths must not reach the network");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("production CSP restricts resource classes and derives browser Supabase origins", () => {
  const policy = directives(policyModule.buildContentSecurityPolicy({ development: false, supabaseUrl: "https://example.supabase.co" }));
  assert.deepEqual(policy["default-src"], ["'self'"]);
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["frame-ancestors"], ["'none'"]);
  assert.deepEqual(policy["frame-src"], ["'none'"]);
  assert.deepEqual(policy["base-uri"], ["'self'"]);
  assert.deepEqual(policy["form-action"], ["'self'"]);
  assert.deepEqual(policy["connect-src"], ["'self'", "https://example.supabase.co"]);
  assert.ok(policy["img-src"].includes("https://avatars.githubusercontent.com"));
  assert.ok(policy["img-src"].includes("https://example.supabase.co"));
  assert.ok(policy["font-src"].includes("https://fonts.gstatic.com"));
  assert.ok(policy["style-src"].includes("https://fonts.googleapis.com"));
  assert.ok(!policy["script-src"].includes("'unsafe-eval'"));
  assert.deepEqual(policy["script-src-attr"], ["'none'"]);
  assert.ok(!policy["style-src"].includes("'unsafe-inline'"));
  assert.deepEqual(policy["style-src-attr"], ["'unsafe-inline'"]);
  assert.ok(!policy["connect-src"].some((origin) => /google|gemini|github/i.test(origin)));
  assert.ok(!policy["img-src"].some((origin) => origin === "*" || origin === "data:" || origin === "blob:"));
});

test("development adds only local Supabase/HMR origins and the Next.js eval allowance", () => {
  const policy = directives(policyModule.buildContentSecurityPolicy({ development: true, supabaseUrl: "http://127.0.0.1:54321" }));
  assert.ok(policy["connect-src"].includes("http://127.0.0.1:54321"));
  assert.ok(policy["connect-src"].includes("ws://localhost:*"));
  assert.ok(policy["script-src"].includes("'unsafe-eval'"));
  const production = directives(policyModule.buildContentSecurityPolicy({ development: false, supabaseUrl: "http://127.0.0.1:54321" }));
  assert.ok(!production["script-src"].includes("'unsafe-eval'"));
  assert.ok(!production["connect-src"].some((origin) => origin.startsWith("ws://localhost:")));
  assert.ok(!production["connect-src"].includes("http://127.0.0.1:54321"));
});

test("Next config attaches the generated CSP to all app responses", () => {
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /buildContentSecurityPolicy\(\{\s*development: process\.env\.NODE_ENV !== "production"/);
  assert.match(config, /supabaseUrl: process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
});
