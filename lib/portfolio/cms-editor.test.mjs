import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const owner = "11111111-1111-4111-8111-111111111111";
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const contentUrl = moduleUrl(readFileSync(resolve(root, "lib/portfolio/content.ts"), "utf8"));
const { resumePortfolioSeed } = await import(moduleUrl(readFileSync(resolve(root, "lib/portfolio/resume-seed.ts"), "utf8").replace('"./content"', JSON.stringify(contentUrl))));

test("browser: CMS CRUD, failed saves, public updates, contact privacy and five responsive widths", { skip: !process.env.PORTFOLIO_TEST_PGLITE_MODULE || !process.env.PORTFOLIO_TEST_ESBUILD_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PORTFOLIO_TEST_PGLITE_MODULE).href);
  const { build } = await import(pathToFileURL(process.env.PORTFOLIO_TEST_ESBUILD_MODULE).href);
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    create table public.profiles(id uuid primary key, display_name text, headline text, bio text, avatar_url text, public_contact_email text, show_public_contact_email boolean default false, public_github_url text, public_linkedin_url text, public_website_url text, public_profile_enabled boolean default false, public_ai_assistant_enabled boolean default false, created_at timestamptz default now());
    alter table public.profiles enable row level security;
    create policy own on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
    grant select, insert, update, delete on public.profiles to authenticated;
    create table public.projects(id uuid primary key, slug text, user_id uuid, visibility text);
    create table public.project_screenshots(id uuid primary key, project_id uuid, storage_path text, caption text, created_at timestamptz, is_public boolean, sort_order integer not null default 0);
    create type public.public_project_card as (slug text, is_featured boolean, updated_at timestamptz);
    create function private.public_project_rows(text, boolean) returns setof public.public_project_card language sql as $$ select null::text, false, now() where false $$;
    insert into public.profiles(id) values ('${owner}');
  `);
  await db.exec(readFileSync(resolve(root, "supabase/migrations/20261004111128_portfolio_cms.sql"), "utf8"));
  await db.query("update private.portfolio_site_config set owner_id = $1 where singleton", [owner]);
  await db.exec(`select set_config('request.jwt.claim.sub', '${owner}', false); set role authenticated;`);
  await db.query("select public.save_portfolio($1::jsonb,0,true,true)", [JSON.stringify(resumePortfolioSeed())]);
  let failNextSave = false;
  const bundled = await build({
    stdin: { contents: `import React, {useState, useEffect} from 'react'; import {createRoot} from 'react-dom/client'; import {PortfolioEditor} from '@/components/portfolio/PortfolioEditor'; import PublicPortfolio from '@/components/portfolio/PublicPortfolio';
      function App(){ const [tab,setTab]=useState('Overview'); const [publicData,setPublicData]=useState(null); useEffect(()=>{if(location.pathname==='/preview') fetch('/public').then(r=>r.json()).then(setPublicData)},[]);
      if(location.pathname==='/preview') return publicData ? <PublicPortfolio initialProjects={[]} initialProfile={publicData.profile} initialError={false} initialProfessionalContent={publicData.content} introduction={{name:'',headline:'',bio:''}}/> : <p>Loading preview</p>;
      return <div className="app-shell min-h-screen p-4"><PortfolioEditor tab={tab} onTabChange={setTab}/></div> }
      createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "isolated-workspace", setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "fixture" }));
      b.onResolve({ filter: /^@\// }, (args) => {
        if (["@/data/context", "@/components/auth/auth-provider", "@/data/projectScreenshotService", "@/lib/supabase/env"].includes(args.path)) return { path: args.path, namespace: "fixture" };
        const base = resolve(root, args.path.slice(2));
        for (const ext of [".tsx", ".ts"]) { try { readFileSync(base + ext); return { path: base + ext }; } catch { /* next extension */ } }
      });
      b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ loader: "js", resolveDir: root, contents: args.path === "next/link" ? "import React from 'react'; export default function Link(props){return React.createElement('a',props,props.children)}" : args.path === "@/data/context" ? `export async function getWorkspaceContext(){ return {userId:'${owner}',supabase:{from(){return {select(){return {eq(){return {single:async()=>fetch('/draft').then(r=>r.json())}}}}}},rpc:async(name,args)=>fetch('/save',{method:'POST',body:JSON.stringify(args)}).then(r=>r.json())}} }` : args.path.includes("auth-provider") ? "export const useAuth=()=>({status:'unauthenticated'});" : args.path.includes("projectScreenshot") ? "export const listPublicProjectScreenshots=async()=>[];" : "export const isSupabaseConfigured=()=>true;" }));
    } }],
  });
  const css = readdirSync(resolve(root, ".next/static/chunks")).filter((name) => name.endsWith(".css")).map((name) => readFileSync(resolve(root, ".next/static/chunks", name), "utf8")).join("\n");
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); return res.end(bundled.outputFiles[0].text); }
      if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/draft") return res.end(JSON.stringify({ data: (await db.query("select * from public.profiles")).rows[0], error: null }));
      if (req.url === "/public") {
        const content = (await db.query("select public.public_portfolio() as content")).rows[0].content;
        const row = (await db.query("select * from public.public_profile()")).rows[0];
        return res.end(JSON.stringify({ content, profile: { displayName: row.display_name, headline: row.headline, bio: row.bio } }));
      }
      if (req.url === "/save") {
        let text = ""; for await (const chunk of req) text += chunk;
        const args = JSON.parse(text);
        if (failNextSave) { failNextSave = false; return res.end(JSON.stringify({ data: null, error: { code: "NETWORK" } })); }
        try { const data = (await db.query("select public.save_portfolio($1::jsonb,$2,$3,$4) as revision", [JSON.stringify(args.p_content), args.p_revision, args.p_enabled, args.p_ai_enabled])).rows[0].revision; return res.end(JSON.stringify({ data, error: null })); }
        catch (error) { return res.end(JSON.stringify({ data: null, error: { code: error.code } })); }
      }
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); const base = `http://127.0.0.1:${server.address().port}`;
  page.setDefaultTimeout(8000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const tab = (name) => page.getByRole("button", { name, exact: true }).click();
  const save = async () => { await tab("Save portfolio"); await page.getByRole("status").filter({ hasText: "Saved." }).waitFor(); };
  const add = async (section, action, values) => { await tab(section); await tab(action); const dialog = page.getByRole("dialog", { name: `Edit ${{ "Technical Toolkit": "toolkit", "Engineering Focus": "focus", "Contact & Links": "links" }[section] ?? section.toLowerCase()}` }); for (const [label, value] of Object.entries(values)) await dialog.getByLabel(label, { exact: true }).fill(value); await dialog.getByRole("button", { name: "Apply to draft", exact: true }).click(); };
  try {
    await page.goto(base); await tab("Hero & Bio");
    await page.getByLabel("Bio / Professional Summary", { exact: true }).fill("Edited browser bio");
    failNextSave = true; await tab("Save portfolio"); await page.getByRole("alert").filter({ hasText: "could not be saved" }).waitFor();
    assert.equal(await page.getByLabel("Bio / Professional Summary", { exact: true }).inputValue(), "Edited browser bio"); await save();
    const preview = await browser.newPage(); await preview.goto(`${base}/preview`); await preview.getByText("Edited browser bio", { exact: true }).waitFor();
    await add("Experience", "+ Add Experience", { Company: "Temporary browser company", "Role / title": "Temporary role", "Start month": "2026-01", "End month": "2026-03" });
    await save(); await preview.reload(); await preview.getByText("Temporary browser company", { exact: true }).waitFor();
    await page.getByLabel("Show Temporary role · Temporary browser company publicly", { exact: true }).uncheck(); await save(); await preview.reload(); await preview.getByText("Edited browser bio", { exact: true }).waitFor(); assert.equal(await preview.getByText("Temporary browser company", { exact: true }).count(), 0);
    await page.getByRole("article").filter({ hasText: "Temporary browser company" }).getByRole("button", { name: "Delete Experience", exact: true }).click();
    await page.getByRole("dialog", { name: "Confirm portfolio action" }).getByRole("button", { name: "Confirm", exact: true }).click(); await save();
    await add("Education", "+ Add Education", { Institution: "Temporary institution", Degree: "Temporary degree" });
    await page.getByRole("article").filter({ hasText: "Temporary institution" }).getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Honors", { exact: true }).fill("Edited honors"); await page.getByRole("dialog").getByRole("button", { name: "Apply to draft", exact: true }).click(); await save();
    await tab("Technical Toolkit"); await page.getByRole("article").filter({ hasText: "Languages" }).getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog"); await dialog.getByRole("button", { name: "+ Add Skill", exact: true }).click(); await dialog.getByLabel("Skill 10", { exact: true }).fill("Browser skill"); await dialog.getByRole("button", { name: "Move Skill 10 up", exact: true }).click(); await dialog.getByRole("button", { name: "Apply to draft", exact: true }).click(); await save();
    await preview.reload(); await preview.getByText(/Browser skill/).waitFor();
    await add("Technical Toolkit", "+ Add Category", { "Category name": "Temporary category" }); await save();
    await page.getByRole("article").filter({ hasText: "Temporary category" }).getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Category name", { exact: true }).fill("Renamed category"); await page.getByRole("dialog").getByRole("button", { name: "+ Add Skill", exact: true }).click(); await page.getByRole("dialog").getByLabel("Skill 1", { exact: true }).fill("Temporary category skill"); await page.getByRole("dialog").getByRole("button", { name: "Apply to draft", exact: true }).click(); await save();
    await preview.reload(); await preview.getByText("Temporary category skill", { exact: true }).waitFor();
    await page.getByRole("article").filter({ hasText: "Renamed category" }).getByRole("button", { name: "Delete Category", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click(); await save();
    await tab("Core Application Stack"); await tab("+ Add Stack item"); await page.getByLabel("Stack item 8", { exact: true }).fill("Browser stack"); await tab("Move Stack item 8 up"); await save();
    await add("Engineering Focus", "+ Add Focus item", { Title: "Browser focus", Description: "Updated browser focus description" }); await save();
    await add("Contact & Links", "+ Add Link", { "Type (GitHub, LinkedIn, portfolio, or custom)": "custom", "Link label": "Browser link", "HTTP/HTTPS URL": "https://example.com/approved" }); await save();
    await tab("Contact & Links"); await page.getByLabel("Show phone publicly", { exact: true }).uncheck(); await save(); await preview.reload(); await preview.getByText("Edited browser bio", { exact: true }).waitFor(); assert.equal(await preview.locator('a[href^="tel:"]').count(), 0);
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const section of ["Hero & Bio", "Experience", "Education", "Technical Toolkit", "Contact & Links", "Public Settings"]) { await tab(section); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: ${section}`); }
      await tab("Experience"); await page.getByRole("article").first().getByRole("button", { name: "Edit", exact: true }).click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: dialog`); await page.getByRole("dialog").getByRole("button", { name: "Apply to draft", exact: true }).click();
      await preview.setViewportSize({ width, height: 900 }); assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: public`);
      for (const theme of ["dark", "light"]) {
        await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
        await preview.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: CMS ${theme}`);
        assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: public ${theme}`);
        if (process.env.PORTFOLIO_TEST_SCREENSHOTS && [320, 1440].includes(width)) {
          await page.screenshot({ path: resolve(process.env.PORTFOLIO_TEST_SCREENSHOTS, `cms-${width}-${theme}.png`), fullPage: true });
          await preview.screenshot({ path: resolve(process.env.PORTFOLIO_TEST_SCREENSHOTS, `public-${width}-${theme}.png`), fullPage: true });
        }
      }
    }
    // Keyboard-visible focus and native modal focus containment.
    await tab("Experience"); await page.getByRole("article").first().getByRole("button", { name: "Edit", exact: true }).click(); await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('dialog[open]'))), true);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error("Browser errors:", errors, "Visible content:", await page.locator("body").innerText());
    throw error;
  } finally { await browser.close(); await new Promise((done) => server.close(done)); await db.close(); }
});
