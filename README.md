# Developer Workplace

A personal software developer workspace for project planning, task execution, portfolio evidence, GitHub activity, and career tracking. The current UI remains usable as a mock-first prototype while the production data boundaries are introduced incrementally.

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
- `lib/supabase/browser.ts` and `lib/supabase/server.ts` provide the Supabase boundary. Copy `.env.example` to `.env.local` to enable it.
- `data/githubService.ts` owns read-only GitHub API access, centralized cache durations, and rate-limit errors.
- `data/githubWriteService.ts` sends writes through `/api/github/write`; the MVP keeps this boundary disabled until a trusted GitHub App/OAuth secret is configured.
- `data/projectService.ts` provides a Supabase-backed project provider with the existing mock data as a no-configuration fallback.
- `data/workspaceService.ts` hydrates the authenticated workspace and provides the guarded localStorage migration.
- `proxy.ts` refreshes Supabase auth cookies and protects `/app` when Supabase is configured.
- `supabase/tests/rls.sql` checks RLS enablement and required ownership/public policies in the Supabase test workflow.
- `supabase/seed.sql` seeds safe example projects for the first local auth user; it exits without changes when no local user exists.

### Supabase setup

1. Create a Supabase project and configure GitHub under Auth → Providers.
2. Add `http://localhost:3000/auth/callback` and the production callback URL to the provider allow-list.
3. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. Run `npx supabase db reset` locally after installing Docker Desktop, or apply `supabase/migrations/20260930120000_phase1.sql` through the Supabase CLI/cloud workflow.
5. Open `/login`, sign in with GitHub, and use `/app` for the protected workspace.

No service-role key is needed by the browser. Keep privileged secrets out of `NEXT_PUBLIC_*` variables.

The local Supabase CLI requires Docker Desktop or Podman. The application build does not require a local database runtime.

## Theme system

The interface supports three modes:

- `light`
- `dark`
- `system`

The current mode is persisted in localStorage and applied to the HTML root element using a theme attribute.

## Routes

- `/login` — GitHub sign-in
- `/app` — authenticated workspace

- `/view` — public profile and featured project index
- `/view/project/autocare` — public project case study page
- `/view/project/ai-agent` — public project case study page
- `/view/project/mobile-llm` — public project case study page
- `/view/project/autosimar` — public project case study page

These pages present a public-facing portfolio experience rather than the internal project management tools.

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

- GitHub OAuth requires configuring GitHub as a Supabase Auth provider and adding the callback URL `/auth/callback`
- no multi-user collaboration
- the legacy root prototype remains available only when Supabase is not configured; authenticated workspaces use Supabase-backed hydration and migration
- GitHub write operations and webhooks are not enabled yet; the trusted server boundary returns an explicit `501` until configured
- no billing or enterprise permissions
- no AI generation workflows

Never place Supabase service-role keys, GitHub client secrets, or GitHub App private keys in `NEXT_PUBLIC_*` variables or browser storage.

## Recommended next steps after user testing

1. Identify which sections are used daily versus ignored.
2. Rank the workflows that feel truly valuable.
3. Decide which parts belong in the production MVP.
4. Configure Supabase Auth and migrate the project list through `projectService`.
5. Add a server-side GitHub token exchange and implement repository import.
6. Add summarized webhook metadata and background activity revalidation.
