import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("./access.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { verifyDriveAccess, driveBrowserAccessUrl } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const row = { id: "row", user_id: "owner", provider_file_id: "drive123" };
const identity = { subject: "google-owner", email: "owner@example.com" };
const session = { id: "upload", user_id: "owner", status: "completed", external_file_id: "row", drive_file_id: "drive123", google_account_sub: "google-owner" };
const file = { id: "drive123", ownedByMe: true, trashed: false, owners: [{ me: true, emailAddress: identity.email }], appProperties: { softwareWorkplaceUploadId: "upload" }, webViewLink: "https://drive.google.com/file/d/drive123/view", webContentLink: "https://drive.google.com/uc?id=drive123&export=download", capabilities: { canDownload: true }, mimeType: "application/pdf" };
test("access requires completed owner/account-bound server upload", () => {
  assert.equal(verifyDriveAccess(file, session, row, identity), true);
  assert.equal(verifyDriveAccess(file, null, row, identity), false);
  for (const patch of [{ user_id: "other" }, { status: "uploading" }, { external_file_id: "other" }, { drive_file_id: "other" }, { google_account_sub: "other" }, { id: "other" }]) assert.equal(verifyDriveAccess(file, { ...session, ...patch }, row, identity), false);
  for (const patch of [{ id: "other" }, { ownedByMe: false }, { trashed: true }, { owners: [] }, { appProperties: {} }]) assert.equal(verifyDriveAccess({ ...file, ...patch }, session, row, identity), false);
});
test("browser access rejects unsafe destinations and honors download capability", () => {
  assert.equal(driveBrowserAccessUrl(file, "preview"), file.webViewLink);
  assert.equal(driveBrowserAccessUrl(file, "download"), file.webContentLink);
  assert.equal(driveBrowserAccessUrl({ ...file, mimeType: "application/vnd.google-apps.document" }, "download"), file.webViewLink);
  assert.equal(driveBrowserAccessUrl({ ...file, capabilities: { canDownload: false } }, "download"), null);
  for (const link of ["http://drive.google.com/file/d/drive123/view", "https://evil.example/file/d/drive123/view", "https://drive.google.com/file/d/other/view", "https://user:password@drive.google.com/file/d/drive123/view", `${file.webViewLink}?access_token=secret`]) assert.equal(driveBrowserAccessUrl({ ...file, webViewLink: link }, "preview"), null);
});
test("route checks session and row owner; callback cannot retain another account grant", () => {
  const route = readFileSync(new URL("../../app/api/drive/files/[fileId]/access/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireGoogleDriveUser/);
  assert.match(route, /\.eq\("user_id", auth.user.id\)/);
  assert.match(route, /verifyDriveAccess\(file, session, row, access.identity\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /nosniff/);
  assert.doesNotMatch(route, /alt=media|new Response\(.*body/);
  const callback = readFileSync(new URL("../../app/api/drive/oauth-callback/route.ts", import.meta.url), "utf8");
  assert.match(callback, /existing.identity.subject !== identity.subject/);
});

test("access handler rejects signed-out and foreign rows before calling Google", async () => {
  let routeSource = readFileSync(new URL("../../app/api/drive/files/[fileId]/access/route.ts", import.meta.url), "utf8");
  routeSource = routeSource.replace(/^import .*;\r?\n/gm, "");
  routeSource = `const { NextResponse, requireGoogleDriveUser, driveBrowserAccessUrl, verifyDriveAccess, getGoogleDriveAccess, getGoogleDriveUploadSession, readDriveFile, driveServiceErrorResponseStatus } = globalThis.__driveAccessTest;\n${routeSource}`;
  let currentRow = null;
  let signedIn = false;
  let googleCalls = 0;
  let completedSession = session;
  const filters = [];
  const query = { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, async maybeSingle() { return { data: currentRow, error: null }; } };
  globalThis.__driveAccessTest = {
    NextResponse: { json: (body, options) => Response.json(body, options), redirect: (url, options) => new Response(null, { ...options, headers: { ...options.headers, Location: url } }) },
    requireGoogleDriveUser: async () => signedIn ? { user: { id: "owner" }, supabase: { from: () => query } } : { response: Response.json({}, { status: 401 }) },
    driveBrowserAccessUrl, verifyDriveAccess,
    getGoogleDriveAccess: async () => { googleCalls++; return { accessToken: "secret", identity }; },
    getGoogleDriveUploadSession: async () => completedSession,
    readDriveFile: async () => ({ ...file, appProperties: { softwareWorkplaceUploadId: "11111111-1111-4111-8111-111111111111" } }),
    driveServiceErrorResponseStatus: () => 502,
  };
  try {
    const output = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const { GET } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
    const request = { nextUrl: new URL("https://workplace.example/api/drive/files/id/access") };
    const context = { params: Promise.resolve({ fileId: "11111111-1111-4111-8111-111111111111" }) };
    assert.equal((await GET(request, context)).status, 401);
    signedIn = true;
    assert.equal((await GET(request, context)).status, 404);
    assert.equal(googleCalls, 0);
    assert.ok(filters.some(([key, value]) => key === "user_id" && value === "owner"));
    currentRow = { ...row, status: "active" };
    const denied = await GET(request, context);
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("cache-control"), "private, no-store");
    assert.doesNotMatch(await denied.text(), /secret/);
    completedSession = { ...session, id: "11111111-1111-4111-8111-111111111111" };
    const allowed = await GET(request, context);
    assert.equal(allowed.status, 303);
    assert.equal(allowed.headers.get("location"), file.webViewLink);
    assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
    assert.equal(allowed.headers.get("referrer-policy"), "no-referrer");
    assert.doesNotMatch([...allowed.headers].flat().join(" "), /secret/);
  } finally { delete globalThis.__driveAccessTest; }
});
