# Workspace Agent Phase 4B: Safe Undo through inverse proposals

## Status and intent

Architectural design approved by the owner on 2026-10-12. This document specifies that design for review before implementation planning. Base release: `89d8200cc888ea560f1c6ea0339b47b674bad9e9`.

Users can prepare a reversal of one applied Agent action, inspect a new canonical proposal, and explicitly Apply or Cancel it. Current workspace state is authoritative. Original actions remain unchanged; an inverse is a new run/action with durable provenance. Reading history never creates proposals or changes workspace content.

No arbitrary rollback, snapshots, run-level reversal, permanent task deletion, Gemini inverse derivation, new broad mutation tools, or automatic approval. No production migration, commit, push, deployment, environment change or unrelated refactoring during implementation.

## Repository evidence and reuse

- `private.agent_actions` already retains canonical payload, before_state, diff, entity/owner/run IDs, expected_updated_at, status and execution timestamps.
- `lib/ai/agent/proposals.ts` canonicalizes task/date proposals. Task before-state text can be truncated; milestone diffs contain display labels rather than authoritative IDs.
- `lib/ai/agent/time-blocks.ts` captures canonical block fields, validates links/ranges and checks availability. PostgreSQL also enforces overlaps with an exclusion constraint.
- `lib/ai/agent/store.ts` reloads canonical batches and dispatches to existing task, scheduling and block Apply RPCs. Those RPCs lock rows and validate the stored expected version.
- Task Apply owns completed_at semantics. Undo must change status through this path, never restore a historical completion timestamp.
- `AgentActivity` and `AgentProposalCards` already provide detail, safe projection, approval, cancellation, refresh and transport recovery.
- Existing task deletion is permanent and can detach dependent block/file records. Safe creation reversal cannot be established without expanding scope.

## Supported inverse-action matrix

- **update_task:** inverse update of historically changed title, description, status, priority, dueDate and milestoneId, subject to complete usable history, field compatibility and valid links.
- **reschedule_milestone:** same action type restoring historical targetDate, including a valid null value.
- **reschedule_project:** same action type restoring historical targetDate, touching no unrelated project fields.
- **create_time_block:** cancel_time_block with payload `{status: 'cancelled'}`. Require the block still matches its created canonical fields and remains scheduled. A completed or materially changed block is unavailable. Preserve notes; a subsequently annotated block is treated as changed for creation reversal.
- **update_time_block:** update_time_block restoring only historically changed canonical fields: title, startAt, endAt, projectId, taskId, kind and status. Revalidate the complete resulting block and compatibility of coupled fields.
- **cancel_time_block:** update_time_block restoring the previous supported status only when the complete cancelled block still matches its historical resulting state, the previous status is scheduled, the slot is future/free and links remain valid.
- **create_task:** unsupported in Phase 4B. Explain that safe removal is unavailable.
- **Unknown, non-applied, incomplete or ambiguous historical actions:** unavailable with a safe explanation; do not guess or partially reverse a multi-field action.

An inverse can itself be undone as a separate applied action under the same rules. For example, undoing creation produces cancellation; undoing that cancellation may restore the future block. An original action whose inverse applied remains linked as reversed, even if a later inverse reverses that inverse.

## Eligibility and historical interpretation

A single deterministic server/domain policy supplies both Activity eligibility and preparation validation. PostgreSQL performs authoritative checks during persistence and approval. Safe eligibility output includes state, reason, human explanation, inverse summary and owned references to an existing inverse where applicable. It never exposes raw audit payloads.

States: `available`, `unsafe`, `already_reversed`, `entity_missing`, `state_changed`, `unsupported`. A pending linked inverse is represented as available with an existing proposal reference and a “Review undo proposal” affordance; preparing again returns that batch. A linked applied inverse yields already_reversed. Cancelled/conflicted/failed inverses do not permanently consume the source; fresh preparation is allowed only after current eligibility is proven again.

Checks, in order:

1. Authenticate and load the exact historical run/action under the authenticated owner. Foreign or unavailable IDs receive the existing generic forbidden response without revealing existence.
2. Require applied source status and a supported action family. Resolve existing pending/applied inverse linkage before attempting a second proposal.
3. Require a current owned entity and valid owning project/context. An entity moved into another project is not silently treated as the old context.
4. Derive affected fields from canonical historical data and cross-check the recorded diff. Use raw canonical milestone UUIDs from before_state/payload, never human labels from diff. Missing keys are distinct from explicit null. Remove semantic no-ops; reject empty, malformed or inconsistent inverses.
5. Compare each affected current value to the historical resulting value using domain representations: calendar dates, normalized instants, exact enum/UUID/null values and supported text semantics. Reject any affected-field mismatch.
6. Build an inverse touching only those affected fields. Unrelated task description/priority changes do not block a due-date inverse. Time range and task/project links are coupled: evaluate the complete resulting range and relationship, rather than treating each member in isolation.
7. Reject history whose old value cannot be faithfully represented by the existing action contract. In particular, conservatively reject potentially truncated historical text at the excerpt limit/ellipsis boundary. Do not invent lost text or coerce an invalid old value into a different reversal.
8. Validate the resulting entity and links through existing domain rules. Restoring milestoneId requires a current owned milestone in the same project. Restoring block taskId/projectId requires a valid same-owner relationship.
9. For any inverse that reactivates a cancelled block or changes a live time range, require resulting start time strictly in the future and a valid bounded range. Check overlap against every non-cancelled block for the owner, excluding the affected block. If the original slot is occupied or cannot be verified, return unavailable; do not propose an impossible restoration.

Task before-state description uses the existing domain's empty-text representation; there is no attempt to reconstruct SQL storage details lost by historical canonicalization. Task due-date reversal follows existing date-only intent and persistence semantics. No inverse restores completed_at, updated_at, created_at, sort order or unrelated metadata.

Field compatibility is evaluated at preparation time rather than requiring the source's obsolete whole-row expected version. The new inverse captures the current version. After preparation, existing whole-row stale checks remain unchanged: even an unrelated subsequent edit may cause Apply to conflict, requiring a fresh proposal.

## Durable linkage and one additive migration

One new Phase 4B migration adds nullable `undo_of_action_id` to private.agent_actions, a composite same-owner foreign key to `(id, user_id)`, the necessary referenced unique key/index, a non-self-reference check, and a partial unique index allowing at most one linked inverse with status pending or applied for each source action. Existing rows have null linkage; no original status, payload, timestamps or history is rewritten.

Canonical operational payload validators reject extra fields, so linkage does not belong in payload. A real relationship permits owner constraints and database-enforced duplicate protection, including concurrent requests.

The migration also adds narrow service-only eligibility/preparation/guarded-Apply functions and extends existing private canonical-batch and safe Activity projections to include explicit linkage. Existing applied migration files remain immutable. No table access or function execution is granted to browser roles. Public service entry points use SECURITY DEFINER, empty search_path and qualified relations; internal helpers remain private.

No applied mutation RPC is replaced or weakened. The inverse Apply entry point validates the inverse and delegates the actual mutation to the existing task/date/block RPC. Ordinary actions continue through their current dispatch. The server selects inverse dispatch from the reloaded canonical action's stored linkage, never from browser metadata.

## Prepare endpoint and transactional invariants

`POST /api/ai/agent/activity/undo-proposal` accepts exactly `{runId, actionId}`. Reject extra keys, invalid IDs, oversized bodies and cross-site requests. Reuse existing authenticated Agent route conventions, no-store responses and operational concurrency/rate controls. No Gemini call or prompt persistence.

The server/service transaction:

1. Locks and verifies the owned applied source action.
2. Recovers any existing pending inverse, or returns already_reversed for an applied one.
3. Locks/reloads the current entity and required parent/link rows; recomputes authoritative eligibility using the current state.
4. Builds a validated canonical inverse with a new action ID, current before-state, current expected_updated_at and human-readable diff.
5. Calls the existing proposal persistence machinery, associates the new action with its source in the same transaction, and returns the canonical batch.

The mutation of operational audit records is explicit preparation; workspace entities remain untouched. Linkage cannot be attached through the normal browser/Gemini draft contract. Failure rolls back the entire new run/action/link transaction, leaving no orphan run.

Source-row locking plus the partial unique index ensures concurrent preparation cannot persist two live inverses. A response lost after persistence can be retried with the same historical IDs and recover the existing pending inverse. Cancellation followed by preparation may create a new inverse; a cancelled proposal is never silently reused or applied.

## Apply, Cancel and race protection

Existing browser Apply/Cancel requests still contain only runId/actionIds. Existing card recovery GET is retained. The server reloads the batch and routes inverse actions through a narrow guarded Apply RPC.

The guard revalidates ownership, source applied status, stored linkage, supported inverse derivation, current entity version, affected-field compatibility, valid links and applicable future/range rules. It must verify that the persisted inverse matches the deterministic inverse, not merely trust a historical payload. It then calls the existing mutation RPC in the same transaction while required locks remain held.

Use a consistent source/action/parent/entity lock order compatible with existing Apply locks; do not introduce a preparation-versus-approval deadlock. Never hold an inverse row lock while waiting on a source lock acquired in the opposite order by preparation. Local PostgreSQL concurrency tests must exercise duplicate preparation, preparation versus cancellation, inverse Apply versus manual edits, and repeated Apply.

The slot check at preparation is advisory eligibility, not the concurrency invariant. The existing database exclusion constraint remains authoritative at mutation and rejects an overlapping concurrent write. Expiry is rechecked immediately before mutation using current server/database time. A failed/stale/overlapping inverse reports the existing canonical conflict/failure result and never partially changes the entity. Normal cancellation changes only the new inverse row through the existing Cancel path.

Original source actions remain unchanged on preparation, Apply, Cancel, retry and error. Applied inverse linkage is derived on reads. Repeated Apply returns its persisted outcome without re-execution.

## Activity and proposal UI

Each applied action detail shows eligibility and an explanation. Available actions offer “Prepare undo”; pending inverses offer “Review undo proposal”; applied inverses show “Reversed later” with an owned history link. Unavailable actions show why instead of disappearing.

Preparation renders the existing AgentProposalCards with a clear “Undo proposal” introduction, source action date and “Nothing has changed yet.” Standard Apply/Cancel controls remain unchanged. Linkage metadata is additive and optional in proposal types so old batches remain compatible; existing recovery projection preserves it after reload.

After a decision, refresh canonical history and source eligibility. Both source and inverse remain visible. Show “Undo of action from …” on the new record and “Reversed by …” on the original only when an inverse actually applied. Safe projections contain only owned identifiers, timestamps, eligibility explanations and normal displayed diffs. No raw before_state, hidden reasoning, original prompt or unrelated entity data.

No run-level Undo control, bulk inverse preparation, automatic retry/execution or new Gemini tool. Existing Review again, navigation and deleted-entity behavior remain intact. Long reasons, linkage and buttons wrap at 1440/1024/768/390/320 without document overflow.

## Validation and acceptance

Add focused domain, PostgreSQL, authenticated route and UI/recovery tests for all cases in the original Phase 4B brief, including:

- Supported task fields individually and together; unrelated edits allowed at preparation; affected edits blocked; current-version stale approval; milestone UUID handling; completion semantics.
- Date reversal and explicit null; missing/foreign entity/link; incomplete or truncated history; unsupported create_task/unknown/non-applied action.
- Block creation cancellation, update restoration, future cancellation restoration, past/expired restoration rejection, occupied slot, coupled links/range and database overlap races.
- Source audit immutability, new run/action/link, same-owner FK, unique pending/applied inverse, cancellation/retry, applied inverse detection, inverse-of-inverse, duplicate preparation and repeated approval.
- Identifier-only requests, extra-field rejection, owner isolation, service-only grants, no Gemini and no raw audit projection.
- Available/unavailable/pending/reversed UI, standard cards, canonical refresh/reload/lost-response recovery and preservation of original history.

Run Phase 4B and Phase 4A/3B/3A/2/1 tests, private/Public AI, Calendar/Focus and full suite, then TypeScript, changed-file ESLint, build and tracked/new-file diff checks. Read installed Next.js guides before changing route/component code. Exercise local authenticated or isolated mock-safe browser acceptance at all five requested widths. New SQL is tested only in disposable local PostgreSQL/PGlite; no production application or acceptance mutation is authorized for Phase 4B.

If concurrency, exact reversal or migration compatibility cannot be proven, report the concrete blocker instead of weakening the invariant. Finish implementation with the requested 37-point report, exact results, limitations and rollout prerequisites. Rollout requires separate authorization to apply the additive migration, release code and perform production acceptance.

## Review decisions and boundaries

- Database linkage is preferred over JSON metadata because ownership and duplicate protection must be enforced atomically.
- Existing mutation RPCs are reused behind an inverse-only guard, preserving normal action behavior.
- Field-level preparation preserves unrelated changes; existing whole-row approval checks remain deliberately strict.
- Task creation reversal is excluded because safe reversible removal is absent.
- Time-block restoration is stricter than ordinary editing because an old cancellation must not reactivate expired or occupied work.
- Historical data loss fails closed. No backfill guesses, prompt storage or repair of genuine audit rows.

Written-spec approval is the next gate. Implementation planning and product changes have not started.
