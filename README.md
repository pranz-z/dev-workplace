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

### Google Drive OAuth checklist (manual)

Enable the Google Drive API and configure an OAuth consent screen in Google Cloud. Create an OAuth client of type **Web application**, request only `openid`, `email`, and `https://www.googleapis.com/auth/drive.file`, and add the exact authorized redirect URI `https://YOUR_DOMAIN/api/drive/oauth-callback` (or `http://localhost:3000/api/drive/oauth-callback` for local development). The host and path must exactly match the application's origin and callback route. Use a separate OAuth client for local/preview testing rather than changing the production client's redirect list during development. For a Vercel preview, register that exact preview deployment hostname.

Set `GOOGLE_DRIVE_OAUTH_CLIENT_ID`, `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET`, `GOOGLE_DRIVE_OAUTH_STATE_SECRET`, and `GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY` only as server-side environment variables. Generate separate random 32-byte values for the state-signing and AES-256-GCM token-encryption keys, encode each as unpadded base64url, and do not expose them through `NEXT_PUBLIC_*`. The app requests offline access and consent on connection; it stores only the encrypted refresh token in `private.google_drive_connections`. The status response returns connection timestamps only. Disconnect removes the local credential and attempts Google token revocation; if remote revocation fails, remove the app from the Google Account security page as well. Google revocation invalidates the OAuth grants issued to that Google Cloud project, so use a dedicated project for Drive or account for the effect on other clients/scopes in that project.

Drive file endpoints are `GET /api/drive/files`, `POST /api/drive/uploads`, `PUT /api/drive/uploads/:uploadId` (chunk), `POST /api/drive/uploads/:uploadId/complete`, and `DELETE /api/drive/files/:fileId` (unlink). Initiation stores an app-managed Drive folder file and resumable session URI in the server-only `private.google_drive_upload_sessions` table; the browser receives only an opaque upload ID. Send sequential raw chunks of at most 4 MiB (multiples of Drive's 256 KiB alignment except the final chunk), then call complete. Completion checks the connected Google account, Drive ownership, folder, upload marker, name, MIME type, and size before creating the Supabase metadata row. Unlink removes only that row and leaves Drive content intact.

In `/app`, open **Settings → Google Drive** to connect or disconnect, then **Files** in the workspace navigation to upload and manage file associations. Choose an optional project/task and upload one file at a time. Progress reports bytes confirmed by the server. If an upload fails, **Retry** checks Google's received position and resumes; **Restart** discards the local session and allows a fresh attempt if the session expired. The selected file and session stay in memory across workspace section changes, but are lost on page reload or sign-out. Files are private workspace metadata and are not added to AI context. Project screenshots keep their existing project UI and Supabase Storage flow.

Google's [resumable upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads) shows JavaScript chunk `fetch` examples, but it does not specify the cross-origin preflight response required for `PUT` with `Content-Range` against session URLs. The implementation keeps session URLs and OAuth credentials server-side and proxies 4 MiB chunks. This is below Vercel's documented [4.5 MB Function request/response payload limit](https://vercel.com/docs/functions/limitations); the whole file is never sent through one Function request.

### Google Drive file access

Files provides **Preview** and **Download** through `GET /api/drive/files/:fileId/access?mode=preview|download`. The server verifies the Supabase owner, active metadata association, completed server-created upload marker, connected Google account, and current Drive ownership before redirecting to the API's file-specific Google browser link. Arbitrary metadata inserts do not grant file access. Responses use private/no-store caching, nosniff, and no-referrer. No file bytes are served inline by Workplace: Google's authenticated viewer/download service handles rendering and content disposition. No proxy response is subject to Vercel's 4.5 MB payload limit, and no CSP changes are needed for top-level navigation.

The browser must be signed into the connected Google account. Native Google documents open the authenticated editor/viewer; use its File → Download action for exports. Native document creation/import is not implemented. No public sharing permission is created, and **Remove from Workplace** only unlinks metadata. See Google's [browser download guidance](https://developers.google.com/workspace/drive/api/guides/manage-downloads) and [file link fields](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

Before manual verification, apply both Drive migrations through the repository's normal database process and configure `SUPABASE_SERVICE_ROLE_KEY` in addition to the four Drive server variables above. Keep `private` outside Supabase's exposed API schemas; browser access uses authenticated metadata RLS, while secrets use service-role-only RPCs. Add your Google account to the consent screen's test users when using a testing OAuth app. Testing grants with Drive scopes can require reconnecting after seven days; see Google's [refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2/web-server#refresh-token-expiration). Retaining an omitted refresh token requires a verified match to the same Google account.

### Drive folders and file browser

The Files workspace has a New menu, real custom folders, project folder cards, clickable breadcrumbs, a responsive list/grid switch, and search across loaded file/folder names and project/task labels. Only the view preference is kept in browser storage. Files, queued uploads, and resumable state remain in memory; reload/sign-out discards the queue. File selection and desktop file drops use the existing authenticated 4 MiB resumable pipeline, sequentially, with independent progress/errors and retry/restart controls. Drop onto a project card to capture its UUID and upload there. Folder/directory uploads are unsupported.

Use **Sync project folders** to ensure current Workplace projects, one authenticated server request at a time. Opening a project or uploading to it also ensures its folder. `POST /api/drive/folders` accepts `action: "ensure-project"` plus `projectId`, or `action: "create"` with `name`, an idempotency `requestId` UUID, and optional `projectId`/`parentId`. Upload initiation also accepts the internal folder `parentId`; the server verifies owner/account/markers and derives its project. Task association still derives/checks the task's actual project. Unassigned root uploads go directly into the existing Developer Workplace folder.

Project folders require `softwareWorkplaceManaged: "google-drive-files-v1"`, `softwareWorkplaceResourceType: "project-folder"`, and `softwareWorkplaceProjectId: "<project UUID>"`. UUIDs are validated before lookup; identity is independent of the server-verified title (`projects.title` in SQL). Only owned, untrashed folders under the verified managed root with all three markers qualify. Same-name unmarked folders are ignored. Rename synchronization is lazy: resolving the folder PATCHes only its name, retaining its ID, properties, and contents. Custom folders use `softwareWorkplaceFolderId`. The server-only `private.google_drive_folder_registry` atomically reserves a [Google-generated folder ID](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files) per owner/Google account/logical folder; concurrent creation/retries use that same ID. Multiple qualifying folders without a canonical reservation fail safely and require manual investigation. Existing reservations remain authoritative; duplicate folders are never deleted automatically. Lookup pagination and incomplete searches fail closed. Trashed/deleted folders are recreated without restoring or moving old content. A database trigger checks parent owner/provider/project, cycles, and a 20-ancestor depth limit. No Drive permissions or public projections are created. Deleting a Workplace project never deletes Drive content; metadata follows the existing project relationship. Custom folders must have no child Workplace associations before unlink; project folders are managed through their project.

Upload-session `app_folder_id` records the actual expected Drive destination (managed root or project folder). Completion checks that parent and the returned file ID alongside the existing upload marker, Google ownership/account, name, MIME type, size, and non-trashed status. Existing project-associated files remain at their original Drive location; this phase does not move or reconcile them. No additional migration is needed for these destination semantics.

Existing files are **not moved**. Previously project-associated files at the Drive root remain there and appear in their project view with a Legacy root file label. This phase performs no bulk reconciliation or arbitrary Drive moves.

Before rolling out application changes, review and apply **only the new** `20261006140000_google_drive_folder_browser.sql` migration through the normal database process. The two earlier Drive migrations are already applied and must not be reapplied or edited. No new OAuth scopes, environment variables, CSP origins, or Google Cloud settings are required. Run `npx supabase test db supabase/tests/drive_folders.sql` against a local database after applying migrations; Node tests mock Google APIs. The new registry remains outside exposed schemas with narrow service-role-only RPC access.

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
