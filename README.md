# Developer Workplace

A personal software developer workspace for project planning, task execution, portfolio evidence, GitHub activity, and career tracking. The private workspace authenticates through Supabase Auth with GitHub sign-in, while the public portfolio routes stay open to visitors.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000

## Main prototype features

- Colorful private workspace for projects, daily flow, notes, plans, and career tracking
- Light, dark, and system theme support with persisted selection via localStorage
- Responsive mobile-first private workspace navigation and dashboard sections
- Project workspace with overview, tasks, milestones, and workflow stages
- GitHub mock importer and repository browser
- Portfolio preview mode and public project case-study routes at `/view` and `/view/project/[slug]`
- Career and freelance tracking for applications and leads
- Local browser persistence with localStorage

## Production foundation

- `supabase/migrations/20260930120000_phase1.sql` applies the lightweight workspace schema from `supabase/schema.sql` with Row Level Security. GitHub commits, issues, pull requests, and repository histories are intentionally not duplicated in Supabase.
- `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server), and `lib/supabase/env.ts` (validated environment) provide the Supabase boundary. Copy `.env.example` to `.env.local` and fill in the Supabase project values.
- `components/auth/auth-provider.tsx` exposes the single authentication state (`loading` / `authenticated` / `unauthenticated`) backed by Supabase Auth; `components/auth/user-menu.tsx` renders the avatar, display name, GitHub username, and the Profile / Settings / Sign out menu.
- `data/githubService.ts` owns read-only GitHub API access, centralized cache durations, and rate-limit errors. It is not wired into the UI yet: repository access is a later phase.
- `data/githubWriteService.ts` sends writes through `/api/github/write`; the MVP keeps this boundary disabled until a trusted GitHub App/OAuth secret is configured.
- `data/projectService.ts` provides a Supabase-backed project provider with the existing mock data as a no-configuration fallback.
- `data/workspaceService.ts` hydrates the authenticated workspace and provides the guarded localStorage migration.
- `proxy.ts` (the Next.js 16 replacement for middleware) refreshes Supabase auth cookies on every request and protects `/app` and any future `/app/*` route server-side.
- `supabase/tests/rls.sql` checks RLS enablement and required ownership/public policies in the Supabase test workflow.
- `supabase/seed.sql` seeds safe example projects for the first local auth user; it exits without changes when no local user exists.

### Supabase setup

1. Create a Supabase project, then open **Authentication → Providers → GitHub** and enable the provider.
2. Create a GitHub OAuth App (GitHub → Settings → Developer settings → OAuth Apps → New OAuth App):
   - **Homepage URL**: your app origin (for example `http://localhost:3000` or `https://your-domain.example`).
   - **Authorization callback URL**: `https://<project-ref>.supabase.co/auth/v1/callback` — replace `<project-ref>` with the Supabase project ref shown in the Supabase dashboard. GitHub redirects to Supabase, and Supabase redirects back to the app callback in the next step.
   - Copy the GitHub Client ID and Client Secret into the Supabase GitHub provider settings.
3. In **Authentication → URL Configuration** set:
   - Site URL: `http://localhost:3000` for development, or the production origin.
   - Redirect URLs (allow-list): `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback`.
4. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Optionally set `NEXT_PUBLIC_SITE_URL` to a canonical origin when the app is served from a custom domain. `.env.example` must stay as placeholders only — never commit real values.
5. Apply the database schema through the Supabase CLI or cloud workflow (`supabase/migrations/20260930120000_phase1.sql`) so the `profiles` and workspace tables exist.
6. Run `npm run dev`, open `/login`, choose **Continue with GitHub**, and the callback lands on `/app`.

**Authentication vs repository access:** this phase uses GitHub only as an OAuth identity provider for Supabase Auth. The app requests no repository scopes, stores no GitHub token, and makes no GitHub API calls. Repository importing, commit/activity feeds, and webhooks belong to a later phase and remain disabled (`/api/github/write` still returns `501`).

**Fail-fast environment handling:** production builds and server starts throw a clear `Missing NEXT_PUBLIC_SUPABASE_URL` error when the environment is absent, the Supabase client factories refuse to create an invalid client, and private routes always redirect to `/login` instead of falling back to mock data. Development only warns so the public pages stay browsable without Supabase.

No service-role key is needed by the browser. Keep privileged secrets out of `NEXT_PUBLIC_*` variables.

The local Supabase CLI requires Docker Desktop or Podman. The application build does not require a local database runtime.

## Theme system

The interface supports three modes:

- `light`
- `dark`
- `system`

The current mode is persisted in localStorage and applied to the HTML root element using a theme attribute.

## Routes

- `/login` — GitHub sign-in (redirects to the workspace when a session already exists)
- `/app` — authenticated workspace, protected server-side; unauthenticated visitors are redirected to `/login?next=/app`
- `/` — redirects to `/app` when signed in and to `/view` for visitors (never shows the private workspace)

- `/view` — public profile and featured project index
- `/view/project/autocare` — public project case study page
- `/view/project/ai-agent` — public project case study page
- `/view/project/mobile-llm` — public project case study page
- `/view/project/autosimar` — public project case study page

These pages present a public-facing portfolio experience rather than the internal project management tools.
The workspace navigation in the sidebar (Today, Projects, Tasks, Plans, Calendar, Notes, Learning, Tech Stack, Applications, Resume, Freelance, Portfolio, Settings) currently switches views client-side inside `/app`; the proxy matcher already protects every future `/app/*` route.

## Where mock data lives

The seeded data is stored in:

- `data/mockData.ts`
- `types.ts`

This keeps the prototype easy to replace later with API calls or a real database layer.

## Public vs private visibility

Each project can be marked as:

- `Private` — private workspace only
- `Public` — visible in the public portfolio viewer
- `Unlisted` — still prototype-only and shareable by direct link

The current seeded data uses public project metadata for the portfolio viewer, while the private workspace retains the full management tools and internal data model.

## Where GitHub is simulated

The GitHub mock flow is intentionally prototype-only and is triggered from the GitHub section and import modal in the app.

- Repository list is seeded from mock data
- Importing a repo creates a project record from repository metadata
- The UI simulates a connected GitHub state and repository health indicators
- Mock data remains the default without Supabase configuration. The live GitHub service is available for the next authenticated migration step.

## Current MVP boundaries

The Phase 1 foundation intentionally leaves these areas deferred:

- GitHub is connected as a Supabase Auth identity provider; repository access, commits, activity, and webhooks remain deferred to a later phase
- no multi-user collaboration
- `/app` always requires a verified Supabase session; without Supabase configuration the private workspace stays locked and only the public routes serve mock data
- GitHub write operations and webhooks are not enabled yet; the trusted server boundary returns an explicit `501` until configured
- no billing or enterprise permissions
- no AI generation workflows

Never place Supabase service-role keys, GitHub client secrets, or GitHub App private keys in `NEXT_PUBLIC_*` variables or browser storage.

## Recommended next steps after user testing

1. Identify which sections are used daily versus ignored.
2. Rank the workflows that feel truly valuable.
3. Decide which parts belong in the production MVP.
4. Verify GitHub OAuth sign-in on desktop and mobile, then align the workspace schema with the UI model in a follow-up phase.
5. Add a server-side GitHub token exchange and implement repository import.
6. Add summarized webhook metadata and background activity revalidation.
