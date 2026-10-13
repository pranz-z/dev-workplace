# Workspace Agent Phase 5B Milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owned milestone detail reads, explicit creation/update proposals, and safe update Undo while preserving legacy milestone rescheduling.

**Architecture:** Gemini supplies intent only. The server loads canonical state, persists a pending action, and executes a deterministic service-only RPC after explicit Apply. New milestone updates and legacy date updates share one private write primitive; the existing SQL Undo evaluator remains the only inverse policy.

**Tech Stack:** Installed Next.js 16.3.6, React 19.2.8, TypeScript, Supabase/PostgreSQL, Node test runner, existing disposable PGlite runtime, and existing Playwright installation.

**Spec:** `docs/superpowers/specs/2026-10-13-workspace-agent-phase5-design.md`, restricted by the approved Phase 5B planning request to milestones.

## Global Constraints

- This document is planning only. Implementation requires separate approval.
- During implementation: no Production mutation/migration, commit, push, deployment, or external settings change without separate authorization.
- Implement only `get_milestone`, `create_milestone`, and `update_milestone`; preserve `reschedule_milestone`.
- No Plans/items, deletion, reorder, bulk actions, autonomous execution, new credentials, dependencies, or infrastructure.
- New milestone proposals occupy exactly one action in a run. Existing legacy runs retain the existing maximum of 10; do not globally reduce their limit.
- Title: trimmed, nonblank, maximum 180; description: maximum 4000, empty string clears; status: `pending | active | completed`; targetDate: valid `YYYY-MM-DD | null`.
- Creation defaults: status `pending`, description `""`, targetDate `null`. Do not accept status/order/identity/version from the creation tool.
- Apply/Cancel accepts exactly `{runId, actionIds}`; Prepare Undo exactly `{runId, actionId}`. Recovery remains identifier-based and Gemini-free.
- Never send Gemini owner IDs, before-state, expected versions, audit linkage, SQL, credentials, or service-role material.
- Source actions remain immutable; inverse lineage points to the immediate source; creation Undo is unsupported.
- Missing is not null. Remove semantic no-ops. Affected historical fields reverse together or not at all.
- Preserve conservative Phase 4B incomplete-history detection and strict whole-row Apply staleness.
- Activity must not expose payload/before_state/prompts/hidden reasoning. Explanation maximum 240; inverseSummary maximum 180; displayed field text maximum 4000.
- Existing applied migrations are immutable. Generate one later-sorting additive migration at implementation time.
- No implementation or validation results are claimed by this plan. Commands below are future execution instructions.

## Review Focus

1. An oversized description written through manual CRUD must never be silently truncated into authoritative history (Tasks 3, 6, 8).
2. Model calls mixing new milestone changes with a legacy date/task action must fail atomically in either order (Tasks 3, 6).
3. A lost create-Apply response must recover the same milestone without duplication (Tasks 5, 9).
4. A project relationship change between discovery and locking must fail safely, without a lock inversion (Tasks 4, 8; rollout matrix).
5. An older client encountering a new action must not mislabel it as a task or offer an unsafe Apply (Task 9; rollback gate).

---

## Repository reconfirmation and implementation entry gate

Planning inspection on 2026-10-13 found main at `182a0f45a51f22148c9f0616bfa845ad78ff926a`, no tracked modifications, and latest migration `20261013090000_workspace_agent_safe_undo.sql`. Reconfirm these facts at execution; preserve unrelated untracked acceptance artifacts and the approved specification.

| Area | Confirmed repository behavior | Consequence |
| --- | --- | --- |
| `20260930120000_phase1.sql` | Milestones have UUID id, project_id, title, description, status, target_date, sort_order, created_at, updated_at; parent FK cascades deletion | No new entity columns |
| Milestone timestamp trigger | `private.set_updated_at()` assigns `now()` on update | Preserve exact timestamp equality; do not invent a clock/version column |
| `20260930140000_phase2b.sql` | Authenticated milestone CRUD is guarded by `private.owns_project(project_id)` in USING/WITH CHECK; anon denied | Agent additionally checks explicit supplied owner through project |
| Task linkage | Nullable `tasks.milestone_id`, FK deletion behavior SET NULL | Agent must not delete, reparent, or cascade task edits |
| `data/milestoneService.ts` | Manual create reads maximum order then inserts pending; edit updates title/description/date; status separate; delete permanent; reorder separate writes | Preserve manual behavior; no global append uniqueness claim |
| Schema documentation | `schema.sql` contains extra checks not established by the migration chain | Do not introduce schema-wide repair based on the documentation |
| Phase 3B audit constraints | Seven existing kinds; project required except blocks; create version null; update entity/version required; payload/before byte limits 40000 each; diff 1–10 entries, 80000 bytes | Extend only new branches; preserve every old valid shape |
| Phase 4B | Same-owner inverse FK, self-reference rejection, one pending/applied inverse index, shared evaluator and source-first lock discipline | Extend existing policy, not a second algorithm |
| Legacy scheduling | Schedule Apply locks action, project, milestone; date-only payload/audit; existing milestone Undo date-only | Delegate only the workspace write |
| `store.ts` / proposal cards | Unknown kinds currently fall through to task dispatch/display | New release needs explicit fallback; unchanged pre-5B code is not a proven rollback target |
| `app/app/page.tsx::onAgentApplied` | Reloads workspace tasks/projects/milestones | Reuse refresh unless a focused regression proves a missing update |

Implementation begins by reading AGENTS.md, referenced RTK instructions, this plan/spec, and relevant installed Next.js docs before touching Next APIs. Re-run `git status`, inspect nested AGENTS files, migration history, constraints/functions, and existing tests. Stop on material drift; do not execute a stale plan mechanically.

## Exact file map

Paths below are relative to `C:\webprac\software-workplace`; no unrelated files are authorized.

| File | Planned responsibility |
| --- | --- |
| `lib/ai/agent/contract.ts` | Milestone family types and supported action discrimination |
| `lib/ai/agent/proposal-schema.ts` | Two strict proposal schemas/parsers and discriminated milestone intents |
| `lib/ai/agent/registry.ts` | Register `get_milestone` |
| `lib/ai/agent/tools.ts` | Owned bounded milestone detail projection |
| `lib/ai/agent/proposals.ts` | Canonical milestone collection, exact before-state, no-ops, one-action boundary |
| `lib/ai/agent/prompt.ts` | Permit approved milestone tools; preserve all other prohibitions |
| `lib/ai/agent/schedule-summary.ts` | Deterministic creation/update summary; retain old date summaries |
| `lib/ai/agent/store.ts` | Explicit new Apply dispatch; reject unsupported kinds |
| `lib/ai/agent/activity.ts` | Owned milestone targets, supported kinds, safe error projection |
| `data/agentActivity.ts` | Human action labels and bounded safe milestone error presentation |
| `data/agentProposalReview.ts` | Review Again for creation/update with correct parent/target context |
| `components/ai/AgentProposalCards.tsx` | Milestone cards, changed fields, unsupported-kind fallback |
| `components/ai/AgentActivity.tsx` | Preserve/render direct lineage labels including “Reversed later” |
| `supabase/migrations/<generated>_workspace_agent_milestones.sql` | The single additive migration described below; do not create during planning |
| `supabase/schema.sql` | Document only objects/constraints actually added by that migration, following existing snapshot conventions |
| `lib/ai/agent/phase5b-fixture.mjs` | Disposable SQL fixture with accurate milestone schema/trigger/RLS and actual Agent migrations |
| `lib/ai/agent/phase5b.test.mjs` | Parser/read/collection/model-loop regressions |
| `lib/ai/agent/phase5b-database.test.mjs` | Persistence, Apply, shared primitive, legacy preservation, grants |
| `lib/ai/agent/phase5b-policy.test.mjs` | SQL Undo and serial interleaving cases |
| `lib/ai/agent/phase5b-route.test.mjs` | Identifier contracts, dispatch, auth, Gemini exclusion |
| `lib/ai/agent/phase5b-recovery.test.mjs` | Recovery, cards, Activity, Review Again, refresh regressions |

Conditional existing-file edits only when a targeted failing test requires them: `lib/ai/agent/executor.ts` (new-call validation/pre-filter), `lib/ai/agent/schemas.ts` (generic read parser should already accept milestoneId), `app/app/page.tsx` (refresh should already suffice). Do not modify manual milestone services/types or unrelated legacy tests to force GREEN. Existing route files and Gemini transport need no new endpoint or credential.

## Shared interfaces and canonical shapes

Keep the existing envelope and existing legacy payload types. Introduce action-family discrimination in `contract.ts` rather than authorizing milestone statuses in task/block validators:

```ts
type MilestoneStatus = 'pending' | 'active' | 'completed';
type MilestoneChanges = {
  title?: string; description?: string;
  status?: MilestoneStatus; targetDate?: string | null;
};
type MilestoneCreatePayload = {
  title: string; description: string;
  status: 'pending'; targetDate: string | null;
};
type MilestoneProposalInput =
  | {milestoneAction:'create'; projectId:string; title:string;
     description?:string; targetDate?:string|null}
  | {milestoneAction:'update'; milestoneId:string; changes:MilestoneChanges};
```

`milestoneAction` is internal parsed discrimination, not a tool argument. `ProposalDraft` becomes a discriminated union of the existing seven-kind draft and two milestone drafts with the existing common envelope. New create: `entityId:null`, `taskId:null`, owned `projectId`, `expectedUpdatedAt:null`, full creation payload, `before:{}`, string/null display diff. New update: real entityId, taskId null, owned projectId, exact expected timestamp, affected-only payload and affected-only before fields plus `before.projectId` canonical context. Preserve missing properties during serialization; never use `value ?? null` to manufacture historical keys.

Shared renderer diff fields remain the existing string/null field names: title, description, status, targetDate. No boolean scalar or Plan field work. Narrow by action kind before task/block-specific property access in summaries/cards/review. Do not rewrite all legacy contracts.

`get_milestone` returns `{milestoneId,projectId,projectTitle,title,description,status,targetDate,titleTruncated,descriptionTruncated,projectTitleTruncated}`. Bounds: title/projectTitle 180, description 4000, status 40; status is a bounded read string because manual legacy data is not assumed enum-valid. Target date is date-only or null. Flags reflect actual read truncation. These strings are informative only; collection reloads raw canonical values and validates fields affected by the intent.

Public HTTP shapes are unchanged. `saveProposalBatch`, `loadProposalBatch`, `applySelectedActions`, `cancelSelectedActions`, `executeReadTool`, and `collectProposal` retain their current signatures. No new Undo route; no TypeScript inverse derivation.

## Ordered implementation tasks

Each task follows RED → minimal implementation → GREEN. Test names below are required behavioral assertions, not promised current results. No commit steps. Use existing TypeScript-transpile/mock test conventions and existing dependencies.

### Task 1: Establish an accurate disposable milestone fixture

**Files:** Create `phase5b-fixture.mjs` and initial `phase5b-database.test.mjs` under `lib/ai/agent/`.

**Interfaces:** Export `fixture(t, {includePhase5b = true} = {})` returning `{db, one(sql,args=[]), owner, other, project, milestone, task}`. `one` returns the first query row. Load old migrations through Phase 4B in order; optionally load exactly one filename ending `_workspace_agent_milestones.sql`. Missing new migration must cause feature assertions, not bootstrap failure.

- [ ] Write `fixture_matches_milestone_schema_and_policies`: assert all nine real milestone columns/defaults, parent CASCADE, task link SET NULL, actual `now()` timestamp trigger behavior, authenticated owner CRUD and foreign/anon denial. Unlike Phase4B's reduced fixture, include description/status/sort_order/created_at and real milestone trigger. Use the baseline migration definitions, not Phase4B's simplified milestone table.
- [ ] Run `node --test --test-name-pattern=fixture_matches lib/ai/agent/phase5b-database.test.mjs`; require RED from missing/inaccurate fixture assertions.
- [ ] Implement the disposable fixture using existing roles/auth.uid mock and btree_gist runtime. Execute actual Agent migrations, not copies of Agent functions. Seed complete owned/foreign projects/milestones/task links. No shared database URL or secrets.
- [ ] Run the same test; require GREEN. Baseline tests must prove old task/date/block/Undo functions exist before adding Phase5B. Capture hashes of all existing migration files for final immutability comparison.

### Task 2: Add strict milestone intent types and narrow detail read

**Files:** Modify contract.ts, proposal-schema.ts, registry.ts, tools.ts; create phase5b.test.mjs. schemas.ts only if its existing generic validation fails a new test.

**Interfaces:** `parseProposalTool(name:string,value:unknown)` adds `MilestoneProposalInput` to its existing return union; `executeReadTool(name,input,context): Promise<Record<string,unknown>>` adds only get_milestone. Export new milestone types from contract.ts.

- [ ] Add `milestone_tool_contracts_are_strict`, `milestone_missing_null_empty_are_distinct`, `milestone_read_is_owned_bounded_and_non_authoritative`. Assert create defaults are not model-supplied fields; reject status/order/id/userId/version/before/undo extras; update requires a nonempty known-field object, rejects null title/description/status, accepts empty description and explicit date null. Assert whitespace title normalization, 180/181 title, 4000/4001 description, invalid calendar date/UUID, pending/active/completed only, rejects task/block statuses.
- [ ] Run `node --test --test-name-pattern=milestone_ lib/ai/agent/phase5b.test.mjs`; require relevant RED.
- [ ] Define schemas for exactly the two approved tool argument shapes. Implement type discrimination before existing schedule/task fallthrough. Register `get_milestone({milestoneId})`; read one milestone through an owned project join. Explicitly project the detail shape above, omit timestamps/owner/audit fields; foreign/missing entity uses existing safe unavailable behavior. Keep list_milestones unchanged.
- [ ] Run the new parser/read tests and existing agent/phase2/phase3a/phase3b parser tests; require GREEN. Add non-ASCII and multi-byte inputs to separate character and byte bounds.

### Task 3: Canonicalize new proposals and enforce one new action per run

**Files:** Modify proposals.ts, prompt.ts, schedule-summary.ts; extend phase5b.test.mjs. executor.ts only for a reproduced new-tool failure.

**Interfaces:** Preserve `collectProposal(name,input,context,drafts)`; add its milestoneAction branch before entityType/task branches. Produce the canonical draft shapes above. No new mutation service or inverse helper in TypeScript.

- [ ] Add `create_milestone_collects_defaults_without_mutation`, `update_milestone_collects_exact_affected_history`, `milestone_noop_removes_proposal`, `milestone_mixed_calls_reject_both_orders`, `oversized_manual_history_is_not_truncated`. Assert full creation defaults, owned parent, null entity/version; assert update exact before/project/version and one grouped description+date diff; omitted fields remain absent, explicit null remains present. Repeated same-target updates merge against initial before-state; returning every field to its initial value removes that draft. Reject second creation, second target, legacy reschedule+new update, and any old/new family mix in either order; no partial persisted run survives.
- [ ] Run phase5b.test.mjs; require the new tests RED before changes.
- [ ] Reload canonical owned project/milestone server-side. Canonicalize only supported fields, derive affected diff, strip no-ops, reject affected history that cannot be stored exactly within text/byte bounds. Do not reject an unrelated oversized description for a date/status-only action. Never use bounded model read text as before-state. Freeze first expected version when merging; reject subsequent discovery/version drift.
- [ ] Enforce single-new-action rules centrally in collection so later legacy/task/block calls cannot bypass them; retain old-only maximum 10. Update prompt permission text and deterministic summary; no-op yields no proposal, not a fake action. Model-loop tests assert no direct workspace insert/update and no extra Gemini tools outside scope. Test a natural-language milestone “reschedule this” request against the existing block-move prefilter before deciding whether executor.ts needs a narrow fix.
- [ ] Run new collection/model tests and existing scheduling summary suites; require GREEN.

### Task 4: Generate the additive migration and shared write primitive

**Files:** Create the single generated migration only now; extend phase5b-database.test.mjs; schema.sql documentation at Task 10.

**Interfaces:** `private.agent_milestone_patch_valid(p jsonb, creating boolean) RETURNS boolean`; `private.agent_apply_milestone_patch(p_user_id uuid,p_project_id uuid,p_milestone_id uuid,p_patch jsonb,p_expected_updated_at timestamptz) RETURNS boolean`.

- [ ] Re-list all migration names and inspect current constraints/function definitions. Generate with `supabase migration new workspace_agent_milestones`; verify generated timestamp sorts strictly after every existing migration. If unavailable/incorrect, stop rather than install tooling or rename an applied migration. Record the chosen filename; tests resolve the unique suffix. Do not run migration against Production.
- [ ] Write `milestone_patch_validator_is_exact`, `shared_patch_locks_parent_and_checks_version`, `shared_patch_has_no_audit_side_effects`. Assert allowlist/types/date validation, no-op rejection for new patches, owner/parent validation, exact timestamp stale false with zero workspace/audit changes, and one-row update preserving every unspecified field. Assert missing expected version is invalid rather than unconditional write.
- [ ] Run focused database tests; require RED from missing objects/behavior.
- [ ] Add validator and primitive. The validator requires full fixed pending create payload or nonempty update patch of at most four keys; date subpatch calls existing `private.agent_schedule_patch_valid`. Validate scalar JSON types before casts, exact bounds, canonical title, status enum. Primitive takes project FOR SHARE first and milestone FOR UPDATE next; owner/relationship checks under locks, exact version equality, one UPDATE assigning only present fields. Return false for stale only; use safe exception classes for invalid (`22023`) and unavailable (`42501`). No audit updates/public Apply call. An empty patch is invalid, but semantic equality is not rejected by this shared primitive: new collection/save reject semantic no-ops, while legacy date-only equality retains old Apply behavior. Do not silently tighten old payload contracts.
- [ ] Run primitive tests GREEN. Check SQL definitions use empty search_path, qualified relations and explicit ownership. Revoke helper execution from PUBLIC/anon/authenticated/service_role; only trusted definer callers execute internal helpers.

### Task 5: Add atomic milestone Apply and delegate legacy date writes

**Files:** Continue same migration; extend phase5b-database.test.mjs.

**Interfaces:** `public.apply_agent_milestone_action(p_user_id uuid,p_run_id uuid,p_action_id uuid) RETURNS jsonb` matching existing ActionResult; preserve `public.apply_agent_schedule_action(uuid,uuid,uuid)` signature/results.

- [ ] Add `milestone_create_is_atomic_idempotent_and_appends`, `milestone_update_is_grouped_and_strictly_stale`, `legacy_reschedule_preserves_payload_audit_and_undo`. Assert create before Apply count0; first Apply count1/action applied/entity set; repeated Apply same id/count1; Cancel no row. Append max+1, empty project order matches existing manual default convention. Inject an audit-finalization failure and assert insertion rolled back. Grouped update either changes all fields and audit or neither. Legacy date apply/clear/stale/foreign/missing retains old status/error/diff/history, never touches title/description/status/task/project deadlines or blocks.
- [ ] Run focused tests RED.
- [ ] Implement new Apply: lock/reload action by owner/run/id first, return terminal state idempotently, reject wrong family and invalid canonical data. Create locks owned project FOR UPDATE initially, derives `coalesce(max(sort_order),0)+1` (empty project starts at 1, matching manual create), inserts DB-generated milestone UUID and full defaults, then finalizes action/run in the same RPC transaction. Check integer overflow safely; no sibling rewrite. Update delegates write to the primitive, maps false to conflict/STALE_ENTITY. Preserve existing terminal result convention and safe timestamps/error behavior.
- [ ] Replace only the milestone write segment of existing schedule Apply with primitive delegation. Keep project branch, old payload validation, audit transitions, dates and schedule error codes unchanged. Do not call new public milestone Apply from legacy schedule Apply and do not create another action.
- [ ] Run new tests plus phase3a/phase4b database/policy suites GREEN. Compare legacy action snapshots before/after, excluding naturally differing timestamps/IDs. Assert no changes to unrelated workspace entities.

### Task 6: Extend persistence constraints and compatibility guards

**Files:** Continue same migration; extend phase5b-database.test.mjs.

**Interfaces:** Preserve `public.save_agent_proposal_batch(uuid,jsonb) RETURNS jsonb` and `private.agent_batch(uuid,uuid) RETURNS jsonb` shape; add new kinds only.

- [ ] Add `new_milestone_batch_requires_one_canonical_action`, `old_kind_shapes_still_persist_and_recover`, `cross_kind_target_guard_preserves_history`, `milestone_history_requires_exact_keys`. Assert rejects forged/missing context/version/entity, malformed before/diff, missing vs null, overbyte data and mixed runs. Assert seven legacy kinds and existing inverse lineage all remain valid. A cross-kind target collision fails without an inserted run/action. Test the preflight against a disposable synthetic history table containing a collision, without disabling real history constraints.
- [ ] Run focused tests RED.
- [ ] Extend the two named audit CHECKs exactly as specified in the migration section. In save, add milestone branches before task fallback; owned project and exact entity relationship, validate before/diff against affected keys including types and one entry per field, enforce no-op removal outcomes cannot be persisted as empty new updates. Creation full payload/before empty; update affected history plus project context. Ensure JSON null cannot bypass boolean SQL validators (`IS NOT TRUE`/explicit null checks). Enforce array length1 whenever either new kind appears; legacy arrays unchanged.
- [ ] Add cross-kind unique index only with the read-only preflight below; fail safely on collisions, never edit historical rows. Verify the current agent_batch function already emits new entityId/projectId/type/payload/before/version/diff with taskId null for non-tasks. Keep its implementation unchanged if assertions prove adequacy; otherwise CREATE OR REPLACE with identical envelope and old serialization, adding only missing milestone projection support.
- [ ] Run all persistence/recovery tests GREEN; assert failed save is atomic and byte limits remain authoritative in PostgreSQL, not only JavaScript.

### Task 7: Route new Apply through explicit kind dispatch

**Files:** Modify store.ts; create phase5b-route.test.mjs.

**Interfaces:** Existing store and action-route signatures unchanged. New kinds call apply_agent_milestone_action; undoOf is dispatched first to apply_agent_inverse_action. Unknown kinds produce safe unsupported/INVALID_INPUT behavior before any mutation RPC, never task fallback.

- [ ] Add `milestone_apply_uses_canonical_identifiers_only`, `milestone_inverse_routes_through_guard`, `approval_cancel_recovery_never_call_gemini`, `unknown_kind_never_dispatches_as_task`. Assert POST extras (payload,userId,changes,expectedUpdatedAt,undoOf) rejected, owner/run/action checked, proper RPC and exactly three SQL identifiers, malicious browser action type ignored, recovery no-store, auth/origin/rate-limit boundaries unchanged.
- [ ] Run phase5b-route.test.mjs RED.
- [ ] Replace substring/default dispatch with explicit supported-kind routing while preserving all seven legacy mappings and inverse-first routing. Preserve generic Cancel and canonical reload; do not add a milestone HTTP endpoint. Unknown actions remain recoverable/displayable but unexecutable.
- [ ] Run new and phase2/phase4a/phase4b route tests GREEN. Use mocks that throw if Gemini is imported/called on approval/cancellation/preparation/recovery paths.

### Task 8: Extend the one SQL Undo policy and lock context

**Files:** Continue same migration; create phase5b-policy.test.mjs.

**Interfaces:** Preserve `private.agent_undo_evaluate(uuid,uuid,uuid,timestamptz,uuid DEFAULT NULL) RETURNS jsonb`, `private.agent_undo_lock_context(uuid,uuid) RETURNS void`, and `public.apply_agent_inverse_action(uuid,uuid,uuid) RETURNS jsonb`. Existing preparation/eligibility entry points remain callers of this evaluator.

- [ ] Add `milestone_undo_restores_each_affected_field`, `milestone_undo_is_all_or_nothing`, `milestone_undo_preserves_unrelated_preparation_edits`, `milestone_inverse_stales_after_preparation`, `milestone_incomplete_history_fails_closed`, `milestone_inverse_lineage_and_recovery`, `milestone_creation_undo_is_unsupported`. Cover each field, all four grouped, date null, description empty, missing/null distinction, affected mismatch, unrelated oversized manual text, invalid old enum/date, text at conservative boundary/ellipsis, malformed/missing diff, entity/project loss/reparenting, post-Prepare manual edit, inverse-of-inverse, repeated Apply/Prepare, Cancel then fresh Prepare, and source snapshots unchanged.
- [ ] Run policy suite RED.
- [ ] Extend evaluator support to update_milestone; canonical current projection includes its four mutable fields and owned project context. Reuse generic affected-field/history checks, validate candidate with the milestone validator before the time-block fallback. Inverse is update_milestone, affected-only payload, exact affected before+project context, current expectedUpdatedAt, direct source linkage. Incomplete affected history fails closed; unrelated fields do not enlarge candidate/history. Keep existing reschedule branch date-only and creation unsupported reason `UNSUPPORTED_ACTION`.
- [ ] Extend lock-context discovery and milestone target branch to update_milestone with project SHARE → milestone UPDATE and existing bounded rediscovery/retry. Extend guarded inverse Apply explicit dispatch after re-evaluation, candidate equality and strict version checks. It calls new milestone Apply while retaining source/action/context locks; that caller owns audit transitions. Keep existing source lock, partial unique index, uniqueness-loser canonical recovery, and Cancel behavior.
- [ ] Add serial tests `prepare_then_cancel_then_prepare`, `cancel_before_prepare_recovers_fresh`, `prepare_then_manual_edit_then_inverse_apply`, `repeated_prepare_recovers_same_inverse`. Run GREEN and all Phase4B policy tests. Clearly label PGlite interleavings as serial single-engine coverage, not multi-connection lock proof.

### Task 9: Render safe cards, Activity, lineage and recovery

**Files:** Modify activity.ts, data/agentActivity.ts, data/agentProposalReview.ts, AgentProposalCards.tsx, AgentActivity.tsx; continue same SQL migration for Activity projection; create phase5b-recovery.test.mjs. app/app/page.tsx only if refresh regression fails.

**Interfaces:** Preserve existing Activity/ProposalBatch HTTP shapes, target shape `{type:'milestone',id,projectId}`, and onApplied callback. Add labels “Created milestone” / “Updated milestone”; create card “Create milestone”, update card “Update milestone”. Add `MILESTONE_SAVE_FAILED` to safe presentation/SQL error whitelists with generic user copy.

- [ ] Write `milestone_cards_render_create_and_changed_fields_only`, `milestone_activity_is_safe_owned_and_bounded`, `milestone_lineage_is_immediate_and_derived`, `milestone_review_again_uses_correct_context`, `milestone_lost_response_recovers_without_duplicate`, `milestone_apply_refreshes_progress`, `unknown_kind_is_display_only`. Assert project label not UUID, empty description/null date rendered clearly, Pending creation status, only changed update fields, target navigation/missing entity fallback, no raw payload/before/version/prompts in Activity, explanations <=240/summaries<=180, old records unchanged, source/inverse/reversed-by navigation and “Reversed later” derived without modifying originals.
- [ ] Run new tests RED. Use existing React rendering/mocked request conventions; behavioral assertions must inspect rendered output and request bodies, not only source-string presence.
- [ ] Extend owned Activity milestone lookup to create/update; pending creation is uncreated, applied creation uses canonical entityId. SQL Activity projection retains existing safe field whitelist/bounds, extends known types and milestone error only. New cards resolve owned project labels with “Unavailable project” fallback. Unknown kinds show “Unsupported action”, no selection/Apply/Review Again, safe history and identifiers retained for recovery. Retain safe status/read handling; do not dispatch task actions for unknown kinds.
- [ ] Review Again creates a fresh user review request: creation identifies the parent project/title, update identifies the existing milestone. It does not replay a payload as authoritative state or automatically Apply. Preserve inverse lineage and existing recovery paths; add conditional “Reversed later” when the viewed inverse itself has a direct reversedBy reference.
- [ ] Verify existing onAgentApplied reload updates milestone collection and derived project progress without page reload; do not add Plan refresh. Run new and all Phase4A/4B recovery/review suites GREEN. In separately local browser checks, test all five widths and manual milestone CRUD/status/progress; capture console/network results, no Production calls.

### Task 10: Complete regression evidence and implementation report

**Files:** schema.sql limited documentation alignment; implementation report location chosen with existing docs convention. No new production/automation tooling.

**Interfaces:** No additional product API or schema changes.

- [ ] Update schema documentation only for the actual additive audit/function changes; do not copy existing schema-only checks into migration.
- [ ] Execute targeted tests first, then full commands below. Report exact discovered/passed/failed/skipped counts from actual output, including PGlite runtime skips; a skipped required test is not acceptance proof.
- [ ] Exercise local disposable browser journeys: owned read, create → pending → Cancel, create → Apply → recover, grouped update → Apply → Activity → Prepare → Cancel/Apply, Review Again, legacy reschedule, manual CRUD/status/delete on disposable fixtures only, Calendar and Focus unchanged. Test 320/390/768/1024/1440 widths, long descriptions, missing targets, console/network, progress refresh.
- [ ] Compare migration hashes and git diff; only authorized files changed, old migrations unchanged, no secret/credential outputs or workspace artifacts staged. No commit/push/deploy.
- [ ] Produce task completion/test evidence, remaining limitations, rollback prerequisite and true PostgreSQL cases still unverified. Stop for separate rollout authorization; do not begin Phase5C.

## 1. Exact migration strategy

One transactionally applied additive migration, generated after implementation entry reconfirmation. The timestamp must exceed the latest migration then present (currently `20261013090000`). No new milestone columns, RLS policy changes, trigger changes, version fields, browser grants, or undo lineage tables.

### Production/history preflight — read only, later authorization required

Before rollout, query the actual target database's migration history, audit constraints/function signatures and grants. Then run this owner-neutral metadata check through an authorized operator; do not return payload/before-state:

```sql
select run_id, entity_id, count(*) as conflicting_actions
from private.agent_actions
where action_type in ('update_milestone', 'reschedule_milestone')
  and entity_id is not null
group by run_id, entity_id
having count(*) > 1;
```

Expected zero rows. If not zero: STOP; no history cleanup/rewrites. Repeat the same guard inside the migration before index creation so the preflight is not the sole authority. The unique index enforces any race at DDL time; failure rolls back, never silently drops rows. Use the same read-only predicate in disposable preflight tests.

### SQL objects

| Operation | Exact object/signature | Change |
| --- | --- | --- |
| Replace CHECK | `private.agent_actions.agent_actions_action_type_check` | Union existing seven kinds with create_milestone/update_milestone |
| Replace CHECK | `private.agent_actions.agent_actions_check` | Preserve old branches verbatim; create_milestone requires project, null expected version and null entity until execution (applied creation may have entity); update_milestone requires project/entity/non-null version |
| Add index | `private.agent_actions_one_milestone_target_idx` on `(run_id,entity_id)` | Unique WHERE action_type IN ('update_milestone','reschedule_milestone'); all statuses, no history edits |
| Add helper | `private.agent_milestone_patch_valid(jsonb,boolean) RETURNS boolean` | Strict canonical scalar/field/date validation |
| Add helper | `private.agent_apply_milestone_patch(uuid,uuid,uuid,jsonb,timestamptz) RETURNS boolean` | Project/target locks; owner/relationship/version; one workspace write; no audit |
| Add RPC | `public.apply_agent_milestone_action(uuid,uuid,uuid) RETURNS jsonb` | Atomic create/update and audit, idempotent |
| Replace RPC | `public.apply_agent_schedule_action(uuid,uuid,uuid) RETURNS jsonb` | Only milestone write delegates to helper; old public semantics preserved |
| Replace RPC | `public.save_agent_proposal_batch(uuid,jsonb) RETURNS jsonb` | New canonical branches, one-new-action boundary, existing branches preserved |
| Verify/retain projection | `private.agent_batch(uuid,uuid) RETURNS jsonb` | Existing generic shape sufficient; replace only if a test identifies missing new-kind support |
| Replace evaluator | `private.agent_undo_evaluate(uuid,uuid,uuid,timestamptz,uuid) RETURNS jsonb` | update_milestone candidate; creation unsupported; sole inverse algorithm |
| Replace lock helper | `private.agent_undo_lock_context(uuid,uuid) RETURNS void` | update_milestone follows existing project/milestone lock order |
| Replace guarded RPC | `public.apply_agent_inverse_action(uuid,uuid,uuid) RETURNS jsonb` | New explicit dispatch after existing guard |
| Replace projection | `private.agent_activity_run(uuid,uuid,boolean) RETURNS jsonb` | Preserve p_detail; new kinds/target support as required, labels remain in presentation; existing safe bounds and lineage; MILESTONE_SAVE_FAILED allowlist |
| Retain | `public.prepare_agent_undo`, `public.get_agent_undo_eligibility`, `public.get_agent_proposal_batch`, `public.cancel_agent_task_actions` | Existing signatures/call paths work through extended functions |
| Retain | inverse same-owner FK, referenced unique key, self-reference CHECK, `agent_actions_one_live_inverse_idx`, payload/before/diff limits | No weakening or replacement |

New public RPC is SECURITY DEFINER with empty search_path; all replaced definer functions retain those properties. Qualify relations/functions. Revoke EXECUTE from PUBLIC/anon/authenticated; grant new public Apply only to service_role. Private helpers revoked from all client roles including service_role; private tables remain denied. Recheck privileges for every replaced function because CREATE OR REPLACE preserves existing grants rather than securing them automatically.

Transaction boundaries: proposal save inserts run/actions atomically without workspace writes; ordinary Apply holds action/context locks through workspace write and audit/run result; Prepare locks source/context and inserts inverse run/action atomically without workspace mutation; inverse Apply retains source/action/context through guarded delegated mutation; Cancel touches only pending audit actions and final run bookkeeping. Workspace writes inside failure-catching blocks must roll back together with audit finalization, never return success after partial work.

## 2. Exact Phase 5B action matrix

| Intent/tool | Persisted kind | Canonical workspace payload | Apply path | Undo |
| --- | --- | --- | --- | --- |
| get_milestone({milestoneId}) | None | Safe owned bounded read | None | N/A |
| propose_create_milestone({projectId,title,description?,targetDate?}) | create_milestone | title,description,status=pending,targetDate; parent on envelope | apply_agent_milestone_action, project lock/append/insert/audit | UNSUPPORTED_ACTION |
| propose_update_milestone({milestoneId,changes}) | update_milestone | Affected title/description/status/targetDate only | apply_agent_milestone_action → private patch helper | update_milestone restoring all historically affected fields |
| Existing propose_reschedule_milestone | reschedule_milestone | Existing `{targetDate}` exactly | apply_agent_schedule_action → same private patch helper | Existing date-only reschedule_milestone inverse |

Description+date is one update action/transaction. No milestone patch changes tasks, project deadline, blocks, availability or Plan data. New updates and old reschedules cannot coexist for the same target/run, and a new action cannot share a run with any other action. Old-only bundles retain their rules.

## 3. Exact lock-order table

Rows of each class are sorted by UUID if more than one is ever needed. New milestone operations target one entity only. No routine locks a run first then waits for an action.

| Order | Lock | Ordinary create | Ordinary update / legacy date | Prepare Undo | Inverse Apply | Cancel |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Nonlocking discovery | Canonical action ids | Canonical action context | Source lookup/context | Immediate source ID | Identifiers |
| 1 | Source action FOR UPDATE | — | — | Yes | Yes, before inverse | — |
| 2 | Current/existing inverse action FOR UPDATE | Current | Current | Existing inverse if any, for recovery | Inverse | Pending selected actions in deterministic order |
| 3 | Owned project | FOR UPDATE initially (append serialization) | FOR SHARE initially | FOR SHARE | FOR SHARE | — |
| 4 | Milestone | Newly inserted row | FOR UPDATE | FOR UPDATE | FOR UPDATE | — |
| 5 | Link rows/tasks | None | None: no link mutation | None for milestone inverse | None for milestone inverse | — |
| 6 | New inverse run/action; terminal action/run bookkeeping | Finish audit/run | Finish audit/run | Insert inverse after context/evaluation | Finish audit/run | Finish audit/run only |

Existing task/block link paths retain Phase4B project → milestone/link → task/target ordering; do not refactor them. Source is never acquired while holding inverse/entity locks. Guarded inverse re-entry into milestone Apply acquires only already-held action/project/milestone locks, no weaker-to-stronger upgrade. Context rediscovery under target lock must match action.project_id; relationship drift fails or uses existing bounded retry, never acquires a second parent out of order. Project deletion serializes against parent locks. Manual updates do not adopt Agent lock order; actual multi-connection tests must assess deadlock/failure behavior before readiness claims.

Agent creates serialize with other Agent creates under project UPDATE. Manual append/reorder currently does not use that protocol: tied sort_order is permitted, not an invariant violation; no sibling overwritten, no new unique order index. Existing timestamp `now()` may be unchanged for multiple writes in one transaction; test separate committed manual-edit transactions for stale behavior and disclose the existing timestamp limitation.

## 4. Exact test matrix and validation commands

| Cases | Primary file/task | Required assertion |
| --- | --- | --- |
| Create defaults/description/date/null, invalid title/UUID/type/enum/text/bytes | phase5b.test.mjs, Tasks2–3 | Strict intent, canonical defaults, no authority fields |
| Owned/foreign/missing project; pending creation/Cancel | phase5b-database.test.mjs, Tasks5–6 | No pre-Apply row; no unauthorized mutation |
| Create append/idempotent/repeated Apply/failure rollback | phase5b-database.test.mjs, Task5 | One stable entity, atomic audit+workspace, no sibling rewrite |
| Each update field/date clear/grouped fields/no-op/omitted/null | phase5b.test.mjs + database, Tasks3–6 | Exact affected patch/history; atomic full patch |
| Stale/missing/foreign/reparented target | database + policy, Tasks4–8 | Durable safe conflict/failure, no workspace partial write |
| No task/project date/block/Plan cascade | database, Task5 | Snapshot unchanged outside target |
| Legacy schedule date/null/stale/audit/old recovery/old Undo | database + policy + recovery, Tasks5,8,9 | Old payload/status/history/date-only semantics retained |
| Mixed family/same target old+new/both orders | test + database, Tasks3,6 | Atomic rejection, no partial pending run |
| Undo each field/all fields/unrelated earlier edit/affected edit/post-Prepare stale | phase5b-policy.test.mjs, Task8 | One shared SQL decision; whole affected set or none |
| Missing/null/empty/truncated/oversized/noncanonical history | policy + collection, Tasks3,8 | Fail closed for affected history, unrelated values survive |
| Inverse-of-inverse/repeated Prepare/Cancel fresh/source immutability/create unsupported | policy, Task8 | Direct lineage, canonical recovery, one live inverse |
| Same-owner FK/self-reference/live inverse index preserved | database + existing phase4b, Tasks6,8 | Invalid linkage denied, source unchanged |
| Service-only grants/auth/origin/identifier contracts/Gemini exclusion | database + phase5b-route.test.mjs, Tasks4,7 | Browser denied RPC/audit; existing boundaries preserved |
| Safe bounded Activity/errors/unknown action | recovery + database, Task9 | No private internals; unknown kind display-only |
| Cards/navigation/lineage/Review Again/refresh/lost responses | phase5b-recovery.test.mjs + local browser, Task9 | Correct labels/requests, stable recovered entity, fresh progress |
| Five widths/long descriptions/console/network/manual CRUD | Local Playwright/browser, Tasks9–10 | 320/390/768/1024/1440 usable with no new overflow or relevant errors |
| Existing Phase1–4B/Calendar/Focus/progress/accountability | Existing suites, Task10 | Regressions reported and fixed only within task scope |

Run from the repository root. Before tests, locate the already available PGlite module; set `AGENT_TEST_PGLITE_MODULE` to its existing absolute `dist/index.js` path in the executing process. Previously available path: `C:/Users/Franz/.codex/visualizations/2026/10/04/01a1069b-4375-7fe2-a9b9-4435879efc5e/sql-runtime/node_modules/@electric-sql/pglite/dist/index.js`. Confirm it exists; do not install a dependency if absent—stop/report the missing disposable runtime.

```powershell
node --test lib/ai/agent/phase5b.test.mjs
node --test lib/ai/agent/phase5b-database.test.mjs
node --test lib/ai/agent/phase5b-policy.test.mjs
node --test lib/ai/agent/phase5b-route.test.mjs lib/ai/agent/phase5b-recovery.test.mjs
node --test lib/ai/agent/*.test.mjs
npm run test:ai
npm run test:public-ai
npm run test:calendar
npm run test:focus-session
npm run test:accountability
npm run test:workspace-shell
npx tsc --noEmit
npx eslint lib/ai/agent/contract.ts lib/ai/agent/proposal-schema.ts lib/ai/agent/registry.ts lib/ai/agent/tools.ts lib/ai/agent/proposals.ts lib/ai/agent/prompt.ts lib/ai/agent/schedule-summary.ts lib/ai/agent/store.ts lib/ai/agent/activity.ts data/agentActivity.ts data/agentProposalReview.ts components/ai/AgentProposalCards.tsx components/ai/AgentActivity.tsx
npm run build
git diff --check
git status --short
```

Include conditional changed files in lint. If Node's installed version does not expand the wildcard, enumerate `rg --files lib/ai/agent -g '*.test.mjs'` and pass the resulting file array to node; do not silently omit old suites. Hash old migrations before/after using Get-FileHash and compare. Read installed Next docs before any Next API changes. Local browser checks must use disposable data/configuration; inability to isolate local testing is a reported blocker, not permission to point tests at Production.

### Separately authorized true PostgreSQL rollout matrix

Do not run during planning. PGlite serial interleavings do not prove these cases. Use a disposable PostgreSQL/staging database first and genuinely independent connections with barriers, bounded lock timeouts and captured SQLSTATE/committed rows. Production testing requires explicit authorization and exact labeled fixture/cleanup scope.

| Concurrent case | Expected committed result |
| --- | --- |
| Two create Apply requests for same action | One milestone, same entity returned after wait/recovery |
| Two update Apply requests for same action | One mutation/audit transition; terminal result on second |
| Two different Agent creates in one project | Both committed, serialized distinct Agent append orders |
| Milestone update versus manual field edit, both lock orders | Serialized success or safe stale/failure; no lost committed edit claimed safe by a stale proposal |
| Milestone update versus project deletion | Serialized commit or unavailable failure, no orphan/partial audit success |
| Milestone update versus milestone reparenting where authorized schema permits | Relationship rediscovery rejects mismatch; no out-of-order parent lock |
| Milestone update versus task milestone-link change | No task writes by milestone operation; ownership/FK/link validity preserved |
| Duplicate Prepare on one source | At most one pending/applied inverse; loser returns canonical winner |
| Prepare versus Cancel existing inverse | Either canonical still-pending inverse or safely fresh inverse after cancellation; never two live inverses |
| Inverse Apply versus manual edit | Strict version/affected policy enforced after wait; no partial reversal |
| Inverse Apply versus Cancel / repeated Apply | One terminal outcome, zero duplicate mutation |

Record actual deadlocks/timeouts as failures requiring investigation; do not treat retryable failures as concurrency proof. The existing exclusion constraint and all old time-block concurrency tests remain unaffected and must not be weakened.

## 5. Compatibility risks and rollout prerequisites

1. **Legacy schedule delegation:** Highest regression risk. Require real old-shape action/Undo snapshots and no nested audit transition before rollout.
2. **Unknown action fallback:** Current pre-5B cards/dispatch are not safe for new kinds. New code must reject unknown mutations and render unsupported history. Do not claim that shipping this fixes old deployed JavaScript. A rollback must target a proven fallback-capable compatibility build, or remain a forward fix; unchanged pre-5B code is not an authorized rollback target once new actions exist. No history deletion or forced audit cancellation to disguise compatibility.
3. **Historical uniqueness:** Run the authorized read-only preflight before index rollout. Existing conflicts block rollout; all old audit records remain untouched.
4. **Text boundaries:** Preserve conservative Undo refusal at title/description limits or ellipsis even for valid new edits. Do not promise every valid update is undoable. Exact affected history is stored; no truncated canonical writes.
5. **Manual order/version behavior:** Existing nonunique order and now()-based version semantics remain. Agent-only append serialization is narrower than global ordering, and no additional version guarantee is invented.
6. **Deployment sequencing:** Migration first under separate authorization, verify functions/grants/old app health, then deploy matching code. Partial new-code/old-schema availability must block new actions safely; never bypass missing RPCs through manual service writes. Confirm deployment SHA and production/preview identity explicitly.
7. **Credentials/test isolation:** Existing service configuration must be available securely for acceptance. No new credential workflow. Disposable and true PostgreSQL checks must pass before claiming rollout concurrency readiness.
8. **Acceptance prerequisites:** Baseline hashes, exact tests/counts, schema preflight, service-only grants, identifier route tests, genuine concurrent connection evidence, five-width hosted browser checks, safe Activity network projection, recovery and existing Calendar/Focus/manual milestone health. Hosted OAuth changes are outside implementation authorization.

### Explicit stop conditions

- Repository/spec drift changes ownership, schema, versions, audit contracts or the lock protocol materially.
- Any applied migration would need editing, old audit rows rewriting/deleting, or lineage/uniqueness constraints weakening.
- A migration timestamp cannot be confirmed later than every existing migration.
- Preflight yields duplicate milestone target/run history, or new constraints reject any formerly valid legacy shape.
- Shared primitive cannot preserve legacy date-only Apply/audit/Undo behavior.
- Affected canonical history cannot be stored exactly, or SQL evaluator would need a TypeScript inverse fallback.
- Source/action/context lock order cannot be maintained without inversion or unsafe upgrades.
- Atomic insert/update plus audit cannot be proven in disposable tests; duplicate creation or inverse races remain unsafe.
- Dependency/infrastructure/credential addition or wider schema repair appears necessary.
- Required disposable runtime or isolated browser environment unavailable; report exact blocked checks.
- Any genuine PostgreSQL case fails or has not run: stop rollout readiness claims, distinguish implementation completion from rollout verification.
- Older-release safe fallback/rollback is unproven: stop before rollout, never label old unknown-action behavior harmless.
- Production migration/testing, commit/push/deploy, Phase5C/5D work or unauthorized destructive cleanup would be required to continue.

## 6. Written-design clarification before implementation

The approved architecture needs no redesign. Two compatibility statements must be explicit at handoff:

- “Older UI must fall back safely” is a rollout prerequisite, not a property of the currently inspected pre-5B release. This plan adds fallback in new code and prohibits unproven downgrade targets. If the owner requires rollback to unchanged pre-5B code after new actions exist, stop for a separately scoped compatibility-release decision before implementation/rollout promises.
- Preserve existing now()-timestamp and nonunique ordering limitations; multi-connection tests prove only their actual observed contract. Do not reinterpret the design as globally unique append order or a new version mechanism.

The private primitive's boolean return is a planning detail: false means stale, true means one successful write, invalid/unavailable raise safe exception classes. It keeps audit ownership in callers and satisfies the approved shared-write architecture.

## Planning self-review

- Scope checked against all 16 sections of the Phase5B request: each maps to the task/file/SQL/test sections above; Plans/items/booleans remain deferred.
- Interfaces checked end-to-end: milestoneAction intent → discriminated draft → save → new Apply/helper → existing evaluator/guard → safe Activity/recovery.
- Each implementation task has a RED assertion set and a GREEN command/gate; no commit or Production step is hidden in a task.
- Review Focus conditions map to concrete tests and separately authorized concurrency cases.
- No code, migration, production configuration or validation execution is part of this planning deliverable. Stop for plan review and separate implementation approval.
