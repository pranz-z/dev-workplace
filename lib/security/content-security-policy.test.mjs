import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

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
