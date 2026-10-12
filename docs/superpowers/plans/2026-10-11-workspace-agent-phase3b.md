# Workspace Agent Phase 3B Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task in the current session. Do not commit, push, deploy, or apply migrations to production.

**Goal:** Persist editable Calendar time blocks and support verified scheduling proposals, including Plan my day.

**Architecture:** Keep deadline events separate from timed blocks. Reuse `profiles.time_zone`, authenticated data services, private Agent actions, and explicit Apply/Cancel. Pure scheduling helpers calculate actual instants and free slots; database constraints enforce ownership, range validity, concurrency safety, and atomic application.

**Tech Stack:** Existing Next.js, React, TypeScript, Supabase/PostgreSQL, Intl, node:test and disposable PGlite. No new runtime date library.

**Spec:** `C:/Users/Franz/.codex/attachments/8ba9068e-51ab-4272-8bb8-de84bbb0f289/Pasted text.txt`

## Global Constraints

- Existing Phase 1, 2 and 3A behavior and deployed migrations remain intact.
- Gemini reads and proposes only. Apply/Cancel never call Gemini; browser sends stored identifiers only.
- No production migration, commits, pushes, deployments, external writes, authenticated demo fallback, or new estimation subsystem.
- Time blocks use timestamptz instants; deadlines retain existing date-only semantics.
- Scheduling requires saved work hours or an explicit requested range. No assumed 9–5 window.
- Reject nonexistent and ambiguous local times; never silently choose a DST occurrence.
- Single block duration capped at 12 hours. Saved default focus duration and explicit durations drive scheduling.
- Existing ten-action/ten-tool-call bounds remain; bounded partial schedules must disclose omissions.
- Cancellation preserves records and audit history; proposal cancellation and block cancellation remain distinct.

## Review Focus

1. Midnight and DST boundaries: local Calendar placement and round-trip conversion must agree.
2. Concurrent overlap: two otherwise valid overlapping inserts must not both commit.
3. Reparented tasks/projects: link correctness must survive ownership and relationship changes.
4. Lost Apply response or mixed batch: retry cannot duplicate blocks; each action retains its actual status.
5. Truncated availability/context: never treat omitted blocks or tasks as free time or a complete plan.

## Repository Evidence

- `data/workspaceCalendar.ts` normalizes derived task, milestone and project dates.
- `components/calendar/WorkspaceCalendar.tsx` owns month selection and selected-day agenda.
- `data/accountabilityDataService.ts` reads/writes `profiles.time_zone`; reuse this source.
- `data/focusSession.ts` implements the existing session timer; handoff must use it without rewriting persistence.
- `lib/ai/agent/proposals.ts` canonicalizes proposal payloads without mutations.
- `lib/ai/agent/store.ts` dispatches deterministic service RPCs and reloads persisted status.
- Private actions currently require a project; a new migration must permit null projects only for time-block actions.
- Existing database acceptance uses disposable PGlite with Phase 2 then Phase 3A migrations.

## Task 1: Scheduling domain and strict time conversion

**Files:** Create `data/timeBlocks.ts`, `data/timeBlocks.test.mjs`; extend `types.ts` and `data/database.types.ts`.

**Interfaces:** `WorkspaceTimeBlock` contains owner/link IDs, title, start/end instants, kind, status, notes and version timestamps. `SchedulingPreferences` contains workday start/end, weekdays, focus duration and buffer, with no timezone column. Export strict local-wall-time conversion, block range validation, overlap and bounded free-slot functions.

- [ ] Write failing tests for valid UTC/Manila conversion, local midnight placement, DST gap/fold rejection, malformed dates/offsets, start >= end and >12-hour duration.
- [ ] Run `node --test data/timeBlocks.test.mjs`; confirm missing behavior fails.
- [ ] Implement conversion using Intl round-trip matching of candidate UTC offsets. Require exactly one matching instant for local wall times.
- [ ] Add failing tests for back-to-back blocks, ignored cancelled blocks, merged occupied ranges, buffer, workday boundaries, no gaps and bounded results.
- [ ] Implement sorted/merged availability with half-open intervals, explicit range or saved work window, and conservative handling of truncated occupied data.
- [ ] Re-run domain and existing Calendar/focus tests.

## Task 2: Persistent storage and database invariants

**Files:** Create a newly timestamped `supabase/migrations/*_workspace_agent_time_blocks.sql`; create `lib/ai/agent/phase3b-database.test.mjs`.

**Interfaces:** Owner-scoped `public.workspace_time_blocks`, `public.workspace_scheduling_preferences`; narrow `public.apply_agent_time_block_action(p_user_id uuid,p_run_id uuid,p_action_id uuid)` for service role only.

- [ ] Write failing disposable database tests applying unchanged Phase 2 and 3A migrations before the new migration.
- [ ] Add RLS, authenticated owner SELECT/INSERT/UPDATE, safe relationship validation, immutable ownership, update stamps and user/range/link indexes. Preserve cancelled blocks rather than granting UI hard deletion.
- [ ] Enforce finite timestamps, start < end, duration <=12 hours, allowed kind/status and task/project ownership consistency in the database.
- [ ] Use database exclusion enforcement for active overlap if the existing PostgreSQL/PGlite extension support permits it; otherwise implement and prove owner-serialized writes with a locking design that also handles concurrent snapshots. Do not rely on a plain pre-insert SELECT.
- [ ] Extend action type/version constraints and canonical batch serialization for the three time-block actions. Require project IDs on legacy action types.
- [ ] Extend proposal save validation and add static, qualified, empty-search-path Apply SQL. Lock canonical action and entity, validate current relationships/version/range/overlap, mutate and audit atomically.
- [ ] Test old pending/applied/cancelled actions, unsupported types/fields, cross-user RLS, forged links, stale updates, overlap introduced after proposal, concurrent writes, idempotence, mixed batches and audit-failure rollback.
- [ ] Test service RPC grants and normal authenticated CRUD separately.

## Task 3: Authenticated manual Calendar editing and preferences

**Files:** Create `data/timeBlockService.ts`, `components/calendar/TimeBlockEditor.tsx`, `components/calendar/SchedulingPreferences.tsx`; modify `components/calendar/WorkspaceCalendar.tsx`, `app/app/page.tsx`, and `data/workspaceService.ts` only where integration needs it.

**Interfaces:** Bounded range reads, validated create/update/status operations returning existing `ServiceResult` results; preference load/save; Calendar callbacks to open linked entities and explicitly start focus.

- [ ] Read installed Next.js guidance before changing page/API conventions.
- [ ] Add failing data-service tests for missing auth, invalid IDs/ranges, refresh, owner-scoped queries and explicit errors.
- [ ] Load blocks for the visible month/day range, with cancellation-safe request lifecycle and no unbounded history or per-day query loop.
- [ ] Add timed blocks to the current month cells and selected-day agenda without changing deadline normalization or dragging semantics.
- [ ] Add accessible manual create/edit/complete/cancel controls, local date/time inputs, optional consistent task/project links, and surfaced overlap failures.
- [ ] Add saved work-hours/weekdays/focus-duration/buffer settings. Offer defaults only as unsaved form values. Reuse persisted timezone.
- [ ] Add explicit task-linked Start focus handoff using existing timer state and bounded remaining/block duration. No automatic completion or task mutation.
- [ ] Run service, Calendar and focus tests plus changed-file type/lint checks.

## Task 4: Agent reads, canonical proposals and planning

**Files:** Modify `lib/ai/agent/registry.ts`, `schemas.ts`, `tools.ts`, `proposal-schema.ts`, `proposals.ts`, `contract.ts`, `store.ts`, `prompt.ts`, `gemini.ts`, `executor.ts`, `schedule-summary.ts`; create focused `lib/ai/agent/time-blocks.ts` and `phase3b.test.mjs` as needed to keep scheduling logic separate.

**Interfaces:** `list_time_blocks(startAt,endAt,projectId?,taskId?,includeCompleted?)`, `get_day_schedule(date)`, `find_free_time(date,durationMinutes,earliestTime?,latestTime?)`; create/update/cancel time-block proposal tools; existing batch and action result envelopes.

- [ ] Write failing schema/read tests for bounded ranges, owned summaries, preferences, timezone, deadline context and verified slots.
- [ ] Include current local date, local time and timezone in model context. Require clarification for ambiguous entities or wall times.
- [ ] Return day schedule/preferences with relevant incomplete task and deadline context efficiently within existing tool limits.
- [ ] Parse strict allowed proposal fields; canonicalize from owned rows; derive before/version/link labels from the database. Detect overlap against persisted blocks and other pending blocks in the batch.
- [ ] Keep block cancellation separate from pending proposal cancellation. Dispatch time-block Apply to its own narrow RPC.
- [ ] Implement deterministic task ranking and slot allocation for Plan my day using incomplete status, overdue/near due/priority and project/milestone deadlines. Use saved/explicit duration and work window; disclose bounded omissions.
- [ ] Require Find me time proposals to match verified availability; return no proposal when no slot fits. Do not move deadlines or existing blocks during planning.
- [ ] Test generation causes no writes; Apply/Cancel cause no Gemini calls; invalid/unverified slots never become proposals; repeated generation/Apply and partial batches preserve truthful state.
- [ ] Re-run Phase 1, Phase 2 and Phase 3A tests.

## Task 5: Proposal presentation and end-to-end acceptance

**Files:** Modify `components/ai/AgentProposalCards.tsx` and its existing parent only as needed; add focused presentation tests. Temporary local browser fixtures must be removed before final diff.

- [ ] Write failing presentation tests for block labels, readable local start/end diffs, linked entities, cancellation distinctions and stale recovery.
- [ ] Preserve existing action states, selected Apply, Cancel, Review again and canonical refresh.
- [ ] Run local/mock browser acceptance at 1440, 1024, 768, 390 and 320 pixels: month/agenda, manual CRUD/conflict/cancel, refresh persistence, scheduling settings and explicit focus handoff.
- [ ] Exercise Agent Find 90 minutes, Block 9–10, Plan my day, proposal-only generation, Apply, stale conflict, Cancel and refresh. Record which scenarios were actually exercised.
- [ ] Run all discovered `.test.mjs` files with disposable PGlite enabled, `npx tsc --noEmit`, changed-file ESLint, `npm run build`, and `git diff --check`.
- [ ] Confirm applied migration files unchanged and remove temporary fixtures. Report unrelated failures separately.
- [ ] Write the requested 37-point sign-off report with exact results, limitations and production rollout steps; leave all work uncommitted and undeployed.

## Execution and Stop Condition

Implement locally in this session after plan review. Stop when the requested paths and checks pass, or report a concrete unresolved blocker without claiming completion. Production rollout remains a separate user action.
