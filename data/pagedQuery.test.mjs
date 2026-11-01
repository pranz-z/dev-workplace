import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./pagedQuery.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { fetchAllRows } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const pageOf = (rows) => async (from, to) => ({ data: rows.slice(from, to + 1), error: null });

test("reads every page past the server cap", async () => {
  const rows = Array.from({ length: 2503 }, (_, index) => index);
  assert.deepEqual(await fetchAllRows(pageOf(rows), 1000), rows);
});

test("stops after an exact-size final page", async () => {
  const rows = Array.from({ length: 2000 }, (_, index) => index);
  let calls = 0;
  const result = await fetchAllRows(async (from, to) => { calls += 1; return pageOf(rows)(from, to); }, 1000);
  assert.equal(result.length, 2000);
  assert.equal(calls, 3);
});

test("a failing page throws instead of returning partial rows", async () => {
  const failure = new Error("boom");
  await assert.rejects(fetchAllRows(async (from) => from === 0 ? { data: [1, 2], error: null } : { data: null, error: failure }, 2), failure);
});

test("reorder migration is atomic, invoker-scoped and authenticated-only", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261101120000_atomic_reorder_functions.sql", import.meta.url), "utf8");
  for (const name of ["reorder_project_tasks", "reorder_project_milestones", "reorder_plan_items"]) {
    assert.ok(sql.includes(`function public.${name}(`));
    assert.ok(sql.includes(`revoke all on function public.${name}(`));
    assert.ok(sql.includes(`grant execute on function public.${name}(`));
  }
  assert.equal((sql.match(/security invoker/g) ?? []).length, 3);
  assert.doesNotMatch(sql, /security definer/);
});
