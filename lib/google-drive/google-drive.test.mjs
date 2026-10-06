import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./service.ts", import.meta.url), "utf8").replace('import "server-only";', "");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const service = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const validationSource = readFileSync(new URL("./validation.ts", import.meta.url), "utf8");
const validationCompiled = ts.transpileModule(validationSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const validation = await import(`data:text/javascript;base64,${Buffer.from(validationCompiled).toString("base64")}`);

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherOwnerId = "22222222-2222-4222-8222-222222222222";
const signingKey = Buffer.alloc(32, 11);
const encryptionKey = Buffer.alloc(32, 22);

test("OAuth state is signed, owner-bound, and expires after ten minutes", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  const payload = { state: Buffer.alloc(32, 3).toString("base64url"), ownerId, issuedAt: now };
  const cookie = service.createSignedOAuthState(payload, signingKey);

  assert.deepEqual(service.readSignedOAuthState(cookie, signingKey, now), payload);
  assert.equal(service.readSignedOAuthState(`${cookie.slice(0, -1)}x`, signingKey, now), null);
  assert.equal(service.readSignedOAuthState(cookie, Buffer.alloc(32, 12), now), null);
  assert.equal(service.readSignedOAuthState(cookie, signingKey, now + 10 * 60 * 1000 + 1), null);
  assert.equal(service.readSignedOAuthState(cookie, signingKey, now - 1), null);
  assert.notEqual(service.readSignedOAuthState(cookie, signingKey, now)?.ownerId, otherOwnerId);
});

test("refresh tokens are encrypted and ciphertext is bound to the workplace owner", () => {
  const refreshToken = "google-refresh-token-that-must-not-be-stored-plaintext";
  const ciphertext = service.encryptGoogleDriveRefreshToken(ownerId, refreshToken, encryptionKey);

  assert.notEqual(ciphertext, refreshToken);
  assert.equal(service.decryptGoogleDriveRefreshToken(ownerId, ciphertext, 1, encryptionKey), refreshToken);
  assert.throws(() => service.decryptGoogleDriveRefreshToken(otherOwnerId, ciphertext, 1, encryptionKey), { code: "encrypted_token_invalid" });
  assert.throws(() => service.decryptGoogleDriveRefreshToken(ownerId, ciphertext, 2, encryptionKey), { code: "encryption_key_version_unsupported" });
});

test("authorization requests only Drive app files and account identity with offline consent", () => {
  const url = service.buildGoogleAuthorizationUrl({ clientId: "client-id", clientSecret: "server-secret", stateSigningKey: signingKey, tokenEncryptionKey: encryptionKey }, "https://workplace.example/api/drive/oauth-callback", "state-value");

  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), ["openid", "email", service.GOOGLE_DRIVE_FILE_SCOPE]);
  assert.equal(url.searchParams.get("state"), "state-value");
});

test("OAuth callback binds persistence to the active Supabase user and status exposes no credential fields", () => {
  const callback = readFileSync(new URL("../../app/api/drive/oauth-callback/route.ts", import.meta.url), "utf8");
  const status = readFileSync(new URL("../../app/api/drive/status/route.ts", import.meta.url), "utf8");
  const disconnect = readFileSync(new URL("../../app/api/drive/disconnect/route.ts", import.meta.url), "utf8");

  assert.match(callback, /auth\.user\.id !== transaction\.ownerId/);
  assert.match(callback, /params\.getAll\("state"\)/);
  assert.match(callback, /p_user_id: auth\.user\.id/);
  assert.match(status, /connected: Boolean\(connection\)/);
  assert.doesNotMatch(status, /refresh_token_ciphertext|access_token|tokenEncryptionKey/);
  assert.match(disconnect, /delete_google_drive_connection/);
  assert.doesNotMatch(disconnect, /NextResponse\.json\([^\n]*(refresh_token|access_token)/i);
});

test("Drive upload metadata, size, and chunk ranges are strictly validated", () => {
  assert.equal(validation.validateDriveFilename("  report.pdf  "), "report.pdf");
  assert.equal(validation.validateDriveFilename("../report.pdf"), null);
  assert.equal(validation.validateDriveFilename(""), null);
  assert.equal(validation.validateDriveMimeType("application/PDF"), "application/pdf");
  assert.equal(validation.validateDriveMimeType("application/vnd.google-apps.document"), null);
  assert.equal(validation.validateDriveMimeType("invalid"), null);
  assert.equal(validation.validateDriveFileSize(1024), 1024);
  assert.equal(validation.validateDriveFileSize(validation.GOOGLE_DRIVE_MAX_FILE_SIZE + 1), null);
  assert.deepEqual(validation.parseDriveContentRange("bytes 0-4194303/8388608"), { start: 0, end: 4194303, total: 8388608 });
  assert.equal(validation.parseDriveContentRange("bytes 0-8388608/8388608"), null);
  assert.equal(validation.parseDriveReceivedOffset("bytes=0-4194303", 8388608), 4194304);
  assert.equal(validation.parseDriveReceivedOffset("bytes=0-8388608", 8388608), null);

  const session = {
    id: "upload-session",
    expected_name: "report.pdf",
    expected_mime_type: "application/pdf",
    expected_size_bytes: 12,
    google_account_email: "owner@example.com",
    app_folder_id: "app-folder",
  };
  const file = {
    id: "drive-file-from-google",
    name: session.expected_name,
    mimeType: session.expected_mime_type,
    size: "12",
    modifiedTime: "2026-10-06T12:00:00.000Z",
    parents: [session.app_folder_id],
    ownedByMe: true,
    trashed: false,
    owners: [{ emailAddress: "OWNER@example.com" }],
    appProperties: validation.createDriveUploadMarker(session.id),
  };
  assert.deepEqual(validation.verifyCompletedDriveFile(file, session), {
    id: file.id,
    modifiedAt: file.modifiedTime,
  });
  assert.throws(() => validation.verifyCompletedDriveFile({ ...file, ownedByMe: false }, session), /drive_file_metadata_mismatch/);
  assert.throws(() => validation.verifyCompletedDriveFile({ ...file, size: "13" }, session), /drive_file_metadata_mismatch/);
});

test("Drive resumable session URLs are restricted to Google upload endpoints and never returned", () => {
  const initiation = readFileSync(new URL("../../app/api/drive/uploads/route.ts", import.meta.url), "utf8");
  const chunk = readFileSync(new URL("../../app/api/drive/uploads/[uploadId]/route.ts", import.meta.url), "utf8");
  const complete = readFileSync(new URL("../../app/api/drive/uploads/[uploadId]/complete/route.ts", import.meta.url), "utf8");
  const unlink = readFileSync(new URL("../../app/api/drive/files/[fileId]/route.ts", import.meta.url), "utf8");

  assert.equal(validation.isGoogleDriveUploadSessionUri("https://www.googleapis.com/upload/drive/v3/files?upload_id=opaque"), true);
  assert.equal(validation.isGoogleDriveUploadSessionUri("https://attacker.example/upload/drive/v3/files?upload_id=opaque"), false);
  assert.match(initiation, /p_user_id: auth\.user\.id/);
  assert.match(initiation, /p_session_uri: sessionUri/);
  assert.doesNotMatch(initiation, /return NextResponse\.json\(\{\s*uploadId,[^}]*sessionUri/);
  assert.match(chunk, /Content-Range/);
  assert.match(complete, /verifyCompletedDriveFile/);
  assert.match(complete, /auth\.supabase[\s\S]*external_files/);
  assert.match(unlink, /\.delete\(\)/);
  assert.doesNotMatch(unlink, /drive\.googleapis\.com[\s\S]*delete/i);
});
