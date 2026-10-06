import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const projectUUID = "11111111-1111-4111-8111-111111111111";
const projectMarkers = (id) => ({ softwareWorkplaceManaged: "google-drive-files-v1", softwareWorkplaceResourceType: "project-folder", softwareWorkplaceProjectId: id });
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
let rpc;
globalThis.__driveFolderAdmin = () => ({ rpc: (...args) => rpc(...args) });
const providerSource = compile("./folder-provider.ts").replace('import "server-only";', "").replace(/import \{ getSupabaseAdminClient \} from [^;]+;/, "const getSupabaseAdminClient = globalThis.__driveFolderAdmin;");
const provider = await import(`data:text/javascript;base64,${Buffer.from(providerSource).toString("base64")}`);

function fixture(existing = []) {
  const registry = new Map(); const files = new Map(existing.map((file) => [file.id, file])); const calls = []; let ids = 0;
  rpc = async (_name, p) => {
    const key = `${p.p_user_id}/${p.p_google_account_sub}/${p.p_logical_key}`;
    if (!registry.has(key) && p.p_candidate_id) registry.set(key, { metadata_id: p.p_logical_key.startsWith("custom:") ? p.p_logical_key.slice(7) : "metadata", drive_file_id: p.p_candidate_id, parent_drive_id: p.p_parent_drive_id });
    const row = registry.get(key);
    if (row && p.p_previous_drive_id === row.drive_file_id) { row.drive_file_id = p.p_candidate_id; row.parent_drive_id = p.p_parent_drive_id; }
    return { data: row ? [{ ...row }] : [], error: null };
  };
  const request = async (_token, address, init = {}) => {
    const url = new URL(address); calls.push({ url, init });
    if (url.pathname.endsWith("generateIds")) return Response.json({ ids: [`generated-${++ids}`] });
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      if (files.has(body.id)) return Response.json({}, { status: 409 });
      const file = { ...body, ownedByMe: true, trashed: false }; files.set(body.id, file); return Response.json(file);
    }
    if (init.method === "PATCH") { const file = files.get(url.pathname.split("/").at(-1)); Object.assign(file, JSON.parse(init.body)); return Response.json(file); }
    if (url.pathname.endsWith("/files")) {
      const q = url.searchParams.get("q");
      return Response.json({ files: [...files.values()].filter((file) => file.trashed === false && file.ownedByMe === true && Object.entries(file.appProperties ?? {}).every(([k, v]) => q.includes(`key='${k}' and value='${v}'`)) && file.parents?.includes("root-folder")) });
    }
    const file = files.get(url.pathname.split("/").at(-1));
    return file ? Response.json(file) : Response.json({}, { status: 404 });
  };
  const ensure = (id = "project-uuid", name = "Same project name") => provider.ensureRegisteredDriveFolder("server-token", "owner", "account", `project:${id}`, name, "root-folder", projectMarkers(id), request);
  return { ensure, files, calls, registry };
}

test("project UUID marker adopts the correct existing folder and renames without changing identity", async () => {
  const f = fixture([{ id: "existing", name: "Old project name", mimeType: provider.DRIVE_FOLDER_MIME, ownedByMe: true, trashed: false, parents: ["root-folder"], appProperties: projectMarkers("project-uuid") }]);
  assert.equal((await f.ensure()).drive_file_id, "existing");
  assert.equal(f.files.get("existing").name, "Same project name");
  assert.notEqual("Old project name", f.files.get("existing").name);
  assert.equal((await f.ensure()).drive_file_id, "existing");
  assert.deepEqual(f.files.get("existing").appProperties, projectMarkers("project-uuid"));
  assert.equal(f.calls.filter((call) => call.init.method === "POST").length, 0);
});
test("missing project folders are real Drive folders and same display names do not collide", async () => {
  const f = fixture(); const a = await f.ensure("project-a"); const b = await f.ensure("project-b");
  assert.notEqual(a.drive_file_id, b.drive_file_id);
  assert.equal(f.files.get(a.drive_file_id).appProperties.softwareWorkplaceProjectId, "project-a");
  assert.equal(f.files.get(a.drive_file_id).mimeType, "application/vnd.google-apps.folder");
  assert.deepEqual(f.files.get(a.drive_file_id).parents, ["root-folder"]);
  assert.equal((await f.ensure("project-a")).drive_file_id, a.drive_file_id);
});
test("concurrent requests reserve one ID and cannot create duplicate project folders", async () => {
  const f = fixture(); const results = await Promise.all([f.ensure(), f.ensure(), f.ensure()]);
  assert.equal(new Set(results.map((row) => row.drive_file_id)).size, 1);
  assert.equal(f.files.size, 1);
});
test("trashed folders are recreated and a changed ownership fails closed", async () => {
  const f = fixture(); const first = await f.ensure(); f.files.get(first.drive_file_id).trashed = true;
  const replacement = await f.ensure(); assert.notEqual(first.drive_file_id, replacement.drive_file_id);
  f.files.get(replacement.drive_file_id).ownedByMe = false;
  await assert.rejects(f.ensure(), /verification_failed/);
});

test("deleted folders are recreated without moving existing content", async () => {
  const f = fixture(); const original = await f.ensure();
  f.files.delete(original.drive_file_id);
  // Google allows recreating the reserved ID if it was never committed, but
  // permanently deleted IDs return 404 on create; the helper then reserves anew.
  const retry = await f.ensure();
  assert.equal(retry.metadata_id, original.metadata_id);
  assert.equal(f.calls.some(({ init }) => init.method === "DELETE"), false);
});

let mockContext;
globalThis.__driveFolderFunctions = {
  driveApiRequest: async () => Response.json(mockContext.invalidRoot ? {} : { id: "root-folder", mimeType: provider.DRIVE_FOLDER_MIME, ownedByMe: true, trashed: false, appProperties: { softwareWorkplaceManaged: "google-drive-files-v1" } }),
  ensureGoogleDriveAppFolder: async () => "root-folder",
  GoogleDriveFileError: class extends Error { constructor(code, status) { super(code); this.status = status; } },
  DRIVE_FOLDER_MIME: provider.DRIVE_FOLDER_MIME,
  DRIVE_MANAGED_MARKER: provider.DRIVE_MANAGED_MARKER,
  ensureRegisteredDriveFolder: async (...args) => { mockContext.providerCalls.push(args); return { metadata_id: "folder-meta", drive_file_id: "project-drive-id" }; },
  reserveDriveFolder: async () => mockContext.registry ?? { metadata_id: "folder-meta", drive_file_id: "project-drive-id" },
};
let folderSource = compile("./folders.ts").replace(/^import .*;\r?\n/gm, "");
folderSource = `const { driveApiRequest, ensureGoogleDriveAppFolder, GoogleDriveFileError, DRIVE_FOLDER_MIME, DRIVE_MANAGED_MARKER, ensureRegisteredDriveFolder, reserveDriveFolder } = globalThis.__driveFolderFunctions;\n${folderSource}`;
const folders = await import(`data:text/javascript;base64,${Buffer.from(folderSource).toString("base64")}`);
function context(project = { id: projectUUID, title: "Project" }, row = null) {
  mockContext = { providerCalls: [], registry: null }; const filters = [];
  return { ownerId: "owner", accessToken: "token", identity: { subject: "account", email: "owner@example.com" }, filters,
    supabase: { from(table) { let saved; return { select() { return this; }, eq(k, v) { filters.push([table, k, v]); return this; }, upsert(value) { saved = value; return this; }, async single() { return { data: saved, error: null }; }, async maybeSingle() { return { data: table === "projects" ? project : row, error: null }; } }; } } };
}
test("root uploads keep the root; project uploads use the owned project folder", async () => {
  const ctx = context(); assert.deepEqual(await folders.resolveDriveDestination(ctx, null, null), { driveId: "root-folder", parentId: null, projectId: null });
  assert.deepEqual(await folders.resolveDriveDestination(ctx, projectUUID, null), { driveId: "project-drive-id", parentId: "folder-meta", projectId: projectUUID });
  assert.ok(ctx.filters.some(([table, key, value]) => table === "projects" && key === "user_id" && value === "owner"));
});
test("foreign projects and unregistered custom parents are rejected", async () => {
  await assert.rejects(folders.resolveDriveDestination(context(null), projectUUID, null), /project_unavailable/);
  const ctx = context(undefined, { id: "custom", user_id: "owner", provider_file_id: "forged", mime_type: provider.DRIVE_FOLDER_MIME, is_project_folder: false, project_id: null });
  await assert.rejects(folders.resolveDriveDestination(ctx, null, "custom"), /folder_unverified/);
});
test("folder and upload routes retain task ownership, parent proof and unlink-only access boundaries", () => {
  const upload = readFileSync(new URL("../../app/api/drive/uploads/route.ts", import.meta.url), "utf8");
  assert.match(upload, /task.project_id !== projectId/); assert.match(upload, /projectId = task.project_id/);
  assert.match(upload, /resolveDriveDestination/); assert.match(upload, /set_google_drive_upload_parent/);
  const route = readFileSync(new URL("../../app/api/drive/folders/route.ts", import.meta.url), "utf8");
  assert.match(route, /ownedDriveProject/); assert.match(route, /ownerId: auth.user.id/);
  const remove = readFileSync(new URL("../../app/api/drive/files/[fileId]/route.ts", import.meta.url), "utf8");
  assert.match(remove, /\.delete\(\)/); assert.doesNotMatch(remove, /driveApiRequest|trashed: true/);
  const migration = readFileSync(new URL("../../supabase/migrations/20261006140000_google_drive_folder_browser.sql", import.meta.url), "utf8");
  assert.match(migration, /parent_row.user_id <> new.user_id/); assert.match(migration, /project_id is distinct from new.project_id/);
  assert.match(migration, /from public, anon, authenticated/); assert.match(migration, /enable row level security/);
});

test("folder creation route rejects another owner's project before contacting Google", async () => {
  const ctx = context(null); let googleCalls = 0;
  globalThis.__folderRoute = {
    NextResponse: { json: (body, options) => Response.json(body, options) },
    requireGoogleDriveUser: async () => ({ user: { id: ctx.ownerId }, supabase: ctx.supabase }),
    driveServiceErrorResponseStatus: (error) => error.status ?? 502,
    getGoogleDriveAccess: async () => { googleCalls++; throw new Error("must_not_call"); },
    ownedDriveProject: folders.ownedDriveProject, DRIVE_UUID: folders.DRIVE_UUID,
    validateDriveFilename: (name) => name,
  };
  let source = compile("../../app/api/drive/folders/route.ts").replace(/^import .*;\r?\n/gm, "");
  source = `const { NextResponse, requireGoogleDriveUser, driveServiceErrorResponseStatus, getGoogleDriveAccess, ownedDriveProject, DRIVE_UUID, validateDriveFilename } = globalThis.__folderRoute;\n${source}`;
  try {
    const route = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const result = await route.POST({ json: async () => ({ action: "create", name: "Assets", projectId: "11111111-1111-4111-8111-111111111111", requestId: "22222222-2222-4222-8222-222222222222" }) });
    assert.equal(result.status, 404); assert.equal(googleCalls, 0);
  } finally { delete globalThis.__folderRoute; }
});

test("task upload derives project from the owned task before resolving the Drive destination", async () => {
  const taskId = "22222222-2222-4222-8222-222222222222", projectId = "11111111-1111-4111-8111-111111111111";
  const resolutions = [], rpcCalls = [];
  const query = (table) => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: table === "tasks" ? { id: taskId, project_id: projectId } : { id: projectId }, error: null }; } });
  globalThis.__uploadRoute = {
    NextResponse: { json: (body, options) => Response.json(body, options) },
    requireGoogleDriveUser: async () => ({ user: { id: "owner" }, supabase: { from: query } }),
    getGoogleDriveAccess: async () => ({ accessToken: "secret", identity: { subject: "account", email: "owner@example.com" } }),
    resolveDriveDestination: async (ctx, project, parent) => { resolutions.push({ owner: ctx.ownerId, project, parent }); return { driveId: "project-drive-folder", parentId: "folder-meta", projectId: project }; },
    driveApiRequest: async (_token, _url, init) => { assert.deepEqual(JSON.parse(init.body).parents, ["project-drive-folder"]); return new Response(null, { status: 200, headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=secret-session" } }); },
    getSupabaseAdminClient: () => ({ rpc: async (name, args) => { rpcCalls.push({ name, args }); return { error: null }; } }),
    createDriveUploadMarker: (id) => ({ softwareWorkplaceUploadId: id }),
    newGoogleDriveUploadId: () => "opaque-uuid", validateDriveFilename: (v) => v,
    validateDriveMimeType: (v) => v, validateDriveFileSize: (v) => v,
    isGoogleDriveUploadSessionUri: () => true, GOOGLE_DRIVE_MAX_FILE_SIZE: 1073741824, GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE: 4194304,
    driveServiceErrorResponseStatus: () => 502,
  };
  let source = compile("../../app/api/drive/uploads/route.ts").replace(/^import [\s\S]*?;\r?\n/gm, "");
  source = `const { NextResponse, requireGoogleDriveUser, getGoogleDriveAccess, resolveDriveDestination, driveApiRequest, getSupabaseAdminClient, createDriveUploadMarker, newGoogleDriveUploadId, validateDriveFilename, validateDriveMimeType, validateDriveFileSize, isGoogleDriveUploadSessionUri, GOOGLE_DRIVE_MAX_FILE_SIZE, GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE, driveServiceErrorResponseStatus } = globalThis.__uploadRoute;\n${source}`;
  try {
    const route = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const result = await route.POST({ json: async () => ({ name: "task.txt", mimeType: "text/plain", sizeBytes: 12, taskId }) });
    assert.equal(result.status, 201); assert.deepEqual(resolutions, [{ owner: "owner", project: projectId, parent: null }]);
    assert.equal(rpcCalls[0].args.p_project_id, projectId); assert.equal(rpcCalls[0].args.p_task_id, taskId);
    assert.equal(rpcCalls[1].args.p_parent_id, "folder-meta"); assert.doesNotMatch(await result.text(), /secret/);
    assert.equal(rpcCalls[0].args.p_app_folder_id, "project-drive-folder");
    const mismatch = await route.POST({ json: async () => ({ name: "task.txt", mimeType: "text/plain", sizeBytes: 12, taskId, projectId: "33333333-3333-4333-8333-333333333333" }) });
    assert.equal(mismatch.status, 400); assert.equal(resolutions.length, 1);
  } finally { delete globalThis.__uploadRoute; }
});

test("same-name unmarked and partially marked folders are never adopted", async () => {
  const base = { name: "Same project name", mimeType: provider.DRIVE_FOLDER_MIME, ownedByMe: true, trashed: false, parents: ["root-folder"] };
  const f = fixture([{ ...base, id: "manual", appProperties: {} }, { ...base, id: "partial", appProperties: { softwareWorkplaceProjectId: "project-uuid" } }]);
  const result = await f.ensure();
  assert.ok(result.drive_file_id.startsWith("generated-"));
  assert.deepEqual(f.files.get(result.drive_file_id).appProperties, projectMarkers("project-uuid"));
});

test("multiple marked matches fail without deleting or adopting either", async () => {
  const base = { name: "Project", mimeType: provider.DRIVE_FOLDER_MIME, ownedByMe: true, trashed: false, parents: ["root-folder"], appProperties: projectMarkers("project-uuid") };
  const f = fixture([{ ...base, id: "a" }, { ...base, id: "b" }]);
  await assert.rejects(f.ensure(), /duplicate_matches/);
  assert.equal(f.registry.size, 0);
  assert.equal(f.calls.some(({ init }) => init.method === "DELETE" || init.method === "POST"), false);
});

test("duplicate lookup examines every page and fails closed on incomplete search", async () => {
  fixture();
  const file = { id: "first", mimeType: provider.DRIVE_FOLDER_MIME, ownedByMe: true, trashed: false, parents: ["root-folder"], appProperties: projectMarkers(projectUUID) };
  let pages = 0;
  const request = async (_token, address) => {
    pages++;
    return new URL(address).searchParams.has("pageToken")
      ? Response.json({ files: [{ ...file, id: "second" }] })
      : Response.json({ files: [file], nextPageToken: "next" });
  };
  await assert.rejects(provider.ensureRegisteredDriveFolder("token", "owner", "account", `project:${projectUUID}`, "Project", "root-folder", projectMarkers(projectUUID), request), /duplicate_matches/);
  assert.equal(pages, 2);
  await assert.rejects(provider.ensureRegisteredDriveFolder("token", "owner", "account", `project:${projectUUID}`, "Project", "root-folder", projectMarkers(projectUUID), async () => Response.json({ incompleteSearch: true })), /lookup_failed/);
});

test("helper validates UUID, root and server project title before ensuring", async () => {
  const ctx = context();
  await assert.rejects(folders.ensureGoogleDriveProjectFolder(ctx, "root-folder", "bad-id", "Client title"), /invalid_project/);
  mockContext.invalidRoot = true;
  await assert.rejects(folders.ensureGoogleDriveProjectFolder(ctx, "root-folder", projectUUID, "Client title"), /managed_root_unverified/);
  mockContext.invalidRoot = false;
  await folders.ensureGoogleDriveProjectFolder(ctx, "root-folder", projectUUID, "Client title");
  const call = mockContext.providerCalls.at(-1);
  assert.equal(call[4], "Project"); assert.deepEqual(call[6], projectMarkers(projectUUID));
});
