# Phase5D One-Shot Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Bind one provider allowance to one owner/project/parent revision and next natural slot without persistent AI consent.

**Architecture:** Private database authorization, fresh-only dispatch credential, atomic shared accounting and an exact-context worker branch. Owner preview/create/status/cancel live in independent Agent Settings and never ACK. Existing normal execution and advisory publication remain authoritative.

**Tech Stack:** Existing Next.js/TypeScript/React, Supabase/PostgreSQL, PGlite, Node test runner and local PostgreSQL.

**Spec:** `../specs/2026-10-29-phase5d-one-shot-design.md` and `../specs/2026-10-29-phase5d-one-shot-amendments.md` (amendments take precedence).

## Global Constraints

- Starting main SHA 7c8dd86ff68a88468266cac616838584ba378387; isolated branch codex/phase5d-one-shot-authorization.
- Local synthetic fixtures only; no remote writes, live provider, authorization, consent, reservations or Pulse invocation.
- No commits, push or deployment. No dependency/infrastructure/config additions.
- One next natural four-hour UTC boundary; expiry min(parent evidence, slot+600 seconds).
- Exactly one allowance; no retry/fallback/sibling; mode workspace, checks-v1, AI consent false and scope empty supported.
- New migration only; applied migrations immutable; retain original budgets, cap, fencing, advisory and ACK guards.

## Review Focus

- Preview races: canonical rehydration and fingerprint comparison reject model/source/settings changes.
- Replay racing original: only initial fresh claim returns admission plaintext; recovered authority cannot consume.
- Lost responses: spent allowance never reopens; physical transmission is not inferred from reservation.
- Cleared/pruned sources: accounting survives, pending invalidates, accepted provenance remains truthful.
- Exact boundaries: next slot, pre-slot and expiry equality fail closed, including elapsed slots with no dispatch.

---

### Task 1: Domain contracts and exact serialization

**Files:** Create `lib/ai/agent/pulse/one-shot.ts`, `lib/ai/agent/phase5d-one-shot-domain.test.mjs`; modify `privacy.ts`, `types.ts` only where shared interfaces require it.

**Interfaces:** Produce `OneShotPreview`, `OneShotAuthorization`, bounded `OneShotReason`, `OneShotAccounting`, `buildOneShotContext(source,parent,authorization)` and canonical preview fingerprint helpers. Normal `buildProactiveContext` contract remains unchanged. Exact mode uses independent admission, not forged ProactiveSettings.

- [x] Write failing tests for single authorized signal bytes, sibling exclusion, wrong parent/project/revision/source/model/expiry, no persistent consent requirement, and bounded status/accounting projections.
- [x] Run `node --test lib/ai/agent/phase5d-one-shot-domain.test.mjs`, observe meaningful RED.
- [x] Separate existing per-signal minimization from normal consent/ranking; implement exact entry point restricted to deadline/important_work/quiet_project. No workspace aggregate admission.
- [x] Run new domain and existing privacy/Gemini tests GREEN; record counts.

### Task 2: Authorization storage and owner RPCs

**Files:** Create one timestamped migration using existing Supabase CLI after rediscovering main migration head; create `phase5d-one-shot-fixture.mjs`, `phase5d-one-shot-schema.test.mjs`, `phase5d-one-shot-owner.test.mjs`.

**Interfaces:** Service-only `agent_pulse_one_shot_preview`, `agent_pulse_one_shot_create`, `agent_pulse_one_shot_list`, `agent_pulse_one_shot_cancel`; common private exact-parent evaluator and effective-state projection. Browser supplies only preview identity/identifiers, never canonical facts/model/owner.

- [x] Write RED SQL tests for RLS/grants, immutable identity, owner/project/revision/family/source checks, next-slot derivation, current owner due compatibility, strict expiry, confirmed creation, tampering, cancellation and one pending/200 retained limits.
- [x] Record all old migration SHA256 hashes; generate new migration after latest current main version.
- [x] Implement private authorization storage, legal transitions, read-only effective expiry, canonical next-slot calculation and owner RPCs. Retain no copied facts/text. Prune only eligible terminal metadata before capacity rejection.
- [x] Run new schema/owner tests GREEN and verify prior migration hashes unchanged.

### Task 3: Fresh admission, atomic consumption and shared accounting

**Files:** New migration from Task 2; modify `db.ts`, `types.ts`; create `phase5d-one-shot-consume.test.mjs`.

**Interfaces:** Fresh authority carries optional internal one-shot admission (authorization ID + unpredictable credential). Replay/recovery never return credential. `reserveOneShot(authority,admission,provider,model,fingerprint)` returns sendAllowed only for original successful atomic consume.

- [x] Write RED tests for initial-only token, stored hash only, replay racing original, all identity mismatches, pre-slot/expiry, duplicate consume, source/seen/resolved/model/attempt/budget blocks, and rollback/lost-response semantics.
- [x] Implement minimal fresh claim extension; shared source/attempt/budget/accounting helpers with unchanged normal wrapper. Lock order: advisory (505,5), owner, ordered Pulse rows, ordered observations, ordered authorizations.
- [x] Atomically spend authorization, Pulse/install reservation and parent attempt. No normal reserve can bypass required one-shot admission.
- [x] Run consume tests plus existing claim/budget/installation regressions GREEN.

### Task 4: Exact worker execution and truthful provider outcomes

**Files:** Modify `engine.ts`, `gemini.ts`, `db.ts`; create `phase5d-one-shot-engine.test.mjs`.

**Interfaces:** Exact context from Task 1; reservation Task 3; expected provider/model supplied to adapter and rechecked before physical fetch. One-shot branch owns AI for the Pulse, with no persistent-path fallthrough. Accounting separates allowance, send attempt, transport/response, validation and publication.

- [x] Write RED worker tests for workspace-only execution, no fallthrough on every failure, no siblings, exact SDK wire bytes, one physical request, model change, lost reservation response, failed transport/output and duplicate workers.
- [x] Integrate branch only from fresh natural dispatch after deterministic publication; direct runClaimedPulse and replay cannot start it. Preserve normal branch unchanged without authorization.
- [x] Reuse adapter's physical sent guard, attempts=1, advisory validator and pre-send current authority/context revalidation.
- [x] Run new engine tests and existing engine/Gemini/handoff suites GREEN.

### Task 5: Publication provenance, source loss and retention

**Files:** New migration; modify `db.ts`/engine finish integration if needed; create `phase5d-one-shot-lifecycle.test.mjs`.

**Interfaces:** One-shot publication links consumed operation, authorization, Pulse and parent. Accepted idea header has immutable one-shot provenance independent of execution expiry and audit pruning. Effective expiry/abandoned maintenance runs in bounded existing maintenance path.

- [x] Write RED tests for accepted read with persistent consent false, expired execution window, audit pruning, ordinary-consent withdrawal unchanged, memory clear before/after consume, parent/project loss, publication races and no refunded allowance.
- [x] Implement authorization-aware publication/projection/lifecycle plus bounded expiry and 30-day retention. Preserve all output/source/idea-cap guards. Mark source loss truthfully; do not add restrictive FKs.
- [x] Run lifecycle and existing lifecycle/retention/projection/handoff suites GREEN.

### Task 6: Authenticated owner API and non-ACK UI

**Files:** Create `app/api/ai/agent/one-shot/route.ts`, `app/api/ai/agent/one-shot/preview/route.ts`, `app/api/ai/agent/one-shot/cancel/route.ts`, `components/ai/AgentOneShotAuthorization.tsx`, `data/agentOneShotService.ts`; modify independent `AgentPulseSettings.tsx`; create `phase5d-one-shot-routes.test.mjs`, `phase5d-one-shot-ui.test.mjs`.

**Interfaces:** Authenticated GET status/preview and POST create/cancel. Strict bounded identifier-only contracts; owner derived from session; configured provider metadata reloaded server-side. No Inbox/Brief mount or ACK/seen/revision writes from this UI.

- [x] Read installed Next route-handler and React guidance; write RED contract/ownership/origin/body-limit/stale-preview tests and UI explicit-confirmation/no-ACK tests.
- [x] Implement narrow routes/service, exact minimized disclosure and server-computed next slot with local/UTC display, safe billing notice, pending cancel and audit phases. No browser slot arithmetic/model/context override.
- [x] Run route/UI tests and existing UI/handoff suites GREEN. Check five browser widths with local synthetic authentication if retained harness is usable; report any environment blocker honestly.

### Task 7: Local PostgreSQL concurrency and full migration replay

**Files:** Create `phase5d-one-shot-postgres.test.mjs` using existing local fixture/runtime; new migration tests only.

**Interfaces:** Same functions as Tasks 2–5 on true multi-connection PostgreSQL; no remote URL accepted.

- [x] Discover retained PGlite and local PostgreSQL paths without revealing credentials. Do not install/link new dependencies without authorization.
- [x] Run concurrent duplicate consume, cancel/consume, normal/one-shot installation budget, expiry/consume and publication/source-invalidation tests with explicit barriers and bounded process timeouts.
- [x] Replay all migrations from scratch locally; verify grants, old hashes and no changes to scheduler/HMAC/cap behavior.
- [x] Record true races separately from PGlite serial interleavings; no false concurrency-readiness claim.

### Task 8: Regression, security review and implementation report

**Files:** Contract docs, this plan's ledger, final 30-section report.

- [x] Run focused one-shot suites and all Phase5D tests with fresh counts, then private/public AI, `npx tsc --noEmit`, focused ESLint, `npm run build`, `git diff --check`.
- [x] Fresh reviewer checks whole diff, capability/replay/SQL grants, context bytes, accepted provenance and normal regressions. Fix important findings test-first.
- [x] Document source identity, migration SHA, tests, local concurrency, limitations, files and separate rollout/new Gate I requirements in the requested 30-section report.
- [x] Stop. No Production migration, live authorization/provider, commit, push, deployment or Gate I.
