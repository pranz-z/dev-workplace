import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const validationUrl = `data:text/javascript;base64,${Buffer.from(compile("./validation.ts")).toString("base64")}`;
const source = compile("./client.ts").replace("@/lib/google-drive/validation", validationUrl);
const client = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("uploads bounded sequential chunks and reports only server-confirmed progress before completion", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const progress = [];
  const chunkSize = 4 * 1024 * 1024;
  const file = new File([new Uint8Array(chunkSize + 17)], "report.bin");
  const signal = new AbortController().signal;
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    if (init.method === "POST") return Response.json({ file: { id: "workplace-file", name: file.name } });
    return Response.json({ nextOffset: calls.length === 1 ? chunkSize : file.size });
  };
  try {
    const result = await client.uploadDriveChunks(file, { uploadId: "opaque-session", chunkSize }, 0, (offset) => progress.push(offset), signal);
    assert.deepEqual(progress, [chunkSize, file.size]);
    assert.equal(calls[0].init.body.size, chunkSize);
    assert.equal(calls[1].init.body.size, 17);
    assert.equal(calls[0].init.headers["Content-Range"], `bytes 0-${chunkSize - 1}/${file.size}`);
    assert.equal(calls[1].init.headers["Content-Range"], `bytes ${chunkSize}-${file.size - 1}/${file.size}`);
    assert.equal(calls[2].path, "/api/drive/uploads/opaque-session/complete");
    assert.ok(calls.every(({ path, init }) => path.startsWith("/api/drive/") && init.credentials === "same-origin" && init.signal === signal));
    assert.equal(result.file.id, "workplace-file");
  } finally { globalThis.fetch = originalFetch; }
});

test("retry resumes from Google's confirmed offset and rejects unrelated conflicts", async () => {
  const originalFetch = globalThis.fetch;
  const signal = new AbortController().signal;
  try {
    globalThis.fetch = async () => Response.json({ error: "Upload has not completed.", nextOffset: 262144 }, { status: 409 });
    assert.deepEqual(await client.checkDriveUpload("session", 524288, signal), { nextOffset: 262144 });
    globalThis.fetch = async () => Response.json({ error: "Google Drive account changed during upload." }, { status: 409 });
    await assert.rejects(client.checkDriveUpload("session", 524288, signal), /account changed/);
    globalThis.fetch = async () => Response.json({ nextOffset: -1 }, { status: 409 });
    await assert.rejects(client.checkDriveUpload("session", 524288, signal), /could not be confirmed/);
  } finally { globalThis.fetch = originalFetch; }
});
