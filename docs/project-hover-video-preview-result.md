# Project Hover Video Preview — Implementation Result

> Historical stale-base implementation report. The candidate has since been reconciled onto `41165ff4db89228d11de9616236e1f68cfb46cef`; see [the current-base reconciliation result](project-video-preview-reconciliation-result.md). The ancestry statement in section 2 below was corrected by a fresh fetch: `dbfa5b3` is an ancestor of `41165ff`, exactly three commits behind.

## 1. Final ruling

**PROJECT VIDEO PREVIEW IMPLEMENTATION: PASS — local candidate with controlled Blob mocks.**

16 feature/CSP tests and 50 related regression tests passed, with no skips in those runs. Live Blob delivery, real MP4 decoding, and hosted migration acceptance remain unverified. The existing CMS browser harness has a separate failure described below; this is not an unconditional release-readiness claim.

## 2. Base/source identity

Repository: `pranz-z/dev-workplace`, branch `main`. Actual starting HEAD: `dbfa5b3e8b25f760e5ebc27eecc971a5ba992c5b`, initially clean. Requested base `41165ff4db89228d11de9616236e1f68cfb46cef` exists but is not an ancestor of this HEAD. This implementation preserves the actual checkout; no reset, commit, or push occurred.

## 3. Architecture

Owner workspace → authenticated metadata-only API → short-lived scoped PUT → browser uploads directly to private Blob → server HEAD verifies → atomic database association. Public card hover → safe slug RPC → server signs GET → browser media loads directly from Blob. Supabase stores metadata only.

## 4. Why Vercel Blob

VIDEO BYTES USE VERCEL PRIVATE BLOB. SUPABASE STORES METADATA ONLY. Pinned `@vercel/blob` 2.8.2 supports OIDC and the official `issueSignedToken` / `presignUrl` APIs. The implementation follows the installed declarations and [official signed URL documentation](https://vercel.com/docs/vercel-blob/vercel-signed-urls). Google Drive and screenshot storage were not changed.

## 5. Files changed

- `app/api/projects/[projectId]/preview-video/route.ts`: authenticated owner route.
- `app/api/public/projects/[slug]/preview-video/route.ts`: public read-only resolver.
- `app/app/page.tsx`: owner section beside screenshots.
- `components/projects/project-preview-video.tsx`: owner controls.
- `components/portfolio/ProjectCardMedia.tsx`: lazy hover lifecycle and static fallback.
- `components/portfolio/PublicPortfolio.tsx`: shared media on both card layouts.
- `data/projectPreviewVideoService.ts`: metadata requests and direct PUT.
- `data/database.types.ts`: maintained row/projection interfaces, following existing conventions; no generated-types workflow exists here.
- `lib/project-video/{policy,blob,server}.ts`: shared policy, server-only SDK calls, request authorization and verification.
- `lib/project-video/{policy,client,server,database,browser}.test.mjs`: feature tests.
- `lib/portfolio/resume-content.test.mjs`: load the real extracted card media in the existing rendering harness.
- `lib/security/content-security-policy.ts`, its test, and `next.config.ts`: exact private-store media source and signed PUT API path.
- `package.json`, `package-lock.json`: pinned Blob dependency and feature test command.
- `docs/superpowers/plans/2026-10-25-project-video-previews.md` and this report.
- One migration listed below.

## 6. Migration

`supabase/migrations/20261025152931_project_preview_videos.sql` was created with the existing Supabase CLI. It adds `public.project_preview_videos`, server-only private upload intents, ownership RLS, verified-binding trigger, transactional server management RPC and narrow public projection. One video per project; MP4 only; inclusive 15 MiB maximum; finite ordered timestamps; user/project deletion cascades metadata.

SHA-256: `0C86FD282627F0B6E51E130C2DD94F664543A7A8662F40BFF35F0F365C992FE0`.

Applied only inside disposable PGlite tests, never to a hosted database. Existing migrations remain unchanged. PGlite proves serial SQL behavior; this is not a multi-connection hosted PostgreSQL concurrency proof.

## 7. Blob upload flow

DIRECT BROWSER UPLOAD VERIFIED **with controlled mocks and a deterministic synthetic 10 MiB contract**. Application requests contain filename/type/size or upload ID, never video bytes. The application rejects non-JSON and metadata bodies over 4 KiB, including streamed oversized bodies. PUT authority has one opaque 192-bit random pathname, only `put`, MP4 MIME, a 15 MiB ceiling, 10-minute expiry, no suffix and no overwrite. Actual Blob HEAD pathname/type/size must match the owner-bound upload intent before finalization.

## 8. Blob privacy / signed URLs

PUBLIC ACCESS USES SHORT-LIVED SIGNED GET URLS. GET scope is exactly one private object for 15 minutes. Signing material remains in `server-only` modules. Public JSON has only `url`, `mimeType`, `expiresAt`, with `private, no-store`. Browser build chunks contain none of the searched server signing/credential identifiers. No video stream is proxied through Next.js.

Previously issued bearer URLs can remain usable until expiration; disabling publication prevents new resolutions immediately, but cannot revoke an already issued URL instantly. Removal deletes bytes best-effort after removing metadata.

## 9. Owner project-video UI

The authenticated project's Screenshots tab now has a separate Project preview video section: current filename/size/format, validated picker, upload/replace, explicit publication checkbox, current private preview, remove, refresh, saving state, errors and cleanup notices. Required recommendation copy is present. Upload and replacement default to disabled; users explicitly opt in again after replacement. Owner playback has controls and never autoplays.

## 10. Public video resolver

`GET /api/public/projects/[slug]/preview-video` validates the public slug and uses `public_project_preview_video`. SQL requires `Public`, enabled video, matching owner/project and the existing canonical portfolio owner. Private, Unlisted, disabled, missing and invalid-slug cases cannot receive a public GET URL. Raw owner tables are not anonymously readable.

## 11. Project card hover behavior

PROJECT CARD VIDEO LOADS ONLY ON HOVER. Featured and regular cards share the media component. Playback is muted, inline and looping, with no initial source, `preload="none"`, decorative semantics and no pointer interception. It fades over the screenshot/gradient after play succeeds. Leave pauses/resets; offscreen or hidden-document state stops playback. A viewport check on pointer entry avoids stale observer state after scrolling. URLs remain cached until near expiry.

## 12. Mobile behavior

Real `(hover: hover) and (pointer: fine)` capability is required; touch pointer events are rejected. Coarse/mobile Chromium fixtures made zero preview URL requests and zero play calls. Static covers and existing links remain.

## 13. Reduced-motion behavior

MOBILE AND REDUCED-MOTION REMAIN STATIC. Reduced-motion fixtures made zero URL requests and zero play calls. Changing the preference during playback stops and clears the media source.

## 14. Failure/fallback behavior

Resolver, upload, playback and media failures leave the static cover intact. A missing preview is remembered; failed requests have bounded later-hover retry. Media failure permits only one later-hover URL refresh, with no automatic loop. Replacement saves the new verified association before old-object cleanup. Removal clears the association first. Cleanup errors return a safe warning without rolling back good metadata. Interrupted uploads, project deletion or failed cleanup can leave private orphan objects; no new cleanup scheduler was added.

## 15. Bandwidth / lazy-loading proof

Chromium fixture asserted zero preview URL requests, zero `.mp4`/`.webm` requests and zero video `src` attributes before interaction. Second hover reuses a current URL; expiration refreshes on a later hover. File-body routing was verified separately using a synthetic 10 MiB descriptor without allocating a large unit-test buffer. Browser media methods were mocked; no real hosted bandwidth measurement is claimed.

## 16. Ownership/security tests

Disposable SQL role switching tested owner reads/CRUD, foreign-owner isolation, denied anonymous table access, denied authenticated server-RPC access, verified-path binding, invalid metadata, expired intents, safe replacement/removal and project-deletion cascades. Mocked requests tested unauthenticated/foreign/missing projects, origin checks, HEAD mismatches, operation scope and absence of signing secrets in JSON.

## 17. Public visibility tests

Public + enabled resolves; Public + disabled, Private + enabled, Unlisted, no association and invalid slug do not. Public SQL projection is exactly slug/path/MIME/updated timestamp. HTTP JSON remains the narrower signed-URL DTO.

## 18. Component tests

Actual portfolio cards and owner component rendered in Chromium, with test-only auth/data boundaries and mocked media methods. Verified first hover, cache, expiry, pause/reset, errors/rejected play, one refresh, missing video, links, owner upload/enable/preview/remove, coarse pointer, reduced motion, live preference changes and offscreen stopping. These fixtures are not a real authenticated Supabase-to-Blob end-to-end test.

## 19. Responsive verification

Checked 1440, 1024, 768, 390 and 320 pixels: no horizontal overflow, 16:9 media frame and no video-induced card height change (allowing subpixel differences from existing card tilt). Actual portfolio cards and built CSS were used.

## 20. Existing regression tests

50/50 passed: portfolio rendering, canonical/public project routes and metadata, portfolio CMS SQL, public AI with mocked provider boundaries, screenshot validation and browser upload/retry UI, and workspace shell.

The separate existing `lib/portfolio/cms-editor.test.mjs` browser test fails before bundling because its esbuild configuration has no output path for the existing Hero CSS module. A temporary output-path probe got further but then timed out because `Edited browser bio` was hidden in the existing hero. That probe was reverted. The unrelated hero/CMS harness remains unchanged; the full CMS browser suite is not green.

## 21. TypeScript/lint/build

- `npx tsc --noEmit`: passed.
- ESLint exact changed source/test/config files: passed.
- `git diff --check`: passed.
- `npm run build`: passed after the final product change.
- `npm run test:project-videos`: 16 passed, 0 failed, 0 skipped.

The install reported six audit findings (five high, one critical); no broad dependency upgrades or audit autofixes were performed. This task does not establish a clean repository-wide dependency audit.

Reproduce feature tests in PowerShell using the existing external test engines:

```powershell
$env:PORTFOLIO_TEST_PGLITE_MODULE='C:/Users/Franz/AppData/Local/Temp/workspace-agent-phase2-tools/node_modules/@electric-sql/pglite/dist/index.js'
$env:PORTFOLIO_TEST_ESBUILD_MODULE='C:/Users/Franz/.codex/visualizations/2026/10/04/01a1069b-4375-7fe2-a9b9-4435879efc5e/sql-runtime/node_modules/esbuild/lib/main.js'
npm run build
npm run test:project-videos
```

These paths are local test prerequisites, not product dependencies. The feature test command intentionally fails if required test engines are absent instead of silently skipping database/browser proof.

## 22. Diff review

Existing screenshot service/component, Drive code, AI/agent paths and prior migrations were checked unchanged. New owner UI uses the existing authenticated gate. No public case-study autoplay was added. Default/script/image CSP sources are unchanged; only an exact private media host and the necessary `https://vercel.com/api/blob` upload path were added when `BLOB_STORE_ID` is configured.

## 23. Repository status

Local uncommitted candidate on `main`; no commit, push or deployment. The only application dependency added is `@vercel/blob` (plus its transitive dependencies). The base discrepancy remains explicit in section 2.

## 24. Vercel Blob setup still required

Hosted store existence/connection was not verified or modified. After review, if absent: in the existing `frami-dev-workplace` project's Storage area, create one Blob store with **Private** access, then connect it to the project through the store's Projects tab. Select intended environments explicitly. Confirm Vercel supplies `BLOB_STORE_ID` and its managed OIDC identity. Do not manually copy a long-lived Blob token into source or browser settings. For local integration, the documented `vercel env pull` retrieves the connected store configuration and development OIDC identity; the SDK handles refresh. See [official Blob setup and authentication](https://vercel.com/docs/vercel-blob/using-blob-sdk).

`BLOB_STORE_ID` must also be available during the build so CSP permits exactly that private media hostname. The existing server-side Supabase service-role configuration is needed for trusted upload-intent/finalization operations. No webhook configuration is required by this manual signed-PUT plus finalize flow.

## 25. Production state

PRODUCTION UNCHANGED. GATE I STATE UNCHANGED. No hosted migration, store creation, environment change, real video upload, publication toggle, deployment, push, scheduler/consent change or Gemini invocation was performed.

## 26. Recommended rollout steps

Review the base discrepancy and local diff; reconcile onto the desired release base explicitly. Review/apply the single migration to an approved nonproduction environment, connect an approved private store with OIDC, and build with its store ID. Then perform real authenticated upload/replace/remove, unsigned-read denial, signed GET/range playback, expiry and static-mode network checks in that environment. Resolve the unrelated CMS browser harness before claiming complete portfolio regression coverage. Production migration/deployment/publication require a separate authorized rollout. Stop here: this task made only the local candidate.
