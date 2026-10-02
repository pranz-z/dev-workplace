import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const load = (source) => import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`);
const withoutImports = (source) => source.replace(/^import .*;\r?\n/gm, "");
const professionalUrl = `data:text/javascript;base64,${Buffer.from(compile(withoutImports(read("lib/portfolio/resume-content.ts")))).toString("base64")}`;

async function proxyFor(user) {
  return load(`
    const userValue = ${JSON.stringify(user)};
    const cookies = { getAll: () => [], set: () => {} };
    const NextResponse = { next: () => ({ kind: "next", cookies }), redirect: (url) => ({ kind: "redirect", url: url.toString(), cookies }) };
    const createServerClient = () => ({ auth: { getUser: async () => ({ data: { user: userValue } }) } });
    const isSupabaseConfigured = () => true;
    const getSupabaseEnv = () => ({ url: "https://db.example", key: "public" });
    const getApplicationOrigin = () => "https://portfolio.example";
    const sanitizeNextPath = (value) => value?.startsWith("/app") ? value : "/app";
    ${withoutImports(read("proxy.ts"))}
  `);
}

const request = (path) => ({ nextUrl: new URL(path, "https://portfolio.example"), cookies: { getAll: () => [], set: () => {} } });

test("root remains public for signed-out and signed-in visitors; workspace is protected", async () => {
  for (const user of [null, { id: "owner" }]) {
    const { proxy } = await proxyFor(user);
    assert.equal((await proxy(request("/"))).kind, "next");
    assert.equal((await proxy(request("/projects/demo"))).kind, "next");
    for (const path of ["/app", "/app/tasks?view=kanban"]) {
      const response = await proxy(request(path));
      if (user) assert.equal(response.kind, "next");
      else {
        assert.equal(new URL(response.url).pathname, "/login");
        assert.equal(new URL(response.url).searchParams.get("next"), path);
      }
    }
  }
});

test("legacy portfolio and case study URLs permanently redirect", async () => {
  const stub = 'const permanentRedirect = (path) => { throw new Error(path); };\n';
  const home = await load(stub + withoutImports(read("app/view/page.tsx")));
  assert.throws(() => home.default(), { message: "/" });
  const project = await load(stub + withoutImports(read("app/view/project/[slug]/page.tsx")));
  await assert.rejects(project.default({ params: Promise.resolve({ slug: "demo-project" }) }), { message: "/projects/demo-project" });
});

test("sitemap includes root and only public canonical project routes", async () => {
  const source = withoutImports(read("app/sitemap.ts"));
  const sitemapModule = await load(`
    const getApplicationOrigin = () => "https://portfolio.example";
    const getSupabaseEnv = () => ({ url: "https://db.example", key: "public" });
    const createClient = () => ({ rpc: async () => ({ data: [
      { slug: "public-project", visibility: "Public", updated_at: "2026-10-02" },
      { slug: "unlisted-project", visibility: "Unlisted" },
      { slug: "private-project", visibility: "Private" }
    ] }) });
    ${source}
  `);
  assert.deepEqual((await sitemapModule.default()).map((item) => item.url), ["https://portfolio.example/", "https://portfolio.example/projects/public-project"]);
});

test("project metadata keeps unlisted noindex and unavailable projects generic", async () => {
  for (const visibility of ["Public", "Unlisted", null]) {
    const projectModule = await load(`
      const getApplicationOrigin = () => "https://portfolio.example";
      const getSupabaseServerClient = async () => ({ rpc: async (name) => ({ data: name === "public_project_by_slug" && ${JSON.stringify(visibility)} ? [{ slug: "demo", title: "Demo", visibility: ${JSON.stringify(visibility)}, description: "Safe description" }] : [] }) });
      ${withoutImports(read("app/projects/[slug]/layout.tsx"))}
    `);
    const metadata = await projectModule.generateMetadata({ params: Promise.resolve({ slug: "demo" }) });
    if (visibility) assert.equal(metadata.alternates.canonical, "https://portfolio.example/projects/demo");
    else assert.equal(metadata.alternates, undefined);
    if (visibility !== "Public") assert.equal(metadata.robots.index, false);
  }
});

test("public presentation and share builders use the canonical route and safe services", () => {
  const workspace = read("app/app/page.tsx");
  assert.match(workspace, /window\.location\.origin\}\/projects\/\$\{encodeURIComponent\(project\.slug\)\}/);
  assert.doesNotMatch(workspace, /\/view/);
  const portfolio = read("components/portfolio/PublicPortfolio.tsx");
  assert.match(portfolio, /project.visibility === "Public"/);
  assert.match(portfolio, /status === "authenticated".*href="\/app"/);
  assert.doesNotMatch(portfolio, /getCurrentProfile|loadWorkspaceData|mockData/);
  assert.match(read("app/projects/[slug]/page.tsx"), /getPublicProjectBySlug/);
  assert.match(read("components/public-ai/public-ai-concierge.tsx"), /href=\{`\/projects\//);
  assert.match(read("app/robots.ts"), /disallow: \["\/app", "\/api\/", "\/auth\/", "\/login"\]/);
});

test("homepage metadata uses only the public profile and falls back safely when sharing is off", async () => {
  const source = read("app/page.tsx").split("export default async function PortfolioHome")[0];
  for (const enabled of [true, false]) {
    const homeModule = await load(`
      import { publicProfessionalIntroduction } from ${JSON.stringify(professionalUrl)};
      const cache = (fn) => fn;
      const getApplicationOrigin = () => "https://portfolio.example";
      const getSupabaseServerClient = async () => ({ rpc: async (name) => ({ data: name === "public_profile" && ${enabled} ? [{ display_name: "Public Name", headline: "Configured focus", bio: "Public bio" }] : [] }) });
      ${withoutImports(source)}
    `);
    const metadata = await homeModule.generateMetadata();
    assert.equal(metadata.title, enabled ? "Public Name — Configured focus" : "Developer Portfolio");
    assert.equal(metadata.alternates.canonical, "/");
    assert.equal(metadata.openGraph.url, "https://portfolio.example/");
  }
});

test("auth callback defaults to /app and blocks external return destinations", async () => {
  const redirects = await load(withoutImports(read("lib/auth/redirects.ts")));
  const redirectsUrl = `data:text/javascript;base64,${Buffer.from(compile(withoutImports(read("lib/auth/redirects.ts")))).toString("base64")}`;
  const callback = await load(`
    import { sanitizeNextPath } from ${JSON.stringify(redirectsUrl)};
    const getApplicationOrigin = () => "https://portfolio.example";
    const NextResponse = { redirect: (url) => ({ url: url.toString() }) };
    const getSupabaseServerClient = async () => ({
      auth: { exchangeCodeForSession: async () => ({ data: { user: { id: "owner", user_metadata: {} } } }) },
      from: () => ({ upsert: async () => ({ error: null }) })
    });
    ${withoutImports(read("app/auth/callback/route.ts"))}
  `);
  for (const next of [null, "/app?tab=tasks", "https://evil.example", "//evil.example", "/\t/evil.example"]) {
    const url = new URL("https://portfolio.example/auth/callback?code=test-code");
    if (next !== null) url.searchParams.set("next", next);
    assert.equal((await callback.GET(new Request(url))).url, `https://portfolio.example${redirects.sanitizeNextPath(next)}`);
  }
});
