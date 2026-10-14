# Workspace Agent Phase 5C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task after explicit implementation authorization. Steps use checkbox syntax for tracking. This request authorizes PLANNING ONLY.

**Goal:** Add safe user-owned Plan creation and record updates to the existing Workspace Agent approval system.

**Architecture:** Extend existing read/proposal contracts, canonical persistence, service-only SQL Apply, shared SQL Undo evaluator and Activity/UI. Plan ownership is direct through plans.user_id; Plan mutations have no project parent. One new Plan mutation must be the sole mutation in its run.

**Tech Stack:** Existing Next.js, TypeScript, React, Supabase/PostgreSQL, Node test runner and disposable PGlite; no new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-workspace-agent-phase5c-design.md`, approved with the user's subsequent locked refinements.

## Global constraints and revalidation

- Baseline HEAD remains `7efc8b8962d4ad784068d2196d7acac420e19cf4`; tracked application working tree was clean during planning.
- Re-read AGENTS.md/RTK.md, approved spec and this plan before execution; create/reuse authorized isolated checkout at execution time. Do not discard unrelated acceptance artifacts.
- Planning rechecked migration DDL/RLS/triggers, planService, UI, get_plan, Agent types/collector/store, latest SQL save/Undo/Activity and gemini-transport. No repository drift from the approved inspection was found.
- Latest migration is `20261013090001_workspace_agent_milestones.sql`; no migration or application file is created/changed in this planning task.
- Title/timeframe maximum 180 Unicode code points; description maximum 4000. No silent canonical truncation. JS code-point counting must agree with PostgreSQL char_length; do not alter legacy validation semantics globally.
- Status exactly Planning/Active/Paused/Completed/Cancelled; omitted create status is Planning, matching browser/database defaults. description is consistently named description in new contracts/history/diffs; never goal/deadline aliases in mutation inputs.
- **Latest instruction overrides one spec normalization:** timeframe strings are trimmed, and a trimmed empty string stays `""`, matching browser service empty-string storage. Null remains null. Omitted create timeframe defaults null. The spec's earlier blank-to-null sentence is superseded; do not change browser services or silently conflate these values.
- Description is NOT NULL in schema: reject explicit null, allow ''. Preserve meaningful whitespace/content. Null clears only timeframe/targetDate.
- updated_at is the existing optimistic guard, not a logical revision counter. Preserve accepted transaction-start timestamp limitations.
- No item writes, Plan deletion, bulk edits, bundles, autonomy, additional Gemini tools beyond the two approved proposal tools, new infrastructure/dependencies, commits, pushes, deployment or Production mutation without later authorization.
- No Gemini for eligibility/Prepare/Apply/Cancel/recovery. Preserve exact identifier-only route contracts and all legacy actions.
- Retain Phase 5B.1 HTTP/network retry classification, three attempts, backoffs, strict 10,000ms minimum next-call gate, 50-second Agent deadline, 60-second maxDuration, logging and error mappings.

## Review focus

1. Empty timeframe versus null versus omitted: Task 2/3 must preserve three distinct meanings, including historical inverse values.
2. Astral characters and whitespace: Task 1/2/3 must agree on code-point boundaries and trim rules without changing old task/milestone validators.
3. False precision from JS Date: Task 3/5 must retain PostgreSQL microsecond version text; no toISOString round-trip in production guards.
4. Legacy unbounded data: Task 2/5 must reject incomplete/invalid affected history while permitting unrelated fields to survive unchanged.
5. Missing Plan after lost Apply response: Task 3/6 must recover terminal audit association without recreating the deleted entity.

## File map and stable interfaces

Existing files to modify only where tasks below require: `lib/ai/agent/contract.ts`, `tools.ts`, `registry.ts`, `proposal-schema.ts`, `proposals.ts`, `prompt.ts`, `schedule-summary.ts`, `store.ts`, `activity.ts`; `data/agentActivity.ts`, `data/agentProposalReview.ts`; `components/ai/AgentProposalCards.tsx`, `WorkspaceAiChat.tsx`; `app/app/page.tsx`; exact tool inventory expectations in `lib/ai/agent/phase2.test.mjs`.

New tests/fixtures: `lib/ai/agent/phase5c.test.mjs`, `phase5c-fixture.mjs`, `phase5c-database.test.mjs`, `phase5c-policy.test.mjs`, `phase5c-route.test.mjs`, `phase5c-recovery.test.mjs`. New SQL: exactly one `_workspace_agent_plans.sql` migration, allocated only during implementation. No product module split is required.

Contract additions in contract.ts:

- `PlanChanges = {title?:string;description?:string;timeframe?:string|null;status?:PlanStatus;targetDate?:string|null}` using the existing types.ts PlanStatus.
- `PlanCreatePayload = {title:string;description:string;timeframe:string|null;status:PlanStatus;targetDate:string|null}`.
- `PlanProposalInput = {planAction:'create';title:string;description?:string;timeframe?:string|null;status?:PlanStatus;targetDate?:string|null} | {planAction:'update';planId:string;changes:PlanChanges}`.
- Discriminated ProposalDraft variants create_plan/update_plan, typed payload/before; shared diff vocabulary adds timeframe. Plan envelopes have taskId/projectId null. Do not add Plan status values to task validators.
- Existing `parseProposalTool(name:string,value:unknown):ProposalInput`, `collectProposal(name:string,input:unknown,context:ToolContext,drafts:ProposalDraft[])`, `executeReadTool`, store and route signatures remain. A private `planChanges(value:unknown):PlanChanges` belongs beside milestoneChanges in proposal-schema.ts. Use local character-aware helpers there/tools.ts, not a new general utility hierarchy.

## Task 1 — Fixtures and existing get_plan extension

**Files:** modify contract.ts, tools.ts, registry.ts; create phase5c.test.mjs and phase5c-fixture.mjs. Read existing agent.test.mjs and phase5b-fixture.mjs; do not rewrite old fixture behavior.

**Interfaces:** existing executeReadTool('get_plan',{planId},context) returns safe bounded record. New fixture export `fixture(t,{includePhase5c=true}={})` composes phase5b fixture, installs exact Plan/item baseline DDL, owns_plan, RLS, grants, indexes and update triggers extracted from applied migrations, then applies the single new Plan migration when requested. Return existing fixture fields plus plan/foreignPlan/item UUIDs. Add a full-precision version query helper for tests; do not serialize updated_at via JS milliseconds.

- [ ] RED: `get_plan_owned_projects_all_record_fields`, `get_plan_missing_and_foreign_are_forbidden`, `get_plan_keeps_bounded_checklist_read`, `get_plan_unicode_bounds_and_null_date`. Assert exact owner filter; no version/user_id/link metadata; 20 of 21 labels, labels <=160; supplementary characters at 180/4000 retained; flags true only beyond bound; no write calls.
- [ ] Run `node --test --test-name-pattern="get_plan_" lib/ai/agent/phase5c.test.mjs`; expect new fields/flags assertions to fail against baseline, not loader failures.
- [ ] Add Plan contract types; extend only existing get_plan branch, selecting timeframe plus existing description. Exact returned keys: id,title,status,targetDate,description,timeframe,titleTruncated,descriptionTruncated,timeframeTruncated,goal,goalTruncated,checklist,checklistTruncated. description <=4000, timeframe <=180 or null, goal <=1000 legacy alias; title <=180, canonical nullable date. Truncation is projection only; do not return raw updated_at/user_id. Keep list_plans unchanged.
- [ ] Update registry description only as needed; keep strict required planId and extra-key rejection through existing parser. Build the fixture from authoritative DDL rather than inventing Plan check constraints. Missing future migration must fail explicitly when includePhase5c=true, never silently skip it.
- [ ] Re-run focused read tests and existing `node --test lib/ai/agent/agent.test.mjs`; PASS. Fixture-only baseline tests run with includePhase5c=false. No application write behavior enabled by this slice.

## Task 2 — Proposal contracts, canonicalization and one-action rule

**Files:** modify proposal-schema.ts, proposals.ts, prompt.ts, schedule-summary.ts and phase2.test.mjs; extend phase5c.test.mjs. Consume Task 1 types.

**Interfaces:** propose_create_plan accepts only title/description/timeframe/status/targetDate; propose_update_plan accepts exactly planId/changes. Both schemas additionalProperties=false; update changes minProperties=1. Parsed output is PlanProposalInput; collector produces canonical ProposalDraft, never writes Plans.

- [ ] RED tests named `plan_create_defaults_match_browser`, `plan_optional_fields_and_null_semantics`, `plan_unicode_boundaries`, `plan_update_exact_affected_history`, `plan_update_noop_rejected`, `plan_legacy_affected_history_fails_closed`, `plan_one_action_in_both_orders`, `plan_repeated_patch_coalesces`, `plan_reads_and_collectors_never_write`. Table assertions cover each field, grouped fields, all five statuses, invalid leap dates, types, ownership injection, items/initialItems/goal/deadline and unknown keys; 180 versus 181 and 4000 versus 4001 Unicode characters.
- [ ] Assert concrete distinctions: parse timeframe `'  '` yields ''; null yields null; missing update yields no key. Description `'  keep\n'` is preserved; description:null rejected. Status omitted materializes Planning. Title `'  Plan  '` becomes Plan; blank/null rejected. Date null clears; missing preserves.
- [ ] Run `node --test lib/ai/agent/phase5c.test.mjs`; expect new proposal support assertions to fail.
- [ ] Implement planChanges and two schema definitions. Use Array.from/string iteration for code points; reject unpaired surrogate/NUL inputs that PostgreSQL JSON/text cannot round-trip. Match JS trim whitespace exactly in SQL canonical validation later; document the explicit whitespace set in tests.
  The trim set is ECMAScript whitespace/line terminators: U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028–2029, U+202F, U+205F, U+3000, U+FEFF. U+0085 and U+200B are not trim characters. SQL must check canonical title/timeframe against that same set, not PostgreSQL default btrim alone. Add NBSP/BOM/tab and U+200B parity assertions; description remains untrimmed.
- [ ] Extend collector before generic legacy branches. Read owned complete plans row including updated_at; use full affected values for before/diff, exact version string, canonical five-field create defaults. Update only changed keys; reject final no-op. If an affected old title/timeframe would be normalized differently on reversal, reject whole action rather than save irreversible history. Unaffected invalid/overlong legacy fields remain untouched. Safe envelope title is projection only.
- [ ] Enforce a Plan mutation as sole draft in both orderings, including legacy milestone/time proposals. Repeated same-Plan updates merge into one patch against the original before/version; re-check combined no-op and history. Reject different Plan, repeated create or mixed kinds. Reads remain allowed. Preserve legacy milestone-only rule and scheduling budgets.
- [ ] Extend prompt and deterministic summary explicitly for Plan records; preserve unsupported checklist/deletion behavior. Update only exact new-tool inventory expectations in phase2.test.mjs.
- [ ] Run phase5c.test.mjs, phase2.test.mjs and phase5b.test.mjs; PASS. Assert every old task/milestone status validator remains unchanged.

## Task 3 — One additive migration: persistence and atomic Plan execution

**Files:** create the one migration; create phase5c-database.test.mjs, extend phase5c-fixture.mjs. No applied SQL file edits.

**Provisional filename:** `20261014113000_workspace_agent_plans.sql`, version `20261014113000`. Planning clock was 2026-10-14 11:29:52 UTC; this is a candidate, not allocated history. At implementation generate using current UTC/CLI and confirm strictly later than every existing local/remote version; use a different later filename if needed, then use that exact filename everywhere. Never create an earlier empty placeholder.

**SQL interfaces:**

| Object | Signature / purpose |
| --- | --- |
| validator | private.agent_plan_patch_valid(jsonb,boolean) RETURNS boolean; total false for invalid canonical shape |
| patch primitive | private.agent_apply_plan_patch(uuid,uuid,jsonb,timestamptz) RETURNS boolean; true on one guarded UPDATE, false stale, safe forbidden/invalid exceptions |
| public Apply | public.apply_agent_plan_action(uuid,uuid,uuid) RETURNS jsonb; existing ActionResult keys id/status/entityId/errorCode |
| save | replace public.save_agent_proposal_batch(uuid,jsonb), retaining signature and all legacy branches |
| constraints/index | Plan-aware existing action checks; agent_actions_one_plan_target_idx on (run_id,entity_id) WHERE action_type='update_plan' |

Keep the approved boolean primitive convention. After successful helper mutation the owner RPC obtains the canonical resulting Plan row internally in the same transaction; response exposes only existing safe entity association, never raw version/internal row. This satisfies canonical-result handling without changing shared response contracts or inventing a parallel primitive.

- [ ] Before SQL creation, hash every existing migration (SHA256 manifest outside product source), enumerate nonempty unique versions and reconcile histories read-only when available. Stop on ambiguity, earlier empty migration, unexpected remote-only/local-only history or an existing file with candidate version. Capture duplicate update_plan targets before index creation. Never repair history or use include-all.
- [ ] RED database tests: `plan_fixture_matches_schema`, `plan_payload_validator_exact`, `plan_canonical_whitespace_unicode_parity`, `plan_save_validates_owner_history_diff`, `plan_save_rejects_mixed_batches`, `plan_create_apply_once_and_recovery`, `plan_update_guarded_patch`, `plan_cancel_no_mutation`, `plan_apply_atomic_failure`, `plan_rpc_and_helpers_grants`, `plan_old_schema_actions_still_apply`.
- [ ] Baseline assertions must confirm Plan schema has no status/title check, description NOT NULL, timeframe nullable, exact RLS/trigger/FKs. Test statement-time microseconds by selecting updated_at::text and using that exact text as expected version. Assert fake ownership/foreign Plan, incomplete before/diff, unknown kind, forged project/task IDs and no-op payloads rejected. Run focused test file; expect missing new validator/RPC support, not runtime setup failures.
- [ ] Create only the new migration via normal CLI workflow after ordering check. Validator checks canonical five keys, exact JSON types/code-point limits, canonical whitespace (title/timeframe), real date round-trip and statuses. Create mode requires all five keys; update requires 1..5. Null accepted only timeframe/date. Validator never silently trims or truncates stored audit. Preserve NULL versus missing checks with key existence.
- [ ] Replace action_type check with eleven kinds (nine legacy plus two Plan kinds). project_id may be null for Plans; require it NULL for Plan kinds. Create Plan expected version null; entity_id null except terminal applied association. Update Plan entity/version required. Do not add nonexistent task_id audit column: taskId is the batch projection field; Plan taskId must be null. Keep existing task/milestone/block constraints and inverse guards intact.
- [ ] Extend save: exact single mutation if any Plan action exists; derived owner; null project/task envelope; complete canonical create; owned/version-matched update with exact affected before values and matching one-diff-per-key. Reject unexpected ordinary-save lineage. Keep private.agent_batch/get_agent_proposal_batch signatures; generic entity_id projection already fits Plans. Save creates audit run/actions only, never Plan rows.
- [ ] Implement Apply: owner-scoped canonical action FOR UPDATE first; terminal action returns existing entityId/status before checking target existence. Pending create inserts exactly one Plan using server user_id/default canonical fields, then atomically associates entity_id and marks applied. No project/profile/list append lock: Plans have no sort order; per-action row lock serializes retries. Two distinct approved create actions may legitimately create equal titles.
- [ ] For pending update, revalidate kind/payload; helper locks owned Plan FOR UPDATE, compares exact timestamptz, requires actual changed fields, updates only present keys. No COALESCE-based null clearing. Caller reads canonical result internally and atomically records status/execution/run completion. Use mutation exception subtransaction so no failed partial write survives. Stale => conflict/STALE_ENTITY; foreign/deleted => safe FORBIDDEN; malformed => INVALID_INPUT; unclassified save => PLAN_SAVE_FAILED. Lost response remains recoverable by existing load/status route, never resubmit a fresh create action automatically.
- [ ] Security-definer only on public RPC; search_path='' and qualified references throughout. Revoke new helper execution from PUBLIC/anon/authenticated/service_role. Grant only new public RPC to service_role; reaffirm replaced service-only function grants. Keep manual RLS/table grants and authenticated owns_plan predicate intact.
- [ ] Apply migration only to disposable fixture; focused database tests PASS. Recheck original migration hashes unchanged and exactly one new nonempty SQL file. Full Undo/Activity portions are added to this same unpublished migration in Task 5/6; no partial migration release.

## Task 4 — Canonical persistence, routing and recovery

**Files:** modify store.ts; create phase5c-route.test.mjs. Read action-route.ts, undo-route.ts, undo.ts and actual app/api/ai/agent routes; preserve their request contracts.

**Interfaces:** existing saveProposalBatch/loadProposalBatch/applySelectedActions/cancelSelectedActions. Add create_plan/update_plan map to apply_agent_plan_action; undoOf continues to route only through apply_agent_inverse_action.

- [ ] RED `plan_dispatch_uses_identifiers_only`, `plan_unknown_kind_never_calls_legacy_rpc`, `plan_apply_cancel_prepare_contracts`, `plan_lost_response_reloads_canonical_batch`, `plan_terminal_create_missing_entity_stays_terminal`. Assert exact RPC arguments p_user_id/p_run_id/p_action_id, no browser payload/version, and no Gemini import/call in write/recovery paths.
- [ ] Run `node --test lib/ai/agent/phase5c-route.test.mjs`; expect missing Plan forward map failures.
- [ ] Add two explicit routes only; leave unknown-kind rejection intact. Preserve pending RETRY_STATUS behavior on ambiguous transport result; canonical recovery returns applied entity association. No new endpoint or action retries around tool execution/persistence. No route file edit unless concrete tests prove one necessary; stop before contract changes.
- [ ] Run new route tests and phase5b-route.test.mjs; PASS. Repeated create after deletion must return historical applied entityId, not recreate Plan.

## Task 5 — Shared SQL Safe Undo and lock discipline

**Files:** extend same unpublished migration; create phase5c-policy.test.mjs. Existing undo.ts/undo-route.ts should remain projection-only and unchanged unless test-proven type support requires a narrow edit.

**Interfaces:** existing agent_undo_evaluate(uuid,uuid,uuid,timestamptz,uuid), agent_undo_lock_context(uuid,uuid), prepare_agent_undo(uuid,uuid,uuid), apply_agent_inverse_action(uuid,uuid,uuid). New update_plan branch only; no second evaluator.

- [ ] RED tests `plan_create_undo_unsupported_even_empty`, `plan_undo_each_field_and_group`, `plan_prepare_preserves_unrelated_edits`, `plan_prepare_affected_change_blocks_all`, `plan_prepare_never_mutates_plan`, `plan_cancel_inverse_then_prepare_fresh`, `plan_inverse_of_inverse_direct_lineage`, `plan_stale_inverse_conflicts`, `plan_history_incomplete_fails_closed`, `plan_exact_bounds_not_truncated`, `plan_source_audit_immutable`, `plan_owner_fk_self_and_live_inverse_guards`.
- [ ] Assert raw source snapshots before/after (payload/history/diff/version/status unchanged); no version values exposed in Activity; before keys distinguish missing/null/''; all affected fields reversed together. Inject oversized/invalid/partial history in disposable privileged fixture only and require HISTORY_INCOMPLETE. Item edits must not block Plan-only Prepare or be reversed.
- [ ] Run focused policy tests; expect unsupported update_plan failures.
- [ ] Extend evaluator owner-read current Plan, exact affected-field after equality and valid before/payload/diff; Plan-specific validation avoids legacy >=bound truncation heuristics. Inverse is update_plan with current canonical updated_at and null project/task context. Extend context locker with direct owned Plan FOR UPDATE branch before legacy project discovery.
- [ ] Extend inverse Apply explicit update_plan dispatch before task fallback. Retain source-lock-first, inverse-lock-second, target-lock-third; evaluator and strict inverse version revalidated under locks. Preserve direct same-owner lineage and existing partial unique live inverse index. Keep Prepare uniqueness-loser subtransaction rollback and canonical reload. create_plan remains unsupported with no item-count special case. No Plan deletion function.
- [ ] Run policy/database/route tests and existing Phase 4B/5B policy suites through full Agent glob; PASS. All new code remains in one unshipped migration, not a second incremental file.

## Task 6 — Safe Activity, proposal cards, navigation and refresh

**Files:** same migration private.agent_activity_run; lib/ai/agent/activity.ts; data/agentActivity.ts; data/agentProposalReview.ts; components/ai/AgentProposalCards.tsx; WorkspaceAiChat.tsx if labels require it; app/app/page.tsx. Create phase5c-recovery.test.mjs. Read installed Next.js guidance before any Next-specific code edits.

**Interfaces:** ActivityTarget adds `{type:'plan',id:string}` through existing union. Existing actionLabel/getAgentRun/proposal cards/Review Again/onAgentApplied remain public interfaces. Existing app callback must setPlans(remote.plans).

- [ ] RED tests `plan_cards_show_only_affected_fields`, `plan_activity_safe_bounded_projection`, `plan_unknown_kind_display_safe`, `plan_deleted_target_and_terminal_recovery`, `plan_review_again_preserves_identity`, `plan_refresh_includes_plans`, `plan_ui_null_and_empty_timeframe_distinct`. Follow phase5b-recovery component/TS loader patterns; test actual callback behavior where feasible, not just presence of a string.
- [ ] Assert create/update headings, no project requirement/label, safe title <=180 code points, diff allowlist plus timeframe, maximum existing 12 diffs and 4000 characters per value, eligibility explanation <=240 and inverseSummary <=180. Inject raw payload/before_state/prompts/reasoning/version/credentials into test input and assert absent from Activity output. Unknown kind is Historical action/unsupported and never clickable as task.
- [ ] Run new recovery test; expect absent Plan UI/navigation/refresh assertions to fail.
- [ ] Add SQL/TS timeframe whitelist and PLAN_SAVE_FAILED safe message; explicit owner-scoped Plan resolution to existing Plans/editor. Add Plan Review Again prompt and labels. Cards render null timeframe distinctly from empty timeframe where needed, avoiding hidden value conversion; date null is Unscheduled. Add Plan entity labels only if current UI uses them.
- [ ] Refresh successful Apply with setPlans(remote.plans), reusing loadWorkspaceData/mapPlanRow; no new full reload, item persistence, manual CRUD rewrite or editor timeframe feature. Existing items stay in returned read model. Unknown-kind handling remains safe in both SQL projection and TS dispatch.
- [ ] Run phase5c-recovery.test.mjs, phase5b-recovery.test.mjs and workspace shell tests; PASS. Later local browser check at 320/390/768/1024/1440 verifies controls, labels, Activity/history recovery and absence of overflow. Record browser checks as blocked/unrun if no authenticated disposable local environment; do not use Production fixtures to fill the gap.

## Task 7 — Full disposable validation and candidate integrity

**Files:** only existing/new Phase 5C tests and migration for proven fixes; optional local implementation report after authorization, no additional product scope.

- [ ] RED cross-layer cases: user-owner spoofing, forged null/project context, both mixed-action call orders, malformed history/nulls, old app legacy RPCs after new migration, failed Plan mutation atomicity, source audit preservation after entity deletion, schema/helper browser denial. Add executable assertions to the responsible phase5c test file before fixes.
- [ ] Run every focused test file, then entire Agent suite using the already configured AGENT_TEST_PGLITE_MODULE. Locate existing disposable runtime from previous Phase 5B setup; do not install a dependency or silently skip tests if absent.
- [ ] Fresh final commands, exact counts and exit codes: `node --test lib/ai/agent/phase5c*.test.mjs`; `node --test lib/ai/agent/*.test.mjs`; `npm run test:ai`; `npm run test:public-ai`; `npm run test:workspace-shell`; `node --test lib/ai/agent/gemini-retry.test.mjs`; `npx tsc --noEmit`; `npx eslint` with exact changed TS/TSX/MJS paths; `npm run build`; `git diff --check`. If PowerShell/Node does not expand a glob, enumerate matching files and pass their paths, excluding fixture-only modules from the focused test list.
- [ ] Re-run only affected gates after repairs; final reported counts must be from fresh current code. No claimed browser verification without execution. Preserve GEMINI_MODEL, credentials, environments, Supabase Auth and deployment configuration.
- [ ] Compare migration SHA manifest, baseline diff, old public signatures/grants, all nine legacy dispatch paths and inverse FK/index guards. Confirm exactly one new migration, no packages/lockfile/env changes and no task/item/project/block side effects. Record retained timestamp limitation and any local browser/runtime availability gap.

## Task 8 — True PostgreSQL concurrency review design (separate execution gate)

**Planned harness:** `.superpowers/sdd/2026-10-14-workspace-agent-phase5c-plan/postgres-concurrency.mjs` with ignored results; adapt existing `.superpowers/sdd/2026-10-13-workspace-agent-phase5b-plan/postgres-rollout.mjs` only after inspecting it. No product dependency or Production access. This task prepares/reviews the harness and expected outcomes; the user's rollout boundary reserves actual concurrency execution for separate authorization. Do not start/install a server during Phase 5C implementation solely because this plan lists the cases.

- [ ] RED harness self-check: fail if both sessions have the same pg_backend_pid, isolation is not the intended READ COMMITTED, connection points outside isolated local/disposable target, lock barriers are unobserved, migration hashes differ, or any race is skipped. Use independent clients and explicit lock/wait barriers, not wall-clock sleeps as ordering proof.
- [ ] Define assertions below before any later authorized execution. Record both PIDs, operation ordering/lock waits, SQLSTATE, row counts, exact versions, action statuses, source snapshots and orphan run count. Lock/statement timeouts are test failures, never expected race outcomes.
- [ ] Review true-PG fixture against real Plan DDL/RLS/triggers/grants and complete Agent migration chain. Use existing runtime only if available and separately authorized; stop for approval before new infrastructure/dependencies. Mark these cases NOT RUN until they actually execute.

| Case | Guaranteed ordering / expected result |
| --- | --- |
| A same create Apply | First locks action; second waits. Both recover same applied entityId; exactly one Plan insertion and audit transition |
| B same update Apply | Action serialization; one guarded UPDATE; both return same terminal result, no second timestamp/write |
| C manual first | Manual locks/commits Plan before Agent acquires target; changed updated_at causes STALE_ENTITY, manual value survives |
| D Agent first | Agent locks/updates Plan; manual waits then writes afterward; applied audit retained, later manual value legitimately wins |
| E deletion both orders | Delete-first => safe unavailable failure, no recreation; Agent-first => update applied, later deletion removes Plan/items, immutable audit remains |
| F duplicate Prepare | Source lock serializes; both recover one canonical pending inverse run/action; one live inverse and no orphan loser run |
| G inverse/manual both orders | Manual-first after Prepare => inverse stale conflict; inverse-first => inverse applied, later manual edit survives |
| H repeated inverse Apply | Source then inverse then Plan; one inverse mutation, second returns same terminal result; no duplicate lineage |
| I Prepare/Cancel | Cancel existing inverse first => fresh inverse allowed; Prepare first => returns existing pending inverse which Cancel may subsequently cancel. At most one live inverse, no workspace mutation |
| J original update/inverse | Prepare before source Apply completes waits for source and reevaluates committed status; valid source then yields one pending inverse. Repeated original Apply racing inverse Apply returns original terminal result, never overwrites inverse result; source history unchanged |

These PostgreSQL scenarios are future proof obligations. Serial PGlite simulations remain labelled serial; no rollout concurrency readiness assertion until actual multi-connection results pass.

## Lock-order reference and migration/security checklist

Forward Apply: action -> owned Plan -> own run completion. Create uses action -> insert Plan -> run completion, no append/project locks. Prepare: source action -> existing inverse action if present -> owned Plan -> insert newly owned inverse run/action. Inverse Apply: discover source ID without lock -> source -> inverse -> Plan -> inverse run completion. Cancel: selected action UPDATE -> own run completion; it never later requests source/Plan. Manual CRUD: Plan only. Checklist children are not touched or locked by Plan Agent writes. Preserve legacy lock order unchanged.

New migration also extends agent_undo_evaluate/context/apply_agent_inverse_action and private.agent_activity_run; these additions are completed in Tasks 5/6 within the SAME file. Preserve signatures of prepare/eligibility/activity/page/batch and generic Cancel. New public Apply service_role only; new private helpers deny direct browser/service execution. Existing owns_plan authenticated access remains. No new same-owner Plan FK or duplicate live-inverse index is needed; existing audit lineage guards remain authoritative.

Before later rollout: migration review; real PostgreSQL concurrency execution; Production read-only history/schema/function/grant/duplicate preflight; separately authorized exact migration application; old Production app health; reviewed commit/push; exact-SHA Preview acceptance; separately authorized Production release. No step here authorizes those operations. Do not run supabase db push, history repair, direct Production SQL writes or any deployment command during planning/implementation.

## Explicit stop conditions and handoff

Stop on repository/schema/history drift; unexpected old migration modifications; ambiguous version ordering; project ownership assumptions for Plans; incomplete affected history; unknown-kind legacy fallback; noncanonical whitespace or Unicode disagreement; inability to preserve version precision; failed required stale/lock cases; duplicate/orphan inverse; mixed-action bypass; browser helper/audit exposure; item mutation; new dependencies/infrastructure requirement. Do not weaken invariants or fix unrelated features.

Planning self-review must verify all spec requirements map to Tasks 1–8, interface names agree, timeframe supersession is explicit, boolean primitive/canonical-result handling is consistent, and true concurrency remains a separate gate. No executable tests are run during planning.

Implementation may begin only after the user approves this plan and authorizes its execution method. Recommend native executing-plans for the tightly coupled migration/evaluator/UI sequence; user may choose subagent-driven execution. No commits are included in task steps because current authorization forbids them. Stop after plan review; do not implement now.
