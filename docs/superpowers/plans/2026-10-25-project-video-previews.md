# Project Video Previews Implementation Plan

> Historical plan. A fresh fetch during reconciliation corrected the original ancestry diagnosis: `dbfa5b3` is an ancestor of `41165ff`, exactly three commits behind. The candidate now lives on `codex/project-video-preview` at `41165ff`; see `docs/project-video-preview-reconciliation-result.md`.

**Goal:** One optional private Blob video per project, managed only in the workspace and played only on eligible public-card hover.

**Architecture:** Browser uploads directly to an official signed PUT URL. Server-only Blob signing and HEAD verification bind opaque paths to private upload intents. Supabase holds metadata; owner RLS and a narrow public RPC preserve existing portfolio ownership. A shared card-media component retains the screenshot or gradient underneath video.

**Tech stack:** Existing Next.js 16/React 19/TypeScript/Supabase, pinned @vercel/blob 2.8.2, Node tests, existing external PGlite/esbuild and Playwright.

**Source:** Clean main at dbfa5b3e8b25f760e5ebc27eecc971a5ba992c5b. Requested 41165ff4db89228d11de9616236e1f68cfb46cef exists but is not an ancestor. Preserve this checkout; no reset, commit, hosted mutation, deployment, or AI/agent changes.

1. Add failing policy and database tests, then one self-contained migration, private upload intents, safe finalize/remove RPCs, owner RLS and public slug projection. Follow the repository's maintained row-interface convention (no type generator is configured).
2. Add server-only Blob adapter and authenticated metadata/upload/finalize/preview/remove routes. Validate bounded JSON and actual HEAD metadata; serialize replacement through a project row lock. Delete old objects only after association changes.
3. Add owner management beside screenshots, with explicit enable control and on-demand owner preview. Keep screenshot and Drive services unchanged.
4. Add shared hover media to both public card layouts. Resolve only on fine-pointer hover with motion allowed, cache until expiry, pause/reset on exit/offscreen, bound failure retries.
5. Extend only necessary CSP sources, test routes with controlled mocks and migration with disposable SQL role switching, run component/browser tests at 1440/1024/768/390/320, existing related regressions, TypeScript, exact-file lint, diff check and build.
6. Review final diff and write the requested implementation report, distinguishing mocks from real Blob integration and documenting post-review setup. Stop locally.
