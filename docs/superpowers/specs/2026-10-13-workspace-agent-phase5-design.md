# Workspace Agent Phase 5 — Milestone & Plan Management

Date: 2026-10-13. Status: proposed written design for owner review.

Repository inspected at `182a0f45a51f22148c9f0616bfa845ad78ff926a` on `main`. Phase 5A means discovery, architecture, and this specification only. The first implementation slice is called Phase 5B below to avoid confusing it with this discovery gate. No implementation plan, application change, migration, production operation, commit, push, or deployment is authorized by this document.

## 1. Intent and repository evidence

Extend the private Workspace Agent so a user can structure work with milestones, Plans, and checklist steps. Gemini may suggest content and select narrow proposal tools. The server owns identity resolution, validation, history, versions, and persistence. Every workspace mutation requires explicit Apply.

The existing data model is authoritative. In particular, a Plan is a user-owned workspace record, not a project child. Its checklist steps may link to projects and existing tasks. Phase 5 does not introduce project-owned Plans or turn checklist steps into tasks.

| Evidence | Current behavior and design consequence |
| --- | --- |
| `supabase/migrations/20260930120000_phase1.sql`, tables and `private.set_updated_at` | Milestones, Plans, and checklist rows already have UUIDs and timestamp triggers. Checklist rows are relational. |
| `supabase/migrations/20260930140000_phase2b.sql`, `private.owns_project`, `private.owns_plan`, policies/grants | Milestone ownership comes through its project; Plan ownership is direct; item RLS checks its parent Plan. Browser CRUD is owner scoped, but item policy alone does not validate linked project/task ownership. |
| `supabase/schema.sql`, milestone/Plan/item definitions | Documents extra status, shape, and task consistency checks that are not present in the inspected migration chain. Do not assume those checks exist in a migrated database. |
| `types.ts`, `data/database.types.ts`, `data/mappers.ts` | `Plan.goal` maps to `plans.description`; `Plan.deadline` maps to `target_date`; `Plan.tasks` is a checklist display alias. Plan view model omits its existing `updated_at`; server can read the row directly. |
| `data/milestoneService.ts` | `createMilestone`, `updateMilestone`, `setMilestoneStatus`, ordering functions, permanent `deleteMilestone`. |
| `data/planService.ts` | `createPlan` inserts the Plan, then separately inserts items; `updatePlan`, `setPlanStatus`, permanent `deletePlan`. No atomic create-with-items RPC. |
| `data/planItemService.ts` | `createPlanItem`, `setPlanItemDone`, `reorderPlanItems`, permanent `deletePlanItem`. No existing label-edit service. Reorder uses separate parallel UPDATE requests. |
| `app/app/page.tsx`, `saveMilestone`, `changeMilestoneStatus`, `savePlan`, `togglePlanItem`, `reorderChecklist`, editors | Manual controls, completion display, workspace refresh. Current Agent refresh updates projects/tasks/milestones, but not Plans. |
| `lib/ai/agent/registry.ts`, `schemas.ts`, `tools.ts` | Existing bounded reads. `list_milestones` has no description; `get_plan` returns at most 20 truncated labels/done flags, without item IDs, links, ordering, or timeframe. |
| `lib/ai/agent/proposal-schema.ts`, `proposals.ts`, `contract.ts` | Strict narrow tool parsing, canonical collection, maximum 10 actions, bounded text, expected versions. New kinds need explicit types/dispatch. |
| `lib/ai/agent/executor.ts`, `gemini.ts`, `prompt.ts`, `schedule-summary.ts` | Six rounds, ten total tool calls, server-generated proposal summary. Existing prompt explicitly disallows Plan writes and non-date milestone writes. |
| `lib/ai/agent/store.ts`, `action-route.ts`, `undo-route.ts`, `app/api/ai/agent/route.ts` | Authenticated canonical storage, identifier-only approval, operational limits/leases, recovery. Apply dispatch is an explicit extension point; unknown new actions must never fall into task Apply. |
| Agent migrations `20261008152535`, `20261008231753`, `20261011090000`, `20261012090000`, `20261013090000` | Private durable actions, guarded per-action transactions, date/block validators, Activity projection, SQL Undo policy and direct inverse linkage. |
| `data/agentActivity.ts`, `lib/ai/agent/activity.ts`, `data/agentProposalReview.ts`, `components/ai/AgentActivity.tsx`, `AgentProposalCards.tsx` | Existing labels, diff whitelist, navigation, Review Again, approval and lost-response recovery must be extended together. |
| `lib/ai/agent/phase4b-*.test.mjs`, earlier Agent tests, `package.json` | Existing Node tests and disposable PGlite fixture pattern. PGlite tests use an externally supplied module path, not a declared project dependency. |

This is repository discovery, not a live database audit. Before rollout, read actual database columns, triggers, policies, function signatures, and grants and compare them with migration history. Do not repair unknown drift by editing applied migrations or executing `schema.sql` wholesale.

## 2. Actual milestone schema and manual behavior

`public.milestones`: `id uuid PK`, `project_id uuid NOT NULL` referencing projects with cascade deletion, `title text NOT NULL`, `description text NOT NULL DEFAULT ''`, `status text NOT NULL DEFAULT 'pending'`, `target_date date NULL`, `sort_order integer NOT NULL DEFAULT 0`, `created_at`, `updated_at` timestamps.

Creation accepts project UUID, trimmed nonblank title, optional description, optional target date. It sets status `pending` and appends using `max(sort_order) + 1`. Manual editing changes title, description, and target date; status has a separate control with `pending | active | completed`. The table's status is manual. Linked tasks do not automatically complete a milestone, and completing a milestone does not complete tasks. Project progress consumes milestone completion alongside tasks.

Tasks link through nullable `tasks.milestone_id`. The existing task proposal path validates the same-project milestone relationship. Milestone target date is a date-only deadline, never a reservation of availability. Changing it does not move task deadlines, project targets, or time blocks.

Manual reordering updates siblings separately. No unique sibling-order constraint is visible in migrations. Manual services and editor do not enforce maximum milestone title/description lengths. Permanent milestone deletion sets linked tasks' milestone IDs to null; deleting the parent project cascades milestones. There is no archive or soft-delete field. Status `completed` is not an archive operation.

Ownership is enforced by project-owner RLS for browser CRUD. New service-only RPCs must check it explicitly because privileged execution cannot rely on browser RLS.

## 3. Actual Plan/checklist schema and manual behavior

| Record | Fields and relationships |
| --- | --- |
| `public.plans` | `id uuid PK`, `user_id uuid NOT NULL`, `title text NOT NULL`, `description text NOT NULL DEFAULT ''`, nullable `timeframe text`, `status text NOT NULL DEFAULT 'Planning'`, nullable `target_date date`, timestamps. **No `project_id`.** |
| `public.project_plan_items` | `id uuid PK`, required `plan_id` with cascade deletion; nullable `project_id` and `task_id` with SET NULL deletion; `label text NOT NULL DEFAULT ''`, `done boolean NOT NULL DEFAULT false`, integer `sort_order`, timestamps. |

A Plan combines a goal/document-like text field and ordered checklist. Multiple Plans can reference work in one project through their items; one Plan can also contain unlinked or differently linked items. Tasks have no `plan_id`. An item may reference an existing task without creating or owning that task.

The Plan editor creates title, goal, status, deadline, and newline-separated checklist labels. It edits the same metadata except initial items; timeframe is supported by the service/schema but has no editor control. Plan status values in the UI/types are `Planning | Active | Paused | Completed | Cancelled`. Status changes are manual and independent of checklist completion. Displayed percentage is rounded `done / total`, or zero for an empty checklist.

Items have stable UUID identity, stored integer ordering, independent boolean completion, and independent `updated_at`. The UI adds a label, toggles completion, drags order, or permanently removes a row. It does not rename an existing label or change links. `createPlanItem` accepts optional project/task UUIDs; its local validation checks UUID shape, while current RLS checks only Plan ownership. New Agent code must not mistake this for complete relationship validation.

There is no item text maximum or item-count maximum in the inspected manual services/editor/migration table definitions. `get_plan`'s 160-character excerpt and 20-item response are read bounds, not existing storage limits. Plan creation is currently two HTTP/database operations; failed child insertion can leave a Plan. Item changes do not update parent Plan `updated_at`. A metadata edit therefore cannot use the Plan version as an aggregate checklist version.

Plan deletion permanently cascades its items. Item deletion has no restore path. `Cancelled` Plan status retains content, but is a business status, not a safe substitute for undoing arbitrary Plan creation.

## 4. Scope and architecture options

Three viable approaches were considered:

1. **Recommended:** milestone slice first; then Plan metadata and a narrow atomic create-with-initial-items; then individual item add/update. Each update ships with Safe Undo. This preserves the model and completes the common five-step creation request in one approval.
2. Empty Plan creation followed by individual item actions. Smaller creation RPC, but a five-step Plan takes six independent approvals and can remain incomplete. Keep as a fallback only if the owner rejects aggregate creation, not as a silent behavior change.
3. General dependent/bundled actions, project-owned Plans, or aggregate replacement. These require new orchestration/model semantics and exceed Phase 5. Defer to a separate design.

Accepted Phase 5 action families: `create_milestone`, `update_milestone`, `create_plan`, `update_plan`, `add_plan_item`, `update_plan_item`. Completion is a boolean field of `update_plan_item`, not a second competing action. Existing `reschedule_milestone` remains compatible.

New Phase 5 requests produce **one new action per Agent response**, with all requested fields of that entity grouped in one patch. Do not mix it with another mutation family or project in that response. Existing Phase 1–4B requests retain their current maximum of ten independent actions. Phase 5 does not raise that limit or create dependency execution. A multi-entity request requires clarification or an explicitly disclosed first subset; never claim all requested work was proposed.

Exclude milestone/Plan/task/project deletion, item removal, milestone or item reparenting, relinking existing items, task auto-creation, milestone ordering, checklist reordering, bulk/run-level Undo, redo subsystem, snapshots, arbitrary SQL/REST, public AI mutations, autonomous/background execution, new credentials, and multi-project bulk edits.

Checklist reorder is useful because the UI displays stored order. It is deferred, not modeled as arbitrary `sort_order` edits. Current reorder writes several sibling rows independently. Safe Agent reorder requires complete sibling identity/order/version history and an atomic mutation coordinated with manual reorder; that deserves a later dedicated design. It must not enter via `update_plan_item`.

## 5. Action matrix

All identifiers are internal UUIDs. `owner` always comes from the authenticated session. `version` means exact canonical `updated_at` captured by the server. Payloads below are stored canonical shapes, not browser approval requests. All failures return existing safe forbidden/invalid/conflict/retry behavior; no raw SQL errors escape.

| Source tool → canonical action | Target, identifiers, allowed fields | Before/version/diff | Apply path and ownership | Activity / Undo / failure |
| --- | --- | --- | --- | --- |
| `propose_create_milestone` → `create_milestone` | Milestone; existing `projectId`; title, description, targetDate; status fixed pending | Empty before, null target version; creation fields and owned project label | New `apply_agent_milestone_action`; lock/recheck owned project, append order server-side, insert + audit atomically | Created milestone; creation Undo unsupported; lost project fails; repeat Apply returns existing entity ID |
| `propose_update_milestone` → `update_milestone` | Existing `milestoneId`; title, description, status, targetDate; project immutable | Exact affected before values + immutable project context; milestone version; affected-field diff only | Same RPC; owned project then target milestone; one guarded patch through shared milestone primitive | Updated milestone; inverse same action; stale whole-row version conflicts; any unsafe affected historical field blocks entire inverse |
| Existing `propose_reschedule_milestone` → `reschedule_milestone` | Existing milestone; targetDate only | Existing date history/version contract | Existing schedule RPC delegates its milestone write to the same guarded primitive | Existing history/Undo stays readable; same target-date rules |
| `propose_create_plan` → `create_plan` | User-owned Plan; title, description from goal, timeframe, status, targetDate; optional bounded initial labels | Empty before, null version; metadata and numbered initial-checklist creation summary | New `apply_agent_plan_action`; one Plan insert + initial child inserts + audit in one transaction | Created plan with N steps; no project badge unless actual item links exist (initial items are unlinked); creation Undo unsupported; any child error rolls back all entity inserts |
| `propose_update_plan` → `update_plan` | Existing `planId`; title, description from goal, timeframe, status, targetDate; no checklist replacement | Exact affected metadata before values; Plan row version; affected diff | Same Plan RPC; direct user ownership + locked Plan; children untouched | Updated plan; inverse same action; child edits alone do not stale a metadata action, Plan edits do |
| `propose_add_plan_item` → `add_plan_item` | Existing `planId`; label, optional owned project/task links; done fixed false; append only | Empty item before plus canonical parent ID/version context; target version null; label/links creation diff | New `apply_agent_plan_item_action`; parent version guard and owner checks; validate linked project/task; append + audit atomically | Added plan item; creation Undo unsupported; deleted/stale parent or invalid links fail/conflict |
| `propose_update_plan_item` → `update_plan_item` | Existing `planId` and `itemId`; label and/or done only; plan/links/order immutable | Exact affected label/boolean before values plus canonical Plan/link context; item version; affected diff | Same item RPC; Plan ownership, current links, item belongs to Plan, locked item and strict item version | Updated or completed/reopened plan item; inverse same action; missing item/link fails, stale item conflicts |

`entity_id` identifies the created/updated milestone, Plan, or item. `project_id` is the milestone project or item link context and is null for Plan actions/unlinked items. Preserve parent Plan identity for items in canonical history: add payload contains `planId`; update before-state contains `planId` and current link IDs. It is rederived from the database, never an arbitrary authority supplied by Gemini. No new project relationship is inferred for a Plan.

No new audit parent FK is needed: deletion of a workspace item must leave history readable. Stable item/Plan context in bounded canonical history and safe projections provides navigation and missing-entity explanations.

## 6. Gemini proposal schemas and read tools

All objects reject unknown keys. All `changes` objects require at least one supported field. Required keys below are mandatory; `?` means optional, omission means preserve on updates. No tool accepts userId, before-state, version, audit IDs, inverse linkage, SQL, grants, or approval metadata.

```text
propose_create_milestone({ projectId, title, description?, targetDate? })
propose_update_milestone({ milestoneId,
  changes: { title?, description?, status?, targetDate? } })
propose_create_plan({ title, goal?, timeframe?, status?, targetDate?,
  initialItems?: [{ label }] })
propose_update_plan({ planId,
  changes: { title?, goal?, timeframe?, status?, targetDate? } })
propose_add_plan_item({ planId, label, projectId?, taskId? })
propose_update_plan_item({ planId, itemId, changes: { label?, done? } })
```

Bounds reuse existing Agent contracts where applicable: trimmed nonblank title up to 180 characters; description/goal up to 4000; valid date-only `YYYY-MM-DD` or null; existing status enums; maximum six model rounds, ten total tool calls, 32,000-byte Agent request, and 50-second Agent deadline. New bounds requiring approval: trimmed nonblank label up to 160 characters (aligned with existing item read excerpt), timeframe up to 180 characters or null, and zero to 20 initial items (aligned with current bounded checklist read). Validate actual JSON byte budgets too: canonical payload/before-state remain at most 40,000 bytes each; do not truncate to fit. Reject oversized content with a useful safe explanation. Do not impose these new limits retroactively on unrelated manual records.

Creation defaults: milestone description `''`, targetDate null, pending status; Plan goal `''`, timeframe/targetDate null, Planning status, no initial items; new item false completion and nullable links. An explicit valid Plan status may be used when requested. Empty title/label is invalid; empty description/goal clears text. Null title/description/goal/status/label/done is invalid. Null date/timeframe/link is a real supported empty value; an absent key is different. `taskId` requires a valid owned project context: derive project from the task if projectId is omitted; reject a supplied conflicting or explicit-null project. Canonicalize both links server-side.

Add only `get_milestone({milestoneId})` in the milestone slice. The current list cannot read description or a reliably complete single selected record; detail returns owned title/description/status/project/date and explicit truncation flags. Keep `list_milestones`, `list_plans`, and `get_plan`; no duplicate list reads.

Before item mutations, extend `get_plan` to return bounded item UUIDs, label, done, order, and safe owned link labels/IDs. Include timeframe and goal truncation flags. Add an optional bounded `checklistCursor` to this existing tool, with validated `(sort_order, id)` cursor semantics, deterministic ordering, and `nextChecklistCursor`; still at most 20 items per page. It is not a snapshot and must say when incomplete. Invalid/foreign links are unavailable and must not disclose foreign labels. Do not expose server version/audit metadata as mutation authority to Gemini. Ambiguous labels require clarification; no mutation by array index, duplicated title, truncated text, or guessed UUID.

Plan generation may suggest text without persisting anything. Persistence requires one of the bounded tools. A Plan generated “for project X” is a workspace Plan whose intended context can be stated in goal text; initial checklist rows stay unlinked. Explicit project/task links can be added individually later. Explain this existing product distinction instead of inventing Plan.projectId. If a real project-owned Plan is required, stop for a new model decision.

## 7. Canonical server validation and proposal persistence

Extend existing parser/collector/store/summary paths. Do not create parallel approval infrastructure or a second Undo algorithm.

1. Authenticate and use the owner-scoped server client for reads. Read canonical target/parent/link rows, not model-supplied prior values.
2. Validate IDs, ownership, allowed fields, enums, date/null/text/bool semantics, actual byte budgets, and current relationships. Determine exact affected fields; omit semantic no-ops and reject an empty patch.
3. Capture exact before-values for affected fields and current target version. Keep immutable parent/link identity separately in canonical before-state. Reject an affected old value that cannot be captured faithfully within the action contract; never store a misleading excerpt as reversible history. Unrelated oversized fields need not be captured or modified.
4. Merge repeated model calls for the same supported entity into its one pending draft only if the version remains unchanged. Mixed new mutation targets/families exceed Phase 5 scope and must not be partially persisted silently.
5. Extend `save_agent_proposal_batch` to validate new action shapes/ownership again and durably store one run/action atomically. Workspace tables are untouched at proposal creation. IDs and approval/inverse metadata are generated or derived on the server.
6. Return canonical cards and a server-generated summary saying nothing changed yet. Proposal collection/save may race with manual edits; subsequent strict Apply detects them rather than trusting the model's read.

For new boolean fields, extend the typed diff scalar to `string | boolean | null`; preserve false distinctly from null. Store raw canonical booleans in audit diff and format them in safe projections/cards. Initial items use structured bounded payload but a bounded numbered text creation summary in diff. No raw JSON is rendered. Existing string/null diffs remain compatible.

Extend canonical payload types by action family rather than permitting task, Plan, milestone, and block status values interchangeably. New canonical field keys are `timeframe`, `label`, `done`, `planId`, and `initialItems`; tool `goal` normalizes to canonical `description`. Only `timeframe`, `label`, `done`, and the rendered `initialItems` summary enter the new human diff whitelist. Parent Plan identity is projected separately as an owned reference/label, not a raw UUID diff. SQL validators are proposed as `private.agent_milestone_patch_valid`, `private.agent_plan_patch_valid`, and `private.agent_plan_item_patch_valid`, with explicit create/update modes and initial-item validation. Their final signatures belong in the implementation plan.

## 8. Apply, Cancel, recovery, and date semantics

Reuse `{runId, actionIds}` for Apply/Cancel, `{runId, actionId}` for Prepare Undo, and existing canonical recovery GET. Requests continue to reject extra keys. Browser never sends a mutation payload. The server reloads stored action and dispatches using its canonical type/linkage. Apply, Cancel, eligibility, preparation, and recovery never call Gemini. Review Again is the existing explicit request for a fresh proposal and may invoke Gemini; it never approves that proposal.

Each action RPC locks, revalidates current owner/links/version and canonical payload, mutates the workspace and records durable success in one transaction. On failure its entity changes roll back before recording safe failure. Repeated Apply returns the stored terminal result and created entity ID, preventing duplicate creation. If a response is lost, reload canonical status; do not assume failure or generate another creation. Multiple selected preexisting actions remain independent per-action transactions; no run transaction is introduced.

**Milestone date decision: include targetDate in update_milestone.** A description-and-date edit must be one atomic patch, not two independently stale actions. Reuse `private.agent_schedule_patch_valid` for the date subpatch and introduce one private guarded milestone patch primitive shared by the new milestone Apply RPC and the milestone branch of existing `apply_agent_schedule_action`. The primitive validates owner/project/version and writes the requested fields once; outer action RPC owns audit transitions. Do not call the existing schedule action RPC as a nested second approval/audit operation.

Retain `reschedule_milestone` tool/action/history for compatibility and date-only intent. New combined requests use update_milestone; canonicalization rejects two actions targeting the same milestone in one run across the old/new kinds. Both routes use the same date validator and write primitive. Existing reschedule_project remains unchanged. Dates stay nullable deadlines; no future-slot/overlap rule applies to deadline edits. Existing valid past deadlines remain valid. Resolve relative date intent using existing profile timezone/date rules; ambiguous dates require clarification. No task/milestone/project date cascade or implicit time-block creation.

Proposed shared primitive: `private.agent_apply_milestone_patch(p_user_id uuid, p_project_id uuid, p_milestone_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)`. It accepts only a validated milestone patch, obtains project-before-milestone locks, verifies exact version, and updates one row. It never creates/changes audit records or invokes another public Apply RPC. Its caller maps safe forbidden/invalid/stale outcomes into the existing durable result convention. Add bounded `MILESTONE_SAVE_FAILED`, `PLAN_SAVE_FAILED`, and `PLAN_ITEM_SAVE_FAILED` presentation codes when those new families ship; retain existing schedule/task/block codes and map unknown internal errors to a generic safe message.

## 9. Ownership, RLS, staleness, and lock order

Preserve existing RLS and browser permissions. Private Agent audit tables stay private. New public RPC entry points follow the current service-only pattern: SECURITY DEFINER, empty search_path, qualified relations, explicit owner predicates, EXECUTE revoked from PUBLIC/anon/authenticated and granted only to service_role. Internal helpers are not granted directly to any client role. Supabase documents the need to secure function privileges and search paths: [Database functions](https://supabase.com/docs/guides/database/functions).

Milestones require owned project then same-project target. Plans require matching user_id. Items require owned Plan, exact item parent, and all present project/task links owned by the same user; a task must belong to the linked project. An existing foreign or broken link blocks item mutation/Undo instead of silently clearing it. The Agent never reparents milestones/items or changes existing item links. A user-owned Plan may contain independent links, but Phase 5 never performs a cross-project bulk edit.

Use exact existing updated_at equality for target-row stale checks. Any post-proposal target-row edit, including an unrelated field, can conflict. A Plan metadata proposal checks Plan version, not child versions. Item update checks item version and current Plan ownership; add checks saved parent Plan version before insertion. Parent edits before preparation can be tolerated where unrelated; strict approval checks apply to the new canonical inverse's target version. No new version column is justified.

The following order extends Phase 4B's source/action/parent/target discipline. Acquire a stronger lock initially when required; do not upgrade shared locks later. Order multiple rows of a class by UUID.

| Order | Locks | Operations |
| --- | --- | --- |
| 1 | Immediate source Agent action FOR UPDATE | Prepare Undo and inverse Apply only; discovery of source ID is nonlocking |
| 2 | Existing inverse/current action FOR UPDATE | Prepare recovers existing inverse; ordinary Apply locks its action; Cancel locks only pending actions, never waits on source/entity afterward |
| 3 | Owning/linked project rows | Milestone create FOR UPDATE to serialize Agent append; milestone update/date FOR SHARE; item linked project FOR SHARE; no invented Plan project |
| 4 | Milestone rows | Target milestone FOR UPDATE; existing task-link paths retain their existing milestone-before-task order |
| 5 | Plan parent/target row FOR UPDATE | Plan metadata target, item add/update parent, item Undo parent; serialize Agent item append; updates must not lock item first |
| 6 | Linked task rows FOR SHARE | Item link validation; task row must match the locked project |
| 7 | Target item row FOR UPDATE | Item updates/Undo, followed by relationship rediscovery check |
| 8 | Newly inserted inverse run/action, or terminal audit/run bookkeeping | Workspace locks are retained through mutation/result; no entry point locks run first and then waits for action |

New Phase 5 paths never span multiple workspace targets. Plan creation inserts a new parent and its new unlinked children; no existing sibling locks are needed. Undo extends `agent_undo_lock_context` with the same ordering. Discover current relationships without locks, acquire parents/links, lock target, then compare discovered/locked context; use existing bounded retry behavior or safe failure if changed. Never wait for source while holding inverse, Plan, or item locks.

Append order remains the existing non-unique integer model. Agent additions serialize with each other under the parent lock. Existing manual inserts/reorders do not take that lock and can create tied sort_order values; do not claim globally unique append positions. New bounded reads use `(sort_order, id)` to resolve ties. Phase 5 append promises no sibling overwrite, not a globally exclusive list position. Reorder stays excluded until manual and Agent paths share an atomic order contract.

## 10. Migration decision and compatibility posture

**A migration is required.** Existing entity tables/RLS/timestamps suffice, but audit CHECK constraints enumerate current action kinds and require project context for non-block actions. `save_agent_proposal_batch`, Apply dispatch RPCs, Undo evaluator/lock helper, and safe Activity whitelist do not understand Plans/items/new milestone fields. TypeScript alone cannot safely extend them.

For the first milestone implementation slice, one additive migration must:

- Extend action-type and create/update shape constraints to include create_milestone/update_milestone. Preserve every old valid kind and shape, null-create/nonnull-update version rules, payload byte limits, direct inverse FK/index, and private grants.
- Add strict milestone payload validation and the shared guarded milestone write primitive; add service-only `apply_agent_milestone_action` and update the existing schedule milestone branch to delegate to it internally as described above.
- Extend save/batch projection and enforce one milestone target per run across update_milestone/reschedule_milestone, preferably with a partial unique index after a read-only duplicate preflight. If existing rows violate it, stop; do not rewrite audit history or delete duplicates.
- Extend the single SQL `agent_undo_evaluate`, context lock helper, guarded inverse dispatcher, Activity projection, and safe error whitelist for milestone fields/actions. No second evaluator.
- Keep all old action payloads/history/API contracts valid. Do not add entity columns, timestamp sources, broad browser grants, dependencies, or schema-wide repair.

Later approved Plan/item slices require their own additive migrations: extend action constraints to allow null project context for Plan/unlinked-item actions; strict metadata/item/initial-items validators; service-only Plan/item Apply RPCs; affected history and bool projections; item parent context; one-target-per-run guards; evaluator/lock/dispatch extensions. These later functions are not installed speculatively in the milestone release. Plan creation's initial children are part of one bounded create RPC, not separate approved actions.

Do not create migration files during Phase 5A. During implementation planning/execution, inspect all current migration names and generate a timestamp sorting after the latest at that time. Current latest inspected filename is `20261013090000_workspace_agent_safe_undo.sql`; do not reuse its timestamp or edit any applied migration. Keep schema documentation aligned only with changes actually introduced by the new migration, without copying unrelated schema.sql-only constraints into production.

Rollback posture: use forward compatibility. Reverting application code may leave additive DB support and new audit kinds; older UI must fall back safely for unknown historical types. Do not drop new action types/functions while pending/applied records depend on them. If first-slice legacy-history compatibility or rollback UI cannot be proven, stop before rollout. No rollback may delete audits or created workspace records.

## 11. Safe Undo integration

Updates ship with Undo in their slice, not in a final deferred safety phase. Extend **only** `private.agent_undo_evaluate`; TypeScript continues projection/transport duties. Activity and Prepare call the same SQL policy. Extend guarded inverse Apply to rederive and compare the canonical inverse, then delegate through the same mutation primitive as ordinary Apply.

- update_milestone restores only historically affected title/description/status/targetDate.
- update_plan restores only historically affected title/description/timeframe/status/targetDate.
- update_plan_item restores historically affected label/done. Parent and links must still match safe canonical context; no order or link restoration is attempted.
- create_milestone/create_plan/add_plan_item return stable `UNSUPPORTED_ACTION` with a bounded explanation that safe removal is unavailable. No permanent DELETE inverse. A created Plan with initial children is also unsupported as a whole.
- Existing task/date/block inverse mappings remain unchanged; create_task stays unsupported.

Before preparing, every affected current field must equal its historical resulting value. Unrelated earlier fields may survive, but changing one affected field blocks the entire multi-field inverse. Missing is not null, false is not null, and empty text is not absent. History must include usable exact affected values and consistent diffs; incomplete, truncated, invalid-enum, mismatched-parent or ambiguous history fails closed. Preserve existing conservative text-boundary treatment; no claim that a boundary-sized historical excerpt is complete.

Prepare captures current affected before-values and current target updated_at; Apply uses strict whole-row stale behavior. An inverse is a new action whose undo_of_action_id points to its immediate source. Original source status/payload/history remain immutable. An inverse may itself be inverted under the same supported rules. Reversed/reversed-by state remains derived.

Retain source locking, same-owner FK, non-self-reference constraint, and partial uniqueness for pending/applied inverses. Concurrent Prepare yields at most one live inverse; uniqueness loser recovers the canonical winner. Cancelled inverse permits fresh preparation after current eligibility passes. Prepare, Cancel, repeat Apply and lost-response recovery reuse existing endpoints. Opening Activity never prepares an inverse or creates audit rows.

Reason codes stay the current bounded `UndoReason` union wherever possible. Explanations remain at most 240 characters and inverseSummary at most 180. No raw payload, before_state, prompt, model reasoning, credentials, tokens, cookies, or internal exception text in Activity.

## 12. Activity and proposal card UX

Reuse AgentProposalCards and AgentActivity, extending field/type formatting, target resolution, navigation, recovery and Review Again together. Normal UI resolves labels and never falls back to printing raw UUIDs for new relationships.

| Action | Human presentation |
| --- | --- |
| create_milestone | “Created milestone” / pending “Create milestone”; title, project label, target date, description, pending status |
| update_milestone | “Updated milestone”; title/project, changed fields only; formatted target before/after, status before/after, description visibly marked Updated with bounded expandable content |
| create_plan | “Created plan”; title/goal, status/deadline/timeframe when present, numbered validated initial checklist, explicit workspace Plan scope |
| update_plan | “Updated plan”; affected metadata before/after; Goal label maps to description |
| add_plan_item | “Added plan item”; parent Plan label, item label, optional owned project/task labels, incomplete state |
| update_plan_item | “Completed plan item” for false→true done-only; “Reopened plan item” for reverse; otherwise “Updated plan item” with all affected changes |

Cards say Pending approval until canonical status changes. Undo cards keep the existing “Nothing has changed yet” banner and source reference, not auto-Apply. Long text wraps; optional disclosure only changes presentation, never canonical values. Initial checklist is rendered as rows, never JSON. Boolean false displays Incomplete, true Completed. Missing target/parent/link has a safe unavailable state and disables invalid navigation.

Add Plan and item navigation targets; item navigation opens the existing Plans view and selected parent/item if available, without inventing a new page. Refresh after successful Agent Apply must also reload `plans` in `app/app/page.tsx`; existing milestone/project progress refresh remains intact. An item change updates checklist percentage only, never Plan status or linked task completion. No changes to public sharing/public AI projections.

## 13. Test strategy before implementation

Write meaningful failing parser/domain/RPC/route tests before each slice's production code. Use real migration-chain table shapes rather than the simplified Phase 4B fixture alone: that fixture's milestone table lacks description/status/order and cannot prove milestone CRUD safety. Include migration-vs-schema documentation assumptions explicitly.

| Area | Required cases and expected proof |
| --- | --- |
| Milestone create | Defaults, each allowed field, owner project, missing/foreign project, invalid IDs/enums/text/date, null date, append without sibling overwrite, no insert before Apply, repeated Apply creates once |
| Milestone update/date | Each field, grouped fields atomically, no-op, empty vs omitted vs null, status independent of tasks, valid past date, no date/task/block cascade, existing reschedule tool uses shared primitive, duplicate old/new milestone targets rejected |
| Plan create | Defaults and metadata, 0/1/20 initial labels, 21 rejected, label/text/byte limits, duplicate labels retain distinct generated IDs, newline/untrusted content, no project_id fiction, child failure rolls back Plan + all children + success audit, repeat Apply/lost-response recovery |
| Plan metadata | Every field, null timeframe/date, empty goal, invalid status, missing/foreign Plan, stale Plan, unrelated child edits don't stale metadata, no checklist replacement |
| Item add/update | Parent membership, UUID identity, duplicate-label clarification, label and false/true completion, multi-field label+done, task-derived project, conflicting/foreign links, existing invalid links blocked, append ties handled deterministically, link/order/parent change rejected, no task creation/completion cascade |
| Shared safety | Unknown/model-authoritative keys denied; one new Phase 5 action and no mixed mutation run; identifier-only Apply/Cancel/Prepare; owner isolation; no workspace writes before approval; Cancel only pending; operational rate limits/lease/origin guards; no Gemini on Apply/Cancel/Undo/recovery |
| Staleness | Manual target edit between propose/Apply; missing/deleted parents/entities; relationships changing during discovery; add parent-version conflict; metadata vs item-version distinction |
| Undo | Each supported field incl bool/null, grouped patch all-or-none, affected mismatch, unrelated pre-Prepare edits, unrelated post-Prepare edit conflicts, incomplete/truncated history, item parent/link loss, unsupported creates, inverse-of-inverse, repeat Prepare/Apply, cancelled then fresh preparation, source audit immutability |
| Projection/UI | Safe fields only, bounded explanations/summaries/content, bool preserved, no UUID fallback, creation initial-list display, Activity status/navigation, Review Again/recovery, no audit creation on read, Plans refresh, long content and duplicate labels |
| Database security | Constraints accept old kinds and reject bad new shapes; service-only function grants; direct browser denial; owner/parent/link checks; same-owner inverse FK/partial uniqueness unchanged; no applied migration edits |
| Regression | All Phase 1–4B Agent suites; workspace/private AI and public AI isolation; Calendar/time blocks/overlap exclusion; Focus Session; manual milestone/Plan CRUD; project progress and accountability consumers |
| Responsive | Cards, Activity, Plan navigation and long checklist/text at 320, 390, 768, 1024 and 1440 CSS pixels; keyboard approval/cancel and scrolling |

Disposable PGlite proves SQL behavior, transactions, constraints, idempotence and serial interleavings. Report skipped tests and fixture limitations. It does **not** prove genuine multi-connection PostgreSQL lock races. Before each rollout, run authorized tests on a suitable disposable true PostgreSQL environment: duplicate Prepare, Prepare vs Cancel, inverse Apply vs manual edit, concurrent ordinary Apply, parent deletion/link edits vs Apply, and concurrent Agent appends. Show one canonical live inverse, no lost writes/partial aggregate, and no lock inversion. Existing manual order ties are a documented model limitation, not proof of reorder safety. Never use production race fixtures without separate explicit rollout authorization.

Suggested execution validation (not run for this documentation-only task):

```powershell
# Discover the already available runtime; do not install a dependency silently.
# Set AGENT_TEST_PGLITE_MODULE to its verified index.js path before database tests.
$phase5Tests = @(rg --files lib/ai/agent -g 'phase5*.test.mjs')
node --test @phase5Tests
$agentTests = @(rg --files lib/ai/agent -g '*.test.mjs')
node --test @agentTests
npm run test:ai
npm run test:public-ai
npm run test:calendar
npm run test:focus-session
npm run test:accountability
npm run test:workspace-shell
npx tsc --noEmit
# Run ESLint on the exact changed source/test files, then build.
npm run build
git diff --check
```

Read installed Next.js guides before any future route/UI implementation. Test filenames and exact lint file list belong in the approved implementation plan; there are no new executable tests yet.

## 14. Recommended subphases, risks, and stop conditions

| Subphase | Deliverable and release boundary |
| --- | --- |
| **5A — current** | This repository-grounded design for owner review; stop here. |
| **5B — first implementation** | create_milestone/update_milestone; get_milestone detail; shared target-date path and legacy compatibility; cards/Activity/recovery; update Undo; one additive milestone migration and tests. |
| **5C — Plans** | create_plan with bounded atomic initial unlinked checklist, update_plan metadata, bounded get_plan metadata extensions, Plan UI refresh/navigation, update Undo, dedicated additive migration/tests. |
| **5D — checklist** | add_plan_item/update_plan_item label+done, bounded item identity/link/order reads via get_plan pagination, ownership/context locks, update Undo, dedicated additive migration/tests. No reorder/remove. |

Each slice requires its own concrete implementation plan and approval. No final “Undo later” release: supported updates must be safely reversible before their slice is declared complete. Reorder, bulk workflows and actual project-owned Plans wait for separate design; Phase 6 may address advanced bundles, not silently absorb missing Phase 5 safety.

Known risks and blockers:

- Migration history and schema.sql differ. Verify effective definitions before implementation fixtures/rollout; add only necessary Agent changes. Do not claim missing checks are deployed.
- Existing manual writes are not guarded whole-row Agent transactions; they remain possible conflict sources. Append order ties can exist. Reorder cannot be accepted under these assumptions.
- Existing Plan/item link policy is narrower than relationship validation needed by privileged Agent RPCs. Every present link must be checked, even on label-only edits.
- `lib/ai/context.ts::projectPlans` reads `plan_items`, while inspected migrations define `project_plan_items` and no matching alias. This is a separate private-AI path discrepancy, not the Agent read path. Report/reproduce in regression work; do not repair it during Phase 5A or assume a remote view exists.
- `isBlockMoveRequest` in `block-resolution.ts` uses broad move/reschedule/cancel + block/it/this matching before model calls. Add regression coverage for milestone/Plan/status requests and titles containing those words; narrow routing only if a reproduced case blocks the new supported behavior. Do not redesign scheduling.
- New types/booleans/initial arrays touch summary, diff projection, review prompts, dispatch, recovery, and refresh. Missing one integration may create misleading cards or unsupported Activity navigation.
- Initial atomic Plan creation is a deliberate bounded aggregate exception for review. If it cannot fit existing audit/response budgets or transaction/retry guarantees, stop and return to the owner; do not fall back silently to multiple item actions.
- Historical large text, bad enum values, and lost links must yield explicit unsupported/unsafe outcomes; never truncate canonical history to make Undo pass.
- Hosted Phase 4B acceptance, production state, and true PostgreSQL races are not reverified by this repository-only discovery.

Stop implementation/rollout on any unproven ownership, atomicity, stale-version, inverse-history, audit-immutability or lock-order invariant; a needed dependency/infrastructure/model change; unsupported migration drift; duplicate existing audits preventing a new uniqueness guard; inability to preserve old date actions; or pressure to remove approval/uniqueness/overlap safeguards. Return the concrete blocker for review rather than weaken the guarantee.

## 15. Acceptance criteria and owner recommendation

1. Owner approves this written scope, including workspace-owned Plans, atomic bounded initial checklist creation, excluded reorder/removal, and subphase naming.
2. First milestone slice supports exactly the two new proposal tools/action kinds, with narrow detail read and compatible existing date tool; every supported request yields a readable pending card.
3. Gemini never mutates workspace data or supplies authoritative owner/version/history/linkage. Apply/Cancel/Undo/recovery remain Gemini-free and identifier-only at the browser boundary.
4. Multi-field update is one transaction; stale target/version/link failures never partially update. Repeat Apply and lost response cannot duplicate creation.
5. One canonical milestone date write path preserves old reschedule history/Undo and does not change any other deadline or time block.
6. Update Undo uses the shared SQL evaluator, exact affected history, current-state checks, direct lineage, one-live-inverse constraints, and strict post-Prepare stale behavior. Creation/removal inverses stay unsupported.
7. Later Plan creation is one atomic Plan-plus-initial-children action; Plan/item metadata, ordering and completion retain the existing model. No task creation or general bundle executor appears.
8. Activity remains read-only, safe and bounded; proposal/recovery/Review Again/navigation/refresh work at all five widths.
9. Each slice passes its focused and relevant regression checks with actual counts/skip reasons; true PostgreSQL concurrency claims require actual multi-connection proof during separately authorized rollout.
10. Only new additive migrations are used, private audit/grants remain protected, and no production operation occurs without separate authorization.

**Recommendation:** Keep Phase 5A spec-only. Build `propose_create_milestone → create_milestone` and `propose_update_milestone → update_milestone` first in Phase 5B, with update Undo and the shared existing targetDate path. One additive milestone migration is required for audit constraints and guarded RPC/projection/Undo extensions; no new entity table/version column is required. Plans and checklist mutations wait for Phase 5C/5D. Reorder, removal, project-owned Plans and bundled workflows require later design. Stop now for written-spec review; do not implement yet.
