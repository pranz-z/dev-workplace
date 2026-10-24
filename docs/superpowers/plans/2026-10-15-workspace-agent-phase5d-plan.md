# Workspace Agent Phase 5D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task after explicit implementation authorization. Steps use checkbox (`- [ ]`) syntax for tracking. This request authorizes planning only; an execution method must be selected with the implementation authorization.

**Goal:** Add periodic deterministic workspace observations and a private Agent Inbox, with optional separately consented Gemini ideas and no autonomous workspace mutation.

**Architecture:** Supabase Cron/pg_net dispatches an HMAC-authenticated Node route. PostgreSQL claims and fences bounded owner work; three owner-scoped Agent tables hold memory, while one content-free installation ledger preserves slot identity and global accounting across account deletion. A pure TypeScript scanner publishes observations before optional one-attempt Gemini interpretation; Inbox Review prefills the existing composer and preserves explicit Apply/Cancel.

**Tech Stack:** Existing Next.js 16.3.6, React 19.2.8, TypeScript, Supabase/PostgreSQL, `@google/genai` 2.24.0, Node test runner, existing external PGlite and disposable PostgreSQL. Zero new application dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-workspace-agent-phase5d-design.md`, owner approved with the installation-ledger and 2026-10-16 current-episode attempt-authority clarifications. Amended-spec SHA256: `C7D9C9DDD9F31E813E9363152A8FA3C860AF7E23A2118F4768679669FC381CBD`.

**Status:** Completed documentation plan for owner review; not implementation authorization. The prior account-deletion blocker is resolved by the explicitly approved fourth table, without restricting deletion.

## Global constraints

- Execute only after separate owner approval. Baseline branch is `codex/workspace-agent-phase5d`; HEAD is `9c78e912b76b64de7743c8b1a31723cc6945c4bc`; worktree is `C:/Users/Franz/.codex/worktrees/workspace-agent-phase5d/software-workplace`.
- Resume verified only the existing specification and incomplete plan as documentation changes. No implementation/migration/configuration changes existed. Only the approved ledger amendment and plan completion are permitted now.
- No task below has been executed. No migration timestamp is allocated. The amended spec must remain unchanged during later implementation unless a new contradiction is reported for review.
- Pulse writes only `private.agent_pulse_state`, `private.agent_pulses`, `private.agent_observations`, and `private.agent_pulse_installation_events`. The first three cascade on account deletion; the fourth contains only typed installation controls and has no owner/Pulse FK. Never write core workspace entities, accountability snapshots, or manual `agent_runs`/`agent_actions`.
- Exactly four families: deadline approaching/overdue; important task without qualifying scheduled work; quiet project; tomorrow workload review. No Plan Items/step analysis, completion inference, GitHub polling, arbitrary watches, notifications, voice, or autonomy.
- Modes are `off`, `workspace`, `workspace_ai`; Off by default. Normal/Quiet are 4/12 hours. Use only saved `profiles.time_zone`.
- Maximum 6 owner Pulses, 2 owner AI requests, 4 installation AI requests, and 2 owner accepted ideas per rolling 24 hours. One provider request and one accepted idea per Pulse. Failed/unknown reservations consume budget.
- At most 3 new deterministic observations and 20 existing observation rechecks/updates per Pulse; 3 model signals; 12 KB total UTF-8 input; 8 KB raw response; 800 output tokens; 5 brief items.
- Four persistent observation states: `active`, `snoozed`, `dismissed`, `resolved`. Derive new/watching. No age-only resurfacing.
- Initial thresholds: approaching through three local days; High/Critical due soon; 14/60 elapsed days quiet; tomorrow at least 5 task deadlines or at least 85% saved-work-window occupancy.
- At most 100 live and 300 total observation rows; stop new admission at 200 suppressed rows. Feedback can still suppress an existing live row. Journal text: 30 days/180 entries; operational accounting: at least 48 hours.
- Preserve existing Agent tools, proposals, identifier-only Apply/Cancel/Prepare Undo, manual deadlines/retries, Activity/Undo, calendar overlap authority, and public/private boundaries.
- One additive migration; existing applied migrations immutable. No extensions, Cron, secrets, opt-in seeds, or processing activation in migration.
- No new dependency, external runtime installation, infrastructure/configuration, commit, push, deployment, or Production mutation without the corresponding later authorization. Test/database harnesses use disposable local targets only.

## Review focus

1. Empty/nonempty dispatch outcomes must survive consent changes and deletion of every claimed owner; Tasks 9/14 pin independent slot identity and replay stability.
2. A block inserted without changing task version must invalidate missing-work evidence; Task 8 tests canonical relationship hashes.
3. An oversized provider response must stop at the byte reader, before SDK JSON parsing; Task 16 tests physical wire bounds.
4. A full suppression pool must still allow Dismiss/Resolve of an existing live card; Task 10 tests row/state capacities.
5. Memory clear or account deletion during an uncertain provider request must not refund installation budget or forget a slot; Tasks 11/13/14/17 test the race.

## Repository evidence and execution ordering

Inspected manual route/executor/store/approval/Activity, Calendar/date helpers, time-block schema/helpers, accountability sources, UI composer prefill, Phase 5C fixtures/tests, scripts and migrations. Existing tests are `.test.mjs` using Node, TypeScript transpilation where needed, and `AGENT_TEST_PGLITE_MODULE`; PGlite is not a product dependency. Existing retained evidence describes a reusable PostgreSQL 17.6/psql harness, but its availability must be rechecked, not assumed.

Planning observed Node `v24.21.0`, npm `11.19.0`. Package versions above come from `package.json`; worktree `node_modules` is absent. An installed SDK in the primary checkout documents `attempts` as total attempts and 0/1 as no retries. Recheck resolution in the execution worktree before tests; do not silently install packages or use mismatched dependencies.

The stages reorder the suggested stages by dependency: SQL accounting/settings/lifecycle precede provider orchestration. There are **20 stages and 26 tasks**, including preflight and future rollout gates. Each code task follows RED, observed expected failure, smallest implementation, targeted GREEN, affected regression, then its stop condition. Do not commit as part of a task. Checkpoints A–G require a report and stop; only a later implementation instruction can authorize crossing them.

## Proposed file manifest

All paths below are relative to the execution worktree. Entries are proposals, not permission to edit now. `M` means modify existing; `N` means new. Test filenames live in `lib/ai/agent/` so the established whole-Agent selection includes them.

| Path | Change | Purpose / owning stage |
| --- | --- | --- |
| `lib/ai/agent/pulse/types.ts` | N | Internal snapshots, decisions, authority, RPC/result contracts; 1 |
| `lib/ai/agent/pulse/policy.ts` | N | Versioned ceilings, reason codes, ranking constants; 1 |
| `lib/ai/agent/pulse/signals.ts` | N | Four pure signal evaluators only; 1 |
| `lib/ai/agent/pulse/completeness.ts` | N | Complete/unknown/false and bounded coverage; 1 |
| `lib/ai/agent/pulse/fingerprints.ts` | N | Canonical material keys/serialization, excluding age; 1 |
| `lib/ai/agent/pulse/scanner.ts` | N | Merge, deterministic ranking, validity bounds; 1 |
| `lib/ai/agent/pulse/db.ts` | N | Narrow typed RPC adapter and canonical recovery; 3–8 |
| `lib/ai/agent/pulse/privacy.ts` | N | Separate consent/scope and minimized model context; 10 |
| `lib/ai/agent/pulse/gemini.ts` | N | Dedicated one-attempt bounded provider adapter; 11 |
| `lib/ai/agent/pulse/engine.ts` | N | Bounded claim-to-finalize orchestration; 12 |
| `lib/ai/agent/pulse/scheduler.ts` | N | Fixed scheduler body, HMAC and freshness; 13 |
| `lib/ai/agent/pulse/routes.ts` | N | Authenticated user-route handlers/projection validation; 14–15 |
| `data/agentInbox.ts` | N | Browser-safe DTOs, query/body parsers, pure handoff draft; 1, 14–15 |
| `data/agentInboxService.ts` | N | Same-origin fetch client; never direct Supabase table access; 16 |
| `components/ai/AgentInbox.tsx` | N | Cards, filters, actions, expandable Journal; 16 |
| `components/ai/AgentPulseSettings.tsx` | N | Modes, consent, cadence, project scope, confirmed clear; 16 |
| `components/ai/AgentPulseStatus.tsx` | N | Last/next/coverage/rolling request versus idea counts; 16 |
| `components/ai/AgentPulseBrief.tsx` | N | Return card, explicit displayed-revision acknowledgement; 16 |
| `components/ai/WorkspaceAiChat.tsx` | M | Minimal Inbox selection and existing composer-prefill handoff; 16 |
| `app/app/page.tsx` | M | Authenticated return card and open-Inbox request; 16 |
| `app/api/internal/agent/pulse/route.ts` | N | HMAC Node endpoint, no owner input; 13 |
| `app/api/ai/agent/pulse-settings/route.ts` | N | GET/POST settings; 14 |
| `app/api/ai/agent/pulse-settings/clear/route.ts` | N | Explicit confirmed owner memory clear; 14 |
| `app/api/ai/agent/inbox/route.ts` | N | Read list/detail and current Review draft; 15 |
| `app/api/ai/agent/inbox/feedback/route.ts` | N | Identifier/revision/action feedback; 15 |
| `app/api/ai/agent/inbox/ack/route.ts` | N | Explicit content-revision/brief acknowledgement; 15 |
| `app/api/ai/agent/brief/route.ts` | N | Read-only brief/status projection; 15 |
| `app/api/ai/agent/journal/route.ts` | N | Read-only bounded safe Pulse history; 15 |
| `supabase/migrations/<allocated-later>_workspace_agent_pulse.sql` | N | One additive migration for three owner tables plus independent installation ledger/RPCs; 2–8 |
| `lib/ai/agent/phase5d-test-support.mjs` | N | Test-only TS loader/fixed clocks/synthetic snapshots; 1 |
| `lib/ai/agent/phase5d-fixture.mjs` | N | Disposable baseline database plus optional new migration; 2 |
| `lib/ai/agent/phase5d-postgres-fixture.mjs` | N | Existing local psql orchestration, backend/barrier evidence; 9 |
| `lib/ai/agent/phase5d-domain.test.mjs` | N | Types/policy/completeness/fingerprint/ranking tests; 1 |
| `lib/ai/agent/phase5d-deadlines.test.mjs` | N | Deadline/calendar boundaries; 1 |
| `lib/ai/agent/phase5d-blocks.test.mjs` | N | Important task/no-work evidence; 1 |
| `lib/ai/agent/phase5d-quiet.test.mjs` | N | Recorded activity and 14/60-day thresholds; 1 |
| `lib/ai/agent/phase5d-tomorrow.test.mjs` | N | Deadline count and occupancy; 1 |
| `lib/ai/agent/phase5d-schema.test.mjs` | N | Tables, constraints, indexes, grant/ownership checks; 2 |
| `lib/ai/agent/phase5d-installation.test.mjs` | N | Typed content-free ledger, account deletion, atomic accounting/slot retention; 2, 4, 6, 8 |
| `lib/ai/agent/phase5d-projection.test.mjs` | N | Fixed reads, truncation, source revalidation; 3 |
| `lib/ai/agent/phase5d-claims.test.mjs` | N | Claims, slots, leases, fencing, recovery; 4 |
| `lib/ai/agent/phase5d-lifecycle.test.mjs` | N | State/revisions/feedback/suppression/capacity; 5 |
| `lib/ai/agent/phase5d-budgets.test.mjs` | N | Owner/installation accounting and idea limits; 6 |
| `lib/ai/agent/phase5d-settings.test.mjs` | N | Consent/settings revisions and authority invalidation; 7 |
| `lib/ai/agent/phase5d-retention.test.mjs` | N | Memory clear, operational retention, provenance; 8 |
| `lib/ai/agent/phase5d-postgres.test.mjs` | N | Real independent-connection race matrix; 9, 17 |
| `lib/ai/agent/phase5d-privacy.test.mjs` | N | Scope/context/bytes/secrets/no audit exposure; 10 |
| `lib/ai/agent/phase5d-gemini.test.mjs` | N | One physical attempt, wire/parser/schema limits; 11 |
| `lib/ai/agent/phase5d-engine.test.mjs` | N | Commit-before-AI, deadlines, failure recovery, import graph; 12 |
| `lib/ai/agent/phase5d-scheduler.test.mjs` | N | HMAC contract, fixed route, replay integration; 13 |
| `lib/ai/agent/phase5d-routes.test.mjs` | N | Authenticated settings/read/feedback/ack contracts; 14–15 |
| `lib/ai/agent/phase5d-handoff.test.mjs` | N | Composer draft and no automatic proposal/send; 15–16 |
| `lib/ai/agent/phase5d-ui.test.mjs` | N | Pure UI-state mapping, text and integration invariants; 16 |

Do not modify package/lockfiles, applied migrations, manual Agent modules, core services, or global styling. Reuse calendar/time-block helpers without modifying their behavior. Any necessary extra product file, dependency, or forbidden module change requires a reported manifest revision before proceeding.

## Frozen interfaces and invariant ownership

### Internal domain interfaces (Task 2)

Define `PulseMode`, `PulseCadence`, `SignalFamily`, `ObservationState`, `PulseStatus`, `IdeaCategory`, `PulseReason`, and `PulseError` as bounded literal unions. `SignalFamily` has exactly four values; task-attention merging is not a new family.

`PulseSourceSnapshot` contains `evaluatedAt`, `timeZone: string | null`, settings/policy revision, the fixed typed project/task/milestone/block facts, preferences, per-target complete block/activity facts, coverage, canonical source tokens, and up to 20 existing observations. Keep nullable fields distinct from missing/invalid fields. Timestamps are canonical PostgreSQL text; do not round-trip optimistic authority through JS milliseconds.

`ConditionDecision` is `{ key, target, family, truth: 'true'|'false'|'unknown', reasonCodes, materialFingerprint, sourceToken, evidenceValidUntil, evidence, importance, rank }`. Source token is an opaque SQL-produced string. The pure scanner never invents a source token. `PulseScan` contains sorted decisions, bounded new candidates, covered baseline patches, and safe coverage counts.

Exact exported functions:

- `scanPulse(source: PulseSourceSnapshot, prior: readonly StoredObservation[], policy: PulsePolicy): PulseScan`.
- `evaluateDeadlines(source: PulseSourceSnapshot): ConditionDecision[]`.
- `evaluateImportantTasks(source: PulseSourceSnapshot): ConditionDecision[]`.
- `evaluateQuietProjects(source: PulseSourceSnapshot): ConditionDecision[]`.
- `evaluateTomorrow(source: PulseSourceSnapshot): ConditionDecision[]`.
- `conditionKey(target: PulseTarget, family: SignalFamily, localDate?: string): string`.
- `materialFingerprint(facts: MaterialFacts): string` and `rankDecisions(items: readonly ConditionDecision[]): ConditionDecision[]`.

`PulseAuthority` is `{ userId, pulseId, slot, leaseToken, leaseExpiresAt, fence, settingsRevision, policyVersion }`; it is server-only. `PulseRepository` exposes only the typed operations in the RPC table below. `runClaimedPulse(authority: PulseAuthority, deps: PulseEngineDeps): Promise<PulseOutcome>` uses that repository, pure scanner, guarded context builder, provider port, monotonic clock/abort signal, and safe event logger. No generic service client or arbitrary RPC name enters the engine interface.

### Layer ownership

| Invariant | Authority / duplication policy |
| --- | --- |
| Ownership, FK, uniqueness, one running Pulse, field bounds | Database constraints plus fixed SQL owner predicates; TS validates input/DTO shape defensively |
| Signal meaning, material fingerprint, rank | One pure TS policy/scanner; no second SQL signal evaluator |
| Current canonical facts/source token | One private SQL projection/hash definition reused by read and publication |
| Lease/fence/settings/revision/time validity | SQL guards under owner lock; TS orchestrates and handles safe outcomes |
| Budgets/reservations | Owner Pulse timestamps for owner limits; independent ledger for installation limit; same PostgreSQL transaction/lock; UI displays only safe aggregates |
| Consent and scope | SQL checks revision/ownership; proactive TS context allowlist limits outgoing fields |
| Byte/provider schema bounds | Dedicated server adapter; DB accepts bounded normalized idea only |
| New/watching/stale UI labels | Safe DTO derivation; not separate persistent statuses |
| Brief nagging and acknowledgement | SQL owner acknowledgement/revision authority; UI session display avoids repeat render |

## Database design to implement later

The three Agent tables have non-null `user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE`. The installation ledger has no owner column or owner/Pulse FK. UUID IDs use existing `gen_random_uuid()`. Use `timestamptz` for instants, `bigint` for monotonic revisions/fences, `integer` for bounded counts/rank, `text` plus explicit checks for unions, and bounded `jsonb` only for structured Agent facts. No native enum is needed for policy evolution.

### `private.agent_pulse_state`

| Columns | Type/default/check |
| --- | --- |
| `user_id` | UUID PK/owner FK |
| `mode`, `cadence` | text, defaults `off`/`normal`, exact unions |
| `checks_consent_version`, `checks_consented_at`, `ai_consent_version`, `ai_consented_at` | nullable bounded text (40)/timestamptz pairs; required by corresponding enabled mode |
| `ai_project_ids` | UUID array default empty, unique elements, at most 20; encoded scope at most 2 KB; current ownership checked in RPC |
| `settings_revision`, `policy_version` | bigint starting 1; bounded text (40) server policy identifier |
| `next_due_at`, `last_success_at`, `last_deterministic_at`, `last_brief_ack_at` | nullable finite timestamptz; next due is a scheduled UTC slot |
| `last_coverage`, `baseline` | jsonb objects, at most 2 KB/16 KB; fixed keys/types only |
| `lease_token`, `lease_expires_at`, `fence` | UUID/timestamptz pair both null or both present; bigint fence starts 0 and never decreases |
| `ui_window_started_at`, `ui_write_count` | finite nullable SQL-clock minute-window timestamp and bounded integer 0–60; isolated user-POST abuse guard, never a model budget |
| `created_at`, `updated_at` | finite timestamptz, server timestamps |

Index `(next_due_at, user_id)` for enabled owners. Settings changes invalidate the lease and increment fence/revision; do not reset accounting. New enablement/settings scheduling takes effect no earlier than the next four-hour slot. Read absence returns an Off DTO, without inserting.

User settings/feedback/ack/clear RPCs enforce at most 60 successful writes per owner per SQL-clock minute window under the already-held state lock. Initial settings creation counts its first write atomically; other operations on absent state do not create opt-in/settings rows. Use the existing `RATE_LIMITED` response convention, without charging the manual/private-AI request meter or holding its lease. The counter is Agent-owned operational state, not an additional table/configuration or proactive provider quota.

### `private.agent_pulses`

| Columns | Type/default/check |
| --- | --- |
| `id`, `user_id`, `scheduled_slot`, `dispatch_nonce` | UUID PK, owner FK, aligned timestamptz slot, UUID nonce |
| `status`, `started_at`, `completed_at` | exact five-status union; finite timestamps; running has no completion time |
| `fence`, `lease_expires_at`, `settings_revision`, `policy_version`, `time_zone_used` | immutable authority/provenance snapshot; bounded timezone text (100), nullable if unavailable |
| `coverage`, `deterministic_commit_id`, `deterministic_committed_at`, `created_count`, `updated_count`, `resolved_count` | bounded typed JSON/UUID/finite timestamp/nonnegative integers; commit marker and writes atomic |
| `ai_reserved_at`, `installation_reservation_key`, `ai_outcome`, `ai_parent_id`, `ai_parent_episode`, `ai_attempt_number`, `idea_accepted_at` | nullable reservation/accepted instants and unique opaque UUID operation key; timestamp/key both present or absent; bounded outcome union; parent same-owner reference; episode bigint; attempt 1 or 2 |
| `error_code`, `summary` | bounded stable error union; nullable text at most 400 characters |

Keys/indexes: unique `(id,user_id)`, unique `(user_id,scheduled_slot)`, partial unique `(user_id) WHERE status='running'`, `(scheduled_slot,dispatch_nonce)`, `(user_id,started_at DESC,id DESC)`, and partial reservation/accepted-time indexes for rolling accounting. Lease expiry is retained on Pulse rows for slot admission/recovery even after state authority changes.

### `private.agent_observations`

| Columns | Type/default/check |
| --- | --- |
| `id`, `user_id`, `kind`, `condition_key` | UUID PK/owner FK, `signal` or `idea`, bounded key at most 160 characters |
| `family`, `target_type`, `target_id`, `target_date` | four-family union for signal; fixed target kinds `task`/`milestone`/`project`/`workspace_day`; UUID or date as appropriate; strict shape checks |
| `parent_observation_id`, `parent_episode`, `idea_category` | required for idea only, category one of the four approved values; same-owner composite FK, reject self/idea parent |
| `episode`, `material_fingerprint`, `source_token`, `evidence_valid_until` | positive bigint; bounded canonical hex strings; finite validity instant |
| `ai_attempt_count`, `ai_last_attempt_at`, `ai_attempt_terminal` | authoritative current SIGNAL episode state: integer 0–2, finite timestamp null iff count=0, boolean default false requiring count>0 when true; ideas require zero/null/false |
| `reason_codes`, `evidence`, `title`, `summary`, `explanation` | fixed bounded reason array, at most 2 KB typed JSON, text at most 120/400/240 Unicode code points |
| `importance`, `rank`, `state` | fixed importance union; rank 0–5; exact four-state union |
| `first_noticed_at`, `last_checked_at`, `last_changed_at`, `snooze_until`, `revisit_at`, `resolved_at` | finite instants; snoozed requires snooze instant; other states cannot retain an active snooze |
| `resolution_code`, `feedback_count`, `row_revision`, `content_revision`, `seen_content_revision` | bounded union/counter; revisions positive and `0 <= seen <= content` |
| `origin_pulse_id`, `latest_pulse_id` | same-owner composite FKs to Pulse headers; no copied Pulse body |

Keys/indexes: unique `(id,user_id)`; unique `(user_id,condition_key)`; partial unique `(user_id,parent_observation_id,parent_episode,idea_category) WHERE kind='idea'`; Inbox `(user_id,state,rank,last_changed_at DESC,id)`; revisit/snooze partial index. A signal parent cannot be deleted while a surviving idea references it; retention removes dependent ideas first under the defined lock order.

### `private.agent_pulse_installation_events`

| Columns | Type/default/check |
| --- | --- |
| `id`, `event_kind`, `created_at` | opaque UUID PK; `dispatch_slot` or `provider_reservation`; finite SQL-clock timestamptz |
| `scheduled_slot`, `nonce_fingerprint`, `dispatch_outcome`, `claim_count` | dispatch only: aligned UTC timestamptz, 64-character SHA256 hex of random nonce, `empty`/`claimed`/`disabled`, integer 0–2 |
| `reservation_key` | provider event only: opaque random UUID operation ID, distinct from Pulse/Auth/workspace IDs |

An exact-shape CHECK requires all dispatch fields and a null reservation key for dispatch, and only a reservation key with all dispatch fields null for provider events. `empty`/`disabled` require zero claims; `claimed` requires one or two. No JSON payload or free-text summary. No FK at all to owner, Pulse or workspace data. No owner/workspace identifiers, titles, evidence, provider content or auth metadata in any field.

Partial unique indexes on `scheduled_slot WHERE event_kind='dispatch_slot'` and `reservation_key WHERE event_kind='provider_reservation'`. Index `(event_kind,created_at)` for accounting/pruning. Events are immutable after their establishing transaction, except guarded aged-row deletion. Initial claim count remains canonical even when owner Pulse rows later cascade away.

Reserve an opaque operation key on the owned Pulse and insert its provider event atomically, without a ledger-to-Pulse FK or a Pulse-to-ledger FK that would prevent independent pruning. Unique operation keys and the guarded transaction enforce correlation. Account deletion and memory clear do not affect the ledger. A new Auth identity has a new owner budget; the installation remains capped by surviving ledger events.

Reason codes include `DEADLINE_OVERDUE`, `DEADLINE_TODAY`, `DEADLINE_SOON`, `IMPORTANT_NO_WORK`, `PROJECT_QUIET`, `TOMORROW_DEADLINES`, `TOMORROW_OCCUPANCY`. Coverage/resolution/error codes are separate bounded unions, including `UNKNOWN_COVERAGE`, `SOURCE_CHANGED`, `SOURCE_UNAVAILABLE`, `AUTHORITY_LOST`, `CAPACITY`, `BUDGET`, `AI_UNAVAILABLE`, `AI_MALFORMED`, `AI_TIMEOUT`. Do not store arbitrary provider/SQL error strings.

Circular provenance references are added after all tables exist. Pulse reservation-parent references use same-owner FKs with `ON DELETE SET NULL (ai_parent_id)` so explicit memory clear can delete observations without erasing accounting. This clears only the nullable parent pointer, never the Pulse owner, reservation-operation key, reserved/accepted timestamp or slot identity. Idea-parent deletion still follows the dependent-idea-first rule. Guard immutable owner/slot/reservation/fence history fields in SQL; final outcomes remain sealed except authorized text pruning and parent-pointer detachment. Use database checks for lengths/finite values/structural combinations, RPC validation for key allowlists/current ownership/caps, TS for scanner/provider semantics. No browser-only integrity requirement.

### Narrow RPC and transaction map

All public entry points below are `service_role` only, with qualified relations and empty `search_path`. They return bounded validated JSON DTO/envelopes rather than exposing table rows. Owner arguments come only from authentication or the scheduler's trusted selection. Revoke PUBLIC/anon/authenticated execute and all direct table DML/SELECT grants. Private helpers have no browser grants.

| Public function (planned signature) | Transaction / purpose |
| --- | --- |
| `agent_pulse_get_settings(uuid)` | Read only; absence is Off |
| `agent_pulse_set_settings(uuid,bigint,jsonb)` | Owner row; strict exact settings keys, expected revision; invalidate authority |
| `agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean)` | Required trusted processing flag, no default/old overload; global advisory lock and replay lookup before disabled establishment or sorted owner/Pulse locks; at most two claims per slot |
| `agent_pulse_read_source(uuid,uuid,uuid,bigint)` | Validate authority, one fixed SQL statement snapshot, bounded source/hash/coverage |
| `agent_pulse_publish_deterministic(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,jsonb)` | State, Pulse, sorted observations; typed decisions/baseline, max 23 decisions, atomic commit ID |
| `agent_pulse_reserve_ai(uuid,uuid,uuid,bigint,bigint,uuid,bigint)` | Global lock, state, Pulse, parent observation; check scope, episode/retry, all request budgets |
| `agent_pulse_publish_ai(uuid,uuid,uuid,bigint,bigint,jsonb)` | Global lock for accepted-idea accounting, then state/Pulse/parent; source/revision checks; one normalized idea |
| `agent_pulse_finish(uuid,uuid,uuid,bigint,text)` | State/Pulse; derive success/partial/failure from stored deterministic outcome, seal AI outcome, next due, release |
| `agent_pulse_recover(uuid,uuid)` | Read only canonical safe execution/commit/reservation status; never retransmit |
| `agent_pulse_list_inbox(uuid,text,jsonb,integer)` | Read only; fixed state filter, owner cursor tuple, limit at most 20 |
| `agent_pulse_get_observation(uuid,uuid)` | Read only current owner/source-safe detail; no raw evidence/hash |
| `agent_pulse_get_brief(uuid)` | Read only maximum five fresh unseen/deduplicated items and safe status |
| `agent_pulse_list_journal(uuid,jsonb,integer)` | Read only retained meaningful history, maximum 20/page |
| `agent_pulse_feedback(uuid,uuid,bigint,text,integer)` | State then observation; fixed action, expected row revision, 1/3/7-day snooze choice only |
| `agent_pulse_ack(uuid,jsonb,boolean)` | State then sorted observations; at most 20 `{id,contentRevision}` pairs, at most 5 for brief acknowledgement; optional brief ack timestamp |
| `agent_pulse_clear_memory(uuid,bigint)` | Global lock then state/Pulses/observations; preserve 48-hour operational accounting and invalidate authority |
| `agent_pulse_retain(uuid,integer)` | Global lock then state/Pulses/observations; batch at most 20; never touch core/audit |
| `agent_pulse_retain_installation(integer)` | Global lock only; batch at most 20 expired operational events; no owner argument or arbitrary event input |

Private helpers: `agent_pulse_source_projection(owner,evaluated_at,target_refs)`, shared canonical hash helper, authority guard, strict typed JSON validators, safe read projection and slot calculation. Dispatch establishment/reservation functions alone insert the respective installation shapes; no standalone event writer is exposed. The publication RPC is not a generic JSON writer: accept only the declared decision grammar, enforce limits/keys, re-read canonical target hashes, and perform only fixed lifecycle operations.

Use one fixed advisory namespace, after checking collision with existing SQL: proposed two-int key `(505, 5)`. Lock order is **installation advisory lock, including ledger access; sorted owner-state rows; sorted Pulse rows; sorted observation rows**. All event readers participating in writes/pruning use the first lock; ledger access introduces no later resource. A function starting later never subsequently acquires an earlier lock. Include AI publication/memory clear/retention in global-lock users because they affect accounting. No transaction crosses provider calls; no changes to Apply/Cancel/Undo locks or new Auth deletion hooks.

## Stage 0 — Preflight and contract freeze

### Task 1 — Revalidate source, runtime and migration prerequisites

**Files:** read AGENTS/RTK, spec, package/lockfiles, listed integration files and all migrations. No product edit. Later evidence goes outside the repository in a task-specific local evidence directory; record commands, exits and red/green results without secrets.

- [ ] Verify branch/HEAD, exact spec hash, documentation-only expected status, clean index, and no unrelated files. Capture migration filename/SHA256 pairs before creating any new migration. Current latest local migration is `20261014114242_workspace_agent_plans.sql`; re-discover during execution.
- [ ] Inspect `node --version`, `npm --version`, installed package resolution/versions and Next route-handler documentation. Inspect SDK `HttpRetryOptions` and its actual fetch/retry implementation. Reuse existing usable runtimes; stop if an install, dependency linkage/configuration change, or unapproved infrastructure would be necessary.
- [ ] Recover and validate the existing `AGENT_TEST_PGLITE_MODULE` from retained local evidence; never substitute a freshly installed runtime. Locate the existing disposable PostgreSQL/psql setup and prove its target is local/disposable before running the later harness. Missing infrastructure requires approval.
- [ ] Compare local applied SQL and read-only linked schema/function/grant metadata when available: migration history, `pg_proc` signatures/ACLs, `pg_class` RLS, `pg_constraint`, and indexes. Use an existing authenticated connector or CLI discovered through help; no direct SQL writes or history repair. If linked read access is unavailable, record the gap and block rollout readiness, without pretending local schema equals Production.
- [ ] Run fresh existing Agent/calendar/time-block/Focus/private/public AI checks using the commands in Validation. Record actual counts, failures and skips. A missing runtime is not a product failure but stops execution until restored. Freeze date helper semantics, scheduled block links/ranges, recorded activity columns and current manual lease behavior.

**Regression/stop:** All later comparisons use these captured results/hashes. Stop on baseline drift, unexpected source/config/migration changes, spec hash drift, missing runtime, or a genuine spec contradiction. No schema timestamp is allocated by this planning task.

## Stage 1 — Pure domain and scanner

### Task 2 — Types, policy, coverage and test support

**Files:** create pulse `types.ts`, `policy.ts`, `completeness.ts`, `fingerprints.ts`, `scanner.ts` boundary; `data/agentInbox.ts` DTO types; test support/domain test from manifest.

**Interfaces:** Produce all domain interfaces above, `PULSE_POLICY: PulsePolicy`, `makeSource(overrides?: Partial<PulseSourceSnapshot>): PulseSourceSnapshot` and `loadPulse(modulePath: string): Promise<unknown>` in test support. Browser DTOs import no server authority or raw source type. `isComplete(coverage: SignalCoverage): boolean` and fingerprints are pure.

- [ ] RED: add `partial_absence_is_unknown`, `fingerprint_ignores_age_and_unrelated_updated_at`, `material_change_changes_fingerprint`, `reason_codes_are_bounded`, `unicode_limits_use_code_points`, and `browser_dto_has_no_authority_fields`. Assert `unknown !== false`, stable task keys, and exactly four family values.
- [ ] Run `node --test lib/ai/agent/phase5d-domain.test.mjs`; observe missing behavior/assertions before writing implementation, not a missing dependency error.
- [ ] GREEN: implement exact types/policy and canonical deterministic serialization, with fixed field ordering and null preservation. Use existing Calendar/date helpers rather than generic new date infrastructure.
- [ ] Repeat the focused command; require zero failed/skipped tests. Re-run existing calendar tests to pin reused semantics.
- [ ] Stop if a new timezone source, fifth family, age-based fingerprint, or server type in browser DTO is needed.

### Task 3 — Deadline signals

**Files:** pulse `signals.ts`, `scanner.ts`; `phase5d-deadlines.test.mjs`.

**Interface:** `evaluateDeadlines(source)` returns one decision per eligible target; the scanner merges task attention later.

- [ ] RED: `deadline_today_is_not_overdue`, `deadline_three_days_included_four_excluded`, `utc_midnight_preserves_calendar_day`, `milestone_project_ownership_required`, `null_invalid_and_excluded_status_are_distinct`, `missing_zone_is_unknown`. Example assertion: `assert.equal(evaluateDeadlines(makeSource(todayTask))[0].reasonCodes[0], 'DEADLINE_TODAY')`.
- [ ] Run `node --test lib/ai/agent/phase5d-deadlines.test.mjs`; observe expected semantic failures.
- [ ] GREEN: reuse `taskCalendarDate`, `localCalendarDate`, and `dayBoundaryInstant`; implement spec status/parent exclusions, three-day window and next-local-day validity expiry. Preserve blocked deadline context.
- [ ] Repeat focused tests and `npm run test:calendar`; cover DST gaps/folds, leap dates, invalid/future instants and date-only versus timestamp inputs.
- [ ] Stop if installed helper behavior contradicts the approved Calendar interpretation; do not rewrite helpers silently.

### Task 4 — Important task without a qualifying work block

**Files:** pulse `signals.ts`, `scanner.ts`; `phase5d-blocks.test.mjs`.

**Interface:** `evaluateImportantTasks(source)` consumes complete per-task relationship facts and returns `IMPORTANT_NO_WORK` only on proven absence.

- [ ] RED: `high_and_critical_only`, `no_due_date_is_not_no_work`, `partial_blocks_never_prove_absence`, `running_focus_counts`, `cancelled_completed_break_custom_do_not_count`, `one_minute_remaining_boundary`, and `new_block_changes_source_without_task_version`. Assert incomplete coverage yields `truth === 'unknown'`.
- [ ] Run `node --test lib/ai/agent/phase5d-blocks.test.mjs`; observe RED.
- [ ] GREEN: evaluate valid same-owner task/project-linked scheduled focus/task ranges clipped to now/deadline end. Require at least 60,000 ms future overlap. Merge deadline/missing-work reasons into one task condition key; compute earliest qualification-change expiry.
- [ ] Repeat focused tests plus `node --test data/timeBlocks.test.mjs data/timeBlockService.test.mjs`; include cross-midnight/query-boundary blocks and changed/deleted links.
- [ ] Stop if absence depends on a truncated generic list or any availability/scheduling mutation.

### Task 5 — Quiet projects

**Files:** pulse `signals.ts`; `phase5d-quiet.test.mjs`.

**Interface:** `evaluateQuietProjects(source)` uses only complete recorded project/task/milestone activity aggregates.

- [ ] RED: `normal_quiet_exact_14_days`, `maintenance_exact_60_days`, `child_change_resets_quiet`, `new_project_has_baseline`, `future_activity_is_unknown`, `excluded_status_is_not_abandoned`. Assert just below either elapsed threshold does not trigger.
- [ ] Run `node --test lib/ai/agent/phase5d-quiet.test.mjs`; observe RED.
- [ ] GREEN: derive max valid recorded activity and workflow-specific threshold, with truthful copy and material fingerprint excluding increasing age. No health score/Plan Item/GitHub/Focus inference.
- [ ] Repeat focused tests plus `npm run test:accountability`; verify the reused concepts do not change existing scoring.
- [ ] Stop if source completeness cannot support absence of newer recorded activity.

### Task 6 — Tomorrow review, ranking and complete scanner

**Files:** pulse `signals.ts`, `scanner.ts`, domain/tomorrow tests.

**Interfaces:** Complete `evaluateTomorrow`, `rankDecisions`, `scanPulse`. Rank classes 0–5 match the spec order; date/priority/material-change/ID are stable tie-breakers. Return at most 3 new and 20 existing decisions for publication.

- [ ] RED: `five_deadlines_exact`, `occupancy_85_percent_exact`, `union_clips_overlaps`, `nonworking_or_missing_preferences_omit_occupancy`, `counts_are_not_effort`, `tomorrow_rollover_expires`, `task_card_merges_reasons`, `brief_rank_has_six_classes`, and `unknown_does_not_resolve_prior`.
- [ ] Run `node --test lib/ai/agent/phase5d-domain.test.mjs lib/ai/agent/phase5d-tomorrow.test.mjs`; observe RED.
- [ ] GREEN: clip/union scheduled ranges to `workWindow` using saved preferences, no buffers as booked time; count only complete eligible dated facts. Merge/rank deterministically, preserve uncovered baseline portions, and limit admission after ranking, not before discovery.
- [ ] Run all five Stage 1 test files and Calendar/time-block tests. Assert byte-identical outputs for equal facts/time/policy regardless of input ordering.
- [ ] **Checkpoint A:** report scanner/domain results and stop. No infrastructure/provider dependency may exist in this import graph.

## Stage 2 — One additive schema

### Task 7 — Tables, constraints, grants and disposable fixture

**Files:** create the single later-allocated migration, `phase5d-fixture.mjs`, schema/installation tests; reuse prior fixture definitions without editing applied SQL or old fixtures.

**Interface:** `fixture(t, { includePulse = true } = {})` returns disposable `db`, `one`, owner/other/target IDs, exact source seeding, and canonical RPC helpers. Missing feature assertions should fail cleanly before the migration exists.

- [ ] RED: assert `to_regclass` for all four private tables, exact checked unions/lengths, same-owner provenance, owner-slot uniqueness and one-running partial uniqueness. Ledger tests assert exact allowed columns, two shapes, zero owner/Pulse/workspace FKs, unique slot/operation keys and immutable events. Verify FK SQLSTATE `23503`, self/shape/check `23514`, duplicate `23505`, and denied browser access `42501` once objects exist.
- [ ] Run `node --test lib/ai/agent/phase5d-schema.test.mjs`; verify absence failures, not fixture bootstrap mistakes.
- [ ] Inspect installed Supabase CLI help; create the unapplied migration through its normal migration generator only after confirming the generated version sorts after all local/remote versions. Stop on an unsuitable timestamp rather than renaming applied history. Implement the table design above; do not enable extensions or jobs.
- [ ] Apply only to disposable fixtures, rerun schema/installation tests, and compare every pre-existing migration hash. Assert normal Auth deletion cascades the three Agent tables without altering the ledger or blocking deletion. Add test checks that the migration contains no Cron creation, extension activation, secrets, core DML, or manual audit writes.
- [ ] Stop on grant leakage, unexpected function replacement, applied-history editing, or migration ordering ambiguity. This migration remains local/unapplied to Production through implementation.

## Stage 3 — Fixed source projection and canonical hashes

### Task 8 — Bounded source RPC and adapter

**Files:** migration, pulse `db.ts`, projection tests/fixture.

**Interfaces:** `PulseRepository.readSource(authority): Promise<PulseSourceSnapshot>` calls `agent_pulse_read_source`. Private canonical projection is reused for publication/detail validation; the same serialization creates source tokens.

- [ ] RED: `only_required_columns`, `owner_and_parent_isolation`, `extra_row_marks_truncation`, `targeted_absence_complete_despite_generic_truncation`, `quiet_aggregate_complete_or_unknown`, `new_block_invalidates_hash`, `preferences_zone_links_change_hash`, and `read_is_one_statement_snapshot`.
- [ ] Run `node --test lib/ai/agent/phase5d-projection.test.mjs`; observe RED using synthetic owners and real disposable SQL rows.
- [ ] GREEN: implement one statement with fixed CTE/LATERAL projections, limits 50/200/100/500 plus one truncation sentinel, and at most 20 independent existing-target rechecks. Return raw date/status/range facts and complete targeted block/activity aggregates, never descriptions/notes/audits/Plan Items. Set a bounded statement timeout; query failure returns unknown/failure, not fabricated partial success.
- [ ] Verify a built-in qualified SHA256 function or the already installed qualified equivalent in preflight; use it for opaque hashes of canonical JSON. No extension installation. Preserve one private projection definition; publication reuses it. Add empty-range, overlapping-range, child reparent/delete, missing profile and invalid timestamp cases.
- [ ] Rerun projection/schema tests and legacy read/calendar tests. Stop if current-source validation requires another independently implemented projection or partial absence claims.

## Stage 4 — Claims, leases, fencing and recovery

### Task 9 — Authoritative dispatch and writer guards

**Files:** migration, pulse `db.ts`, claims tests. Produce `claimDispatch(slot,nonce,issuedAt,processingEnabled)`, authority guard and `recover(authority)` repository operations. The required boolean is trusted server state, not scheduler JSON. Reject NULL. Under the installation lock recover existing slots first; only a new disabled dispatch writes `disabled` with zero claims before any owner selection/locking/state change. Existing outcomes always win. Keep only the four-argument service-only SQL signature, with no default.

- [ ] RED: `same_slot_owner_unique`, `two_claims_installation_wide`, `same_nonce_returns_original_batch`, `changed_nonce_cannot_amplify_slot`, `empty_replay_stays_empty_after_budget_aging_or_settings_change`, `lease_unexpired_not_stolen`, `expired_writer_loses_to_later_slot`, `stale_fence_cannot_publish_or_finish`, `lost_claim_response_recovers_without_restart`.
- [ ] Run `node --test lib/ai/agent/phase5d-claims.test.mjs`; observe RED.
- [ ] GREEN: acquire global lock and consult the unique installation `dispatch_slot` event first. If present, return its original aggregate outcome; reload only surviving owned Pulse recovery data and do not start any worker. If absent, select due opted-in owners by due time/ID, lock selected rows in UUID order, claim at most two owner-slot rows, issue 90-second leases/higher fences, and insert the final zero-to-two-claim ledger outcome in the same transaction. Any failure rolls back claims and event together. The unique slot index is a second authority guard.
- [ ] Pin empty/nonempty slot recovery: same nonce returns canonical outcome; different nonce also cannot expand the established batch; deletion of every original owner leaves original claim count/slot established. Include new consent/settings, budget aging, owner deletion and lost response during the freshness window. Do not retain the earlier draft's slot-boundary budget/lease-freezing workaround: the ledger now supplies replay authority; owner budget counts use current SQL rolling windows.
- [ ] Rerun schema/installation/claims tests and inspect canonical events/rows/counts/fences. Stop if replay depends on surviving owner rows, expands a batch or reconstructs deleted memory. Existing Apply/Cancel/Undo functions and locks remain byte-identical.

## Stage 5 — Deterministic publication and observation lifecycle

### Task 10 — Atomic publication, feedback and suppression

**Files:** migration, pulse `db.ts`, lifecycle tests.

**Interfaces:** `publishDeterministic(authority, commitId, scan): Promise<PublishResult>` and `feedback(owner,id,rowRevision,action,snoozeDays): Promise<InboxItem>`; source hash validation uses Task 8 helpers, not a second scanner.

- [ ] RED: create, unchanged refresh, material revision, seen/content separation, snooze/expiry recheck, dismiss, user Resolve, proven-false resolution, unknown retention, unavailable target, false-then-true episode, no age/wording/policy resurfacing, feedback/publication conflict, lost-response commit recovery. Assert unchanged refresh leaves `content_revision` unchanged and dismissed unchanged facts remain dismissed.
- [ ] Run `node --test lib/ai/agent/phase5d-lifecycle.test.mjs`; observe RED.
- [ ] GREEN: one state/Pulse/observation transaction validates all typed decisions, ownership, current canonical hashes, authority, expected row revisions and evidence-valid-until. Atomically publish accepted independent decisions plus the commit marker; stale individual facts become partial coverage, never partial reversal of workspace changes. Limit new/update counts and preserve user feedback.
- [ ] Add exact capacity tests: live 100, total 300, suppression admission threshold 200, Dismiss/Resolve still accepted at capacity, reopening deferred when live is full. For snooze use existing strict local-time conversion; reject an ambiguous/nonexistent preserved local time with a safe choice error rather than inventing a shifted time. Expiry still requires fresh evaluation.
- [ ] Rerun lifecycle/projection/claims/schema tests. Stop on a fifth persistent status, lost suppression, stale overwrite, or any core/manual-audit DML.

## Stage 6 — Atomic proactive accounting and idea publication

### Task 11 — Reserve requests and publish at most one idea

**Files:** migration, pulse `db.ts`, budget tests. Produce `reserveAi(authority,parentId,episode)`, `publishAi(authority,idea)` and safe usage counters.

- [ ] RED: exact rolling window; 6 owner claims; 1 reservation/Pulse; owner 2/installation 4 requests; unknown/failure counted; no refund after crash/clear; at most 1 idea/Pulse and 2 accepted ideas/owner; two-attempt episode ceiling and 12-hour delay; malformed output is terminal; parent/category/episode dedupe.
- [ ] Run `node --test lib/ai/agent/phase5d-budgets.test.mjs`; observe RED.
- [ ] GREEN: reserve under global/state/Pulse/parent locks before network. Count installation `provider_reservation` events and this owner's Pulse timestamps using SQL `(clock_timestamp() - interval '24 hours', clock_timestamp()]` with one captured SQL time. Validate source/scope/settings and both ceilings; the locked SIGNAL count/time/terminal flag alone decide current-episode retry eligibility. Set owner reservation time/opaque operation key, insert exactly one installation event and increment/stamp the SIGNAL attempt state, committing all three together. A uniqueness loser reloads canonical reservation state, never retries transmission. Publication checks actual `idea_accepted_at` windows separately: delayed publication cannot exceed two accepted ideas.
- [ ] Keep uncertain requests consumed and canonical recovery read-only. A caller losing its reservation response skips transmission unless the current process can prove it never began transmission; another process never resumes it. Same idea identity recovers its canonical record rather than raising an internal duplicate error.
- [ ] Add installation tests: A/B each reserve two requests, both Auth owners are deleted, C/D still cannot reserve until the installation window ages out; no restrictive owner FK blocks deletion. Inject an event-insert failure and assert neither owner mark nor event commits. Rerun budgets/installation/lifecycle/claims tests. Stop on quota refund, partial reservation commit, process-memory authority or a bypass of one-attempt-per-Pulse.

## Stage 7 — Owner settings and consent authority

### Task 12 — Settings read/update and in-flight invalidation

**Files:** migration, pulse `db.ts`, settings tests.

**Interfaces:** `getSettings(owner): Promise<PulseSettingsDto>`; `setSettings(owner,expectedRevision,input): Promise<PulseSettingsDto>`. Consent versions are fixed server constants, not arbitrary client strings.

- [ ] RED: absent row returns Off without insertion; checks consent does not grant AI; empty scope; max20/current owner projects; null versus omitted; stale revision conflict; mode/scope/cadence changes invalidate lease; date tokens invalidate on profile timezone change; disclosure revision disables AI pending renewed consent.
- [ ] Run `node --test lib/ai/agent/phase5d-settings.test.mjs`; observe RED.
- [ ] GREEN: strict settings grammar and current project ownership; revision/fence increment under owner lock; retain reservations, history and committed observations. Next due is the first future scheduled slot, then cadence advances 4/12 hours without catch-up. The saved profile remains the only timezone source.
- [ ] Rerun settings/claims/budget tests, including disable before reservation and after reservation. Missing configured scheduler does not imply a check has run; DTO displays disabled/never checked.
- [ ] Stop if manual consent is reused, whole-workspace AI scope is implicit, or a settings write resets accounting or reactivates a current-slot worker.

## Stage 8 — Safe projections, acknowledgement and retention

### Task 13 — Read RPCs, memory clear and bounded pruning

**Approved Checkpoint B clarification:** edit the same local unapplied migration only. Add signal-only `ai_attempt_count integer NOT NULL DEFAULT 0` constrained 0–2, nullable finite `ai_last_attempt_at` with zero iff null, and `ai_attempt_terminal boolean NOT NULL DEFAULT false` (true requires count >0); ideas require zero/null/false. Parent signal is authoritative; Pulse attempt fields remain provenance. Under installation/state/Pulse/parent locks reserve atomically with owner mark + installation event + parent increment/time. Preserve across ordinary checks, same-episode content edits, feedback and suppression compaction; reset only with the existing semantic new-episode transition. Persist malformed terminality on the signal, never reconstruct it from retained headers. No refunds for failure/timeout/crash/unknown. Memory Clear may remove episode memory but retains recent owner/installation accounting and slot identity; account deletion still cascades normally. No hidden clear-surviving owner tombstones.

- [ ] Test-first resolution: preserve original external RED reproduction; verify first/second/third reservations, 12-hour boundary, one/both header pruning, terminal malformed outcome after pruning, compaction/recheck/same-episode changes, genuine/false→true resets, three-way transaction rollback, lost-response and PGlite-serial duplicate recovery, clear and account deletion. Rerun Tasks 7–12 regressions; no true multi-connection claims before Task 14.

**Files:** migration, pulse `db.ts`, `data/agentInbox.ts`, retention/schema/lifecycle tests.

**Interfaces:** Implement the list/detail/brief/journal/ack/clear/retain RPCs and matching repository methods. Safe DTOs omit raw evidence, hashes, authority, nonces, context and audits. IDs/revisions/time/status/safe labels remain available for actions.

- [ ] RED: owner-only list/detail; max20 pages/max5 brief; stale/unavailable target withdrawal; no GET writes; ranking/dedupe; displayed-revision ack cannot hide newer content; 24-hour no-nag boundary; quiet Pulse absent from meaningful Journal; retention30d/180; thin provenance; clear during unknown reservation preserves accounting and slot identity.
- [ ] Run `node --test lib/ai/agent/phase5d-retention.test.mjs lib/ai/agent/phase5d-schema.test.mjs`; observe RED.
- [ ] GREEN: read-only safe SQL projections and owner/filter-bound cursor tuples. Encode opaque base64url cursors with version, owner digest, filter and fixed sort tuple; validate them, but never treat a cursor as authorization. SQL still filters authenticated owner. Filter aged text on reads; physical pruning runs only through explicit POST maintenance or eligible Pulse work, maximum 20 records per batch.
- [ ] Implement confirmed clear under global/state/Pulse/observation lock order; clear observations/baseline/text and detach their nullable Pulse parent references, increment fence/revision, preserve at least 48 hours of owned operational rows including reservation/accepted timestamps, and never erase installation events. Keep first/latest owner provenance headers, at most 780/owner under approved bounds. Never evict unchanged suppression merely for age/capacity. Installation pruning uses its separate owner-free RPC under the global lock; delete at most 20 events older than 48 hours and outside active accounting/replay windows. All owners Off/deleted must not prevent authorized operational cleanup; downtime can delay physical deletion.
- [ ] Rerun all Stage 2–8 SQL tests and verify the full GRANT/REVOKE matrix with actual role switching and catalog ACL inspection, including helper denial and service direct-table denial. **Checkpoint B:** report complete disposable schema/RPC/ACL results and unchanged prior migration hashes; stop.

## Stage 9 — First real PostgreSQL authority proof

### Task 14 — Independent-connection claims/budget/feedback barriers

**Files:** new PostgreSQL fixture/test from manifest; no runtime install or repository connection configuration.

**Interface:** `withPostgresFixture(t, fn)` uses existing local psql via `node:child_process`, creates a uniquely named disposable database after verifying loopback target, replays the reviewed baseline/new migration, and provides independent connections A/B plus observer. Require explicit opt-in environment pointing at the already available disposable test target; never default to linked Production.

- [ ] RED: add barrier cases for simultaneous same-owner claims, slot two-owner ceiling across nonces, expired fence versus later slot, owner/installation reservations, accepted-idea publication window, feedback/publication, disable/reservation/finalization, and canonical recovery. Add all eight approved ledger cases: different-owner simultaneous reservations; deletion immediately after reservation; another owner's attempt after deletion; same nonce twice; changed nonce same slot; deletion after dispatch; same-slot retry after deletion; retention versus reservation/dispatch. Compare ledger counts, canonical outcomes and unchanged surviving core/audit hashes. Disposable Auth deletion intentionally cascades that owner's fixtures; assert expected deletion rather than incorrectly asserting those rows remain unchanged.
- [ ] Run `node --test lib/ai/agent/phase5d-postgres.test.mjs`; an unavailable target fails the required proof explicitly, not a green skip. First run against missing guards must show the intended failed invariant.
- [ ] GREEN: correct only new Phase 5D SQL/adapter code exposed by the cases. Use `BEGIN` barriers, distinct `pg_backend_pid()` values, observer `pg_blocking_pids()` evidence, bounded lock/statement/harness timeouts, and both transaction orderings. Never rely on sleeps as the proof of overlap.
- [ ] Repeat the true PostgreSQL cases and all disposable SQL tests. Record PID/wait events/SQLSTATE/final counts and source hashes, with no credentials. Reuse existing binaries; if unavailable, stop for infrastructure authorization.
- [ ] **Checkpoint C:** report real multi-connection authority results and limitations; stop. PGlite/serial tests alone do not satisfy this checkpoint.

## Stage 10 — Dedicated proactive privacy guard

### Task 15 — Consent, project scope and minimized provider context

**Files:** pulse `privacy.ts`, types/policy refinements, privacy tests. No modification to manual context builders.

**Interfaces:** `buildProactiveContext(source: PulseSourceSnapshot, candidates: readonly ConditionDecision[], settings: PulseSettingsDto): ProactiveContextResult`. The result is either a bounded safe skip code or `ProactiveContext = { contents, aliases, primaryAlias, allowedCategories, allowedFacts, parentId, parentEpisode, sourceToken, evidenceValidUntil }`; private aliases map only selected current-owner targets. `allowedFacts` is the server-derived set used to validate numeric/date claims. `NormalizedPulseIdea = { sourceAlias: string; category: IdeaCategory; title: string; advisoryText: string }` is the exact accepted provider shape.

- [ ] RED: `manual_consent_does_not_enable_proactive`, `empty_scope_sends_nothing`, `twenty_project_scope_limit`, `removed_or_foreign_project_excluded`, `prohibited_fields_never_copied`, `secret_title_rejected`, `utf8_12kb_includes_instructions_and_schema`, `three_signals_max`, `uuid_aliases_ephemeral`, `tomorrow_scope_is_not_whole_workspace`.
- [ ] Run `node --test lib/ai/agent/phase5d-privacy.test.mjs`; observe expected RED on the real context builder, not mock assertions.
- [ ] GREEN: allowlist titles (120 code points), status/priority/deadline and necessary deterministic facts; check versioned AI consent/current project scope. Filter before serialization; reject known key/token/private-key patterns, descriptions/notes/GitHub/audit/auth fields. Correctly derive a complete scoped tomorrow aggregate or omit it; never send unrelated-project counts.
- [ ] Choose the highest-ranked eligible parent before reservation and pin its primary alias/episode. Up to two additional scoped signals are supporting context only. The returned idea must name that primary alias and a category justified by its reason codes; it cannot switch to another parent after reservation. Test rejection of a known supporting alias or incompatible known category. This keeps episode/retry accounting deterministic.
- [ ] Repeat privacy/domain/settings/projection tests. Verify no provider capability, arbitrary route/tool/SQL or owner identity appears in serialized input. AI mode may remain enabled with empty scope, but makes zero calls.
- [ ] Stop on privacy leakage, incomplete scoped absence, broad context-loader reuse, or provider terms/disclosure requiring an unapproved expansion.

## Stage 11 — One-attempt Gemini adapter

### Task 16 — Physical request count, wire bounds and validated idea

**Files:** pulse `gemini.ts`, Gemini tests; reuse existing `getGeminiConfiguration` without changing it.

**Interfaces:** `generatePulseIdea(context: ProactiveContext, options: { signal: AbortSignal; deadlineAt: number; fetch: typeof fetch }): Promise<NormalizedPulseIdea | PulseAiFailure>`. `NormalizedPulseIdea` has known alias/category, title <=120 and advisory text <=400 code points; no dates/IDs/authority fields supplied by the model. The injected fetch is for testability and enforcing the same production byte reader.

- [ ] RED: count real SDK fetch calls for success/408/429/503/network failure; assert exactly one physical request. Test no function declarations, `attempts: 1`, 800 output tokens, 12-second timeout, abort before/during request, >15-second start gate, 8-KB streamed response boundary, invalid UTF-8, malformed/multiple/unknown-alias/category output, and unsupported numeric/date/range claims.
- [ ] Run `node --test lib/ai/agent/phase5d-gemini.test.mjs`; observe RED. Use injected deterministic streams/clocks and installed SDK, not a replacement fake adapter that proves only its own behavior.
- [ ] GREEN: call `GoogleGenAI.models.generateContent` once, with no tools and `httpOptions.retryOptions.attempts = 1`; do not use `retryGeminiTransport`. Wrap the SDK's fetch response reader to count actual body bytes and cancel at >8 KB before SDK `.json()` parsing. Combine abort/deadline/12-second timeout; reject a start at exactly 15 seconds remaining. Count all outbound wire attempts in tests.
- [ ] Send only the minimized `context.contents`, fixed instructions/schema and provider limits. Never serialize the entire `ProactiveContext`: its parent IDs, alias map, source token and validity metadata are server-only. Assert the complete outbound HTTP body contains no private correlation identifiers.
- [ ] Parse one strict output object, normalize/bound it, check known aliases/categories and explicit factual literals against `allowedFacts`, and discard raw response/prompt. Return a safe bounded error code on failure. Prose remains labeled advisory; validation does not claim to prove every semantic assertion.
- [ ] Repeat Gemini/privacy tests and the existing retry test to confirm manual transport behavior is unchanged. Stop if one physical request, wire bounds, or SDK abort propagation cannot be enforced without new dependencies/configuration or manual-Agent changes.

## Stage 12 — Bounded Pulse engine

### Task 17 — Orchestrate short transactions and failure recovery

**Files:** pulse `engine.ts`, `db.ts` finalization/recovery methods, engine tests.

**Interfaces:** `runClaimedPulse(authority, deps): Promise<PulseOutcome>` and `runPulseDispatch(input: PulseDispatchInput, deps: PulseEngineDeps): Promise<DispatchOutcome>`. `PulseEngineDeps` exposes only the fixed repository, scanner, privacy builder, provider, clock/abort signal and safe logger. `DispatchOutcome` contains safe established/recovered/disabled counts/codes; never raw ledger rows or owner data. No generic admin client is passed to the engine.

The internal dispatch input additionally requires `processingEnabled: boolean` from trusted server configuration; it has no default and is not a scheduler HTTP field. Pass it explicitly to the four-argument claim RPC. Even when false, establish/recover the slot through SQL, then execute zero owners regardless of the canonical prior outcome.

- [ ] RED: `deterministic_commit_precedes_reservation`, `provider_failure_keeps_observations`, `quiet_scan_calls_no_model`, `workspace_mode_calls_no_model`, `owner_20s_dispatch_45s_budgets`, `skip_ai_at_15s_boundary`, `crash_after_commit_recovers`, `stale_source_drops_idea`, `disable_or_delete_after_reservation_prevents_publish`, `clear_keeps_installation_controls`, `expired_worker_cannot_finish`.
- [ ] Run `node --test lib/ai/agent/phase5d-engine.test.mjs`; observe RED. Assert repository call order and committed SQL effects through fixtures, not only mocked call counts.
- [ ] GREEN: claim the entire bounded batch once, process at most two owners sequentially, read/scan/publish deterministic observations, then revalidate consent/source/time before atomic reservation and single transmission. Revalidate again before idea publication. Finalize from stored deterministic coverage; optional AI failure has a separate outcome and does not turn complete deterministic success into failure. Never await provider work in a database transaction.
- [ ] After deterministic commit, reread the guarded service-only source and join decisions to committed references by condition identity. Use PostgreSQL `id`/`episode`, canonical `seen`/`lastCheckedAt` and existing source/evidence fields for Task 15; never infer authority from scanner decisions, row/content revisions or browser DTOs. Only minimized contents may reach Task 16.
- [ ] Enforce 60-second route duration/45-second dispatch deadline/20-second owner budget; stop starting work when no time remains for bounded finalization. Record safe skip/error codes; uncertain reservations stay consumed. Recover lost publication responses via commit IDs, never regenerate another batch or retransmit. Deleted owners are skipped, while installation controls remain authoritative.
- [ ] Add transitive import/call-boundary assertions: worker code cannot reach core CRUD, proposal save, Apply/Cancel/Undo, manual executor/tools, GitHub writes, snapshot capture or broad workspace loaders. Verify zero core/manual-audit DML using before/after hashes and disposable write-audit counters. Restrict counters to test fixtures only.
- [ ] Run Stage 10–12 tests plus all Phase 5D SQL tests. **Checkpoint D:** report privacy/provider/budget/engine results and stop. New provider attempts, hidden retries or core writes are blockers.

## Stage 13 — Internal scheduler endpoint, with no scheduler activation

### Task 18 — Strict HMAC request contract and fail-closed route

**Files:** pulse `scheduler.ts`, internal route, scheduler tests. No `vercel.json`, Cron SQL, extensions or environment files.

**Interfaces:** `parseSchedulerRequest(request: Request, secret: string, now: number): Promise<SchedulerInput>`; input is exactly `{ version: 1, scheduledSlot: string, issuedAt: number, nonce: string }`. Export `schedulerSigningText(input): string` for deterministic tests and later scheduler documentation. Signature arrives in fixed `X-Agent-Pulse-Signature` header as 64 hex characters, not body data.

The existing dispatch RPC enforces the same integer-second freshness: reject fractional `p_issued_at`, floor only the authoritative current tick's epoch, and compare whole issued epoch inclusively against current epoch minus600/plus60. Test `.000000`, `.500000` and `.999999` authoritative instants directly in disposable SQL fixtures, plus actual-route600/601 and future60/61 boundaries. Do not alter HTTP validation or add tolerance/clamping.

- [ ] RED: correct signature; wrong key/path/method/version; unknown owner/payload keys; duplicate/malformed fields; oversize/non-JSON body; exact 600-second age/60-second future skew; wrong/future slot; same/changed nonce; first empty slot; replay after all owners deleted. Assert rejected requests have zero claims/reservations/provider calls.
- [ ] Run `node --test lib/ai/agent/phase5d-scheduler.test.mjs`; observe RED.
- [ ] Reject duplicate JSON keys before constructing the scheduler object, including escaped duplicate names. Use a small fixed flat-object token reader, decoding primitive key/value tokens with JSON parsing; reject nesting/arrays and unknown keys. Do not introduce a general JSON-parser dependency.
- [ ] GREEN: read at most 1 KB with fatal UTF-8 decoding, then exact-schema validation. Canonical text is `1`, `POST`, `/api/internal/agent/pulse`, canonical UTC slot, integer issued-at seconds, and lowercase UUID nonce, joined by `\n` with no trailing newline. Decode fixed-size signature, HMAC-SHA256 with Node crypto, then `timingSafeEqual`. Accept age <=600 seconds and future skew <=60; slot must equal the current four-hour UTC slot. No arbitrary owner input.
- [ ] Route exports Node runtime, dynamic/no-store behavior and `maxDuration = 60`; invoke bounded engine only after authentication/config validation. Proposed server-only names are `AGENT_PULSE_SCHEDULER_SECRET` and `AGENT_PULSE_ENABLED`; missing/false enablement prevents owner processing. Do not set them now. When a configured, authenticated dispatch is intentionally disabled, atomically establish a zero-claim `disabled` slot outcome; replay cannot later expand it. Missing secret is a rejection, not an accepted dispatch. Return safe aggregate outcome only.
- [ ] Repeat scheduler/claims/installation/engine tests. Stop if deployment itself enables processing, authentication relies on browser cookies, or a signature/failure leaks secrets. An in-flight bounded worker may finish after a server configuration kill switch changes; immediate owner revocation uses SQL settings/fencing.

## Stage 14 — Authenticated settings and memory-clear APIs

### Task 19 — Strict owner routes without implicit opt-in

**Files:** pulse `routes.ts`, `data/agentInbox.ts`, settings/clear route files, route tests.

**Interfaces:** `handlePulseSettings(request: Request): Promise<Response>`, `handlePulseMemoryClear(request: Request): Promise<Response>`. GET accepts no query/body/owner. POST settings accepts exactly `{ expectedRevision, mode, cadence, aiProjectIds, checksConsentVersion?, aiConsentVersion? }`; version values must equal current server disclosures when required. Explicit clear accepts exactly `{ expectedRevision, confirmation: 'CLEAR_AGENT_MEMORY' }`. New absent settings use expected revision 0; existing revisions must match.

- [ ] RED: unauthenticated/cross-origin/unknown-key/owner-injection/oversize/duplicate-project requests fail; GET never inserts; mode changes require correct consent; stale revision conflicts; confirmed clear affects only Agent memory; installation events/manual audits persist. Assert no browser table grants or direct client Supabase writes are needed. Test the isolated 60-write/minute boundary and unchanged manual/private-AI request counters.
- [ ] Run `node --test --test-name-pattern='settings|clear' lib/ai/agent/phase5d-routes.test.mjs`; observe expected RED in the authenticated settings/clear cases.
- [ ] GREEN: use `getSupabaseServerClient`, `requireAuthenticatedAiUser`, same-origin checks and existing safe `AiError` response conventions. Derive owner from `auth.getUser()` only; bound JSON bodies to 4 KB with fatal UTF-8 parsing. Call only named service RPCs, no direct private-table APIs. Enforce the isolated owner-state UI-write guard inside these RPCs, preserving the existing manual/private-AI meter and approval lease. GET remains read-only/no-store.
- [ ] Repeat route/settings/retention/schema tests and existing auth/AI route tests. The response contains revision/consent/safe usage/current owner project choices only, not provider secrets/ledger rows. Current owned-project choices use an authenticated fixed `id,title` projection, bounded/paginated, not a broad workspace loader.
- [ ] Stop on implicit opt-in, a changed manual route/error mapping, a new browser grant, or a memory clear that refunds installation events.

## Stage 15 — Inbox, Brief, Journal and proposal handoff APIs

### Task 20 — Safe read/feedback/ack contracts

**Files:** pulse `routes.ts`, `data/agentInbox.ts`, Inbox/feedback/ack/Brief/Journal routes, route tests.

**Interfaces:** `handleInbox`, `handleInboxFeedback`, `handleInboxAck`, `handlePulseBrief`, `handlePulseJournal`, all `(request: Request): Promise<Response>`. `InboxItem`, `InboxDetail`, `InboxPage`, `PulseBriefDto`, `PulseJournalPage` and `PulseSettingsDto` are allowlisted browser DTOs. Internal authority/source/event types are not imported by client components.

**Detail contract clarification (E4a):** `InboxDetail` is `{ item: InboxItem | null, reviewContext: InboxReviewContext | null }`. Context contains only `targetLabel`120, `deterministicSummary`400, `deterministicExplanation`240/null and `advisoryIdea:{title:120,summary:400}`/null (Unicode code points). Extend only existing service-only `agent_pulse_get_observation`; its safe flat item result gains `reviewContext`, which the HTTP boundary reconstructs separately. Preserve the internal repository's item-only reader and all list/Brief/Journal/feedback/ACK projections. No new RPC or browser grants.

For signals, use their own current deterministic facts. For ideas, resolve the exact stored same-owner parent signal only, verify target/source/episode/category relationships and existing freshness/complete evidence, and separate the child's advisory text. Current labels come from the existing source projection. Missing/stale/unavailable/changed/malformed authority returns null context and cannot authorize handoff. Never infer parent by target/condition/title/time matching or expose parent IDs, episodes, raw evidence or source/authority tokens. Prove this with same-target/different-parent, zero-write snapshot, role/catalog and strict nested DTO tests on PGlite and genuine disposable PostgreSQL. E4a does not implement Task21 draft generation.

- [ ] RED: owner-only rows; strict list/detail query exclusivity; maximum 20 pagination; owner/filter cursor binding; stale source/target loss; no GET writes/model calls; no prohibited nested fields; unknown reason/error strings rejected; feedback conflicts; unseen content cannot be falsely acknowledged; brief 24-hour boundary.
- [ ] Run `node --test lib/ai/agent/phase5d-routes.test.mjs`; observe RED.
- [ ] GREEN: Inbox GET accepts either `{ id }` or bounded `state/cursor/limit` query; reject duplicate/unknown parameters. Brief GET has none; Journal GET accepts cursor/limit. Feedback POST is exactly `{ id, expectedRevision, action, snoozeDays? }`, with snoozeDays present only for snooze and one of 1/3/7. Ack POST is exactly `{ items: [{ id, contentRevision }], brief: boolean }`, at most 20 distinct IDs, at most 5 for brief=true. No owner/evidence/rank/source payload keys.
- [ ] Resolve current ownership/source freshness through fixed RPCs and project safe text lengths/reason unions. Source changes withdraw evidence only from returned GET DTO; do not persist a lifecycle transition on a read. Explicit feedback/ack performs narrow Agent-owned writes. A stale acknowledgement cannot mark newer content seen; brief acknowledgement uses SQL time. Separate owner state from aggregate installation budget availability; never return ledger events/nonces/reservation keys.
- [ ] Repeat route/lifecycle/projection/retention tests and Activity regression. Stop on any raw payload leakage, automatic model call/run/proposal, or GET mutation.

### Task 21 — Current-source composer draft

**Files:** `data/agentInbox.ts`, pulse `routes.ts` detail projection, handoff tests; no manual Agent module changes.

**Interface:** `buildInboxReviewDraft(detail: InboxDetail): string`, maximum 1000 code points. `InboxDetail` supplies owner-checked current target identity/labels, safe deterministic summary, optional advisory idea and freshness state. Unavailable/unknown source yields no actionable draft.

- [ ] RED: `review_only_prefills`, `changed_source_cannot_be_authority`, `deleted_or_foreign_target_has_no_draft`, `idea_is_untrusted_advisory`, `draft_is_bounded`, `no_manual_run_or_proposal_on_review`. Assert core rows and manual run/action counts are unchanged after GET detail and draft construction.
- [ ] Run `node --test lib/ai/agent/phase5d-handoff.test.mjs`; observe RED.
- [ ] GREEN: produce a plain-text request to review current named facts and prepare a fresh proposal after rechecking. Include only safe current target references needed by manual Agent; never executable payloads, canonical versions or provider-supplied IDs. Clearly separate optional idea text from factual evidence.
- [ ] Repeat handoff/route tests and existing Phase 4 review/recovery tests. Existing `buildAgentReviewPrompt` behavior remains unchanged; reuse its UI prefill pattern rather than manufacture a fake `ProposalDraft`.
- [ ] Stop if Review sends automatically, directly saves a proposal, mutates an entity, or bypasses manual ownership/canonicalization.

## Stage 16 — Minimal notebook UI integration

### Task 22 — Inbox, settings, status and expandable Journal

**Files:** browser service, AgentInbox/AgentPulseSettings/AgentPulseStatus components, `WorkspaceAiChat.tsx`, UI/handoff tests.

**Interfaces:** `agentInboxService` exposes named fetch functions for the routes above, takes AbortSignal where needed and validates safe DTOs. `AgentInbox({ onReview, onNavigate })`, `AgentPulseSettings({ onChanged })`, `AgentPulseStatus({ status })`. `WorkspaceAiChat` adds optional `inboxOpenRequest: number` and uses an internal panel selector for Chat/Agent/Activity/Inbox without changing message/tool/proposal semantics.

- [ ] RED: pure state/text tests for Off/never-checked/checking/partial/stale/budget/error, rolling request versus idea labels, filters/actions/revision conflicts, consent/empty scope, confirmed memory clear, keyboard focus and handoff. Preserve existing Chat/Agent/Activity rendering and file/context behavior.
- [ ] Run `node --test lib/ai/agent/phase5d-ui.test.mjs lib/ai/agent/phase5d-handoff.test.mjs`; observe RED before component changes.
- [ ] GREEN: add Inbox selection and isolated components using existing notebook classes/buttons. Journal is expandable inside Inbox. Settings distinguishes checks consent from provider disclosure/scope consent. Review switches to Agent and sets the draft exactly as existing Activity `onReview` does; it never calls send. Handle loading/empty/conflict/error, safe cancellation on unmount/owner change, pagination and disabled controls while submitting.
- [ ] Acknowledge displayed revisions explicitly on Inbox open, through POST, never incidental GET. Render no raw HTML/links from provider text. Show source/check time and stale/partial labels; Resolve copy explicitly affects only the Inbox item. UI memory clear confirms rediscovery and surviving operational accounting.
- [ ] Run targeted UI/handoff/routes tests, plus local browser keyboard/focus checks on an authorized disposable authenticated environment. Do not substitute mock data in the product or point state-changing tests at Production. Test-only network fixtures may exercise rendering, but must be labeled as fixtures and cannot prove authenticated end-to-end behavior. If the required safe browser/test runtime is unavailable, stop rather than claim UI proof or add infrastructure.

### Task 23 — Return brief and five-width integration

**Files:** AgentPulseBrief component, minimal `app/app/page.tsx` placement/state, UI/handoff tests.

**Interface:** `AgentPulseBrief({ onOpenInbox })`; page increments `inboxOpenRequest` and calls existing `setAiOpen(true)`. Mount only when `authStatus==='authenticated'`, workspace is ready and `workspaceUserId===user.id`; reset on owner change. No demo/anonymous Agent memory.

- [ ] RED: maximum 5/dedup/ranking, stale suppression, no repeat banner after acknowledgement, newer content not hidden, timezone change does not bypass 24 hours, auth-owner switch clears prior display, and Open Inbox only opens the panel. Assert no extra manual Agent request is issued.
- [ ] Run focused UI/handoff tests and observe RED.
- [ ] GREEN: place the return card beside/below the existing greeting without redesigning the dashboard. Explicit Open/Dismiss acknowledges only displayed revisions; no navigation GET acknowledgement. Reuse current `aiOpen` state and composer interactions; do not introduce a global event bus/state framework.
- [ ] Verify widths 1440/1024/768/390/320 with existing Playwright or browser tooling in the safe local environment. Capture actual viewport, horizontal overflow, action/dialog visibility, keyboard order, focus restoration, loading/error and long Unicode text cases. Keep fixture screenshots distinct from real authenticated flow evidence.
- [ ] **Checkpoint E:** report Inbox/settings/status/Brief/Journal/handoff and five-width results; stop. Missing safe UI execution, raw content exposure or any Review-triggered send is a blocker.

## Stage 17 — Full local regression and final concurrency proof

### Task 24 — Fresh verification, including all ledger races

**Files:** only fix new Phase 5D files for demonstrated defects; update their focused tests first. Existing core files remain outside scope except the two approved UI integration files.

- [ ] Run the fresh full Phase 5D suite and genuine PostgreSQL matrix. Add final engine/API integration cases for account deletion after an uncertain reservation, original batch deletion/replay, all owners Off/deleted plus operational pruning, failure rollback between owner reservation and ledger insert, and safe database-abort recovery on FK/deletion contention. Both committing transactions and an expected fail-closed rollback must leave the installation invariant intact; never promise deadlock-free Auth cascades.
- [ ] Run whole Agent Phase 1–5D, Calendar/time-block/Focus/accountability/workspace-shell/task-kanban, Private AI and Public AI suites, then TypeScript, exact-changed-file ESLint, build and diff checks using Validation commands. Record fresh actual counts/failures/skips per command; no baseline count reuse.
- [ ] Inspect entire candidate diff/import graph, migration hash and every old migration hash; inspect all function overload grants, RLS, ledger exact shapes/no owner FK, default Off and no activation. Verify no source/config/dependency drift or arbitrary event writer.
- [ ] Repeat five-width/keyboard/owner-switch UI evidence and manually review user-facing text, retention/clear disclosures and provider terms applicability. A new failure gets a focused RED/GREEN cycle; do not weaken a test/constraint or expand phase scope to obtain green.
- [ ] **Checkpoint F:** report full local/regression/concurrency outcomes and practical limitations; stop. Failed, skipped or unavailable required proof prevents rollout readiness.

## Stage 18 — Implementation report and rollout readiness

### Task 25 — Evidence-backed report, with no release side effects

**Files:** no extra project artifact required by this plan. Produce report in the implementation response and refer to redacted local evidence captured outside the worktree. A separately requested acceptance document would require adding its path to the authorized manifest.

- [ ] Fill the report template below from fresh outputs, exact diff and migration hash. Distinguish PGlite serial coverage, true PostgreSQL barriers, browser fixtures and real authenticated local flows. Mark unavailable checks explicitly.
- [ ] Verify no Production migration/code/configuration/scheduler change, no dependency install, no commit/push/deploy and no later phase. Recheck worktree branch/HEAD/status and only the authorized candidate manifest.
- [ ] Classify as `READY FOR SEPARATE ROLLOUT REVIEW` only if all local required checks passed and no blocker remains. This is not rollout authorization or hosted acceptance.
- [ ] **Checkpoint G:** present report for owner review and stop. Do not execute Stage 19 operations without their separate authorizations.

## Stage 19 — Future rollout gates, documented only

### Task 26 — Keep release, infrastructure and consent authorization separate

This task specifies a future release checklist; it authorizes no external action and creates no deployment/configuration file now.

- [ ] **A — Local implementation:** finish approved tasks/checkpoints and retain exact migration/candidate hashes and true PostgreSQL evidence.
- [ ] **B — Migration/rollout review:** separately inspect full additive migration, history/order, default Off, all four private tables/ACLs, ledger shape/unique constraints/account-deletion proof, backward compatibility and rollback. Recheck platform/provider docs and current capabilities.
- [ ] **C — Production schema:** only after explicit authorization, prove the exact pending set/hash and use the normal reviewed transactional migration path. Do not use include-all/repair/manual history workarounds. Verify old Production app health, existing RPCs/actions/Undo/Activity/time-block constraints and new service-only grants. No scheduler or consent activation.
- [ ] **D — Preview code:** deploy only the exact separately authorized commit. Reuse a matching READY Preview. Check target/SHA and correct stable OAuth callback before any settings change; stop on auth issues and identify the exact missing setting. No Production application release yet.
- [ ] **E — Hosted acceptance with scheduler disabled:** validate Inbox/settings/Brief/Journal/read-only defaults/manual approvals/legacy flows and safe projections. Preview may share Production data; no background job, destructive cleanup or real account deletion is implied. Do not send provider context without explicit scoped consent. Use disposable PostgreSQL proof for deletion races.
- [ ] **F — Production application release:** only with separate authorization; release exact reviewed code with owner checks Off and scheduler unenabled. Verify health and existing manual AI behavior. Deployment/merge must not activate processing.
- [ ] **G — Infrastructure activation:** separately verify Supabase limits, installed pg_cron/pg_net availability/signatures and Vault permissions. Obtain approval before required extensions/configuration. Provision dedicated Vault HMAC secret and matching server-only Vercel secret/kill switch; no secrets in SQL files or job literals/logs. Create exact Cron job disabled, inspect stored command/signing method/HTTP timeout, then explicitly enable only when authorized. Secret-setting changes do not alter Production OAuth/Gemini configuration outside the approved activation.
- [ ] **H — Deterministic owner opt-in:** explicit checks consent for one owner. Observe bounded Pulse, coverage, slot replay/claim count, safe ledger-only installation controls, no manual runs/actions or core writes. Verify operational cleanup with all owners Off, kill-switch behavior and recovery; do not enable AI implicitly.
- [ ] **I — Optional AI activation:** separate current informed consent and selected projects; observe one bounded real request/normalized idea and atomic owner/installation reservation. Unknown failure remains consumed. Verify no core writes; stop again at any unsafe result.

Disable dispatch/owner mode first for containment, retaining additive schema and content-free accounting during its window. Do not drop tables, refund events, rewrite migrations, restore arbitrary snapshots or roll back user workspace rows. A code rollback must tolerate additive schema and disabled scheduling. Account deletion remains permitted throughout; no restrictive FK or Auth deletion hook is introduced.

## Checkpoint table

| Checkpoint | Completed tasks | Required evidence / stop |
| --- | --- | --- |
| A | 1–6 | Pure four-signal scanner, keys/fingerprints/completeness/date tests green |
| B | 7–13 | All four-table schema/RPC/ACL/lifecycle/accounting/retention disposable tests green; old migrations unchanged |
| C | 14 | True PostgreSQL claims/fencing/reservation/deletion/replay/retention race proof |
| D | 15–17 | Dedicated privacy, one physical request, strict budgets and commit-before-AI engine green |
| E | 18–23 | Scheduler/user contracts, Inbox/settings/Brief/Journal/handoff, safe browser and five widths green |
| F | 24 | Fresh complete regression/build/type/lint/diff and repeated real concurrency proof |
| G | 25 | Exact report/manifest/hash, limitations and separate rollout-review readiness; no release |

If the owner later authorizes only one checkpoint, stop there. A future implementation instruction may authorize crossing specified checkpoints; this planning request authorizes none. No subagent is dispatched by this document.

## Validation commands for later implementation

Run from the authorized worktree, with previously available runtimes. These are planned commands, not results of this documentation task. Node flags precede paths; PowerShell arrays avoid relying on shell wildcard expansion. Every suite must contain files and report zero failures; required database/concurrency/UI cases must not be skipped.

```powershell
git branch --show-current
git rev-parse HEAD
git status --porcelain=v1 --untracked-files=all
git diff --check
git diff --cached --check

$pulseTests = @(Get-ChildItem -LiteralPath 'lib/ai/agent' -Filter 'phase5d-*.test.mjs' -File | Select-Object -ExpandProperty FullName)
if ($pulseTests.Count -eq 0) { throw 'Phase 5D tests are missing' }
node --test @pulseTests

$agentTests = @(Get-ChildItem -LiteralPath 'lib/ai/agent' -Filter '*.test.mjs' -File | Select-Object -ExpandProperty FullName)
node --test @agentTests

node --test data/workspaceCalendar.test.mjs data/timeBlocks.test.mjs data/timeBlockService.test.mjs
npm run test:focus-session
npm run test:accountability
npm run test:workspace-shell
npm run test:task-kanban
npm run test:ai
npm run test:public-ai
npx --no-install tsc --noEmit

$pulseSource = @(Get-ChildItem -LiteralPath 'lib/ai/agent/pulse' -Filter '*.ts' -File | Select-Object -ExpandProperty FullName)
$pulseRoutes = @(
  'app/api/internal/agent/pulse/route.ts',
  'app/api/ai/agent/pulse-settings/route.ts',
  'app/api/ai/agent/pulse-settings/clear/route.ts',
  'app/api/ai/agent/inbox/route.ts',
  'app/api/ai/agent/inbox/feedback/route.ts',
  'app/api/ai/agent/inbox/ack/route.ts',
  'app/api/ai/agent/brief/route.ts',
  'app/api/ai/agent/journal/route.ts'
)
$pulseUi = @(
  'data/agentInbox.ts', 'data/agentInboxService.ts',
  'components/ai/AgentInbox.tsx', 'components/ai/AgentPulseSettings.tsx',
  'components/ai/AgentPulseStatus.tsx', 'components/ai/AgentPulseBrief.tsx',
  'components/ai/WorkspaceAiChat.tsx', 'app/app/page.tsx'
)
npx --no-install eslint @pulseSource @pulseRoutes @pulseUi @pulseTests lib/ai/agent/phase5d-test-support.mjs lib/ai/agent/phase5d-fixture.mjs lib/ai/agent/phase5d-postgres-fixture.mjs
npm run build
git diff --check
```

Capture/check `$LASTEXITCODE` after each native command and stop on failure; do not let a later command hide an earlier failure. During preflight select existing Agent tests without the not-yet-created Phase 5D files. Preserve `AGENT_TEST_PGLITE_MODULE` only in the current process, without printing unrelated env values. For true PostgreSQL use an explicit `AGENT_TEST_POSTGRES_DSN` process value and an independently verified existing local `psql` path; never print the DSN or infer it from production secrets. Missing test prerequisites cause a reported failure, not an install or skip.

Migration integrity: capture filename/SHA256 maps before creation with `Get-ChildItem supabase/migrations -File | Get-FileHash -Algorithm SHA256`, compare every old pair after each SQL task, and hash the one new migration separately. Verify remote history read-only before allocation/rollout; no timestamp is selected in this plan. For new unstaged documents/files, ordinary `git diff --check` is insufficient: also inspect `git diff --no-index --check -- NUL <exact-file>`; expected difference exit1 without whitespace diagnostics is not a test failure. Once release staging is separately authorized, run `git diff --cached --check` and inspect the exact staged manifest.

Browser verification uses existing Playwright/browser tools at the five exact widths and a safe authorized local authenticated environment. A fixture screenshot proves rendering only; real auth/API/RPC flow requires its own evidence. Never install another browser/runtime, create an auth principal, change config or mutate Production merely to unblock a test without separate authorization.

## Eventual implementation report template

Report each item with fresh evidence, exact counts/exits and an explicit unverified reason where applicable:

1. Branch/worktree/exact baseline and final HEAD; no unsolicited commit.
2. Approved amended specification version/hash and execution/checkpoint authorization.
3. New migration filename/version/SHA256 and how ordering was proven.
4. Every prior migration hash unchanged.
5. Exact new/modified file manifest versus this plan.
6. Four signal definitions, threshold/date boundaries and results.
7. Completeness/truncation/absence/unknown behavior.
8. Stable keys/material fingerprints and merged task cards.
9. Observation lifecycle/revisions/suppression/snooze/capacity.
10. Pulse lifecycle and deterministic commit-before-AI.
11. Lease/fence/settings/source-token/evidence-valid-until guards.
12. Installation ledger exact event shapes and prohibited-data checks.
13. Account deletion and new-identity behavior; no deletion restriction.
14. Independent slot establishment, empty/same/changed-nonce replay and deleted-batch recovery.
15. Atomic owner/installation reservation, rollback and lost-response recovery.
16. Request/accepted-idea rolling windows and actual budget outcomes.
17. Separate consent/version/project scope and privacy guard.
18. Physical provider request count, SDK retry/abort/wire/schema bounds.
19. Provider/DB/dispatch failure handling and uncertain reservations.
20. Scheduler signature/body/timestamp/slot/nonce security.
21. Ownership/RLS/grants/default execute/helper/browser denial checks.
22. Safe Inbox/Brief/Journal DTOs and no raw ledger/audit/context exposure.
23. Settings/UI modes/usage/loading/error/stale states.
24. Composer handoff and unchanged manual proposal/Apply/Cancel/Undo contracts.
25. Memory clear, owner retention and independent operational pruning.
26. Focused test counts per suite, failures/skips and RED/GREEN evidence.
27. Whole Agent Phase 1–5D regression counts/results.
28. Calendar/time-block/Focus/accountability/workspace-shell/task-kanban results.
29. Private AI and Public AI counts/results.
30. TypeScript result.
31. Exact-file ESLint result.
32. Build result and known unrelated warnings.
33. Diff/status/index checks and manifest scope.
34. Five-width/keyboard/browser evidence; fixtures versus real authenticated flows.
35. True PostgreSQL case names, backend PIDs/barriers, final states; PGlite serial limits kept distinct.
36. Remaining risks, unavailable prerequisites and exact blockers; no fabricated readiness.
37. Separate migration/Preview/Production/infrastructure/consent rollout prerequisites, readiness classification and confirmation of no unauthorized external action/later phase.

## Plan self-review and stop conditions

Spec coverage: sections 1–7 map to global constraints/Tasks 1–6; sections 8–14 to Tasks 7–17; sections 15–18 to Tasks 20–23; sections 19–22 to Tasks 9/11/16–18; sections 23–29 to Tasks 7–15/19–20; sections 30–31 to Tasks 22–24; sections 32–35 to Tasks 7/14/24–26; sections 36–38 to scope/limitations/rollout gates. The installation clarification additionally maps to Tasks 7/9/11/13/14/17/18/24/26. All five Review Focus cases have explicit task tests.

No unresolved architectural contradiction remains after the approved ledger amendment. Runtime availability, installed SQL/SDK signatures, provider terms/quota and safe local browser/auth setup remain preflight facts to verify. Their absence blocks the relevant checkpoint; it does not permit another dependency, mock product fallback or weaker invariant.

Stop on unexpected source/config/history drift; privacy/grant leakage; an arbitrary event writer; owner-dependent global accounting/replay; blocked account deletion; partial reservation commits; source hash/completeness mismatch; stale feedback/fence acceptance; autonomous core/manual-audit writes; extra model attempts; unavailable/failed required true PostgreSQL or safe UI proof; or any genuine specification contradiction. Report the exact evidence instead of changing architecture.

**Stop after completing this plan document. The next gate is owner review and approval of the plan and selection of the execution method. No implementation, migration creation/application, configuration, dependency addition, commit, push, deployment or next phase is authorized by this document.**
