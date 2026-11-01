# Project Video Preview — Current-Base Reconciliation Result

## 1. Final ruling

**PROJECT VIDEO PREVIEW RECONCILIATION: PASS** — local candidate and controlled integration tests. Live Blob uploads/playback and hosted rollout remain unverified and were not authorized.

## 2. Stale-base diagnosis

The original uncommitted candidate started at `dbfa5b3e8b25f760e5ebc27eecc971a5ba992c5b`. The prior report's non-ancestor diagnosis was incorrect. After fetching, Git confirms the stale base is exactly three commits behind the required base. Historical feature documents now point here and explicitly correct that statement.

## 3. Verified Git ancestry

`git merge-base --is-ancestor dbfa5b3e8b25f760e5ebc27eecc971a5ba992c5b 41165ff4db89228d11de9616236e1f68cfb46cef` exited 0. The intervening commits, oldest first:

1. `1d5356806cbea4ddc436eb1187a756b1800aa37d` — fix: harden proactive AI advisory output.
2. `555f0c0aa6e5f8c6c0c2277f803edebab21b58ed` — fix: refine proactive AI command detection.
3. `41165ff4db89228d11de9616236e1f68cfb46cef` — fix: separate agent settings from inbox.

Their combined changed paths are exactly the five protected Phase5D files listed in section 8.

## 4. Current required base

Fetched `origin/main` is exactly `41165ff4db89228d11de9616236e1f68cfb46cef`. The new feature branch's HEAD is that exact commit. **CANDIDATE NOW BASED ON CURRENT PRODUCTION MAIN.** No newer base was substituted.

## 5. Preservation method

Before fetching or creating the new checkout, captured status, tracked diff/stat/name-status, binary patch, untracked-file list, and byte copies/SHA-256 manifest for all 25 original candidate files under:

`C:/Users/Franz/.codex/tmp/project-video-reconcile-20261025/`

All 25 files matched the preserved bytes immediately after transplant. At completion, all 22 non-documentation candidate files other than the browser test still match exactly; that test gained a hidden-document stopping assertion, and two historical documents were annotated. All application source and the migration retain their original bytes. The original checkout and uncommitted candidate remain untouched as an additional backup. No stale-base commit or stash was created.

## 6. Reconciled branch/worktree

Branch: `codex/project-video-preview`.

Managed worktree: `C:/Users/Franz/.codex/worktrees/project-video-preview/software-workplace`.

Created directly from the required commit. The patch applied cleanly; no conflict resolution or accepted-branch rewrite was needed. The branch remains uncommitted. Independent dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund`; the lockfile did not change. A temporary dependency junction was removed after Turbopack rejected it; the successful final build uses real worktree-local dependencies.

## 7. Final changed files

All 27 paths fit the requested classifications:

| Classification | Paths relative to the worktree |
| --- | --- |
| VIDEO FEATURE | `app/api/projects/[projectId]/preview-video/route.ts`; `app/api/public/projects/[slug]/preview-video/route.ts`; `app/app/page.tsx`; `components/projects/project-preview-video.tsx`; `components/portfolio/ProjectCardMedia.tsx`; `components/portfolio/PublicPortfolio.tsx`; `data/projectPreviewVideoService.ts`; `data/database.types.ts`; `lib/project-video/policy.ts`; `lib/project-video/blob.ts`; `lib/project-video/server.ts` |
| VIDEO TEST | `lib/project-video/policy.test.mjs`; `lib/project-video/client.test.mjs`; `lib/project-video/server.test.mjs`; `lib/project-video/database.test.mjs`; `lib/project-video/browser.test.mjs`; `lib/project-video/migration-replay.test.mjs`; `lib/portfolio/resume-content.test.mjs` |
| VIDEO MIGRATION | `supabase/migrations/20261025152931_project_preview_videos.sql` |
| BLOB DEPENDENCY | `package.json`; `package-lock.json` |
| CSP REQUIREMENT | `lib/security/content-security-policy.ts`; `lib/security/content-security-policy.test.mjs`; `next.config.ts` |
| DOCUMENTATION | `docs/project-hover-video-preview-result.md`; `docs/superpowers/plans/2026-10-25-project-video-previews.md`; this report |

The reconciliation adds only a full-migration replay test, a hidden-document assertion in the existing video browser fixture, and documentation corrections/report beyond the original candidate. No application behavior or video migration was changed during reconciliation.

## 8. Phase5D file-integrity proof

**ALL ACCEPTED PHASE5D CHANGES PRESERVED.** Captured raw SHA-256 values from the pristine new worktree, then compared after transplant and verification. Every file matches byte-for-byte:

| File | Pristine/current candidate SHA-256 |
| --- | --- |
| `components/ai/AgentInbox.tsx` | `9DBBC0D45EAA541F0347C7EA4DDE0651F30E03E34ACF7C734EBB4FF5D30D3652` |
| `components/ai/WorkspaceAiChat.tsx` | `CA38FD009553A783377FB4B0921C1A8D8CBF52C467345A0E4356C5971CECE3A1` |
| `lib/ai/agent/phase5d-gemini.test.mjs` | `D6EFD7EC515AEEE9DC70EE089292478788DEF747FB358B276DB2FE807ACAADA0` |
| `lib/ai/agent/phase5d-ui.test.mjs` | `29F8E3C18CE1CF785B2F1FB885A0F6F815DA80FACD768E32D6D68D0155E08841` |
| `lib/ai/agent/pulse/gemini.ts` | `62C1EBC000B03BBCDC06F069F123DECC1AF96F757AB9945E1542433A4103490D` |

`git diff 41165ff -- components/ai lib/ai/agent` is empty. No Phase5D code/test was edited.

## 9. Feature behavior preservation

**VIDEO FEATURE BEHAVIOR PRESERVED.** Exact original source bytes retain private Blob bytes, Supabase metadata only, MP4/15 MiB policy, one preview/project, disabled-by-default publication, explicit enable, direct scoped browser PUT, owner-bound intents, server HEAD, opaque paths, 15-minute public signed GET, and no Next.js byte proxy.

Both card layouts retain muted/inline/loop playback, no initial source, `preload="none"`, hover-only activation, fine-pointer capability, pause/reset on leave, offscreen/document-hidden stop, reduced-motion static fallback, screenshot/gradient preservation, expiry caching and bounded retry. Owner preview stays authenticated and signed.

## 10. Migration identity/collision check

No base migration has timestamp `20261025152931`. All 24 base migration files are unchanged. The sole new migration retains SHA-256:

`0C86FD282627F0B6E51E130C2DD94F664543A7A8662F40BFF35F0F365C992FE0`.

No schema incompatibility or migration correction was required.

## 11. Blob SDK contract

Re-read installed `@vercel/blob` 2.8.2 declarations/source. `issueSignedToken` accepts exact pathname, operations, expiry, MIME/size limits and OIDC/store options. `presignUrl` accepts the signing material plus private `get`/`put` options and returns `{presignedUrl}`. `head(pathname)` returns the pathname/size/contentType checked by finalization. Credential resolution supports managed `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID` without explicit token handling. Server-only signing material is never returned. Browser build chunks contain none of the searched `clientSigningToken`, `issueSignedToken`, Blob read/write-token or Supabase service-role identifiers.

## 12. Database tests

Disposable PGlite replay executes all 24 current-base migrations in order, then the unchanged video migration. The harness supplies platform Auth/Storage fixtures and loads `btree_gist`. Because this PGlite distribution lacks `pgcrypto`, only its installation statement is omitted **in memory**; core `gen_random_uuid()` is used. Source migrations are untouched. The fixture configures the canonical portfolio owner only in its disposable database.

Replay integration plus the focused SQL tests pass: owner CRUD, foreign isolation, anonymous denial, service-only operations, verified upload binding, uniqueness, MP4/size constraints, expiry, replacement, removal, cascade, enabled public projection and Private/Unlisted denial. This is serial engine verification, not true multi-connection PostgreSQL concurrency proof. No hosted database was used.

## 13. Feature tests

`npm run test:project-videos`: **17 passed, 0 failed, 0 skipped**. Includes lazy initial network behavior, valid hover, cache reuse/expiry, pause/reset, rejected playback, bounded media retries, coarse/touch and reduced-motion modes, offscreen stop, a simulated hidden-document visibility event, owner controls, 10 MiB direct-upload contract and bounded metadata-only application requests. Browser media methods and Blob service calls are controlled mocks; live decoding and Blob delivery remain unverified.

## 14. CSP tests

All four CSP cases pass. Only the configured exact private Blob media host and the necessary `https://vercel.com/api/blob` PUT path are added. Default/script/frame/image sources are unchanged; no wildcard Blob host was added.

## 15. Screenshot regressions

Existing screenshot tests pass, including browser upload/retry behavior. The full-schema replay additionally verifies screenshot publication, ordering, cover selection and public gallery projection. Screenshot component/service, screenshot migrations, Storage policies and existing Google Drive implementation have no diff against `41165ff`.

## 16. Portfolio regressions

**50 passed, 0 failed, 0 skipped** across portfolio rendering, canonical routes/public project metadata, CMS SQL, mocked public AI, screenshots and workspace shell. Feature browser coverage also checks featured/normal card layouts, safe case-study/demo/repository links, static covers and responsive sizing. No real Gemini request was made.

## 17. CMS-editor baseline comparison

**CMS EDITOR HARNESS: PRE-EXISTING BASELINE FAILURE — NOT CAUSED BY VIDEO FEATURE.**

Ran `lib/portfolio/cms-editor.test.mjs` unchanged on the pristine `41165ff` worktree before transplant, then on the candidate with the same test runtimes. Both exit 1 at the same esbuild error: `Cannot import "components/portfolio/PortfolioHero.module.css" into a JavaScript file without an output path configured`. The test, Hero source and Hero CSS are unchanged. Baseline/candidate logs are preserved as `cms-pristine.log` and `cms-candidate.log` in the backup directory. No attempt was made to fix this harness.

## 18. Phase5D regressions

**367 passed, 0 failed, 0 skipped** from `phase5d-gemini.test.mjs`, `phase5d-ui.test.mjs` and `phase5d-handoff.test.mjs`. The accepted executable/route guard, allowed ordinary Git/Node prose, independent Settings access, existing Inbox ACK and unseen-observation preservation remain intact. Provider transport is mocked.

## 19. TypeScript/lint/build

Fresh `npx tsc --noEmit`, ESLint on exact changed source/test/config paths, `git diff --check`, and `npm run build` all exit 0. The worktree intentionally has no copied `.env.local`; the successful build reports missing local public Supabase configuration and uses the existing locked/unconfigured behavior. This does not prove hosted configuration or authenticated live integration.

## 20. Responsive verification

Actual portfolio fixture and newly built CSS checked at 1440, 1024, 768, 390 and 320 pixels: no horizontal overflow, unchanged 16:9 frame, no video-induced layout shift within existing tilt subpixel tolerance, static mobile cover, and preserved links. These are controlled Chromium fixtures, not deployed-page checks.

## 21. Final diff against 41165ff

Final review uses `41165ff4db89228d11de9616236e1f68cfb46cef`, including tracked edits and untracked additions. All paths are classified in section 7. The old checkout is not the comparison base. A temporary alternate Git index captures the complete review patch/file list outside the worktree without staging the candidate in its real index. No unrelated accepted Phase5D, Drive or screenshot implementation appears in the diff.

## 22. Dependency/audit note

Only direct dependency addition: pinned `@vercel/blob` **2.8.2**. Existing locked package versions changed: **zero**. The lock gains 24 required entries; existing shared packages may change dev/production classification because Blob now uses them at runtime. No audit fix or unrelated upgrade was run. The previous install's five high/one critical findings remain separately reported; causation by this feature has not been established and no repository-wide clean audit is claimed.

## 23. Repository status

Local uncommitted candidate on `codex/project-video-preview`, HEAD exactly `41165ff`. Original `main` checkout remains on its prior HEAD with its original candidate intact; neither main nor accepted branches were rewritten. Preservation files and logs remain outside tracked source. No commit, push or merge occurred.

## 24. Production state

**NO HOSTED MUTATION. PRODUCTION UNCHANGED. GATE I STATE UNCHANGED.** No hosted migration, Blob creation/connection, environment configuration change, real upload, publication enable, deployment, scheduler/consent modification or actual Gemini invocation occurred. Process-local test runtime variables are not hosted environment changes.

## 25. Remaining rollout requirements

After review, an authorized nonproduction rollout must apply the reviewed migration and connect/configure a private Blob store with OIDC. `BLOB_STORE_ID` must be available at build time for exact-host CSP; existing server Supabase administration configuration is required. Real owner upload/replace/remove, unsigned-read denial, signed GET/range playback, expiry and static-mode network behavior still need integration acceptance. Previously issued signed URLs may remain valid until expiry. The CMS harness baseline failure remains separate.

## 26. Recommended next step

Review this uncommitted branch and full diff against `41165ff`; then separately authorize nonproduction integration setup/testing. Do not deploy or mutate Production from this task. Local reconciliation stops here.
