import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../app/api/ai/chat/route.ts", import.meta.url), "utf8");
const migrationDirectory = new URL("../../supabase/migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationDirectory).filter((name) => name.endsWith("_phase6a1_private_ai_concurrency_leases.sql"));
assert.equal(migrationFiles.length, 1, "expected exactly one Phase 6A.1 concurrency lease migration");
const migration = readFileSync(new URL(migrationFiles[0], migrationDirectory), "utf8");
const sqlTest = readFileSync(new URL("../../supabase/tests/private-ai.sql", import.meta.url), "utf8");

test("chat takes an authenticated persistent quota and lease before parsing uploads", () => {
  assert.ok(route.indexOf("userId = (await requireAuthenticatedAiUser") < route.indexOf('rpc("consume_private_ai_rate_limit"'));
  assert.ok(route.indexOf('rpc("consume_private_ai_rate_limit"') < route.indexOf("acquirePrivateAiLease(userId)"));
  assert.ok(route.indexOf("acquirePrivateAiLease(userId)") < route.indexOf("parseChatForm(request)"));
  assert.match(route, /finally\s*\{\s*await releasePrivateAiLease/);
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export const maxDuration = 60/);
});

test("private lease RPC is service-role-only, owner-keyed, and expires within its bound", () => {
  assert.match(migration, /create table if not exists private\.private_ai_active_leases[\s\S]*?user_id uuid primary key references auth\.users/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on private\.private_ai_active_leases from public, anon, authenticated, service_role/);
  assert.match(migration, /private_ai_active_leases_expires_at_idx/);
  assert.match(migration, /delete from private\.private_ai_active_leases where expires_at <= v_now/);
  assert.match(migration, /p_ttl_seconds < 30 or p_ttl_seconds > 180/);
  assert.match(migration, /expires_at <= v_now/);
  assert.match(migration, /where user_id = p_user_id and lease_id = p_lease_id/);
  assert.match(migration, /grant execute on function public\.acquire_private_ai_lease\(uuid, uuid, integer\) to service_role/);
  assert.match(migration, /grant execute on function public\.release_private_ai_lease\(uuid, uuid\) to service_role/);
  const tableDefinition = migration.match(/create table if not exists private\.private_ai_active_leases \([\s\S]*?\);/)?.[0] ?? "";
  assert.doesNotMatch(tableDefinition, /prompt|response|file_content|uploaded_file/i);
  assert.match(sqlTest, /private\.private_ai_active_leases/);
  assert.match(sqlTest, /public\.acquire_private_ai_lease/);
  assert.match(sqlTest, /public\.release_private_ai_lease/);
});

test("request-body copies are dropped after bounded parse and binary conversion avoids a Buffer copy", () => {
  assert.match(route, /chunks\.length = 0/);
  assert.match(route, /bytes = new Uint8Array\(0\)/);
  const files = readFileSync(new URL("./chat-files.ts", import.meta.url), "utf8");
  assert.match(files, /Buffer\.from\(buffer\)\.toString\("base64"\)/);
  assert.doesNotMatch(files, /Buffer\.from\(bytes\)/);
});
