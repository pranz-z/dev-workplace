# Portfolio CMS implementation report

Implemented locally on October 4, 2026. No remote migration, production content mutation, deployment, or commit was performed.

1. **Previous architecture:** `/` combined `public_profile()` and public project projections with name-matched hardcoded professional content in `resume-content.ts`. Public AI independently imported resume facts and contact fallbacks, including phone/email values that could outlive public visibility settings.
2. **New architecture:** `/app` → Portfolio editor → authenticated `save_portfolio()` → existing `profiles` row → `public_portfolio()` → both public portfolio and Public AI. There is no production resume fallback. Legacy configured database profile fields remain readable until the owner initializes the CMS.
3. **Database changes:** `profiles.portfolio_content` stores one strictly validated structured JSONB document; `portfolio_revision` detects stale saves. Collections use UUID IDs, `enabled`, and `sort_order`. Existing profile IDs, timestamps, sharing flags, and RLS are reused. This avoids redundant identity/contact tables and permits one atomic save.
4. **Migration:** `supabase/migrations/20261004111128_portfolio_cms.sql`, created with the Supabase CLI. Self-contained SQL; no applied migration was edited, no owner UUID is embedded, and no profile is seeded or published automatically.
5. **Hero editor:** Public name, headline, description, supporting line, and optional HTTP/HTTPS image URL.
6. **Bio editor:** Multiline professional summary, bounded to 2,000 characters in client validation and the database trigger.
7. **About editor:** Title, body, and secondary paragraph, rendered as escaped text.
8. **Core Application Stack:** Individual item inputs with add/remove, visibility, and Up/Down controls.
9. **Experience CRUD:** Focused native dialog supports company, role, employment type, months, current role, location, summary, individually editable bullets, and technologies. Cards support edit, visibility, confirmed delete, and reordering.
10. **Education CRUD:** Institution, degree, field, honors, start/graduation month, location, coursework, activities, notes, visibility, confirmed delete, and reordering.
11. **Technical Toolkit CRUD:** Categories can be created, renamed, hidden, reordered, and deleted with confirmation. Individual skills support input editing, add/remove, visibility, and ordering.
12. **Engineering Focus CRUD:** Title, description, optional icon key, visibility, ordering, and confirmed deletion. The icon key is stored as text and never interpreted as HTML or executable code.
13. **Contact editor:** Explicit public email, phone, location, CTA, note, and structured links. Auth email is never used as public contact data.
14. **Contact visibility:** Independent email, phone, and location controls. Every link has its own visibility toggle. Hidden values are removed in PostgreSQL before reaching either public consumer.
15. **Section visibility:** Hero, Projects, About, Experience, Toolkit, Education, Focus, and Contact. Empty professional sections omit headings and navigation.
16. **Ordering:** Child collection order persists through `sort_order`; skills and bullets also have keyboard controls. Major section layout remains fixed to preserve the current portfolio design. Disabling the Projects section does not change project visibility or case-study access.
17. **Public projections:** New `public_portfolio()` uses `private.project_portfolio()` to exclude hidden sections, entries, skills, links, and contact values and sort public collections. Existing `public_profile()` keeps its return contract and projects CMS-approved fields after initialization.
18. **Public AI context:** Reads the same `public_portfolio()` RPC through the anonymous projection client. Profile and project selection use the explicitly configured `private.portfolio_site_config.owner_id`; an unset owner fails closed. Public project lists, exact-slug project pages, screenshots, storage reads, and AI evidence are all scoped to that owner. No static resume projects or hidden phone/contact fallbacks remain. Existing request limits, lease/quota handling, and private Workspace AI are unchanged.
19. **Resume alignment:** Extracted the complete one-page `C:/Users/Franz/Downloads/resumes/Franz_Resume.pdf` and visually inspected its rendered page. The one-time import contains the actual summary, three BMWare bullets, September 2026 education, six toolkit categories including Codex/Copilot/Antigravity/OmniRoute, and supported focus areas. Automated checks verify the name, headline, role, dates, school, honors, technologies, and contact values. Cursor/Cline from the old hardcoded copy were not carried into the new seed. Existing configured identity/bio/avatar/links are preserved during import, so review those fields against the resume before saving.
20. **Project system:** No project records or project-management tables were added. Existing public project list, cards, screenshots, visibility checks, and case-study routes are preserved. The downloadable static PDF was not rewritten; its button remains available even with Hero disabled.
21. **RLS/security:** Existing `profiles` owner policy retains both `USING (id = auth.uid())` and `WITH CHECK`. Anonymous profile-table access remains denied. Save uses `SECURITY INVOKER`, derives the owner from `auth.uid()`, and rejects missing sessions. All new privileged helpers use an explicit empty search path and revoked default execution grants. Strict recursive validation rejects unknown fields, unsafe protocols, oversized content, invalid dates/types/UUIDs, and duplicate collection IDs, including direct authenticated table writes.
22. **Mobile behavior:** Browser fixture checks passed at 1440, 1024, 768, 390, and 320 pixels for CMS forms, cards, dialogs, and public page, in light and dark modes. No horizontal document overflow was found. Desktop and 320px screenshots were visually reviewed. The existing activity rail/context sidebar/resizing/AI shell is retained.
23. **Accessibility:** Explicit labels and unique field IDs; native modal focus containment; descriptive destructive controls; text Up/Down buttons; checkbox visibility labels; visible focus; and status/alert messages. Browser tests exercise modal keyboard focus. No browser `confirm()` or JSON editing is required.
24. **Files changed:**
    - `app/app/page.tsx`, `app/page.tsx`, `app/api/public-ai/route.ts`
    - `components/portfolio/PortfolioEditor.tsx`, `ProfessionalSections.tsx`, `PublicPortfolio.tsx`
    - `data/portfolioService.ts`, `data/database.types.ts`
    - `lib/portfolio/content.ts`, `resume-seed.ts`, `resume-content.ts`, `public-resume-context.ts`
    - `lib/portfolio/resume-content.test.mjs`, `cms-database.test.mjs`, `cms-editor.test.mjs`
    - `lib/public-ai/service.ts`, `lib/public-ai/public-ai.test.mjs`
    - `package.json` (one CMS test script; existing user edits preserved)
    - the new migration and this report
    Existing `.gitignore`, lockfile, package edits, and `marketing/` work were not reset.
25. **Tests added/updated:** Database-backed owner/RLS/projection/save-conflict tests; actual browser CMS/service/SQL integration; public rendering and resume-alignment checks; Public AI tests replacing assumptions about static resume defaults.
26. **Test results:** All 134 repository tests passed with the disposable PostgreSQL and browser test tools enabled: zero failures, zero skips. The CMS integration tests use synthetic local accounts and a disposable PGlite database. They do not connect to the remote project or invoke Gemini. Existing Calendar, Task Kanban, Focus, workspace-shell, private/public AI, security, and route tests passed.
27. **TypeScript:** `npx tsc --noEmit` passed; production build type checking passed.
28. **ESLint:** Changed-file lint passed. Repository-wide `npm run lint` is blocked by an existing `prefer-const` error at `marketing/showcase/final-edit/src/scenes/BriefShowcase.tsx:44`; that unrelated user file was left unchanged.
29. **Build:** `npm run build` passed after implementation, including `/`, `/app`, project routes, AI routes, and GitHub routes.
30. **npm audit:** Full audit reports five high-severity development-toolchain findings in the `braces` → `micromatch` → `fast-glob` → Next ESLint dependency chain. `npm audit --omit=dev` passes with zero production vulnerabilities. No dependency versions were changed.
31. **Diff check:** `git diff --check` passed. Git's Windows LF/CRLF notices are informational.
32. **Migration status:** `npx supabase migration list` succeeded against the linked remote. All 12 pre-existing local migrations match remote. `20261004111128` exists locally and is absent remotely: one pending migration. No migration push was run.
33. **MANUAL SETUP REQUIRED:** Review and apply the pending migration through the normal approved database process before using this feature against the linked database. Then, using a trusted administrative database role, set `private.portfolio_site_config.owner_id` to the intended `profiles.id` UUID; it remains `NULL` by default, which disables all canonical public profile/project projections. Do not grant the public application roles access to this table. Then sign in as that owner, open `/app` → Portfolio → Overview → Import attached resume, confirm the draft import, review every field, and select Save portfolio. Public Settings controls existing opt-in profile and assistant flags; importing never turns them on. Before initialization, legacy configured profile values remain available but static experience/education/toolkit fallbacks have been removed.
34. **MANUAL VALIDATION REQUIRED:** After applying the migration, run the requested live-account workflow: edit/save Bio and verify `/`; add/hide/delete a temporary experience; add/reorder/remove a temporary skill; hide phone and ask a fresh Public AI conversation for it; update Bio and verify a Gemini answer uses the update. Also smoke-test `/projects/[slug]`, project/task Kanban, Calendar, Workspace AI, GitHub App, Focus, sharing, resume download, and themes in the actual authenticated application. These live-provider/remote-database checks were not performed because the migration has deliberately not been pushed. Local database, browser, rendering, and regression checks are complete.
35. **Remaining issues:** One pending database migration and owner import/setup; live Gemini/account smoke checks; the pre-existing marketing lint error and development audit findings. The static downloadable resume remains independent of CMS edits, as requested. No deployment or commit was performed.

## Re-running the isolated integration tests

The default repository suites use existing dependencies. The two integration tests additionally need disposable PGlite and esbuild modules; no application dependency was added for these tools. Without the environment variables below, those two tests explicitly report SKIP, while the schema-contract test still runs.

Install test tools into a temporary directory outside the repository, then set their module paths:

```powershell
npm install --prefix "$env:TEMP\portfolio-cms-test-tools" @electric-sql/pglite esbuild --no-audit --no-fund
$env:PORTFOLIO_TEST_PGLITE_MODULE = "$env:TEMP\portfolio-cms-test-tools\node_modules\@electric-sql\pglite\dist\index.js"
$env:PORTFOLIO_TEST_ESBUILD_MODULE = "$env:TEMP\portfolio-cms-test-tools\node_modules\esbuild\lib\main.js"
npm run build
npm run test:portfolio:cms
$taskTests = @(rg --files lib data components -g '*.test.mjs')
node --test @taskTests
```

The browser test uses the existing Playwright installation and compiled application CSS from `.next/static/chunks`. It mounts the actual CMS/public components and calls the actual portfolio data service against a synthetic local RPC adapter backed by the new migration. The fixture replaces authentication, screenshot lookup, and Next Link routing; it does not substitute the CMS editor, save service, schema validation, SQL projection, or public professional components.
