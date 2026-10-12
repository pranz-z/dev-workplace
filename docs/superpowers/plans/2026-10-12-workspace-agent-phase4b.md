# Workspace Agent Phase 4B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task if inline execution is confirmed; use superpowers:subagent-driven-development only if the owner selects delegation. Steps use checkbox syntax for tracking.

**Goal:** Prepare safe, deterministic, single-action inverse proposals from applied Agent history, then reuse explicit approval and recovery.

**Architecture:** One private PostgreSQL domain evaluator derives eligibility and canonical inverses. Activity reads and transactional preparation call that same evaluator; inverse Apply calls it again under locks before delegating the existing mutation RPC. TypeScript handles authentication, identifier validation, safe projection and presentation, with no second inverse algorithm.

**Tech Stack:** Existing Next.js 16.3.6, React 19.2.8, TypeScript, Supabase/PostgreSQL, Node test runner and disposable PGlite with btree_gist.

**Spec:** `docs/superpowers/specs/2026-10-12-workspace-agent-phase4b-design.md`, approved 2026-10-12. Base release `89d8200cc888ea560f1c6ea0339b47b674bad9e9`.

## Global constraints

- Planning only until this plan is reviewed and execution is authorized.
- No production migration, commit, push, deployment, environment change or unrelated refactoring during implementation.
- One additive migration; existing applied migrations remain immutable.
- Original actions remain unchanged; immediate-source lineage is immutable after preparation.
- No bulk/run-level undo, redo subsystem, task deletion, snapshots, arbitrary rollback, autonomous execution or new Gemini tools.
- No Gemini calls for eligibility, Prepare, inverse Apply, inverse Cancel or recovery.
- Workspace data changes only on Apply. Prepare may persist a new operational run/action.
- Browser Prepare body exactly `{runId, actionId}`; Apply/Cancel exactly `{runId, actionIds}`.
- Missing canonical keys differ from explicit null. Incomplete or potentially truncated history fails closed.
- Preparation tolerates unrelated earlier edits; inverse captures current updated_at; Apply preserves strict whole-row version checks.
- profiles.time_zone remains the only timezone source; block instants remain absolute timestamps.
- Existing PostgreSQL exclusion constraint remains final overlap authority.
- No new dependencies or infrastructure unless a concrete blocker is reported first.

## Review focus

1. Timestamp precision and timezone changes: SQL comparison must preserve timestamp precision; date interpretation must match existing canonical task behavior (Task 1).
2. Pending inverse becomes cancelled between lookup and recovery: never return a cancelled batch as a pending recovery (Tasks 3, 6).
3. An inverse-of-inverse must preserve immediate lineage, without rewriting the first source's reversed state (Tasks 3, 4).
4. Completion-to-scheduled restoration and a slot expiring during approval must receive the same future-time protection as cancellation restoration (Tasks 1, 4).
5. Navigation away during Prepare/recovery must not install an old proposal into another action's details (Task 6).

## File map

| File | Responsibility / likely functions |
|---|---|
| New `supabase/migrations/20261013090000_workspace_agent_safe_undo.sql` | All Phase 4B schema, policy, preparation, guard and projection additions; timestamp must still sort after current migrations when execution starts |
| New `lib/ai/agent/undo.ts` | Server-only RPC adapter `prepareAgentUndo`; safe result validation, no derivation |
| New `lib/ai/agent/undo-route.ts` | `handlePrepareAgentUndo(request: Request): Promise<Response>` with existing authenticated Agent conventions |
| New `app/api/ai/agent/activity/undo-proposal/route.ts` | Node, force-dynamic POST forwarding to handler |
| `lib/ai/agent/proposal-schema.ts` | `parseUndoSelection(input: unknown): {runId:string;actionId:string}` |
| `lib/ai/agent/store.ts` | `applySelectedActions` chooses inverse guard using reloaded stored lineage |
| `lib/ai/agent/contract.ts` | Optional safe `undoOf` metadata on ProposalDraft; shared projected UndoEligibility types |
| `lib/ai/agent/activity.ts` | `getAgentRun` attaches whitelisted SQL eligibility/lineage; no raw history returned |
| `data/agentActivity.ts` | Optional action eligibility, direct source and reversedBy references |
| `components/ai/AgentActivity.tsx` | Prepare, review pending, unavailable reasons, direct lineage navigation and recovery |
| `components/ai/AgentProposalCards.tsx` | Undo introduction from optional metadata, ordinary decisions unchanged |
| New `lib/ai/agent/phase4b-policy.test.mjs` | Disposable SQL evaluator fixtures and normalization cases |
| New `lib/ai/agent/phase4b-database.test.mjs` | Full migration, preparation, Apply, grants, constraints, rollback and serial interleavings |
| New `lib/ai/agent/phase4b-route.test.mjs` | Existing esbuild/mock route style; strict bodies/auth/no Gemini/dispatch |
| New `lib/ai/agent/phase4b-recovery.test.mjs` | Activity/proposal integration and transport/state recovery cases |
| New `docs/acceptance/phase4b/implementation.md` | Exact evidence, matrix outcomes and final 37-point report, created during execution only |

No generated database types are changed unless an actual typed RPC caller requires them; current adapters use SupabaseClient RPC strings. Do not alter normal proposal draft validation to accept lineage input.

## Shared policy interfaces

Private SQL functions, defined in the single migration:

- `private.agent_undo_evaluate(p_user_id uuid, p_run_id uuid, p_action_id uuid, p_now timestamptz, p_selected_inverse_id uuid DEFAULT NULL) RETURNS jsonb`: read-only evaluator, no locks or writes. Checks existing direct inverses, source, historical integrity, owned current state, links, range and availability. Its internal result contains safe eligibility plus a canonical candidate, current version and lock-reference IDs. Never return internal result directly from a public read RPC.
- `private.agent_undo_project(p_result jsonb) RETURNS jsonb`: whitelist safe eligibility only.
- `private.agent_undo_lock_context(p_user_id uuid, p_source_id uuid) RETURNS void`: used only after source/inverse locks; lock required parent/link/target rows in the order below, then caller reevaluates. A discovery read is not validation; changed discovered link IDs cause bounded transaction retry, never locking an earlier class out of order.
- `public.get_agent_undo_eligibility(p_user_id uuid,p_run_id uuid,p_action_id uuid) RETURNS jsonb`: service-only read wrapper, evaluator + projection. Activity detail projection calls the same private evaluator within its statement snapshot, avoiding one RPC per action.
- `public.prepare_agent_undo(p_user_id uuid,p_run_id uuid,p_action_id uuid) RETURNS jsonb`: service-only atomic preparation. Envelope `{eligibility, proposalBatch?}`; pending recovery returns canonical batch; unavailable returns safe reason. Foreign IDs return null/generic forbidden at adapter.
- `public.apply_agent_inverse_action(p_user_id uuid,p_run_id uuid,p_action_id uuid) RETURNS jsonb`: service-only guarded mutation, returns existing ActionResult shape.

Projected TS interfaces:

```ts
type AgentActionReference = {runId:string;actionId:string;createdAt:string};
type UndoEligibility = {
  state:'available'|'unsafe'|'already_reversed'|'entity_missing'|'state_changed'|'unsupported';
  reason:string; explanation:string; inverseSummary?:string;
  existingInverse?:AgentActionReference & {status:'pending'|'applied'};
};
// ProposalDraft.undoOf?: AgentActionReference
// AgentActivityAction.undo?: UndoEligibility
// AgentActivityAction.undoOf?: AgentActionReference
// AgentActivityAction.reversedBy?: AgentActionReference
type PrepareUndoResult = {eligibility:UndoEligibility;proposalBatch?:ProposalBatch};
// prepareAgentUndo(admin:SupabaseClient,userId:string,selection:{runId:string;actionId:string}):Promise<PrepareUndoResult>
```

Only stable reason codes and bounded server-written explanations cross HTTP. The canonical batch keeps its existing safe operational fields; Activity never exposes before_state/payload. `reversedBy` exists only for an applied direct inverse. Pending reference uses `existingInverse`, never a misleading reversed badge.

## Action to inverse and mutation-path mapping

| Applied source | Inverse payload | Existing mutation RPC called by guard |
|---|---|---|
| update_task | update_task of changed supported fields only | public.apply_agent_task_action |
| reschedule_milestone | reschedule_milestone restoring targetDate, including null | public.apply_agent_schedule_action |
| reschedule_project | reschedule_project restoring targetDate, including null | public.apply_agent_schedule_action |
| create_time_block | cancel_time_block `{status:'cancelled'}` | public.apply_agent_time_block_action |
| update_time_block | update_time_block restoring affected canonical fields | public.apply_agent_time_block_action |
| cancel_time_block | update_time_block restoring scheduled status | public.apply_agent_time_block_action |
| create_task | Unsupported; no proposal | None |
| unknown / incomplete / non-applied | Unavailable; no proposal | None |

Task status reversal uses existing completed_at rules; never restores the old completion timestamp. Time blocks never alter deadlines.

## Exact additive migration plan

All statements live in the one new file; none are written during planning.

1. Add `private.agent_actions.undo_of_action_id uuid NULL`, with no default/backfill.
2. Add unique referenced key `(id,user_id)` named `agent_actions_id_owner_key` (existing PK id alone does not satisfy composite FK reference).
3. Add FK `(undo_of_action_id,user_id) REFERENCES private.agent_actions(id,user_id) ON DELETE RESTRICT`, named `agent_actions_undo_owner_fkey`. Do not cascade audit deletion.
4. Add check `undo_of_action_id IS NULL OR undo_of_action_id <> id`, named `agent_actions_undo_not_self_check`.
5. Add partial unique index `agent_actions_one_live_inverse_idx ON private.agent_actions(undo_of_action_id) WHERE undo_of_action_id IS NOT NULL AND status IN ('pending','applied')`. Cancelled/conflict/failed rows permit a new inverse; applied rows permanently consume that immediate source.
6. Define private evaluator, safe projector and context locker; revoke execution from PUBLIC, anon, authenticated and service_role. Reuse existing patch validators; implement inverse normalization once here, not again in TypeScript.
7. Define the three public service entry points above, `SECURITY DEFINER SET search_path=''`, all relations/functions schema-qualified. Revoke PUBLIC/anon/authenticated execution explicitly; grant only service_role. Keep private table privileges denied, including service_role direct access.
8. Replace only projection functions in this additive migration: `private.agent_batch` and `private.agent_activity_run(uuid,uuid,boolean)` used by `get_agent_activity_run`, preserving signatures, existing safe fields and pagination behavior. Add optional `undoOf`, projected `undo`, derived `reversedBy`; list summary/count behavior remains unchanged. Preserve `p_detail=false` list projection without invoking the evaluator.
9. Do not replace `apply_agent_task_action`, `apply_agent_schedule_action`, `apply_agent_time_block_action`, `cancel_agent_task_actions` or normal save validators. Preparation calls `save_agent_proposal_batch` with a server-derived single draft, then attaches linkage within the same transaction before returning `private.agent_batch`.
10. Add source/link integrity checks in preparation and guard, not JSON payload metadata. No audit-wide trigger required: source status is already applied and existing mutation/cancel routines skip terminal actions; no privileged direct browser write exists.
11. Test existing migrations plus new migration in order against a fresh disposable database with representative old records. Verify old records keep null lineage and byte-equivalent existing audit values.

Function volatility: read evaluator/projector/read wrapper and detail projections STABLE where they only read; preparation, context locking and Apply VOLATILE. Read calls receive a statement timestamp; write calls reevaluate with `clock_timestamp()` immediately before mutation. Empty search_path does not exempt explicit qualification of extension operators/functions.

## Lock-order table and transaction boundaries

| Order | Prepare | Guarded inverse Apply | Reason |
|---|---|---|---|
| 0 | Read IDs without locks, authenticate owner | Read selected inverse's source ID without locks, authenticate owner | Discovery only; reload after locks; source linkage must match |
| 1 | Immediate source action FOR UPDATE | Immediate source action FOR UPDATE | Shared serialization point; never lock inverse first |
| 2 | Existing pending/applied inverse FOR UPDATE, if present | Selected inverse action FOR UPDATE | Reload status and direct link; repeated Apply returns stored outcome |
| 3 | Owning/current/restored projects ordered UUID, FOR SHARE; project-date target FOR UPDATE at this stage | Same | Matches task/milestone existing parent-first order; avoids later project lock upgrade |
| 4 | Required milestones ordered UUID FOR SHARE; milestone-date target FOR UPDATE | Same | Lock both current and restored links if needed; no later upgrade |
| 5 | Linked tasks ordered UUID FOR SHARE, excluding target task | Same | Stabilize restored block links; parent ownership checked first |
| 6 | Target task or block FOR UPDATE | Same | Capture current version; guard retains lock through existing mutation RPC |
| 7 | New run/action inserted through save; linkage attached | Existing mutation RPC updates selected inverse and its run last | Never take run FOR UPDATE before action/entity locks |

No exclusive overlap-row locks: availability reads plus the exclusion constraint handle unrelated block writers. No source-run lock is needed; original run is untouched. New single-action inverse runs eliminate multi-action cancellation ordering inside Phase 4B. Existing Cancel locks inverse then its run and **never waits for source**, so it cannot complete a source↔inverse lock cycle with Prepare. Guard must not acquire ancestors recursively: immediate source is immutable applied history; inverse-of-inverse follows the same two-row order.

Existing ordinary block Apply locks block before FK checks, whereas the new guard prelocks parent/link rows. Prelocking must be audited against actual FK key locks, authenticated task/project edits, triggers and delete paths. Do not claim this table proves arbitrary manual-operation deadlock freedom. If evidence shows a cycle or inconsistent link discovery that cannot be retried safely within these boundaries, stop; do not change old mutation RPCs or weaken ownership. Transient database deadlock/serialization errors produce existing recoverable pending status, never automatic workspace re-execution.

**Prepare transaction:** source lock → existing inverse lock/recovery → context locks → fresh evaluator → construct current-before/current-version draft → save one new run/action → attach immediate linkage → reload canonical batch → commit. Workspace rows are only locked/read. Any failure rolls back run, action and linkage together.

**Unique conflict recovery:** isolate save+attach in a PL/pgSQL exception subtransaction. Catch `unique_violation` only when diagnostic constraint name is `agent_actions_one_live_inverse_idx`; rollback all inserted draft/run rows, then reload/lock the canonical live inverse under the source lock. Pending returns its canonical batch; applied returns already_reversed. Reevaluate if the winner became terminal. Other unique failures remain errors. Never catch all constraint errors as duplicate preparation.

**Apply transaction:** source lock → selected inverse lock → return persisted terminal outcome if already decided → context locks → exact expected_updated_at comparison → evaluator with this selected pending inverse excluded from duplicate short-circuit → compare candidate type/entity/project/payload with stored inverse → full links/range/future/availability validation → existing mutation RPC → canonical outcome. Pass the internal p_selected_inverse_id argument to validate this pending candidate without returning recovery early; expose no such switch to HTTP.

Guard validation failures update only the inverse's decision fields and run completion, using existing conflict/failure semantics: stale/state changed → conflict STALE_ENTITY; overlap → conflict TIME_BLOCK_OVERLAP; owner/link loss → failed FORBIDDEN; invalid history/range/expired → failed INVALID_INPUT. No partial workspace write; unknown transport outcome remains recoverable. SQL exclusion violation from delegated mutation remains authoritative. Recheck time using clock_timestamp immediately before delegate.

## Ordered implementation tasks

### Task 1 — Shared SQL eligibility and inverse policy

**Files:** new migration; new phase4b-policy.test.mjs. Read existing proposals.ts, time-blocks.ts, schema validators and Phase 3B database fixture first.

**Interfaces:** evaluator returns internal candidate `{type,entityId,projectId,payload,before,expectedUpdatedAt,diff}` plus safe eligibility; projector strips candidate. Use the five-argument evaluator signature defined above; read/Prepare pass null, guard passes selected inverse. This bypasses only that candidate's pending-recovery shortcut, never ownership/history checks.

- [ ] Write failing SQL fixtures for six task fields (`title`, `description`, `status`, `priority`, `dueDate`, `milestoneId`), multi-field, no-op, null and missing; assert inverse payload contains precisely affected keys and current-before/current-version.
- [ ] Add assertions: unrelated priority edit does not block dueDate reversal; changed dueDate blocks it; milestone diff label is ignored and historical UUID restored; incomplete multi-field history creates no partial inverse.
- [ ] Add boundary fixtures for 179/180 title and 3999/4000 description characters and trailing ellipsis: conservatively reject at truncation boundary; allow complete shorter values. Validate historical after text too. Explicit null permitted only where contract allows; empty description follows existing domain representation.
- [ ] Add all action-mapping fixtures, missing/foreign entity/link/context, unknown/create_task/non-applied unsupported, dates/null, timezone/instant precision and source project movement. Assert current representations match existing taskCalendarDate/date persistence semantics; ambiguous historical dates fail closed rather than guessing source timezone.
- [ ] Add block fixtures: full created state + notes guard; changed fields only for update; complete cancellation state; resulting coupled links/range; past/occupied slots. Future rule covers every reactivation into scheduled from cancelled **or completed**, and active range changes; title-only update of an already active block does not invent a time change.
- [ ] Run `node --test lib/ai/agent/phase4b-policy.test.mjs`; expect named assertions to fail because new evaluator is absent, not fixture bootstrap errors.
- [ ] Implement evaluator/projector in the one migration, using JSON key presence (`?`) before null extraction, canonical enum/date/instant comparisons and existing patch validators. Check every non-cancelled overlap excluding target; incomplete availability fails closed. No calls to Gemini.
- [ ] Rerun policy tests; require all database tests executed, zero failures, no Phase 4B skip. Deliverable: one policy used by subsequent tasks, no production mutation.

### Task 2 — Durable lineage, private grants and read projection

**Files:** same new migration; new phase4b-database.test.mjs; contract.ts, data/agentActivity.ts, activity.ts.

**Interfaces:** optional projected `undoOf`, `undo`, `reversedBy` per types above; SQL read wrapper and unchanged canonical batch shape plus metadata.

- [ ] Write failing tests for same-owner FK, foreign owner, self-reference, duplicate pending/applied index, terminal inverse freeing the slot and null old lineage. Snapshot source rows with `to_jsonb` before reads/writes and compare exactly.
- [ ] Add role-switch tests: anon/authenticated cannot execute any new public/private function or access audit tables; service_role can execute only new public functions, cannot directly access tables/private helpers. Inspect `pg_proc.prosecdef/proconfig` and explicit qualified SQL.
- [ ] Add safe projection assertions: no payload/before_state/prompt/reasoning/secrets in Activity; old pagination/mixed status/count behavior unchanged; source and inverse refs owner-scoped. Fake forbidden references never leak existence.
- [ ] Run new database tests and Phase 4A database tests, confirm intended failures.
- [ ] Add schema/constraints/grants and read projection replacements only in new migration. Update TypeScript optional fields and whitelist runtime values in getAgentRun. Activity's SQL projection calls evaluator; adapter does not independently derive eligibility.
- [ ] Rerun both suites; verify unchanged applied-migration hashes. Deliverable: safe read-only eligibility and lineage, no new preparation endpoint yet.

### Task 3 — Atomic preparation and canonical recovery

**Files:** same migration, phase4b-database.test.mjs, new undo.ts.

**Interfaces:** prepare_agent_undo and prepareAgentUndo return PrepareUndoResult; context locker follows table above.

- [ ] Add failing tests: new single run/action, workspace untouched, source immutable, current updated_at captured despite unrelated earlier edit, direct lineage on inverse-of-inverse, pending retry returns identical IDs, applied inverse returns already_reversed.
- [ ] Add cancellation then fresh preparation with new IDs; terminal failed/conflicted inverse permits revalidation; forced attachment/persistence failure rolls back entire new run. Inject unique-conflict path locally and verify only named index conflict triggers canonical reload, no orphan run or generic internal error.
- [ ] Add serialized Prepare/Cancel orderings: Prepare before Cancel recovers old pending; Cancel before Prepare creates new pending. Recovery must recheck status under lock. These are interleavings, not proof of multi-session locking.
- [ ] Run failing database tests; implement locking/preparation/subtransaction recovery and RPC adapter with strict safe envelope validation. Save uses existing server-only persistence path; arbitrary standard drafts cannot attach lineage.
- [ ] Rerun policy/database tests; inspect rows and source snapshots. Deliverable: transactional Prepare callable only by service, no workspace mutation.

### Task 4 — Guarded inverse Apply and existing Cancel reuse

**Files:** same migration, store.ts, phase4b-database.test.mjs, phase4b-route.test.mjs.

**Interfaces:** apply_agent_inverse_action returns ActionResult; store selects it only when canonical stored undoOf exists. Ordinary dispatch unchanged.

- [ ] Write failing tests for each inverse's delegated RPC outcome, status/completed_at semantics, milestone/project dates/null, block create→cancel, update restoration, cancel→scheduled, inverse-of-inverse.
- [ ] Add prepare→manual unrelated edit→Apply strict conflict; affected edit conflict; exact timestamp precision; lost link/owner, occupied slot after Prepare, past slot after Prepare, forged persisted candidate mismatch and malformed history fail closed. Assert no partial entity writes and source byte-equivalence.
- [ ] Test repeated Apply returns same terminal result without re-execution; cancelled inverse cannot Apply; existing Cancel cancels only inverse; ordinary actions still dispatch to original RPCs. Add test that a guarded Apply called with an unlinked ordinary action rejects rather than becoming a bypass.
- [ ] Run failing tests; implement guard, consistent locks, selected-inverse evaluator mode and narrow dispatch branch. Invoke existing mutation RPC in same transaction, retain exclusion constraints, translate guard failures into canonical outcomes/run completion. Preserve old RPC implementations.
- [ ] Rerun Phase 4B policy/database/route plus Phase 2/3A/3B database tests. Audit potential lock upgrades and trigger/FK interactions; stop on unexplained cycle.

### Task 5 — Identifier-only authenticated Prepare route

**Files:** proposal-schema.ts, undo-route.ts, new POST route, phase4b-route.test.mjs.

**Interfaces:** parseUndoSelection and handlePrepareAgentUndo as file map; response PrepareUndoResult with no-store.

- [ ] Read installed Next.js route-handler guide before writing route code.
- [ ] Add failing route tests: exact `{runId,actionId}` succeeds; extra patch/before/after/user/version/lineage keys, arrays, missing/bad UUID, oversized bodies, cross-site, unauthenticated and owner-B requests rejected. Assert Apply/Cancel retain exact existing shapes.
- [ ] Assert action rate limit and lease acquisition/release on success/error/abort; no Gemini import/call; no raw history response. Fake lost HTTP response after committed Prepare, retry IDs returns same canonical pending batch.
- [ ] Run route tests to show intended failures; implement strict parser, auth/origin/body guards, consume_agent_action_limit, existing private lease try/finally, server-derived user and RPC adapter. Do not extract unrelated route scaffolding.
- [ ] Rerun Phase 4B and existing Phase 4A route/recovery tests. Deliverable: safe Prepare endpoint, no browser-supplied candidate data.

### Task 6 — Activity and approval/recovery presentation

**Files:** AgentActivity.tsx, AgentProposalCards.tsx, phase4b-recovery.test.mjs; data/agentActivity.ts only for established contract refinements.

**Interfaces:** existing cards still send runId/actionIds; Activity POST sends runId/actionId; canonical GET apply recovery remains unchanged.

- [ ] Read installed Next.js client-component guide before edits. Add failing assertions for available/unavailable/unsupported/missing/state-changed/pending/already-reversed states and direct source/reversedBy links.
- [ ] Add recovery cases: pending inverse after reload, lost Prepare response recovered by retry, failed request never implies workspace mutation, Apply/Cancel refresh source+inverse, navigation during pending request cannot show stale batch, double click disabled, long explanation wraps.
- [ ] Run recovery tests to intended failures; implement Prepare and Review undo proposal, clear introduction “Undo proposal” / source timestamp / “Nothing has changed yet.” Keep normal cards and Review again paths. Follow current AbortController/request identity patterns and recover canonical status before enabling approval after an uncertain response.
- [ ] Rerun Phase 4B and Phase 4A UI/recovery tests. No run-level button, bulk operation or automatic Apply. Deliverable: reviewable inverse cards and immutable source history.

### Task 7 — Validation, concurrency evidence and report

**Files:** Phase 4B tests above; new docs/acceptance/phase4b/implementation.md; isolated local evidence only.

- [ ] Run full targeted matrix below and record actual results; skipped database tests do not count as passing SQL coverage.
- [ ] Exercise a local isolated authenticated Supabase/PostgreSQL stack if already available; otherwise use an explicitly isolated fixture browser harness for UI and report live integration unavailable. Never point new-code browser acceptance at production Supabase. Test five widths 1440/1024/768/390/320, Prepare/no mutation, cards, Apply/Cancel, refresh/recovery, links, unavailable reasons and horizontal overflow. Preserve unrelated records; no production acceptance fixtures.
- [ ] Run full suite, TypeScript, changed-file ESLint, build, diff and applied-migration hash comparison. Report unrelated baseline failures separately; fix introduced failures only.
- [ ] Record local concurrency limits and true PostgreSQL rollout gates below. Do not claim Promise.all on one PGlite instance proves concurrent lock behavior.
- [ ] Write the requested 37-point report from the original Phase 4B brief, mapping each claim to evidence and remaining gaps. No commit/push/deploy or production migration. Stop for owner review.

## Test matrix

| Cases / assertions | Primary task / test file | Required evidence |
|---|---|---|
| Six task fields, multi-field, null vs missing, no-op, completion rules | 1/4 policy + database | Exact inverse keys and actual delegated entity values |
| Unrelated pre-Prepare edits allowed; affected edits blocked; any post-Prepare edit stale | 1/3/4 database | Current version captured, strict later conflict |
| Milestone UUID vs display labels; date/null and timezone precision | 1 policy | Raw canonical UUID restored; normalized dates/instants |
| Truncation, missing after/before, malformed diff, unknown/create_task | 1 policy | Unavailable, zero draft rows |
| Entity/project/milestone/task link loss or foreign owner | 1/4 database | Fail closed; no information leak/write |
| Created block cancellation; updated block restoration; cancelled restoration | 1/4 database | Existing block RPC reused, notes preserved, deadlines unchanged |
| Occupied/past/expired slots, completed→scheduled, coupled range/link edits | 1/4 database | Both preparation and Apply validation; exclusion violation conflict |
| Direct lineage/inverse-of-inverse, immutable source, same-owner FK | 2/3/4 database | Exact source-row snapshots and relational constraints |
| Duplicate Prepare, unique loser, lost response, cancellation/fresh Prepare | 3/5 database + route | At most one live inverse, canonical IDs recovered |
| Prepare vs Cancel; inverse Apply vs manual edit; repeated Apply | 3/4 database + later PostgreSQL | Serial interleavings locally; real session contention separately |
| Service-only grants, empty search_path, denied browser table access | 2 database | Role-switch execution + catalog assertions |
| Strict identifiers, ownership, rate/lease/error/abort, no Gemini | 5 route | Mock handler invocation and response projection |
| Activity states, pending/reversed refs, standard cards, uncertain response | 6 recovery | Integration/state tests plus browser observation |
| Five widths and navigation/request race | 6/7 browser | Screenshots/overflow measurement and actual UI interaction |
| Phase 4A/3B/3A/2/1, private/Public AI, Calendar/Focus, Drive/GitHub | 7 full suite | Existing relevant tests, limitations explicitly recorded |

### Concurrency evidence split

**Disposable single-engine PGlite:** run real constraints, grants, save/apply rollback, duplicate index insertion, persisted state transitions, both serial orderings of races and idempotency. Use btree_gist exactly as Phase 3B tests. No replacement overlap SELECT, fake exclusion or source-lock mock can count as invariant proof.

**True PostgreSQL with independent connections (required before rollout readiness):** use an authorized disposable local/staging database and existing available driver/psql, never production and never add a dependency silently. Execute the real migration chain, use explicit transaction barriers and bounded lock_timeout/statement_timeout:

1. Two Prepare sessions contend on same source: second demonstrably waits, then recovers identical pending IDs; exactly one live inverse/run survives.
2. Prepare holds source then waits for inverse while Cancel holds inverse: Cancel completes without waiting for source; Prepare returns fresh canonical status or creates a new inverse after cancellation.
3. Guard holds source/inverse/context; manual target edit waits, then writes after Apply, or manual edit commits first and guard conflicts. No lost update.
4. Two Apply sessions on same inverse: second returns first's persisted terminal outcome.
5. Concurrent overlapping block insert vs restoration: exclusion accepts only one, loser conflicts atomically.
6. Link/parent edits/deletes concurrent with inverse Apply: ownership/link checks remain stable or fail/retry safely; test project/task/milestone FK locks for cycles.

Record connection/session IDs, barrier order, waits, SQLSTATE and final counts without credentials. If unavailable during implementation, report these checks **unverified** and release readiness blocked pending rollout verification. If a tested invariant fails, stop implementation integration and report blocker; do not weaken it or claim readiness.

## Validation commands (during execution, not planning)

Run from repository root in PowerShell. Locate PGlite first, using the already available module path if it still exists:

```powershell
$env:AGENT_TEST_PGLITE_MODULE = 'C:/Users/Franz/.codex/visualizations/2026/10/04/01a1069b-4375-7fe2-a9b9-4435879efc5e/sql-runtime/node_modules/@electric-sql/pglite/dist/index.js'
Test-Path $env:AGENT_TEST_PGLITE_MODULE
$phase4bTests = @(rg --files lib/ai/agent -g 'phase4b*.test.mjs')
node --test @phase4bTests
$agentTests = @(rg --files lib/ai/agent -g '*.test.mjs')
node --test @agentTests
npm run test:ai
npm run test:public-ai
npm run test:calendar
npm run test:focus-session
$allTests = @(rg --files -g '*.test.mjs' -g '!node_modules' -g '!marketing')
node --test @allTests
npx tsc --noEmit
npx eslint lib/ai/agent/undo.ts lib/ai/agent/undo-route.ts lib/ai/agent/proposal-schema.ts lib/ai/agent/store.ts lib/ai/agent/contract.ts lib/ai/agent/activity.ts data/agentActivity.ts components/ai/AgentActivity.tsx components/ai/AgentProposalCards.tsx app/api/ai/agent/activity/undo-proposal/route.ts
npm run build
git diff --check
git diff --stat
git status --short
```

Include each new test file in ESLint if covered by repository config. For untracked new files, additionally run `git diff --no-index --check -- NUL <file>` individually (exit 1 can mean content differs; inspect whitespace diagnostics). Hash the four applied Agent migrations before and after with Get-FileHash and compare; do not stage files to inspect them. Tests can be run individually in their task before broad gates. Full-suite baseline previously had two optional portfolio CMS skips; record fresh actual totals, not inherited numbers.

## Rollout prerequisites

- Owner reviews this plan, then separately authorizes implementation; this document does not authorize execution or external side effects.
- All local acceptance results and migration privilege/diff review available; applied files unchanged; no source rewrite/backfill.
- True multi-connection PostgreSQL cases above verified in an authorized disposable environment before asserting concurrency readiness.
- Separate owner authorization for production migration/release/deployment and production acceptance. Apply additive migration before code using new RPCs; keep feature code unreleased until schema exists.
- Confirm service-role configuration privately, backup/recovery procedure and deployment order. Roll back code first if needed; do not drop lineage or rewrite genuine audit rows as a rollback shortcut.
- Hosted safe-projection inspection is a separate rollout check; Phase 4A's previously unverified hosted API inspection is not silently marked passed.

## Explicit stop conditions

1. Approval absent: no implementation, migration file creation or application edits.
2. Historical value cannot be reconstructed safely: mark that action unavailable; do not guess or partially reverse.
3. Required invariant needs weaker stale/owner/link/exclusion controls or an old migration edit: stop and report design blocker.
4. Lock-order cycle, unsafe link-discovery retry, unhandled uniqueness loser or orphan-run possibility: stop integration until resolved within this design.
5. Real multi-session behavior unverified: disclose release gate; no concurrency-readiness claim. A failing concurrent invariant is a blocker, not a test skip.
6. PGlite cannot execute actual btree_gist/SQL: use an authorized disposable PostgreSQL instance or report SQL validation blocked; no test-only weakening.
7. Validation would require production mutation, secret exposure, new infrastructure/dependency, commit/push/deploy: stop for explicit authorization.
8. Unexpected task-delete, redo, bulk, new Gemini or other scope requirement: report separately, do not implement.

## Planning self-review

Checked approved-spec coverage, interface consistency, test-first steps, direct lineage, duplicate recovery, missing/null, truncation, strict Apply, transaction rollback, private projection and requested exclusions. One migration and one shared policy are retained. Planning created only this document; no application code or migration was created or edited. Execution method and implementation remain subject to owner review.
