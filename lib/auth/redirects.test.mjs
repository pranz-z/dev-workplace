import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./redirects.ts", import.meta.url), "utf8")
  .replace('import { getSiteUrlOverride } from "@/lib/supabase/env";', "const getSiteUrlOverride = () => null;");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const redirects = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("only same-origin internal redirect paths are retained", () => {
  assert.equal(redirects.sanitizeNextPath("/app?tab=tasks"), "/app?tab=tasks");
  assert.equal(redirects.sanitizeNextPath("https://evil.example"), "/app");
  assert.equal(redirects.sanitizeNextPath("//evil.example"), "/app");
  assert.equal(redirects.sanitizeNextPath("///evil.example"), "/app");
  assert.equal(redirects.sanitizeNextPath("/\\evil.example"), "/app");
  assert.equal(redirects.sanitizeNextPath("javascript:alert(1)"), "/app");
  assert.equal(redirects.sanitizeNextPath("/\t/evil.example"), "/app");
  assert.equal(redirects.sanitizeNextPath("/\n/evil.example"), "/app");
  assert.equal(redirects.sanitizeNextPath("/app\\evil.example"), "/app");
  assert.equal(redirects.sanitizeNextPath(null), "/app");
  assert.equal(redirects.sanitizeNextPath("/app/tasks?view=kanban"), "/app/tasks?view=kanban");
});
