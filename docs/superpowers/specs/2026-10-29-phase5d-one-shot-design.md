# Phase5D exact one-shot proactive authorization — proposed design

Status: approved with the accompanying 2026-10-29 amendments; amendments override original proposals. No live authorization is permitted by implementation approval.

## Intent and boundaries

Add a durable server-side permission for one owner, project-linked signal, content revision, exact natural slot and configured provider/model. Maximum requests is exactly one. The owner's existing settings can remain workspace mode, checks-v1, AI consent false and persistent scope empty. Preserve normal behavior whenever no one-shot applies. October 29 20:00 authorization is unused and will not be salvaged.

No Production changes, live Gemini, live authorizations, commit, push, deployment, scheduler changes or retrospective trial. Implement and validate only against local synthetic fixtures after design approval.

## Repository findings

- `lib/ai/agent/pulse/routes.ts` authenticates the owner and translates narrow browser requests into service-only RPCs.
- `privacy.ts:buildProactiveContext` currently requires persistent consent, ranks candidates and includes up to three signals.
- `engine.ts:runOwner` publishes deterministic results, then skips AI unless settings.mode is workspace_ai. It revalidates context immediately before transmission and publication.
- `engine.ts:runPulseDispatch` distinguishes fresh versus replayed dispatch batches. Existing replay processing may recover an already claimed Pulse.
- `agent_pulse_reserve_ai` serializes under advisory transaction lock (505,5), checks canonical owner/Pulse/parent authority and commits Pulse accounting, installation reservation and parent attempt together. A lost reservation response never grants another send.
- `agent_pulse_publish_ai` and `private.agent_pulse_ai_parent_eligible` currently depend on persistent consent; one-shot must have independent permission checks while retaining shared source/budget/output rules.
- `gemini.ts:generatePulseIdea` has one SDK attempt and a physical fetch guard; advisory parsing rejects executable output. It receives only minimized serialized facts and synthetic aliases.
- `AgentInbox` ACKs rendered revisions. `AgentPulseSettings` is independently mounted by `WorkspaceAiChat`; the new review surface must stay there.
- Observation memory clear deletes observations; retained Pulse headers and installation events have separate retention. A new authorization must not prevent those operations or erase existing request accounting.

The current clean checkout is an isolated worktree on reconcile commit 41165ff, older than origin/main 7c8dd86. Relevant Pulse/settings/Inbox files match origin/main, but migration history and workspace UI have later changes there. Implementation must start a feature branch from the verified current main in this existing worktree, preserving the reconcile branch. Do not build on the stale checkout. Latest main migration is 20261025152931_project_preview_videos.sql; rediscover immediately before generating a new migration with the existing CLI.

## Approach

One approach satisfies the stated boundaries: a private database capability with an isolated worker branch, reusing existing deterministic scans, minimized fact serialization, accounting and advisory publication.

Temporary persistent consent is explicitly rejected. A browser-only parent pin or process-local token cannot enforce concurrent consumption. A second Agent/provider implementation would duplicate working safety logic. No alternative scheduler or provider SDK is needed.

## Immutable authorization identity

New private table, proposed name `private.agent_pulse_one_shot_authorizations`. Store immutable owner, project, signal ID, signal content revision, episode, family, canonical source token and minimized-context fingerprint; exact UTC natural slot; provider=gemini; exact configured model; authorization/context-policy versions; max_requests=1; created_at and expires_at; and settings/policy revision captured for conservative invalidation.

Store transition metadata separately in the same row: status, consumed_at, terminal_at, safe bounded reason code, bound Pulse identity and existing installation reservation identity. No credentials or original provider response. Creation only follows an explicit owner confirmation of server-built facts.

RLS enabled; deny all direct table access to PUBLIC, anon, authenticated and service_role. Public RPCs are service_role-only SECURITY DEFINER with empty search_path and qualified relations. The HTTP layer derives owner from Supabase authentication, never a browser owner ID. RPCs still verify all resource relationships. Guard triggers reject identity edits and illegal transitions; unique keys enforce one reservation per authorization and one authorization per consumed Pulse. Permit at most one effective pending authorization per owner, keeping one-Pulse capacity and selection unambiguous.

Use an owner FK. Observation/project/Pulse/reservation identities remain immutable audit references checked transactionally rather than adding restrictive FKs that would break normal memory clear, entity deletion or existing accounting retention. Deleting a source blocks execution; it does not erase consumed accounting. Explicit tests cover deletion/clear and reference loss.

## States, cancellation and expiry

States: pending, consumed, completed, blocked, expired, cancelled, failed. Only pending can be cancelled or consumed. Consumption irreversibly spends the single request allowance even when no response is known. No transition returns to pending. Use a bounded reason-code union with separate bounded explanations.

Authorization expiry is immutable and no later than parent evidence expiry. Proposed one-shot send window ends at slot plus 600 seconds, never the next slot. This is a NEW narrower policy choice: the existing scheduler's 600-second check constrains issuedAt age, while its slot check accepts the current four-hour bucket. It does not already impose slot+600 expiry. UI shows the actual expiry. The worker also requires its existing lease/execution/provider time budget, which can close the window sooner.

Every read and consume computes effective expiry from database time, so a missed slot cannot remain executable or appear pending indefinitely. Existing natural dispatcher maintenance materializes expired pending rows and abandoned consumed rows in bounded batches, even when no owner is claimed. Read projection itself performs no write. If scheduler stops entirely, effective terminality remains immediate; physical status materialization waits for a later maintenance/product mutation. This distinction must be documented and tested, not hidden.

No new Cron, extension or service. Missed owner dispatch gets NO_NATURAL_DISPATCH when supported by canonical evidence, otherwise a truthful SLOT_EXPIRED reason. Do not invent pulse_cap where no per-owner reason was recorded. Optional general dispatch-skip instrumentation is deferred.

## Product action and ACK safety

Add narrow authenticated routes for read-only candidate preview/status, confirmed creation and pending cancellation. Browser submits identifiers, expected content revision, selected future slot and the server-issued preview identity; it cannot supply facts, owner, request count, consumed status or model override. Server reloads canonical facts/model and rejects changed previews. No draft authorization exists before explicit confirmation.

Small `AgentOneShotAuthorization` panel inside independent Agent Settings. Read candidates without mounting Inbox or Brief. Show project, signal, family, reason, revision, UTC/local natural slot, evidence and authorization expiry, provider/model, unknown/free-service billing disclosure, one request, advisory-only, no automatic mutation, and exact provider-visible minimized facts. Creation, status and cancellation do not ACK. Do not auto-select another candidate after failure.

Initially support the existing project-linked signal families: deadline, important_work and quiet_project. Workspace-wide tomorrow observations cannot truthfully bind to one project under their current identity/permission contract; reject them explicitly rather than silently broadening scope. This is a proposed product limit for owner review.

## Natural execution and exact context

Retain deterministic scan/publication first. After successful deterministic publication, the fresh-dispatch worker looks up a matching exact one-shot for this owner and canonical slot before the existing workspace-mode AI skip. Persistent consent remains false; do not forge a ProactiveSettings value pretending it is true.

Separate normal-consent admission from shared minimized signal serialization. A new exact-context entry point accepts exactly one canonical parent plus validated capability; it does not call normal ranking, select top-three, include siblings or expand project scope. It must require the same current truth/source/relationship proof as normal generation. Provider bytes are fingerprinted and compared again immediately before actual fetch.

If the slot has a one-shot attempt, handle its blocked/failure result without falling through to normal AI or another parent. Without a one-shot, the existing normal path stays unchanged. Creation requires workspace mode with existing checks consent and no persistent AI consent/scope; later conflicting settings changes invalidate the grant.

One-shot admission is only available to runPulseDispatch's fresh authenticated dispatch branch. Standalone runClaimedPulse/manual test entry points and replay batches cannot start a one-shot attempt. Matching dispatch/Pulse/nonce fields ALONE DO NOT distinguish replay: current recovery returns those same fields.

Therefore the new migration must minimally extend the original fresh claim branch: for a matching pending one-shot, mint an unpredictable single-use admission credential, bind its hash to authorization and newly created Pulse, and return plaintext only in the initial fresh claim result. Never store plaintext or return it from replay, recovery, owner routes or projections. Consumption requires this credential in addition to canonical slot/fence/lease/event checks. The normal claim DTO remains unchanged when no one-shot is admitted. Keep the optional credential internal to the worker; never log it or include it in provider context. This is the necessary limited dispatch integration, not a scheduler/HMAC/cap change. Tests must prove replay/recovery lack the credential and cannot consume, including racing replay delivery before the original worker reserves.

Existing server/HMAC authority remains the trust boundary: the system cannot independently prove a correctly signed request came from pg_cron rather than another holder of the signing secret. No new claim of that capability is made.

## Atomic reservation, locking and model binding

Use existing global advisory transaction lock (505,5), then owner state, relevant Pulse rows in UUID order, parent observations in UUID order, then authorization rows in UUID order. All new creation/cancel/consume/publication/expiry paths obey this order. Recheck expiry and lease after locks.

Extract shared source-validity/attempt/budget checks and reservation accounting from current SQL functions without weakening their persistent-consent wrapper. One-shot consumption independently validates owner/project/parent/revision/episode/family/source/context policy/exact slot/active unseen state/fresh evidence/attempts/model metadata, then atomically commits status consumed, bound Pulse, original existing provider reservation, parent attempt and counters. No reservation RPC call can succeed without the corresponding permission path. Abort rolls back all accounting together; duplicate consumers return sendAllowed=false. A uniqueness loser recovers canonical state without another send.

Provider/model metadata comes from the configured server adapter, not browser input. Compare preview, authorization and current adapter metadata; pass the expected model into the adapter and compare again before send. No fallback model. Reuse its SDK attempts=1 and physical sent guard. Uncertain consume response means no send; uncertain transport means consumed and no retry.

Publication revalidates the same consumed grant, exact parent and reserved operation while reusing the existing output guard, idea category linkage and capacity/idea budgets. The only possible generated artifact is the existing owner-review idea. Apply/Cancel and workspace mutation paths are untouched. Interrupted/failed publication remains truthful and never grants another provider attempt.

## Accepted-idea provenance, lifecycle and retention

Existing private.agent_pulse_safe_observation also calls the persistent-consent predicate when projecting ideas. Merely changing reservation/publication would therefore hide a successful one-shot result immediately. Explicitly add immutable one-shot publication provenance to the accepted idea header in the new migration, linked to the consumed authorization/Pulse and established only by the guarded publication transaction. The existing normal idea path keeps its existing withdrawal behavior. For a one-shot idea, safe projection and lifecycle use canonical ownership/parent/current-source/evidence checks plus its accepted one-shot provenance, without requiring broad persistent consent or an unexpired EXECUTION window. Execution expiry must never silently erase a legitimately accepted advisory. No other stale/unavailable/output guard is relaxed.

Proposed bounded retention: authorization metadata only, maximum 200 retained rows per owner, 30 days after terminal time, and at most one pending row. Reject new creation at retained capacity; do not delete fresh accounting to make space. Store no signal text or fact payload in authorization audit rows: use identity, versions, hashes, timestamps and bounded reasons. Project/signal labels come from safe current joins and become unavailable after source loss. Accepted idea provenance remains immutable in its own existing retained header even after authorization audit metadata is pruned, while existing idea expiry/redaction rules still apply.

Memory clear must invalidate pending one-shots before deleting observations, under the same lock order. A consumed/in-flight attempt cannot regain send permission; mark its truthful interrupted outcome without refunding any reservation, and prevent later publication. Preserve operational authorization accounting during its retention window, just as current request accounting survives clear. Explicitly test project deletion, parent loss, clear, post-expiry advisory reads and audit pruning.

Owner audit shows allowance/reservation consumption separately from transmission evidence. A committed consumed row means the one allowance was spent; it does NOT prove a physical request occurred. Lost reservation responses show no authorized resend and transmission unknown/not-started as actually evidenced. Physical transport failures can also remain unknown. Never label every consumed authorization as one confirmed provider HTTP request.

## Validation

Test first with synthetic PGlite fixtures and fake provider transport. New tests cover all 27 requested cases, immutable identity, cancellation/consume races, missed dispatch expiry with no owner claim, deletion/memory clear, changed settings, preview tampering, lost responses, terminal retention, and no fallback to normal generation. Verify exact wire contents with multiple unrelated eligible siblings and excluded-content sentinels. Test physical request count, not only mock function invocation.

Run unchanged phase5d-gemini, phase5d-ui and phase5d-handoff regressions, then the full Phase5D suite, private/public AI suites, typecheck, focused ESLint, build and diff checks. Add true multi-connection PostgreSQL tests against already available local infrastructure for duplicate consume, cancellation versus consume, concurrent normal/one-shot budget spending and expiry/publication races. PGlite serial interleavings are not PostgreSQL concurrency proof. Do not install dependencies or new infrastructure without authorization. No live provider calls.

## Migration and rollout

One new immutable self-contained migration after every current main migration; do not edit applied Pulse SQL. Add table, guards, grants, shared helper refinements and necessary RPC replacements in that migration. Verify old migration hashes and replay from scratch locally. Check existing test fixtures explicitly apply the new migration in new tests without changing the meaning of old regression tests.

No production migration, live authorization, generation or deployment. After implementation/review, a separately authorized rollout must verify real PostgreSQL races, grants, old application compatibility and new worker/UI. Gate I must restart with a reconciled new baseline, a newly valid natural parent and new explicit authorization. Runtime baseline SHA remains an external release/Gate I check unless a reliable existing server SHA is found; do not add GitHub/Vercel network calls to the worker.

## Approval scope

Approve or amend: the isolated database capability approach; fresh-only admission credential; accepted-idea provenance integration; project-linked families only; one pending authorization per owner; proposed slot+600-second expiry bound; immediate effective expiry with lazy physical materialization; 30-day/200-row metadata retention; and the existing HMAC/service authority limitation. These are design proposals, not approved implementation decisions.
