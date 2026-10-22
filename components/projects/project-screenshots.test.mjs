import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { basename, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const source = readFileSync(resolve(root, "data/projectScreenshotService.ts"), "utf8").replace(/^import .*;\r?\n/gm, "");
const compiled = ts.transpileModule(`const serviceFail = error => ({ok:false,error}); const serviceOk = data => ({ok:true,data}); const isUuid=()=>true; const getWorkspaceContext=async()=>globalThis.projectScreenshotTestContext;\n${source}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const service = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("screenshot validation preserves accepted types and the existing per-file size limit", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(service.validateProjectScreenshotFile({ type, size: 10 * 1024 * 1024 }), null);
  }
  assert.match(service.validateProjectScreenshotFile({ type: "image/gif", size: 1 }), /JPEG, PNG, or WebP/);
  assert.match(service.validateProjectScreenshotFile({ type: "image/png", size: 0 }), /10 MB/);
  assert.match(service.validateProjectScreenshotFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 }), /10 MB/);
});

test("a saved screenshot with a signing failure is identified so batch retry cannot duplicate it", async () => {
  let insertCount = 0;
  const row = { id: "saved", project_id: "project", storage_path: "owner/project/saved.png", caption: "", sort_order: 0, is_public: false, created_at: "2026-10-22" };
  globalThis.projectScreenshotTestContext = {
    userId: "owner",
    supabase: {
      from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, maybeSingle: async () => ({ data: null }), insert() { insertCount++; return this; }, single: async () => ({ data: row }) }),
      storage: { from: () => ({ upload: async () => ({}), createSignedUrl: async () => ({ error: { code: "SIGNING_FAILED" } }) }) },
    },
  };
  try {
    for (const throws of [false, true]) {
      globalThis.projectScreenshotTestContext.supabase.storage.from = () => ({ upload: async () => ({}), createSignedUrl: async () => { if (throws) throw new Error("Network failure"); return { error: { code: "SIGNING_FAILED" } }; } });
      const result = await service.addProjectScreenshot("project", new File(["image"], "saved.png", { type: "image/png" }), "");
      assert.equal(result.ok, false);
      assert.equal(result.saved, true);
      assert.match(result.error, /Screenshot saved/);
    }
    assert.equal(insertCount, 2);
  } finally { delete globalThis.projectScreenshotTestContext; }
});

test("batch screenshot picker previews, removes, uploads sequentially and retries only failed files", { skip: !process.env.PORTFOLIO_TEST_ESBUILD_MODULE }, async () => {
  const { build } = await import(pathToFileURL(process.env.PORTFOLIO_TEST_ESBUILD_MODULE).href);
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO9sAAAAASUVORK5CYII=";
  const calls = [];
  let active = 0, maxActive = 0, failSecond = true;
  const saved = [{ id: "existing", caption: "Existing", signedUrl: image, sortOrder: 0, isPublic: false }];
  const cssDirectory = resolve(root, ".next/static/chunks");
  const css = existsSync(cssDirectory) ? readdirSync(cssDirectory).filter(name => name.endsWith(".css")).map(name => readFileSync(resolve(cssDirectory, name), "utf8")).join("\n") : "";
  const bundle = await build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ProjectScreenshots} from '@/components/projects/project-screenshots';
      function App(){const [items,setItems]=useState(${JSON.stringify(saved)});const [project,setProject]=useState('one');return <><button onClick={()=>setProject('two')}>Switch project</button><ProjectScreenshots key={project} projectId={project} screenshots={items} loading={false} loadError="" onChange={setItems} onRefresh={async()=>setItems(await fetch('/saved').then(r=>r.json()))}/></>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: "tsx" },
    outfile: "fixture.js", bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: resolve(root, "tsconfig.json"), nodePaths: [resolve(root, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "local-screenshot-boundary", setup(b) {
      b.onResolve({ filter: /^@\/data\/projectScreenshotService$/ }, () => ({ path: "service", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export const validateProjectScreenshotFile=file=>!['image/jpeg','image/png','image/webp'].includes(file.type)?'Choose a JPEG, PNG, or WebP image.':!file.size||file.size>10485760?'Choose an image smaller than 10 MB.':null;
        export const addProjectScreenshot=async(projectId,file,caption)=>fetch('/upload',{method:'POST',body:JSON.stringify({name:file.name,caption,projectId})}).then(r=>r.json());
        export const deleteProjectScreenshot=async()=>({ok:true});export const setProjectScreenshotPublic=async()=>({ok:true});export const reorderProjectScreenshots=async()=>({ok:true,data:[]});` }));
    } }],
  });
  const server = createServer(async (req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); return res.end(bundle.outputFiles[0].text); }
    if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    if (req.url.includes("/media/")) { const file = resolve(root, ".next/static/media", basename(req.url)); if (existsSync(file)) { res.setHeader("Content-Type", "font/woff2"); return res.end(readFileSync(file)); } }
    if (req.url === "/saved") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(saved)); }
    if (req.url === "/upload") {
      let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body); calls.push(input); maxActive = Math.max(maxActive, ++active);
      await new Promise(done => setTimeout(done, 20)); active--;
      res.setHeader("Content-Type", "application/json");
      if (input.name === "second.png" && failSecond) { failSecond = false; return res.end(JSON.stringify({ ok: false, error: "Temporary upload failure" })); }
      const row = { id: input.name, caption: input.caption || input.name, signedUrl: image, sortOrder: saved.length, isPublic: false };
      saved.push(row);
      if (input.name === "saved.png") return res.end(JSON.stringify({ ok: false, saved: true, error: "Screenshot saved, but couldn't open it. Refresh the project and check the Storage policies." }));
      return res.end(JSON.stringify({ ok: true, data: row }));
    }
    res.setHeader("Content-Type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL); window.previewUrls = new Set(); URL.createObjectURL = file => { const url = create(file); window.previewUrls.add(url); return url; }; URL.revokeObjectURL = url => { window.previewUrls.delete(url); revoke(url); }; });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const picker = page.locator('input[type="file"]');
    assert.equal(await picker.getAttribute("multiple"), "");
    const png = name => ({ name, mimeType: "image/png", buffer: Buffer.from(image.split(",")[1], "base64") });
    await picker.setInputFiles([png("first.png"), png("remove.png"), png("second.png"), png("third.png"), { name: "invalid.gif", mimeType: "image/gif", buffer: Buffer.from("bad") }]);
    await page.getByText("Selected screenshots (5)", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Remove selected screenshot: remove.png" }).click();
    await page.getByText("Selected screenshots (4)", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Upload screenshots", exact: true }).click();
    await page.getByText("Temporary upload failure", { exact: true }).waitFor();
    assert.deepEqual(calls.map(call => call.name), ["first.png", "second.png", "third.png"]);
    assert.equal(maxActive, 1);
    await page.getByText("Selected screenshots (2)", { exact: true }).waitFor();
    assert.equal(await page.getByRole("img", { name: "Existing", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Upload screenshots", exact: true }).click();
    await page.getByText("Selected screenshots (1)", { exact: true }).waitFor();
    assert.deepEqual(calls.map(call => call.name), ["first.png", "second.png", "third.png", "second.png"]);
    await page.getByRole("button", { name: "Remove selected screenshot: invalid.gif" }).click();
    await picker.setInputFiles(png("saved.png"));
    await page.getByRole("button", { name: "Upload screenshots", exact: true }).click();
    await page.getByRole("img", { name: "saved.png", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Upload screenshots", exact: true }).isDisabled(), true);
    const batchNames = ["dashboard.png", "projects.png", "kanban.png", "workspace-ai.png", "mobile.png"];
    await picker.setInputFiles(batchNames.map(png));
    await page.getByLabel("Caption for all (optional)").fill("Release preview");
    await page.locator("form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await page.getByText("Uploaded 5 of 5 screenshots.", { exact: true }).waitFor();
    assert.deepEqual(calls.slice(-5).map(call => [call.name, call.projectId, call.caption]), batchNames.map(name => [name, "one", "Release preview"]));
    assert.equal(calls.length, 10);
    assert.equal(await page.getByLabel("Caption for all (optional)").inputValue(), "");
    await picker.setInputFiles(png("a-long-project-screenshot-name-for-the-mobile-preview.png"));
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}px`);
    }
    await page.getByRole("button", { name: "Switch project" }).click();
    assert.equal(await page.evaluate(() => window.previewUrls.size), 0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
});
