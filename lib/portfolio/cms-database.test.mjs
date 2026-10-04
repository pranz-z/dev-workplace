import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`;
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const contentUrl = moduleUrl(read("./content.ts"));
const { portfolioSchema, validatePortfolio } = await import(contentUrl);
const { resumePortfolioSeed } = await import(moduleUrl(read("./resume-seed.ts").replace('"./content"', JSON.stringify(contentUrl))));
const publicResumeUrl = moduleUrl(read("./public-resume-context.ts").replace('import "server-only";', ""));
const { buildPublicDeveloperContext } = await import(moduleUrl(read("../public-ai/service.ts").replace('import "server-only";', "").replace('"@/lib/portfolio/public-resume-context"', JSON.stringify(publicResumeUrl))));
const migration = read("../../supabase/migrations/20261004111128_portfolio_cms.sql");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

test("SQL schema is identical to the shared bounded validation contract", () => {
  const embedded = migration.match(/schema_spec jsonb := '(.*?)'::jsonb/s)[1];
  assert.deepEqual(JSON.parse(embedded), portfolioSchema);
});

test("database: migration, owner CRUD, RLS, projections, ordering, conflicts and AI privacy", { skip: !process.env.PORTFOLIO_TEST_PGLITE_MODULE }, async () => {
  // Disposable real PostgreSQL engine; never points at the linked production DB.
  const { PGlite } = await import(pathToFileURL(process.env.PORTFOLIO_TEST_PGLITE_MODULE).href);
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create table public.profiles (
      id uuid primary key, display_name text, headline text, bio text, avatar_url text,
      public_contact_email text, show_public_contact_email boolean not null default false,
      public_github_url text, public_linkedin_url text, public_website_url text,
      public_profile_enabled boolean not null default false, public_ai_assistant_enabled boolean not null default false,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    alter table public.profiles enable row level security;
    create policy "own profile" on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
    grant select, insert, update, delete on public.profiles to authenticated;
    create table public.projects (id uuid primary key, slug text unique, user_id uuid, visibility text);
    create table public.project_screenshots (
      id uuid primary key, project_id uuid, storage_path text, caption text,
      created_at timestamptz default now(), is_public boolean default false, sort_order integer not null default 0
    );
    create type public.public_project_card as (slug text, is_featured boolean, updated_at timestamptz);
    create function private.public_project_rows(p_slug text, p_include_unlisted boolean)
    returns setof public.public_project_card language sql as $$
      select p.slug, false, now() from public.projects p
      where (p.visibility = 'Public' or (p_include_unlisted and p.visibility = 'Unlisted'))
        and (p_slug is null or p.slug = p_slug)
    $$;
    grant usage on schema private to anon, authenticated;
    insert into public.profiles(id, display_name, public_profile_enabled, public_ai_assistant_enabled, created_at)
      values ('${owner}', 'Owner', true, true, '2020-01-01'), ('${other}', 'Other', true, false, '1900-01-01');
    insert into public.projects(id, slug, user_id, visibility) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner-public', '${owner}', 'Public'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'other-public', '${other}', 'Public'),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'other-unlisted', '${other}', 'Unlisted');
    insert into public.project_screenshots(id, project_id, storage_path, caption, is_public) values
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${owner}/owner.png', 'owner', true),
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${other}/other.png', 'other', true);
  `);
  try {
    await db.exec(migration);
    async function as(role, id = "") { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${id}', false); set role ${role};`); }
    async function save(doc, revision, enabled = true, ai = true) { return (await db.query("select public.save_portfolio($1::jsonb, $2, $3, $4) as revision", [JSON.stringify(doc), revision, enabled, ai])).rows[0].revision; }
    async function projection() { return (await db.query("select public.public_portfolio() as content")).rows[0].content; }
    await as("anon");
    assert.equal(await projection(), null);
    assert.equal((await db.query("select * from public.public_profile()")).rows.length, 0);
    assert.equal((await db.query("select * from public.public_ai_profile()")).rows.length, 0);
    assert.equal((await db.query("select * from public.public_project_list()")).rows.length, 0);
    assert.equal((await db.query("select * from public.public_project_by_slug('other-unlisted')")).rows.length, 0);
    assert.equal((await db.query("select * from public.public_project_screenshots('other-public')")).rows.length, 0);
    await assert.rejects(db.query("select * from private.portfolio_site_config"), /permission denied/);
    await assert.rejects(db.query("select private.canonical_portfolio_owner_id()"), /permission denied/);
    await as("authenticated", other);
    await assert.rejects(db.query("select * from private.portfolio_site_config"), /permission denied/);
    await assert.rejects(db.query("update private.portfolio_site_config set owner_id = $1 where singleton", [other]), /permission denied/);
    const originalCreatedAt = (await db.query("select created_at::text as created_at from public.profiles where id = $1", [other])).rows[0].created_at;
    await db.query("update public.profiles set display_name = 'Other published profile', public_ai_assistant_enabled = true where id = $1", [other]);
    assert.equal((await db.query("select display_name from public.profiles where id = $1", [other])).rows[0].display_name, "Other published profile");
    await assert.rejects(db.query("update public.profiles set created_at = '1800-01-01' where id = $1", [other]), /system-managed/);
    assert.equal((await db.query("select created_at::text as created_at from public.profiles where id = $1", [other])).rows[0].created_at, originalCreatedAt);
    await assert.rejects(db.query("update public.profiles set id = $1 where id = $2", [owner, other]), /system-managed/);
    await as("anon");
    assert.equal(await projection(), null);
    assert.equal((await db.query("select * from public.public_profile()")).rows.length, 0);
    assert.equal((await db.query("select * from public.public_ai_profile()")).rows.length, 0);
    assert.equal((await db.query("select * from public.public_ai_project_list()")).rows.length, 0);
    assert.equal((await db.query("select * from public.public_project_list()")).rows.length, 0);
    await db.exec("reset role");
    await db.query("update private.portfolio_site_config set owner_id = $1 where singleton", [owner]);
    await as("authenticated", owner);
    const seed = resumePortfolioSeed(); validatePortfolio(seed);
    let revision = await save(seed, 0);
    assert.equal(revision, 1);
    await assert.rejects(save(seed, 0), /changed in another editor/);
    await assert.rejects(save(null, revision), /required|Invalid portfolio content/);
    const raw = (await db.query("select portfolio_content from public.profiles")).rows;
    assert.equal(raw.length, 1); assert.equal(raw[0].portfolio_content.bio, seed.bio);
    const update = structuredClone(seed);
    update.hero.name = "Edited identity"; update.hero.headline = "Edited headline"; update.bio = "Updated public bio";
    update.about.body = "Updated About";
    update.experience.push({ ...structuredClone(seed.experience[0]), id: crypto.randomUUID(), company: "New company", sort_order: 0 });
    update.experience[0].sort_order = 2;
    update.experience[0].summary = "Edited existing experience";
    update.education.push({ ...structuredClone(seed.education[0]), id: crypto.randomUUID(), institution: "New education", sort_order: 0 });
    update.education[0].sort_order = 2;
    update.education[0].honors = "Edited education honors";
    update.toolkit[0].items.push({ id: crypto.randomUUID(), name: "New skill", enabled: true, sort_order: 0 });
    update.toolkit[0].items[0].sort_order = 2;
    update.stack[0].name = "Edited stack"; update.focus[0].description = "Edited focus";
    revision = await save(update, revision);
    let projected = await projection();
    assert.equal(projected.hero.name, "Edited identity"); assert.equal(projected.bio, "Updated public bio");
    assert.equal(projected.about.body, "Updated About");
    assert.equal(projected.experience[0].company, "New company"); assert.equal(projected.education[0].institution, "New education");
    assert.equal(projected.experience[1].summary, "Edited existing experience"); assert.equal(projected.education[1].honors, "Edited education honors");
    assert.ok(projected.toolkit[0].items.some((item) => item.name === "New skill"));
    assert.equal(projected.stack[0].name, "Edited stack"); assert.equal(projected.focus[0].description, "Edited focus");
    const aiContext = buildPublicDeveloperContext({ portfolio: projected }, []);
    for (const fact of ["Edited identity", "Updated public bio", "Updated About", "New company", "New education", "New skill", "Edited stack", "Edited focus"]) assert.ok(JSON.stringify(aiContext).includes(fact), fact);
    const hidden = structuredClone(update);
    hidden.contact.showPhone = false; hidden.contact.showEmail = false; hidden.contact.showLocation = false;
    hidden.experience[1].enabled = false; hidden.education[1].enabled = false;
    hidden.toolkit[0].items.at(-1).enabled = false; hidden.toolkit[1].enabled = false; hidden.stack[0].enabled = false;
    hidden.focus[0].enabled = false; hidden.links[0].enabled = false;
    hidden.sections.about.enabled = false;
    revision = await save(hidden, revision);
    projected = await projection();
    const json = JSON.stringify(projected);
    for (const secret of [seed.contact.email, seed.contact.phone, seed.contact.location, "New company", "New education", "New skill", "Updated About", "Edited focus", "Edited stack"]) assert.ok(!json.includes(secret), secret);
    const hiddenContext = JSON.stringify(buildPublicDeveloperContext({ portfolio: projected }, []));
    for (const secret of [seed.contact.email, seed.contact.phone, seed.contact.location, "New company", "New education", "New skill", "Updated About", "Edited focus", "Edited stack"]) assert.ok(!hiddenContext.includes(secret), secret);
    assert.equal(projected.toolkit.some((group) => group.id === hidden.toolkit[1].id), false);
    const profile = (await db.query("select * from public.public_profile()")).rows[0];
    assert.equal(profile.public_contact_email, ""); assert.equal(profile.website_url, null);
    const ai = (await db.query("select * from public.public_ai_profile()")).rows[0];
    assert.equal(ai.bio, "Updated public bio"); assert.equal(ai.public_contact_email, "");
    hidden.experience.splice(1, 1); hidden.education.splice(1, 1); hidden.toolkit.splice(1, 1);
    revision = await save(hidden, revision);
    assert.equal((await db.query("select portfolio_content from public.profiles")).rows[0].portfolio_content.experience.length, 1);
    const malicious = structuredClone(hidden); malicious.links[0].url = "javascript:alert(1)";
    await assert.rejects(save(malicious, revision), /Invalid portfolio content/);
    const duplicateIdCaseVariants = structuredClone(hidden);
    duplicateIdCaseVariants.stack[0].id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    duplicateIdCaseVariants.stack.push({ ...duplicateIdCaseVariants.stack[0], id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" });
    await assert.rejects(save(duplicateIdCaseVariants, revision), /Invalid portfolio content/);
    const tooLong = structuredClone(hidden); tooLong.bio = "x".repeat(2001);
    await assert.rejects(save(tooLong, revision), /Invalid portfolio content/);
    await assert.rejects(db.query("update public.profiles set portfolio_content = $1::jsonb where id = $2", [JSON.stringify(malicious), owner]), /Invalid portfolio content/);
    // Disable each major section and confirm no content survives its server projection.
    const disabled = structuredClone(hidden);
    for (const key of Object.keys(disabled.sections)) disabled.sections[key].enabled = false;
    revision = await save(disabled, revision);
    projected = await projection();
    assert.equal(projected.hero.name, ""); assert.equal(projected.bio, ""); assert.equal(projected.about.body, "");
    for (const key of ["stack", "experience", "education", "toolkit", "focus", "links"]) assert.deepEqual(projected[key], []);
    assert.equal(projected.contact.phone, ""); assert.equal(projected.contact.email, "");
    assert.equal((await db.query("select * from public.public_ai_profile()")).rows[0].bio, "");
    revision = await save(hidden, revision, true, false);
    assert.equal((await db.query("select * from public.public_ai_profile()")).rows.length, 0);
    assert.equal((await db.query("select * from public.public_ai_project_list()")).rows.length, 0);
    revision = await save(hidden, revision, false, false);
    assert.equal(await projection(), null);
    assert.equal((await db.query("select * from public.public_profile()")).rows.length, 0);
    assert.equal((await db.query("select * from public.public_ai_profile()")).rows.length, 0);
    await save(hidden, revision, true, true);
    await as("anon");
    assert.equal((await db.query("select * from public.public_profile()")).rows[0].display_name, "Edited identity");
    assert.equal((await db.query("select * from public.public_ai_profile()")).rows[0].display_name, "Edited identity");
    assert.equal((await projection()).hero.name, "Edited identity");
    assert.deepEqual((await db.query("select slug from public.public_project_list() order by slug")).rows.map((row) => row.slug), ["owner-public"]);
    assert.deepEqual((await db.query("select slug from public.public_ai_project_list() order by slug")).rows.map((row) => row.slug), ["owner-public"]);
    assert.equal((await db.query("select * from public.public_project_by_slug('owner-public')")).rows.length, 1);
    assert.equal((await db.query("select * from public.public_project_by_slug('other-unlisted')")).rows.length, 0);
    assert.deepEqual((await db.query("select project_slug from public.public_project_screenshots('owner-public')")).rows.map((row) => row.project_slug), ["owner-public"]);
    assert.equal((await db.query("select private.can_read_public_project_screenshot($1) as allowed", [`${other}/other.png`])).rows[0].allowed, false);
    assert.equal((await db.query("select private.can_read_public_project_screenshot($1) as allowed", [`${owner}/owner.png`])).rows[0].allowed, true);
    await as("authenticated", other);
    assert.equal((await db.query("select id from public.profiles")).rows[0].id, other);
    assert.equal((await db.query("update public.profiles set portfolio_content = null where id = $1 returning id", [owner])).rows.length, 0);
    await assert.rejects(db.query("update public.profiles set id = $1 where id = $2", [owner, other]), /system-managed|row-level security|duplicate key/);
    await as("anon");
    await assert.rejects(db.query("select * from public.profiles"), /permission denied/);
    await assert.rejects(save(seed, 0), /permission denied/);
    await assert.rejects(db.query("update public.profiles set public_profile_enabled = false"), /permission denied/);
    assert.ok(await projection());
    await as("authenticated", "");
    await assert.rejects(save(seed, 0), /Authentication required/);
  } finally { await db.close(); }
});
