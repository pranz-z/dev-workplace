# Phase 0a/0b — isolated synthetic evidence

Run from the clean redesign worktree root. Only the test bundle aliases
`@/components/auth/auth-provider` and `@/data/agentInboxService`; shipped
code/config remains unchanged. Real `WorkspaceAiChat`, `AgentInbox`,
`AgentPulseSettings` and current global CSS are used. Synthetic auth is never
installed into the application. In-memory stub calls are not HTTP endpoints.

All output paths must be outside the repository. Current evidence root:
`C:/webprac/redesign-baseline/phase-0a`.

```powershell
# One-time prepare: permitted Google font CSS/assets; existing esbuild runtime.
node tests/redesign/run.mjs prepare C:/webprac/redesign-baseline/phase-0a/assets
# Offline rebuild after harness edits; reuses downloaded font assets.
node tests/redesign/run.mjs build C:/webprac/redesign-baseline/phase-0a/assets
node tests/redesign/run.mjs test C:/webprac/redesign-baseline/phase-0a
node tests/redesign/run.mjs capture C:/webprac/redesign-baseline/phase-0a
node tests/redesign/run.mjs verify C:/webprac/redesign-baseline/phase-0a
# Optional reproduction of the existing unchanged CMS esbuild/CSS failure.
node tests/redesign/run.mjs cms C:/webprac/redesign-baseline/phase-0a
```

`run.mjs` starts a child with only named OS/runtime environment paths. It
loads no dotenv/config/credentials/session. Do not run with Node --env-file,
production cookies, copied .env.local or .auth files. `prepare` alone fetches
official Google font assets. Browser tests/captures use existing local fonts
and only a loopback static-resource server; no Next server or API handlers.
Do not click Send, settings save, feedback or other controls to call live
services. Service mutations are either the ACK memory stub or rejected.

The browser denies all requests except fixed static GET resources on its
assigned loopback origin; service workers are blocked and WebSockets closed.
The server independently rejects unknown resources/methods and never proxies.
Denied endpoint-shaped probes are deliberately intercepted before network.
Build metadata checks exclude the real auth/service/Supabase/API boundaries.
This is an application-fixture boundary, not an OS firewall or a hosted test.

Runtime prerequisites: lockfile-installed packages and existing Playwright
Chromium. `build-fixture.mjs` uses the previously documented external esbuild
runtime; `cms-baseline.mjs` also uses the documented external PGlite runtime.
If unavailable, report the missing prerequisite instead of installing a new
repository dependency or borrowing legacy configuration/session files.

Validation: Node isolation tests, real-browser lifecycle/ACK cases, existing
160-test Agent UI suite, ESLint and TypeScript. The full type check may report
missing generated Next LayoutProps/PageProps on this unbuilt checkout.
`typecheck.mjs` separately checks fixture entry points and compares full-tree
diagnostics with the same tree excluding the harness. A known baseline error
does not count as a full type-check pass. CMS reproduction intentionally
expects the historical CSS output-path failure and does not fix it.

Phase 0a captures are synthetic Inbox component evidence. Supplemental data,
held-ACK progression and mobile fonts live in the external clarification set.
`source-guard.mjs` pins the four protected source files to accepted 0a hashes
and runs before fixture builds/browser startup; injected-byte tests prove it
rejects changes without editing shipped source.

Phase 0b adds PRODUCT.md/DESIGN.md, a real-component BEFORE matrix and gap
evidence. It uses test-bundle aliases for service/Next boundaries and a strict
in-memory GET adapter, never a Next server/API handler. Only pure accountability
calculation uses its original service-named module; the actual Accountability
view's snapshot-on-mount request is discarded in its fixture alias. No production
data or observations are changed. Boundary limitations are in the manifest.

Use the already prepared local font assets. **Do not run prepare or make any
external request in Phase 0b.** From the repository root:

```powershell
node tests/redesign/run.mjs matrix-build C:/webprac/redesign-baseline/phase-0b/assets
node tests/redesign/run.mjs matrix-test C:/webprac/redesign-baseline/phase-0b
node tests/redesign/run.mjs matrix C:/webprac/redesign-baseline/phase-0b
node tests/redesign/run.mjs gaps C:/webprac/redesign-baseline/phase-0b
node tests/redesign/run.mjs types C:/webprac/redesign-baseline/phase-0b
```

Five sizes, both themes, fixed clock/timezone and locally served fonts make
the new 1024 BEFORE comparable with a later matching AFTER. Full Next routing,
hosted integrations, physical devices and real MP4 decoding are not certified
by these fixtures. Record baseline failures; do not fix shipped UI during 0b.
Stop after Phase 0b; no later implementation. Section 27: PENDING SKILLS.

## Pre-Phase 1 addendum — evidence only

The addendum keeps the phase0b-v1 dataset and accepted CSS, adding a separate
unauthenticated auth alias and optional local synthetic preview variant. It
does not rewrite the accepted owner-session baseline. `generate-clip` uses
native Chromium canvas/MediaRecorder to create a silent synthetic MP4 locally;
the addendum build embeds it in the memory preview response. No HTTP media
route is added, and isolation.mjs/request policy remains unchanged. Actual
ProjectCardMedia decodes/plays/stops the clip without mocked media methods.
Production signed URLs, CSP and Blob delivery remain outside this test.

Evidence outputs are under C:/webprac/redesign-baseline/pre-phase-1-addendum.
Use the existing copied fonts; never invoke prepare or a hosted request:

```powershell
node tests/redesign/run.mjs generate-clip C:/webprac/redesign-baseline/pre-phase-1-addendum
node tests/redesign/run.mjs addendum-build C:/webprac/redesign-baseline/pre-phase-1-addendum/assets
node tests/redesign/run.mjs target-components C:/webprac/redesign-baseline/pre-phase-1-addendum
node tests/redesign/run.mjs anonymous-captures C:/webprac/redesign-baseline/pre-phase-1-addendum
node tests/redesign/run.mjs preview-evidence C:/webprac/redesign-baseline/pre-phase-1-addendum
```

Target enrichment reuses the accepted owner-session bundle and original 508
instances. It matches original locators/labels/rectangles, then groups by real
DOM area/tag/type/stable class signature; size variants and counts remain.
Anonymous captures cover hero/projects/case study at five sizes in both themes.
Stop after addendum review; Phase 1 is not executed by these commands.
