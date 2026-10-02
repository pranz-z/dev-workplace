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
- GitHub App repository browser, import, and project linking
- Portfolio preview mode and public project case-study routes at `/view` and `/view/project/[slug]`
- Career and freelance tracking for applications and leads
- Local browser persistence with localStorage

## Production foundation

- `supabase/migrations/20261001100000_phase3a_github_repository_connections.sql` adds GitHub App installations and normalized repository links with Row Level Security. GitHub history is not copied into Supabase.
- `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server), and `lib/supabase/env.ts` (validated environment) provide the Supabase boundary. Copy `.env.example` to `.env.local` and fill in the Supabase project values.
- `components/auth/auth-provider.tsx` exposes the single authentication state (`loading` / `authenticated` / `unauthenticated`) backed by Supabase Auth; `components/auth/user-menu.tsx` renders the avatar, display name, GitHub username, and the Profile / Settings / Sign out menu.
- `data/githubAppService.ts` creates short-lived installation tokens on the server and returns allowlisted repository metadata. Tokens and App credentials never reach the browser or Supabase.
- `data/githubWriteService.ts` sends writes through `/api/github/write`; the MVP keeps this boundary disabled until a trusted GitHub App/OAuth secret is configured.
- `data/projectService.ts` provides the authenticated Supabase-backed project provider; prototype data is isolated to unauthenticated demo mode.
- `data/workspaceService.ts` hydrates the authenticated workspace and provides the guarded localStorage migration.
- `proxy.ts` (the Next.js 16 replacement for middleware) refreshes Supabase auth cookies on every request and protects `/app` and any future `/app/*` route server-side.
- `supabase/tests/rls.sql` checks RLS enablement and required ownership/public policies in the Supabase test workflow.
- `app/api/public-ai/route.ts` serves the opt-in public developer concierge separately from the authenticated workspace assistant. It loads only the dedicated public AI RPC projections and never reads private workspace tables.
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
5. Apply the Supabase migrations in timestamp order, including `supabase/migrations/20261001100000_phase3a_github_repository_connections.sql`.
6. Run `npm run dev`, open `/login`, choose **Continue with GitHub**, and the callback lands on `/app`.

**Authentication vs repository access:** Supabase GitHub OAuth verifies user identity. Repository access uses a separate GitHub App installation selected by the user. Repository listing, import, project attachment, unlink, and metadata refresh are read-oriented; `/api/github/write` remains disabled (`501`).

**Fail-closed environment handling:** missing or malformed Supabase browser configuration is reported by variable name only, client factories refuse to create invalid clients, and private routes stay locked instead of falling back to mock data. Development warns so public pages can still be browsed without Supabase.

No service-role key is needed by the browser. Keep privileged secrets out of `NEXT_PUBLIC_*` variables.

The local Supabase CLI requires Docker Desktop or Podman. The application build does not require a local database runtime.

### Phase 5D public AI setup

Review and apply `supabase/migrations/20261002130000_phase5d_public_ai_concierge.sql` after the earlier Phase 5A/5B migrations. Do not enable the assistant until the migration is applied and the server environment is configured. Set `PUBLIC_AI_RATE_LIMIT_SALT` to a random secret of at least 32 characters, keep it server-only, and restart the app. `PUBLIC_AI_DAILY_LIMIT` defaults to 25 and accepts values from 1 to 100. The endpoint also caps each visitor at five requests per UTC minute.

The rate limiter stores HMAC-derived visitor identifiers in RLS-protected tables under the unexposed `private` schema. Service-role-only RPCs update counters and acquire short-lived single-request leases; expired buckets and leases are removed as requests arrive. The public assistant keeps no visitor conversation history. The owner enables it from **Public portfolio profile → Public AI assistant**; both that toggle and **Show my profile on the public portfolio** must be on. The assistant uses only the safe public profile and public project projections and shows a privacy summary in the owner settings.

Run `npm run test:public-ai` for public-AI boundary, validation, and rate-limit handler tests. `supabase/tests/public-ai.sql` contains database privilege and limiter checks for `supabase test db`.

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

## GitHub App setup — manual setup required

Create a GitHub App in **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**:

- **App name**: `Developer Workplace` (or another available name)
- **Homepage URL**: `http://localhost:3000` for local development; use the production origin after deployment
- **Setup URL**: `http://localhost:3000/api/github/setup` (production: `https://<your-domain>/api/github/setup`)
- **Callback URL**: `http://localhost:3000/api/github/oauth-callback` (production: `https://<your-domain>/api/github/oauth-callback`)
- **Redirect on update**: enable this so repository selection changes return to the workspace
- **Request user authorization during installation**: leave unchecked; Phase 3A starts the separate user authorization flow after GitHub returns to the Setup URL
- **Webhook**: leave disabled for Phase 3A
- **Repository permissions**: `Metadata: Read-only`, `Contents: Read-only`, `Pull requests: Read-only`, and `Issues: Read-only`; no write permissions are used
- **Where can this GitHub App be installed?**: choose the account scope that fits your use; users select the repositories during installation

Save the App, copy its numeric **App ID** and **Client ID**, generate a **Client secret**, and generate a private key from the App's **Private keys** section. Set these values in the ignored local `.env.local` file (never in `NEXT_PUBLIC_*` variables). Also copy the Supabase **service role key** from Project Settings → API; the callback uses it only after GitHub confirms the signed-in GitHub user can access the installation. Authenticated users can read only their own installation rows; they cannot create or change those rows directly.

```env
GITHUB_APP_ID=<App ID>
GITHUB_APP_SLUG=<the slug from the GitHub App URL>
GITHUB_APP_CLIENT_ID=<Client ID>
GITHUB_APP_CLIENT_SECRET=<Client secret>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
SUPABASE_SERVICE_ROLE_KEY=<Supabase service role key>
```

The private key may also be entered with literal newlines. Set the GitHub App's user authorization callback URL to `/api/github/oauth-callback`. The setup route `/api/github/setup` checks a short-lived state cookie, then starts a PKCE-protected GitHub user authorization flow. The callback exchanges the code server-side and checks the selected installation against `GET /user/installations` using that short-lived user token before saving the association. The token is not persisted. GitHub's user installations endpoint requires a user access token and lists installations the authorizing account can access; repository listing still uses an installation token and Metadata read-only permission. No webhook permissions or additional repository permissions are needed.

Installation and repository IDs are unique per Developer Workplace user. This lets two workspace users connect the same organization installation and link the same repository independently while preventing duplicate links within either user's workspace. Apply `supabase/migrations/20261001100000_phase3a_github_repository_connections.sql` only after reviewing it, then restart the app and use **GitHub → Connect GitHub** in the authenticated workspace.

## Phase 3B — GitHub activity sync

The authenticated project **GitHub** tab shows up to 10 recent commits, pull requests, and issues plus the latest five releases for its linked repository. Activity is read live through the owning workspace user's GitHub App installation; responses are cached briefly per user and repository in the server process, with an explicit **Refresh activity** action. Private activity remains in the authenticated project workspace. Public project views continue to expose only the existing safe repository link behavior.

Phase 3B requires read-only `Contents`, `Pull requests`, and `Issues` repository permissions in addition to Phase 3A's `Metadata` read permission. The REST endpoints used for commits and releases require `Contents: Read`, listing pull requests requires `Pull requests: Read`, and listing repository issues requires `Issues: Read` ([commits](https://docs.github.com/en/rest/commits/commits#list-commits), [pull requests](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests), [issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues), [releases](https://docs.github.com/en/rest/releases/releases#list-releases)). **Manual setup required:** update the GitHub App permissions and approve the permission change for existing installations before expecting private repository activity to load. No write permissions or database migration are required.

For production, change the GitHub App homepage and setup URL to the deployed HTTPS origin and add all variables listed above to the hosting provider. OAuth login remains configured separately in Supabase.

The unauthenticated prototype may still show seeded demo data. Authenticated repository flows never fall back to demo repositories.

## Current MVP boundaries

The Phase 1 foundation intentionally leaves these areas deferred:

- GitHub OAuth remains the identity provider; webhooks and accountability scoring remain deferred
- no multi-user collaboration
- `/app` always requires a verified Supabase session; without Supabase configuration the private workspace stays locked and only the public routes serve mock data
- GitHub write operations and webhooks are not enabled yet; the trusted server boundary returns an explicit `501` until configured
- no billing or enterprise permissions
- the authenticated Gemini workspace assistant and the owner-opt-in public portfolio concierge use separate server-side context paths

Never place Supabase service-role keys, GitHub client secrets, or GitHub App private keys in `NEXT_PUBLIC_*` variables or browser storage.

## Recommended next steps after user testing

1. Identify which sections are used daily versus ignored.
2. Rank the workflows that feel truly valuable.
3. Decide which parts belong in the production MVP.
4. Complete the GitHub App setup above and test repository selection with a real installation.

## Phase 6A production readiness

### Prerequisites and environment

Use a production Supabase project, an HTTPS production domain, and separate GitHub Apps/provider credentials for production and local development where callback URLs differ. Do not put server-only values in `NEXT_PUBLIC_*` variables. Configure these in Vercel by environment:

- **Production:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` (the canonical HTTPS origin), and the server-only `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, and `PUBLIC_AI_RATE_LIMIT_SALT` when their features are enabled. `PUBLIC_AI_DAILY_LIMIT`, `PRIVATE_AI_REQUESTS_PER_MINUTE`, and `PRIVATE_AI_DAILY_LIMIT` are optional and default to 25, 10, and 100 respectively.
- **Preview:** use a separate non-production Supabase project and separate GitHub App credentials if GitHub integration is enabled. Vercel preview origins resolve from `VERCEL_URL`; add the exact preview callback origin (or an owner-approved Vercel preview pattern) to Supabase's redirect allowlist. For a preview alias, set `NEXT_PUBLIC_SITE_URL` to that canonical HTTPS origin. Avoid production service-role and Gemini credentials unless the preview explicitly uses production data and access has been reviewed.
- **Development:** copy `.env.example` to `.env.local`; use development Supabase/GitHub credentials. `NEXT_PUBLIC_SITE_URL` may be empty and defaults to `http://localhost:3000`.

`SUPABASE_SERVICE_ROLE_KEY` is used by trusted server routes only. GitHub private keys/secrets, Gemini API keys, and both AI rate-limit secrets remain server-only. The private AI limiter migration is `supabase/migrations/20261002140000_phase6a_private_ai_rate_limit.sql`; review and apply it through the normal migration workflow before enabling the private AI endpoint in production. Never edit already-applied migration files. No external monitoring vendor is configured; use Vercel function/runtime logs and add an observability provider later only after choosing one.

### Supabase Dashboard checklist (manual)

1. Set **Authentication → URL Configuration → Site URL** to `https://YOUR_DOMAIN`.
2. Add the exact redirect `https://YOUR_DOMAIN/auth/callback` to the redirect allowlist. Retain `http://localhost:3000/auth/callback` only for development as needed.
3. Keep the Supabase GitHub OAuth provider's callback at `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`; GitHub identity OAuth terminates at Supabase before returning to the app.
4. Confirm the Phase 3A–5D migration history is present, review and apply the new Phase 6A migration, then verify `npx supabase migration list` and `npx supabase db push --dry-run`. Do not run a reset against the hosted project.
5. Keep the `project-screenshots` bucket private. Public images are exposed only through explicit public metadata and short-lived signed URLs; do not change bucket visibility to public.
6. Run the RLS and public-AI SQL tests against a disposable/local database when available; never use a destructive reset on production.

### GitHub App checklist (manual)

For the production App, set **Setup URL** to `https://YOUR_DOMAIN/api/github/setup` and **User authorization callback URL** to `https://YOUR_DOMAIN/api/github/oauth-callback`. Keep the required read-only repository permissions (`Metadata`, `Contents`, `Pull requests`, and `Issues`) and keep webhooks disabled. GitHub App callback settings can conflict with local URLs; use a separate development App rather than changing production URLs during local testing. Set the production App ID, slug, client ID, client secret, and private key only in Vercel's Production environment.

### Gemini checklist (manual)

Set `GEMINI_API_KEY` and the owner-validated `GEMINI_MODEL` as Vercel server-only variables. Do not hardcode or silently substitute a model. If public AI is enabled, also set `PUBLIC_AI_RATE_LIMIT_SALT` to a random secret of at least 32 characters; choose `PUBLIC_AI_DAILY_LIMIT` from 1–100 if needed. Private AI defaults to 10 requests per user per UTC minute and 100 per UTC day; optional overrides are bounded to 1–20 and 1–1000. Private AI counters contain no prompts or responses.

### Build and deployment preparation

1. Configure the Vercel project to use this repository and the standard Next.js build (`npm run build`). No custom `vercel.json` is required.
2. Add environment variables separately for Production, Preview, and Development; do not copy production secrets into previews by default.
3. Apply reviewed migrations using the project's deployment process, then verify the remote migration list and dry run.
4. Run `npx tsc --noEmit`, `npm run lint`, `npm run test:accountability`, `npm run test:calendar`, `npm run test:ai`, `npm run test:public-ai`, and `npm run build` before an owner-triggered production deployment.
5. Configure the manual dashboard values above and perform the post-deployment checks below. This repository does not deploy automatically.

### Phase 6B production smoke checklist

- [ ] Public `/view`, a public project, an explicitly public screenshot, public repository link, opt-in public accountability, and opt-in public AI work while signed out; verify the public AI limit and safe unavailable/error state.
- [ ] Login, logout, session refresh, and a signed-out protected-route redirect work.
- [ ] Create and edit a project, task, milestone, plan, note, and goal; verify task and project Kanban drag/drop and Calendar rescheduling persist.
- [ ] Connect/install GitHub, browse repositories, attach/import a repository, load activity, then revoke/remove repository access and verify it fails safely.
- [ ] Use a private AI action, apply a selected result, and verify Notes/GitHub context is included only when explicitly selected; verify per-user private rate limits.
- [ ] Submit a signed-out public AI question and verify public rate-limit/error behavior.
- [ ] Verify private projects and screenshots are inaccessible anonymously, unlisted projects are absent from listing/sitemap, private repositories are not exposed, and goals/reports/private accountability remain private.
- [ ] Confirm browser responses include security headers, public pages have canonical metadata, `/robots.txt` and `/sitemap.xml` exclude private routes and unlisted projects, and no browser bundle contains server credentials.
