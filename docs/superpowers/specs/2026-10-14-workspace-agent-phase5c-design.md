# Workspace Agent Phase 5C — Plan Record Management

Status: proposed design for review; no implementation authorized by this document.
Baseline: `7efc8b8962d4ad784068d2196d7acac420e19cf4`.
Latest inspected migration: `20261013090001_workspace_agent_milestones.sql`.

## 1. Purpose and boundaries

Allow the authenticated owner to read, create and patch a Plan record through the existing Agent approval flow. Gemini selects tools and proposes content; the server validates canonical state; explicit Apply authorizes deterministic execution. This is architectural design work only.

This specification narrows the earlier `2026-10-13-workspace-agent-phase5-design.md` for Phase 5C. In particular, initial checklist items are excluded even when creating a Plan. No checklist writes, relinking, item-to-task conversion, deletion, bulk edits, approval bundles, autonomous execution, background scheduling, arbitrary SQL/REST tools, Phase 5D, Phase 6 or Phase 7.

## 2. Verified current state

Repository sources: `supabase/migrations/20260930120000_phase1.sql`, `20260930140000_phase2b.sql`, `data/planService.ts`, `data/planItemService.ts`, `data/mappers.ts`, `data/database.types.ts`, `types.ts`, and `app/app/page.tsx`. Read-only Production catalog inspection on 2026-10-14 confirmed the constraint/index/policy/trigger inventory below. No workspace records were changed during this design task.

### Plan schema

| Column | SQL type | Nullability/default | Constraint |
| --- | --- | --- | --- |
| id | uuid | NOT NULL; gen_random_uuid() | plans_pkey |
| user_id | uuid | NOT NULL | plans_user_id_fkey to auth.users(id), ON DELETE CASCADE |
| title | text | NOT NULL | No migrated blank/length check |
| description | text | NOT NULL; '' | No length check |
| timeframe | text | nullable | No enum or length check |
| status | text | NOT NULL; 'Planning' | No migrated status enum/check |
| target_date | date | nullable | No future-date check |
| created_at | timestamptz | NOT NULL; now() | — |
| updated_at | timestamptz | NOT NULL; now() | Updated by trigger |

Indexes: `plans_pkey` unique btree(id), `plans_user_id_idx` btree(user_id). There is no project_id, title uniqueness, ordering column or soft-delete column. Plans are directly USER-OWNED.

`plans_set_updated_at` is BEFORE UPDATE FOR EACH ROW, calling `private.set_updated_at()`, which assigns `now()`. RLS is enabled. Policy `own plans`, ALL to authenticated, uses/checks `user_id = auth.uid()`. Anonymous table access is revoked; authenticated has SELECT/INSERT/UPDATE/DELETE subject to RLS. `private.owns_plan(uuid)` is the existing security-definer ownership predicate available to authenticated for item RLS; do not revoke it when denying new Agent helpers.

### Checklist relationship

`project_plan_items`: id uuid PK/default gen_random_uuid(); plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE; nullable project_id REFERENCES projects(id) ON DELETE SET NULL; nullable task_id REFERENCES tasks(id) ON DELETE SET NULL; label text NOT NULL DEFAULT ''; done boolean NOT NULL DEFAULT false; sort_order integer NOT NULL DEFAULT 0; created_at/updated_at timestamptz NOT NULL DEFAULT now().

Indexes: `project_plan_items_pkey`, `project_plan_items_plan_id_idx`, `project_plan_items_project_id_idx`. No task_id index or migrated link-consistency checks. BEFORE UPDATE trigger `project_plan_items_set_updated_at` invokes the same timestamp function. RLS policy `own project plan items`, ALL authenticated, uses/checks `private.owns_plan(plan_id)`. Authenticated CRUD grants and anonymous denial match Plans. Ownership of linked tasks/projects is not independently enforced by this policy. Ordinary FKs prove existence, not common ownership. Phase 5C does not change these links or policies.

### Existing application behavior

- `listPlans` loads Plans newest-created first and items ordered by sort_order, then `mapPlanRow` maps description to `goal`, target_date to `deadline` (null becomes empty string), timeframe null to undefined. `tasks` is derived checklist display data, not task entities.
- `createPlan` trims/rejects blank title, derives user_id from authenticated context, inserts Plan, then separately inserts optional initial items. This manual create-with-items is not atomic. Phase 5C Agent creation inserts only the Plan.
- `updatePlan` patches supplied title/goal/timeframe/status/targetDate; title is trimmed/nonblank. It uses browser owner RLS and no expected version. It reloads items after UPDATE. `setPlanStatus` delegates to it.
- `deletePlan` performs permanent DELETE; its items cascade-delete. Linked projects/tasks survive. There is no recovery/trash path. Agent deletion and create Undo are therefore excluded.
- `handleCreatePlan`, `handleEditPlan`, `savePlan`, `changePlanStatus`, `removePlan`, and `renderPlansPage` in `app/app/page.tsx` implement manual UI. Title, Goal, Status and Deadline are editable. Timeframe exists in services/types but has no current editor control.
- UI PlanStatus values: Planning, Active, Paused, Completed, Cancelled (case sensitive). SQL currently accepts other nonnull text. `data/serviceResult.ts` names potential status/title checks, but those names do not prove deployed constraints exist. `supabase/schema.sql` is not authoritative over applied migration history.
- Timeframe is descriptive free text, not a scheduling rule. target_date is date-only. Changing either must not schedule blocks, alter tasks/projects, or derive checklist changes. Item progress is calculated from done flags, independently of Plan status. Plan edits only update that row and its timestamp; no propagated-write trigger was found.
- Agent `get_plan` already exists: strict planId UUID input, explicit owner filter, safe FORBIDDEN for missing/foreign rows; returns id/title/status/targetDate plus goal bounded to 1000 and up to 20 checklist label/done summaries (160-character labels), reading 21 to flag overflow. It currently omits timeframe and text truncation flags; null date becomes ''.
- Current `onAgentApplied` reloads workspace but updates only tasks/projects/milestones. It must also call `setPlans(remote.plans)` for Plan actions.

## 3. Chosen architecture and alternatives

Recommended: extend existing proposal persistence, explicit dispatcher, service-only Apply RPC, shared SQL Undo evaluator and Activity projection. Add one Plan validator and one Plan patch primitive, adapting ownership directly to plans.user_id. This retains one approval boundary and one inverse algorithm.

Rejected: invoking browser manual services from Agent Apply (cannot atomically couple canonical action, version guard, mutation and audit); separate Plan audit/Undo subsystem (duplicates existing policy and recovery). No global Plan constraints or timestamp-trigger redesign is proposed: these would change existing manual behavior beyond Phase 5C.

## 4. Tool and payload contracts

Keep `get_plan`, `propose_create_plan`, `propose_update_plan` as the only Phase 5C tool families. Canonical persisted actions are `create_plan`, `update_plan`. Reject extra keys at every boundary. UUIDs are internal identifiers; user_id/owner/version/history/lineage are never model inputs.

| Field | Create | Update | Canonical rules |
| --- | --- | --- | --- |
| title | required | optional | string, trim, nonblank, at most 180 Unicode code points |
| description | optional, default '' | optional | string including ''; at most 4000 code points; preserve content, reject null |
| timeframe | optional, default null | optional | null or trimmed string, at most 180 code points; blank becomes null |
| status | optional, default Planning | optional | exact Planning/Active/Paused/Completed/Cancelled; reject null |
| targetDate | optional, default null | optional | real Gregorian YYYY-MM-DD or null; no time/offset; no future restriction |

These are proposed Agent bounds, not existing database text limits. Implement identical Unicode length semantics in SQL/TypeScript rather than mixing JS UTF-16 length and PostgreSQL character length. Do not truncate canonical stored values. Relative date interpretation uses existing authenticated reference-day/timezone context; the proposal contract still requires a verified concrete date. Timeframe never drives date arithmetic.

Create tool accepts only the five fields above. All five are materialized in canonical payload. before={}, expectedUpdatedAt=null, entityId=null until Apply, taskId=null, projectId=null. Authenticated owner comes only from server context. Creation status can be explicitly selected from the existing UI values; omitted status is Planning. No items/initialItems/goal/deadline/projectId/userId fields accepted. The existing view model mapping handles description/targetDate names.

Update tool accepts exactly `{planId, changes}`. `changes` allows the five fields; missing means leave unchanged, null only clears timeframe/targetDate. After canonicalization remove unchanged fields and require at least one remaining field. Grouped patches are atomic; no partial application. Capture exact before values for changed fields only, server-read updated_at, and safe bounded display title. Read a complete owner-scoped row for validation; never use the bounded Gemini read projection as canonical history.

If any affected historical value cannot fit its canonical reversible contract (including unknown legacy status, oversized text or incomplete history), reject the entire proposal/inverse. Unaffected legacy fields remain untouched; do not silently normalize them. Missing and JSON null must be tested separately.

Enhance existing get_plan without creating a duplicate read implementation: preserve existing id/goal/checklist compatibility, add bounded description (4000), timeframe (180), title/description/timeframe truncation flags, and canonical nullable targetDate. Keep goal as a bounded legacy alias with its own truncation flag. Return no user_id, updated_at, raw items/links or audit history. Existing read-only checklist summary remains read-only; no Phase 5D identity/link expansion. Missing and foreign-owned IDs share the same safe refusal.

## 5. One-action rule and persistence

A run containing a new Plan mutation must contain exactly one mutation action total. Read calls remain allowed. Reject mixing it with legacy task/schedule/block/milestone actions in either call order. Repeat patch calls for the same Plan may merge into one canonical update, using the existing milestone pattern; revalidate combined fields/history and reject a final no-op. A repeated creation call must not add another action. Enforce in collector AND save_agent_proposal_batch; do not trust model compliance.

Extend ProposalDraft as discriminated Plan variants, PlanChanges and the shared diff field vocabulary with timeframe. Do not widen legacy task status acceptance accidentally. Persist Plan entity identity in entity_id and owner in user_id; project_id remains NULL, never a fabricated project/Plan ID.

SQL save validates complete create shape, owner context, action envelope, full affected before/diff consistency, strict current version for updates, and absence of project/task/undo lineage supplied through ordinary proposal save. Adapt existing project-required checks only for Plan kinds. Add one-target uniqueness `(run_id,entity_id)` filtered to update_plan as defense in depth; no title uniqueness (legitimate duplicate names exist).

## 6. Deterministic SQL execution and security

Proposed functions:

- `private.agent_plan_patch_valid(p_patch jsonb,p_create boolean) RETURNS boolean`: exact keys/types/bounds/status/date validation; total false on malformed values.
- `private.agent_apply_plan_patch(p_user_id uuid,p_plan_id uuid,p_patch jsonb,p_expected_updated_at timestamptz) RETURNS boolean`: owner-scoped Plan FOR UPDATE, exact version comparison, patch only present keys using CASE/key presence rather than COALESCE, no-op guard, one UPDATE. Use existing safe stale/forbidden error classification pattern.
- `public.apply_agent_plan_action(p_user_id uuid,p_run_id uuid,p_action_id uuid) RETURNS jsonb`: one transaction; lock/reload canonical action, return terminal result for repeated Apply, validate exact kind/envelope, create with authenticated ownership or delegate update to primitive, write entity_id/status/executed_at and run completion atomically. Any failed mutation rolls back its write before recording safe terminal conflict/failure. Use bounded PLAN_SAVE_FAILED projection if a new public error code is needed.

The sole public mutation RPC handles create/update; separate create and update public RPCs add no benefit. Inverse Apply dispatches update_plan through the same primitive/RPC after existing inverse guard. No general SQL executor.

Public RPC: SECURITY DEFINER, search_path='', fully qualified relations/functions, explicitly revoke PUBLIC/anon/authenticated and grant only service_role. New private helpers remain invoker functions behind the owner-executed security-definer entry point, with direct EXECUTE revoked from PUBLIC/anon/authenticated/service_role, matching existing helpers. Manual authenticated table CRUD/RLS stays intact. Service-role bypass never replaces explicit owner checks.

Apply/Cancel browser requests remain exactly `{runId, actionIds}`. Prepare Undo remains exactly `{runId, actionId}`. Server reloads stored canonical actions. No Gemini calls for eligibility, Prepare, Apply, Cancel or recovery. Transport resilience parameters/files remain unchanged.

### Lock order and transaction boundaries

| Operation | Order |
| --- | --- |
| Forward create/update Apply | canonical action FOR UPDATE; target Plan FOR UPDATE for update (insert for create); finalize own run after mutation |
| Prepare Undo | immediate source action FOR UPDATE; existing live inverse action if any; target Plan FOR UPDATE; evaluate current state; insert new inverse run/action only if eligible |
| Inverse Apply | discover immediate source ID without lock; source action FOR UPDATE; inverse action FOR UPDATE; target Plan FOR UPDATE; evaluator/version guard; mutation; finalize inverse run |
| Cancel | existing selected action lock/update and run completion; never acquires Plan/source after holding an inverse |
| Manual edit/delete | normal owner-scoped Plan row lock; no audit/source lock |

No parent project/task/item locks are needed for Plan record operations. Extend agent_undo_lock_context with a Plan branch that locks only the owned Plan and returns, rather than falling into project logic. Never acquire source while holding inverse/Plan. Run completion follows target mutation; Prepare must not prelock a run and then wait for Plan. New inverse run is private to the transaction until commit. Preserve legacy lock order for legacy paths.

Existing trigger/version semantics are retained: use canonical PostgreSQL timestamptz precision; reject any observed updated_at mismatch. `now()` is transaction-start based, so do not claim this is a universal monotonic revision counter. True PostgreSQL tests must exercise the existing manual application's separate-request transaction pattern; adversarial same-transaction repeated writes are not solved by Phase 5C. If required stale cases fail with the retained version strategy, stop for review rather than redesign shared timestamps silently.

## 7. Safe Undo

create_plan is UNSUPPORTED_ACTION: inverse deletion would permanently remove Plan and checklist children. No automatic cascade or synthetic cancel status as substitute.

update_plan uses the single existing SQL `private.agent_undo_evaluate` for Activity and Prepare. Add Plan to eligible kinds, owner-scoped current row loading, affected-field validation and inverse derivation. Current affected fields must equal historical after values; all affected before values and diffs must be complete and valid. Missing, overlong, truncated or invalid history fails closed for the whole action. No second TypeScript inverse algorithm.

Unrelated edits before Prepare survive. Candidate contains only inverse affected fields, captures CURRENT updated_at, has null projectId/taskId, and direct undo_of_action_id to its immediate source. Any observed whole-row version change after Prepare conflicts on Apply, including an unrelated field. Item changes alone do not update Plan.updated_at and do not block Plan-only Undo; they remain untouched.

The existing evaluator contains legacy text-length truncation heuristics. The new Plan branch must validate complete canonical payload/before/diff and its own bounds; do not route it through a legacy threshold that rejects legitimate exactly-180/4000-character values. Never infer completeness solely from projected text length. Extend candidate validation explicitly before schedule/time-block fallback.

Source action is immutable; reversed/reversed-by state remains derived. Inverse-of-inverse is another update_plan subject to the same policy. Preserve same-owner composite FK, referenced unique key, self-reference check and partial one-live-inverse index. Source locking plus uniqueness are authoritative for concurrent Prepare. A uniqueness loser rolls back new run/action and reloads canonical existing pending inverse. Cancellation permits fresh preparation; pending/applied inverses block a second live inverse. Preserve reason-code union and explanation <=240 / inverseSummary <=180.

## 8. Activity, UI and dispatch

Add explicit forward map entries create_plan/update_plan to apply_agent_plan_action; inverse dispatch adds explicit update_plan before legacy fallback. Unknown kinds fail safely. Preserve all nine legacy kinds: create_task, update_task, reschedule_milestone, reschedule_project, create_time_block, update_time_block, cancel_time_block, create_milestone, update_milestone.

SQL Activity projection adds timeframe to allowed diffs and PLAN_SAVE_FAILED only if introduced. Existing safe projection/lineage helpers remain. TS projection adds Plan labels, fields and owner-resolved Plan navigation; extend ActivityTarget with plan and app navigation to existing Plans/editor. Missing Plan displays missing safely; unknown kinds stay unsupported without accidental task navigation. Add explicit Plan Review Again prompts.

Proposal cards show Create/Update plan, title and affected field diffs; do not print a fabricated project label for user-owned Plans. Render timeframe as text and nullable target date as unscheduled. Activity title <=180; each before/after <=4000; field count bounded by existing limit; explanations/summaries retain 240/180 bounds. Activity never exposes payload, before_state, prompts, hidden reasoning, secrets or internal expected version. Existing proposal recovery endpoint remains distinct from Activity projection.

Update workspace refresh to setPlans(remote.plans); use existing listPlans/mapPlanRow and retain checklist state. Extend prompt and deterministic proposal summary to enable only Plan record writes and keep item writes unavailable. Do not modify Gemini transport helper, retry statuses, causes, attempts, backoffs, deadline, maxDuration or logging.

## 9. Additive migration requirements

One new transactional migration after all existing local/applied versions. Do not allocate its filename now: implementation must inspect migration histories and current UTC, generate/confirm a sortable later timestamp using the normal CLI workflow. Never edit/rename applied migrations.

Migration must: add two allowed action kinds; adapt project-null/version/entity shape checks narrowly for Plans; add Plan target uniqueness index; create validator/patch helper/public Apply; replace proposal save to enforce Plan canonical history and single action; extend shared Undo evaluator/context/inverse dispatcher; extend Activity field/error projection; reaffirm service-only grants. Preserve every legacy branch and all inverse FK/uniqueness/self guards. Existing agent_batch already carries generic entity_id and null task/project IDs; change only if executable tests prove required. No new Plan columns, Plan ownership FK, project relation, global status/title checks, item schema changes or new audit tables are needed.

Rollout later requires read-only schema/history/grant preflight, migration-only compatibility proof with old application, exact reviewed Preview code acceptance, true concurrency evidence, cleanup plan and separate Production application authorization. This document authorizes none of those writes.

## 10. Test and concurrency matrix

| Area | Required coverage |
| --- | --- |
| Read | Owned/missing/foreign Plan; exact UUID and extra-key rejection; bounded description/timeframe/title flags; null date; existing checklist cap/compatibility; no actions created |
| Create | Defaults and all allowed fields; Unicode boundaries; null/type/unknown field/status/date rejection; owner injection/items rejected; Cancel leaves no Plan; one Apply one row; repeated Apply same entity; lost response recovery |
| Update | Every field alone; grouped patch; nullable clears versus missing; empty description; trim rules; no-op after normalization; affected overlong/unknown historical values rejected; foreign/missing; version conflict; no item/project/task side effects |
| Single action | Multiple creates, mixed legacy kinds in both orders, different Plan patches rejected; repeated same-Plan patch coalesces one action or rejects safely; SQL persistence independently enforces |
| Undo | Prepare unchanged workspace; Cancel; inverse Apply; inverse-of-inverse; create unsupported; unrelated pre-Prepare edits survive; affected edits block entire grouped inverse; post-Prepare edit conflicts; incomplete/truncated history; source immutable; direct lineage; duplicate Prepare winner recovery; cancellation then fresh Prepare |
| Security | Public RPC service-only; browser roles denied; helper EXECUTE denied; existing owns_plan RLS still works; audit writes denied; owner predicates at every entry; identifier-only routes; safe Activity allowlist |
| UI | Cards, current Plan labels, no project requirement, Activity/link states, Review Again, reload/recovery, setPlans refresh, 320/390/768/1024/1440 widths; no overflow or hidden Apply/Cancel |
| Legacy | All nine old kinds; Activity/Safe Undo; time-block exclusion constraint and schedule semantics; private/public AI isolation; Phase 5B.1 retry focused suite unchanged |

Disposable PGlite tests cover deterministic policy, transactions, constraints, idempotency and explicitly serial interleavings. They are not multi-connection proof.

True independent PostgreSQL connections must exercise: duplicate create Apply; duplicate update Apply; manual edit before/after Agent row lock; deletion before/after update lock; concurrent duplicate Prepare; inverse Apply versus manual edit; repeated inverse Apply; Cancel versus Prepare in both lock orders. Assert final exact row/action counts, serial outcomes, source immutability, no orphan inverse run, no deadlock, and expected stale/refusal states. Agent-first then manual edit may legitimately result in the later manual value; manual-first must not be overwritten by stale Agent Apply. Update-first then deletion may legitimately leave a deleted Plan and applied immutable history; deletion-first must refuse update. Cancel-first permits a fresh inverse; Prepare-first recovers the existing inverse which may subsequently be cancelled. No claims of rollout concurrency readiness until these actual PostgreSQL cases pass.

Suggested later validation: focused new phase5c Node tests first; `node --test lib/ai/agent/*.test.mjs`; `npm run test:ai`; `npm run test:public-ai`; `npx tsc --noEmit`; ESLint exact changed files; `npm run build`; `git diff --check`; isolated PostgreSQL harness following existing Phase 5B pattern. No tests were run for this design-only task.

## 11. Implementation slices and review decisions

1. Test-first contracts/read expansion and canonical Plan proposal collection, including mixed-action rejection.
2. Additive SQL save/Apply/constraints/grants with disposable database fixtures and legacy replay.
3. Extend shared SQL Undo policy and lock context, proving lineage/recovery and serial interleavings.
4. Explicit dispatch, safe Activity/cards/navigation/review, Plan refresh, route/security tests.
5. Full local validation and isolated true PostgreSQL concurrency; then request separate rollout review.

Review choices proposed here: create may select existing status enum; timeframe is supported despite lacking a manual UI control; description is the Agent contract name while goal remains a read compatibility alias; title/timeframe bounds 180 and description 4000 Unicode code points; no global Plan table checks. These are explicit proposed choices for written-spec approval, not unresolved implementation guesses. No additional blocker found in inspected schema. Any requested change to these choices belongs in spec review.

Stop on schema/history divergence, unsupported ownership assumptions, impossible precise stale guard, unsafe lock inversion, uniqueness recovery failure, mixed-action bypass, history truncation used as canonical state, widened browser/audit grants, unexpected legacy dispatcher fallback, item mutation, or need for new dependencies/infrastructure. Report the blocker instead of weakening an invariant.

Only this design document may change in this task. Stop for written-spec review; do not create a migration, implementation plan, code patch, commit, push or deployment.
