# Workspace Agent Phase 5D — Proactive Intelligence & Agent Inbox

## 1. Status and approval context

**Status: written design for owner review. Implementation is not authorized by this document.**

The owner approved the architectural direction with an MVP refinement on 2026-10-15. This specification incorporates that refinement: exactly four deterministic signal families, Agent-owned persistence, optional separately consented Gemini interpretation, and the existing manual approval boundary.

The subsequent approved clarification adds one owner-independent installation operational ledger to the three owner-scoped Agent tables. It preserves installation request accounting and dispatch identity across account deletion. Account deletion remains allowed; no other product scope changes.

The owner-approved 2026-10-16 Checkpoint B clarification makes current-episode AI attempt count/time and malformed terminality durable on the parent SIGNAL observation. Pulse provenance retention cannot reopen retry eligibility. This targeted amendment adds no feature/table and does not authorize Task 14 or rollout.

Verified documentation baseline:

- Branch: `codex/workspace-agent-phase5d`.
- Worktree: `C:/Users/Franz/.codex/worktrees/workspace-agent-phase5d/software-workplace`.
- HEAD: `9c78e912b76b64de7743c8b1a31723cc6945c4bc`.
- Working tree and index were clean before this specification was created.

The current documentation authorization permits this targeted amendment and completion of the separate implementation plan. It does not authorize application changes, migration creation/application, scheduler activation, configuration changes, dependencies, commits, pushes, or deployments. Owner review of the completed implementation plan is the next gate.

Throughout this document, “must” describes an acceptance requirement. Proposed routes, functions, fields, and bounds describe the future implementation, not existing behavior. Numerical thresholds below are explicit initial product policy, subject to owner review of this specification.

## 2. Problem statement

Workspace Agent currently responds when the owner asks. Important deadlines, unscheduled important tasks, quiet projects, and a crowded tomorrow can remain unnoticed between visits. The owner wants a persistent assistant that checks periodically and saves a small number of useful observations and ideas.

Persistence must not imply autonomous management of the workspace. The assistant needs a private Inbox and truthful check history, with predictable cost, bounded context, durable suppression, and safe recovery from duplicate or failed scheduled execution.

## 3. Goals

- Run bounded, periodic checks for explicitly opted-in owners.
- Notice the four approved conditions using deterministic current workspace facts.
- Save a concise, deduplicated Inbox and return brief.
- Optionally explain a meaningful observation or suggest a next step through Gemini, within separate consent and strict budgets.
- Preserve Review, canonical proposals, Apply/Cancel, Activity, Undo, and recovery.
- Make missed checks, partial coverage, stale evidence, AI failures, and costs visible without exposing private implementation data.
- Reuse the existing Node runtime, PostgreSQL authority, timezone source, calendar semantics, and notebook UI.

## 4. Non-goals

This phase does not implement autonomous workspace changes, a general background agent, continuous monitoring, a new approval system, a job platform, or a second Agent runtime. It does not infer technical completion from project names, phase labels, status changes, or model opinion.

Plan actionable-step analysis, Plan Items, project-completion inference, live GitHub polling/interpretation, and positive Apply-based learning are outside the MVP. The full deferred list is in section 36.

## 5. Existing architecture evidence

Repository paths below are relative to the verified worktree. They are integration evidence, not authorization to edit those files.

| Area | Existing evidence | Design consequence |
| --- | --- | --- |
| Manual Agent | `app/api/ai/agent/route.ts`, `lib/ai/agent/executor.ts`, `registry.ts`, `schemas.ts` | Authenticated requests, fixed tools, bounded rounds, canonical proposal collection already exist. Pulse must not invoke this tool loop automatically. |
| Approval boundary | `lib/ai/agent/proposals.ts`, `store.ts`, `action-route.ts`, `components/ai/AgentProposalCards.tsx` | Proposal storage and deterministic Apply/Cancel remain the only path for Agent workspace mutations. |
| Activity and Undo | `lib/ai/agent/activity.ts`, `undo.ts`, `undo-route.ts`, `components/ai/AgentActivity.tsx` | Reuse safe projections and manual recovery. Do not copy raw audit payloads into Pulse context or add another inverse algorithm. |
| Existing AI UI | `components/ai/WorkspaceAiChat.tsx`, `data/agentProposalReview.ts` | Review Again already prefills the composer without automatically sending. Inbox handoff should follow that behavior. |
| Reads | `lib/ai/agent/tools.ts` | Fixed owner-filtered reads report truncation. `list_unscheduled_tasks` means missing due dates; it cannot answer whether work blocks exist. |
| Calendar | `data/workspaceCalendar.ts` | `taskCalendarDate` preserves date-only/UTC-midnight input semantics. Deadline counts are not effort estimates. |
| Scheduling | `data/timeBlocks.ts`, `lib/ai/agent/time-blocks.ts`, `20261011090000_workspace_agent_time_blocks.sql` | Saved working preferences and `profiles.time_zone` exist. Time blocks have independent ranges and database overlap protection. Pulse only reads them. |
| Accountability | `data/accountabilityService.ts`, `accountabilityDataService.ts` | Recorded activity can inform quiet-project evidence. Browser snapshot capture writes workspace data and must not run from Pulse. A partial scan must not become a fabricated health score. |
| Plans | `data/planService.ts`, `20261014114242_workspace_agent_plans.sql` | Plan records and manual proposals exist. Plan Items and step analysis remain deferred; they are not required Pulse inputs. |
| GitHub | `app/api/github/projects/[projectId]/activity/route.ts`, `data/githubAppService.ts` | Activity is fetched through separate GitHub authorization and a short memory cache. No durable complete activity feed exists for safe background reuse. |
| Focus | `data/focusSession.ts`, `app/app/page.tsx` | Focus timing is browser state, not reliable server activity telemetry. Pulse must not infer focus work. |
| Provider/runtime | `lib/ai/agent/gemini.ts`, `gemini-transport.ts`, `contract.ts`, `lib/ai/private-concurrency.ts` | Manual Agent uses a 50-second deadline, 60-second route duration, and transport retries. Pulse has separate budgets and must not inherit hidden retries or block manual Apply/Cancel with its lease. |
| Persistence/security | `lib/supabase/admin.ts`, `lib/ai/auth.ts`, existing Agent migrations | Server-only service access and private audit RPC patterns exist. New tables stay private; user-facing routes authenticate with Supabase Auth. |

No existing tracked recurring Pulse scheduler was found. Read-only hosted metadata inspection during architecture review found `pgcrypto` and Supabase Vault, but not `pg_cron`, `pg_net`, or `cron.job`. This is an observation from review, not a guarantee about rollout-time state.

Platform facts inspected on 2026-10-15 must be checked again during rollout:

- Vercel Hobby Cron supports daily scheduling, which does not satisfy four-hour checks. See [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- Supabase Cron supports recurring jobs; HTTP dispatch uses `pg_net`, with Vault recommended for secrets. See [Supabase Cron](https://supabase.com/docs/guides/cron) and [scheduled HTTP functions](https://supabase.com/docs/guides/functions/schedule-functions).
- `pg_net` requests start after transaction commit and have their own timeout. See [pg_net documentation](https://supabase.com/docs/guides/database/extensions/pg_net). Installed signatures and duration limits require verification before activation.
- Gemini limits depend on project and model; application ceilings do not guarantee provider availability. See [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
- Unpaid Gemini usage can involve provider use/review of submitted content, subject to applicable terms and regional/account exceptions. Consent must explain the actual account's terms. See [Gemini API terms](https://ai.google.dev/gemini-api/terms).
- Free Supabase availability can be interrupted, including project pausing. See [production readiness guidance](https://supabase.com/docs/guides/deployment/going-into-prod).

## 6. Core safety invariant

Agent Pulse may autonomously write only its own state, Pulse records, observations, ideas, feedback/suppression, and safe Journal provenance in three owner-scoped private tables, plus minimal installation dispatch/reservation controls in the fourth private table. The operational ledger is not Agent memory or workspace state.

Pulse must never write projects, tasks, milestones, Plans, Plan Items, time blocks, notes, GitHub links, accountability snapshots, or another core workspace entity. It must not call existing proposal-save, Apply, Cancel, Undo, GitHub-write, or general workspace CRUD functions. It does not create manual Agent runs/actions.

Real workspace changes still require a manual Agent request, server canonicalization, user review, and explicit Apply. Apply/Cancel/Undo/recovery remain deterministic and do not gain Gemini calls. Reading Inbox, Journal, Activity, or a brief does not trigger a scan, provider call, proposal, or workspace mutation.

## 7. Phase 5D MVP boundary

The MVP contains exactly:

1. Deadline approaching or overdue.
2. Important task due soon without qualifying scheduled work.
3. Project quiet according to recorded workspace activity.
4. Tomorrow deadline count and/or scheduled occupancy worth reviewing.

The first two can share one task card. Counts refer to facts observed at a check, not forecasts of effort. An optional AI idea attaches to one eligible deterministic observation; it is not a fifth signal family.

## 8. Agent Pulse lifecycle

1. An authenticated scheduled dispatch identifies a UTC slot.
2. PostgreSQL selects eligible opted-in owners and claims bounded work.
3. A fixed read projection returns a consistent, bounded source snapshot, coverage metadata, current settings, and source tokens.
4. Pure deterministic scanning computes conditions and compares prior observations/baseline.
5. A short guarded transaction publishes deterministic observations and coverage. This commits before optional Gemini work.
6. If there is a meaningful eligible change, AI consent/scope, time, and budget, reserve one provider attempt atomically.
7. Send minimized context once. Validate the response and revalidate source/settings before publishing at most one idea.
8. Finalize the Pulse, advance the next due time, and release its lease. All publication is fenced.

No transaction or row lock stays open during provider/network calls. Quiet checks make no Gemini call. An unsuccessful interpretation cannot roll back committed deterministic observations.

Suggested internal endpoint: `POST /api/internal/agent/pulse`, Node runtime, maximum route duration 60 seconds and internal deadline 45 seconds. Dispatch handles at most two owners, sequentially, with a maximum 20 seconds per owner. A provider attempt has a 12-second timeout and starts only with more than 15 seconds left in both owner and dispatch budgets. Otherwise record `ai_skipped_time_budget`. These are Pulse limits; manual Agent deadlines/retries remain unchanged.

## 9. Deterministic signal definitions

### Shared rules

Use one versioned deterministic scanner and explicit policy constants. Capture a single evaluation time from PostgreSQL and a valid saved `profiles.time_zone`. Do not create another timezone setting or silently use server/browser timezone. Missing/invalid saved timezone skips date-dependent evaluation with visible coverage information.

Reuse Calendar's canonical task-date interpretation, including UTC-midnight values entered as calendar dates. Milestone/project target dates are calendar dates. A deadline day remains due today until the next local day starts; overdue means the canonical day is before today. Local day lengths must follow timezone rules, not fixed 24-hour arithmetic. Missing and invalid dates are distinct; neither is invented.

Eligible tasks are all statuses except `Completed`; blocked tasks can have deadline attention, with their blocked status displayed. Milestones are eligible unless `completed`, and require an owned parent project. Projects in `Completed`, `Cancelled`, or `On Hold` are excluded from deadline/quiet monitoring; their tasks/milestones are also excluded from these MVP signals. A blocked project can retain deadline attention but is excluded from quiet-project interpretation. Status exclusion is a monitoring policy, not a declaration of technical completion.

### 9.1 Deadline approaching or overdue

| Property | Initial rule |
| --- | --- |
| Inputs | Owned incomplete task `due_date`, milestone `target_date`, or project `target_date`, plus relevant ownership/status links |
| Trigger | Canonical deadline is overdue or within today through three local calendar days ahead, inclusive |
| Urgency | Overdue, due today, due tomorrow, due in two/three days, in that order |
| Evidence | Entity type, safe title, canonical date, status, evaluated local day, and check time |
| Resolution | Date removed/moved outside window, completion, excluded parent status, or entity/link loss, proven by a complete targeted recheck |

Increasing lateness may update displayed urgency for an active card. It must not create another card or reopen a dismissed/resolved unchanged condition. A model cannot alter the deadline or choose urgency.

### 9.2 Important task lacks scheduled work

The task must be `High` or `Critical`, incomplete, not `Blocked`, and have a valid canonical due day from today through three local days ahead. Past deadlines stay in the deadline family; this signal does not recommend scheduling into a past range.

A qualifying block is owned by the same user, linked to that task and its canonical project, `scheduled`, of kind `task` or `focus`, with a valid range. It has at least one minute of future time remaining before the exclusive end of the deadline day. A currently running qualifying block can count; a completed/cancelled block or a `break`/`custom` block does not. This proves some scheduled work, not sufficient effort to finish the task.

“No qualifying block” requires a complete targeted relationship query, including blocks beginning before now but ending after now and ranges crossing query boundaries. It cannot be inferred from `list_unscheduled_tasks`, a missing due date, or a truncated generic block list. Evidence includes the checked interval and checked relationship token, without copying block notes.

If both deadline and missing-work conditions hold, retain both reason codes in one task attention card. A newly linked block invalidates missing-work evidence even when `task.updated_at` is unchanged.

### 9.3 Project has gone quiet

Eligible project statuses are `Planning`, `Research`, `In Development`, `Testing`, and `Deployment`. Use canonical `workflow_stage` to identify maintenance. Threshold is 14 elapsed days for other projects and 60 elapsed days for maintenance projects. These are explicit per-project workflow rules, not a new configurable inactivity subsystem.

Last recorded activity is the maximum valid project creation/update time and the creation/update/completion times of its owned linked tasks and creation/update times of its milestones. Use a bounded aggregate over those relations; do not fetch descriptions or full child collections. Creation establishes a baseline for a new project. Future-dated/invalid activity timestamps make that project's quiet result unknown until corrected; they are not silently clamped into a confident claim.

The condition holds when elapsed time since that maximum is at least the threshold. Display “No recorded workspace changes for 14 days” or equivalent. Do not claim no coding, no GitHub activity, no focus work, abandonment, or lack of progress outside the app. Plan Items, notes, GitHub polling, and browser Focus telemetry are not inputs.

A recorded activity change, threshold/workflow change, or eligible status change is material. Further passage of time alone is not material for suppression.

### 9.4 Tomorrow workload review

“Tomorrow” is the next local calendar day. Trigger either of these independent facts:

- At least five eligible incomplete tasks have that canonical deadline. Show separate milestone/project deadline counts for context; do not count them as additional task effort.
- Scheduled, non-cancelled blocks occupy at least 85% of saved working time tomorrow. Occupancy uses the union of actual block intervals clipped to the saved work window, including overlapping legacy data only once. Break/custom blocks occupy calendar time too. A completed block does not become future scheduled occupancy.

Use saved working weekdays/start/end. If tomorrow is not a working day, or preferences/range are absent or invalid, omit the occupancy test and report why; the deadline count can still trigger. Do not substitute defaults and label them as saved preferences. Buffers and inferred focus duration are not counted as booked time. Invalid ranges make occupancy unknown.

Evidence separates “5 task deadlines” from “85% of saved working hours booked.” Never translate counts into hours, declare the owner overloaded, or invent availability. One condition key per owner and tomorrow's local date prevents duplicate cards. Expire it when that day is no longer tomorrow; stale old-day cards do not enter the return brief.

## 10. Completeness rules

Initial per-owner read limits are 50 projects, 200 tasks, 100 milestones, and 500 relevant time blocks. The range read covers now through seven local days ahead plus overlapping blocks. No Plan/Plan Item scan is required by the four-signal MVP. Quiet-project aggregates are restricted to the selected owned projects and bounded by statement timeout, with explicit per-project success/unknown flags.

Fetch one additional row where needed to prove truncation. Return per-collection and per-signal coverage, bounds, checked interval, and evaluation time. Use deterministic ordering; do not call a capped collection complete. Candidate selection prioritizes overdue/soon facts and then stable UUID order. Existing observations receive targeted rechecks independently of new-candidate discovery, up to 20 per Pulse, so a newly truncated list cannot erase them.

- A present, valid fact can support a positive deadline observation despite unrelated collection truncation.
- Absence of work blocks, absence of newer activity, and total counts/occupancy require complete relevant relationship/aggregate coverage.
- A targeted `EXISTS`/aggregate can prove completeness for one target even when another collection is truncated.
- Unknown is not false. Unknown conditions cannot resolve, reopen, or produce confident ideas.
- Only proven false conditions resolve automatically; deletion/ownership loss requires a targeted owner check.
- A partial check cannot advance a missing portion of the baseline. Persist coverage independently.

The fixed projection and its source hashes must be generated from one SQL statement snapshot per owner. All reads have owner predicates, field allowlists, range bounds, and timeouts. No broad browser workspace loader, notes loader, mock data, or live GitHub fetch belongs in this path.

## 11. Agent-owned persistence model

Use three owner-scoped Agent tables plus one owner-independent installation operational ledger. Inbox, watching, suppression, ideas, Brief, and Journal do not need separate tables.

| Table | Responsibility |
| --- | --- |
| `private.agent_pulse_state` | Owner settings, consent, scheduling authority, compact comparison baseline, acknowledgement |
| `private.agent_pulses` | Unique scheduled execution, operational outcome, AI reservations, safe provenance |
| `private.agent_observations` | Deterministic cards, optional ideas, feedback, suppression and revisions |
| `private.agent_pulse_installation_events` | Short-lived installation dispatch identity/claim ceiling and provider-reservation accounting; no user/workspace content |

Use UUID internal identities and explicit owner relationships for the three Agent tables. Their Auth owner FKs cascade normally on account deletion. Polymorphic workspace targets are not falsely represented as a general FK: fixed SQL branches verify their type, ownership, parent links, and existence on reads/writes. Thin references remain useful after source deletion without preserving copied source content.

The installation ledger accepts only two database-validated event shapes:

- `dispatch_slot`: opaque event ID, scheduled UTC slot, nonce fingerprint, bounded canonical aggregate outcome, initial claim count from zero to two, and creation time. One dispatch event per slot is unique, including empty slots.
- `provider_reservation`: opaque event ID, unique opaque reservation-operation key, and reservation time. The corresponding owner Pulse stores that operation key while it exists, but the event has no cascading FK to a Pulse or Auth owner.

The ledger has no `user_id`, email/name/profile, workspace IDs, titles/descriptions, observation/Inbox text, evidence, workspace source tokens, prompts/output/context, credentials, or auth/session metadata. It is not an Inbox, Journal, user-history or memory table. No arbitrary event writer exists. Its events survive owner deletion and Agent-memory clear until operational retention expires.

All text, JSON structures, enumerations, scopes, and array counts are bounded in validation and database checks. No full row snapshots or audit payloads are retained.

## 12. Pulse state

One row per owner; absence means Off. GET requests do not initialize a row. An explicit authenticated settings update creates/enables it.

Required conceptual fields:

- `user_id` primary key and FK to `auth.users` with account-deletion cascade.
- `mode`: `off`, `workspace`, or `workspace_ai`; cadence: `normal` or `quiet`.
- Separate proactive checks consent and AI consent version/timestamp. AI consent is not implied by checks consent or manual Agent consent.
- AI scope: bounded explicit project references, initially empty, maximum 20 references and 2 KB encoded. Current ownership is revalidated. Whole-workspace scope is not an implicit default.
- `settings_revision`, versioned policy, `next_due_at`, `last_success_at`, last coverage summary, last brief acknowledgement time.
- Lease token, expiry, monotonic fence, and compact previous-state baseline, maximum 16 KB.
- Creation/update timestamps.

Owner deletion cascades this row and its owner-scoped Pulse/observation data. It does not delete installation events or restore installation quota. A later registration with a new Auth UUID is a new owner identity with its own owner budget.

The baseline contains typed condition fingerprints, aggregate counts, coverage markers, and evaluation dates. It contains no descriptions, copied rows, general status history, completion inference, or provider messages. Observations hold per-condition history; the baseline is not a workspace snapshot.

Mode, consent, scope, cadence, or relevant settings changes increment the revision and invalidate in-flight authority. Timezone remains exclusively `profiles.time_zone`; the value used for a check is recorded as provenance. A changed timezone invalidates date evidence even without a settings-row change.

Plan scope is considered but not activated in this MVP: none of the four signals requires Plan content. Adding Plan interpretation requires a later approved scope change; project scope must not silently include Plans or Plan Items.

## 13. Pulse provenance and Journal

`private.agent_pulses` records an execution, not a thought process. Required concepts:

- ID, owner, scheduled UTC slot, dispatch nonce, start/completion times.
- Status: `running`, `succeeded`, `partial`, `failed`, or `abandoned`.
- Fence, settings/policy version, timezone used, read bounds and completeness counts.
- Deterministic commit marker and counts of created/updated/resolved observations.
- AI reservation timestamp, opaque installation reservation-operation key, outcome, parent/episode and attempt number for provenance, and whether an idea was accepted. The operation key is distinct from owner, Pulse, and workspace identifiers. Per-episode attempt eligibility comes only from the current parent SIGNAL state, never retained Pulse headers.
- Bounded safe error code and safe summary of at most 400 characters.

One `(user_id, scheduled_slot)` is unique. A partial unique index permits at most one `running` Pulse per owner. Composite `(id, user_id)` keys support same-owner observation provenance FKs. Final Pulse outcomes are sealed; separately authorized retention can remove text/obsolete rows. Reservation timestamps are never rewritten to refund uncertain calls.

Owner Pulse rows remain authoritative for per-owner accounting and recovery while that owner exists. Installation accounting and established-slot identity come from the independent ledger, so cascade deletion cannot erase those installation controls. Canonical dispatch outcomes contain aggregate counts/codes only; owner-specific recovery may reload still-existing Pulse rows and must never recreate deleted rows.

Use `succeeded` for a completed fully covered deterministic scan, even if optional AI was skipped or failed; AI has its own outcome. Use `partial` for a completed scan with unknown/uncovered portions, `failed` when no usable deterministic commit completed, and `abandoned` when expired execution cannot finalize. Do not describe a successful deterministic check as unavailable solely because Gemini failed.

Journal is an owner-only projection of meaningful Pulse summaries: counts checked, coverage limitations, facts noticed, and AI outcome. A quiet successful check updates status/last-check time but adds no prominent Journal entry. Expandable operational detail may show its time and outcome. Do not say “2 Plans checked” when Plans were not read.

Never persist prompts, hidden reasoning, thought signatures, full Gemini responses, credentials, source code, raw workspace snapshots, or raw audit payloads. A validated bounded idea is the only retained provider text.

## 14. Observation lifecycle

`private.agent_observations` uses `active`, `snoozed`, `dismissed`, and `resolved`. A signal observation and an idea share storage but have distinct kinds and validated shapes.

Required concepts include owner; stable condition key; target type/ID; reason-code set; episode; material fingerprint; current source token; bounded evidence; importance; lifecycle state; first noticed/last checked/last material change times; snooze/revisit times; feedback counters; row revision; content revision; seen content revision; and first/latest Pulse references. An idea also has a same-owner parent observation reference and a bounded category.

Approved Checkpoint B clarification: the parent SIGNAL observation owns current-episode `ai_attempt_count` (integer 0–2), `ai_last_attempt_at` (finite timestamp, null exactly when count is zero), and `ai_attempt_terminal` (boolean for malformed-output terminality; true requires a consumed attempt). Ideas have zero/null/false and never receive independent retry authority. Pulse attempt number/time/outcome/parent/episode fields are provenance only; they do not reconstruct episode eligibility. Ordinary rechecks, same-episode content changes, Snooze/Dismiss/User Resolve and suppression compaction preserve these fields. Only an existing approved semantic new-episode transition resets them to zero/null/false; polling, elapsed age, wording, urgency alone and retention cannot reset them.

Limits: title 120 characters, summary 400, explanation 240, evidence 2 KB, condition key 160, and bounded stable reason/error-code unions. Length enforcement applies after normalization. Raw provider/source objects never enter browser DTOs.

| Event | Required behavior |
| --- | --- |
| First proven condition | Create one active observation, subject to capacity/new-item limits. |
| Unchanged active condition | Update check metadata; do not increment content revision or create a new card. |
| Material fact changes | Update evidence and content revision; reopen a suppressed condition only under the material-change rules below. |
| Read | Return projection only; do not mark seen implicitly. |
| Acknowledge | Authenticated explicit write of displayed ID/content revision; cannot acknowledge a newer unseen revision. |
| Snooze | Save an explicit future instant and feedback revision. Hide from brief. |
| Snooze expires | Queue bounded re-evaluation; surface only if the current condition is proven true, remains relevant, and passes suppression rules. |
| Dismiss | Suppress that condition episode/fingerprint. Mere age, polling, urgency bucket, wording, or policy deployment cannot recreate it. |
| User Resolve | Mark resolved and suppress unchanged material facts; this does not complete a task/project. |
| Proven false | Resolve automatically; record safe reason, retaining suppression identity as needed. |
| Unknown/partial recheck | Keep prior lifecycle state; mark evidence stale/coverage unknown. |
| Target deleted/unowned | Remove displayable source text, resolve as unavailable, and remove from brief/AI context. |

`new` is `content_revision > seen_content_revision`, not a status. `watching` is an active observation with a revisit due time, not a separate status. Row revision protects feedback from concurrent writes; content revision changes only meaningful visible evidence, not last-check timestamps.

Material fingerprints include the condition's semantic inputs: deadline/status/priority where relevant, qualifying block relationships/ranges, quiet-project last activity/threshold, or tomorrow's exact dated counts/ranges. Exclude unrelated row updates, generated wording, elapsed age, and urgency bucket alone. A condition proven false and later true begins a new episode. A changed date, new/moved/removed relevant block, or recorded new project activity can permit a new episode; a duplicate scan cannot.

Stable task attention keys merge deadline/missing-work reasons for one task. Milestone/project deadline keys and quiet-project keys stay distinct; the brief deduplicates repeated targets, showing combined evidence where possible. Tomorrow keys include the local date.

Snooze choices are one, three, or seven local days, preserving the selected local time where valid and using the existing timezone boundary rules for transitions. Store the resolved UTC instant. No arbitrary background watches are introduced. Dismiss/Resolve/Snooze write only Agent-owned state.

## 15. Agent Inbox

Add Inbox inside Workspace AI while preserving Chat, Agent, and Activity. Default Inbox shows active relevant cards, then waiting ideas; snoozed/resolved/dismissed records are secondary views. Paginate 20 items with stable ordering and opaque owner-bound cursors.

Actions are Review, Snooze, Dismiss, and Resolve. Ideas offer Review idea / Turn into proposal. Review fetches a fresh safe owner-checked context and prefills the existing Agent composer. It does not send the message or create a proposal. Unavailable or stale targets show a reason and offer refresh; they never navigate to another owner's entity.

User-facing proposed boundaries are fixed Inbox list/detail/feedback/acknowledgement and proactive settings routes under `/api/ai/agent/`. Authenticated writes use the existing same-origin, strict-body, owner, rate-limit, and error conventions. Feedback accepts identifiers, expected revision, a known action, and an allowed snooze choice; it never accepts arbitrary evidence, ownership, rank, or source payloads. Pulse scheduler authentication is separate from browser sessions.

## 16. “While you were away” brief

The return card is a read-only projection of at most five active, unseen, current items. Rank deterministically by: overdue/today deadline; tomorrow deadline or important missing work; tomorrow workload; other deadlines within two/three days; quiet project; attached idea. Within a class use canonical deadline, priority, material change time, then stable ID. Model output cannot change ranking.

Deduplicate by target/condition and parent idea, merging task deadline/missing-work facts. Suppress dismissed/resolved/snoozed conditions and obsolete tomorrow cards. Evidence older than 24 hours or with failed current coverage is not presented as a fresh assertion; Inbox can show it as stale with its last check time.

Show the return card only when there are eligible unseen revisions and no acknowledged brief in the preceding 24 hours. A timezone change does not bypass that interval. Opening Inbox or dismissing the banner explicitly acknowledges only the displayed revisions; it does not acknowledge future changes. Ordinary navigation/GET remains read-only. Unacknowledged cards can remain in Inbox without repeated banners within the same visit.

## 17. Idea generation

Ideas are optional interpretations of a meaningful deterministic observation, never invented evidence. Eligibility requires current complete relevant evidence, project scope consent, an unseen material episode, enough time, and a successful reservation. A quiet scan, a dismissed parent, or an unchanged already-attempted episode does not trigger routine AI calls.

For provider failure, an otherwise eligible episode may receive at most one later attempt, no sooner than 12 hours later, within all rolling budgets. This is recorded in Agent-owned attempt metadata; it is not immediate transport retry. Malformed output is terminal for that episode. Parent changes require re-evaluation before another attempt.

Reservation locks installation advisory authority, owner state, Pulse, then parent signal. Validate current authority/consent/scope/source/episode, count below two and at least 12 hours since the first reservation, plus rolling owner/installation budgets. Atomically mark Pulse provenance, insert the installation reservation, increment the signal count and stamp its last-attempt SQL time. Failure rolls all three back; canonical replay never increments again. Success, failure, timeout, crash and unknown outcome all consume the reservation without refund. Malformed output also marks durable signal terminality. Unreferenced Pulse pruning cannot affect this policy.

At most one accepted idea per Pulse and two per owner in a rolling 24 hours. Dedupe by parent condition episode and server-allowed idea category, not generated prose. An idea expires from active review after seven days or earlier if its source changes, disappears, or loses scope. Dismissal does not teach positive Apply preferences or train a model.

## 18. Proposal handoff

Review resolves owner-checked source labels and a bounded deterministic explanation into the existing composer. Treat copied idea text as untrusted advisory text. The owner can edit it and explicitly send it in Agent Mode. Existing manual consent, rate limits, tool validation, canonicalization, and proposal creation then apply.

Authenticated Inbox detail alone includes nullable `reviewContext`: `targetLabel` (120 code points), `deterministicSummary` (400), `deterministicExplanation` (240 or null), and `advisoryIdea` (`title`120/`summary`400 or null). Signals use their own current deterministic facts. Ideas use only their exact stored same-owner parent signal's deterministic facts; child text remains separately advisory. The label comes from the existing current owner/source projection, never copied/provider wording. The parent must still be a signal with matching target/source/episode/category relationships and current complete evidence. No parent lookup may infer a relationship from matching targets, condition keys, titles or timestamps.

Missing, stale, unavailable, changed or malformed authority yields `reviewContext:null`, meaning no actionable handoff. Parent IDs, episodes, raw evidence and source/authority tokens remain private. The existing service-only detail getter adds this safe field without widening Inbox list, Brief, Journal, settings, feedback or ACK. Detail GET remains read-only and does not acknowledge, invoke a model, start a manual run or create a proposal.

No Pulse identifier confers mutation authority. The manual route re-reads current entities and relationships. Do not directly transform stored AI text into executable payloads, accept old source versions as current, or invoke `save_agent_proposal_batch` from Inbox Review. Existing Apply/Cancel request contracts remain `{ runId, actionIds }`; Prepare Undo remains `{ runId, actionId }`.

Activity remains history of manual actions; Journal remains Pulse history. Review does not mark an action accepted/applied, and observation Resolve does not change workspace completion. No automatic Apply-based feedback linkage is added.

## 19. Scheduler architecture

Use Supabase Cron to dispatch through `pg_net` to the secured Vercel Node endpoint. Reuse the existing TypeScript runtime; do not duplicate scanner/provider logic in an Edge Function or SQL Cron script. No Vercel Cron fallback is introduced.

Initial schedule is one dispatch every four hours, at 00:00/04:00/08:00/12:00/16:00/20:00 UTC. Normal owners are due every slot; Quiet owners every third slot. This is approximate periodic checking, not an exact local-time guarantee. No catch-up burst occurs after downtime. Select due owners by oldest next-due time then ID, without accepting a caller-selected owner.

The first valid dispatch atomically establishes one installation ledger event and at most two owner claims for its scheduled slot. Select and persist the bounded claim batch before processing either owner; acquire selected state rows in UUID order while preserving due-time selection priority. Every later request for that slot recovers the original aggregate outcome and cannot expand the batch, even with another nonce or after account deletion. A first empty batch is final for the slot. This bounds invocation duration and duplicate amplification for the current small workspace installation. More due owners wait fairly for later slots; expansion requires capacity review. Manual actions do not request extra Pulse work.

The service-only dispatch RPC requires an explicit fourth boolean `p_processing_enabled`, with no default or three-argument overload. This trusted server-internal processing decision is not part of the scheduler HTTP payload. Under the installation advisory lock, validate the identity and non-null flag, then recover an existing slot before considering the flag. Only a fresh slot with processing disabled establishes `outcome=disabled`, `claim_count=0` and no owner claims; this branch precedes all owner selection, locking and processing and leaves owner state untouched. An existing disabled, empty or claimed slot always wins over later processing state. The engine still consults this authority when disabled but executes zero owners, including when recovering an earlier claimed batch.

`pg_net` is only the dispatcher; verify its HTTP timeout accommodates the endpoint before activation. A transport timeout does not imply the worker failed, so retry/recovery must consult PostgreSQL slot status. Avoid including response bodies or secrets in Cron job text/logs. Scheduler URL and credentials are fixed trusted configuration, never request-selected destinations.

## 20. Scheduler authentication

Use a dedicated scheduler HMAC-SHA256 secret, separate from the Supabase service-role key. The Cron side reads it from Vault; the Node side reads the corresponding server-only secret. Key provisioning is a later authorized configuration step.

The request contains exactly protocol version, UTC scheduled-slot start, issued-at Unix seconds, and a random UUID nonce. It contains no owner ID or arbitrary payload. Sign a documented canonical UTF-8 string consisting of protocol version, `POST`, fixed endpoint path, slot, issued-at, and nonce, separated by newlines. Verify the bounded syntax first, then a fixed-length decoded signature with constant-time comparison. Reject unknown keys, oversized bodies, wrong methods/path/version, malformed slots, and future slots.

Use a ten-minute maximum request age and at most 60 seconds future clock skew. The slot must equal the current four-hour UTC slot; delayed dispatch outside the window is skipped. Freshness does not replace idempotency.

Freshness uses integer epoch seconds end-to-end. SQL requires `p_issued_at` to be an exact whole-second instant before extracting its epoch; fractional issued timestamps are invalid, never rounded or floored. SQL floors only the authoritative current tick to its integer epoch second, then accepts issued epochs inclusively from current epoch minus600 through current epoch plus60. No tolerance seconds or timestamp clamping is added.

Under the installation lock, first consult the unique `dispatch_slot` ledger event. If absent, establish it and the zero-to-two owner claims in the same transaction. If present, return its bounded canonical aggregate outcome without new claims. The nonce fingerprint distinguishes same-nonce retry from another nonce, but both recover/skip the already established slot. An empty slot remains established. Deleting all originally claimed owners cannot reopen it; missing owner Pulse rows are not recreated.

Do not rely solely on `agent_pulses` for installation replay/claim limits. The ledger records only an opaque nonce fingerprint, count and safe outcome code, never owner identities. Invalid requests receive no database mutation or Gemini call. HMAC freshness and database idempotency are separate requirements; neither claims exactly-once external delivery. Test empty/nonempty slots, same/changed nonce, stale timestamps, delayed responses, and deletion of all claimed owners.

## 21. Cadence and budgets

| Policy | Initial ceiling |
| --- | --- |
| Default mode | Off |
| Workspace checks | Deterministic only |
| Workspace + AI ideas | Deterministic checks plus separately consented, scoped Gemini |
| Normal / Quiet | 4 hours / 12 hours |
| Owner Pulses | 6 in rolling 24 hours, including failed claimed Pulses |
| Provider attempts per Pulse | 1 |
| Owner proactive provider attempts | 2 in rolling 24 hours |
| Installation proactive provider attempts | 4 in rolling 24 hours |
| New deterministic observations | 3 per Pulse |
| Existing observation rechecks/updates | 20 per Pulse |
| New ideas | 1 per Pulse, 2 per owner in rolling 24 hours |
| Provider input | 12 KB UTF-8 total, including instructions and schema |
| Provider signals | At most 3 scoped deterministic signals |
| Provider output | 800 tokens maximum, plus strict parsed field/byte limits |
| Return brief | 5 items |

Rolling windows use PostgreSQL time and `(now - interval '24 hours', now]`; an attempt at the lower boundary has aged out. Reserve under database authority before an outbound attempt, counting every reservation including timeout, abort, crash, and unknown provider outcomes. Do not refund an uncertain reservation. Budget denial still permits deterministic publication. Retain reservation metadata beyond the accounting window, including any execution/freshness allowance.

Per-owner request accounting uses owned Pulse reservations. Installation request accounting uses only `provider_reservation` installation events. Under the shared installation transaction advisory lock, count both rolling windows, verify both ceilings, mark the owner Pulse reserved and insert exactly one installation reservation event with the same opaque operation key, then commit together. A failure commits neither; a lost response reloads canonical state and must not reserve/transmit again. A uniqueness key prevents duplicate installation events without an owner/Pulse FK.

Deleting an owner removes that owner's budget/history but never refunds installation attempts. New Auth identities have new owner budgets while the installation ceiling remains four. Accepted-idea publication separately checks its actual acceptance-time window, not only request timestamps. Reserve and publish at most one idea per Pulse; delayed acceptance cannot exceed two accepted ideas per owner in a rolling 24 hours.

Versioned server policy defines numeric ceilings within broad storage bounds; changing a cadence/budget policy does not require reshaping tables. Increasing approved ceilings requires review, not a client-provided override. UI labels say “last 24 hours,” not “Today,” for rolling counts. These are proactive budgets, not a replacement for provider quotas or manual AI limits.

## 22. Gemini interaction contract

Use a dedicated proactive provider entry point. Do not import the manual Agent loop, tool registry, proposal tools, GitHub context builder, or existing retry helper. Explicitly configure one SDK attempt (`httpOptions.retryOptions.attempts = 1` in the inspected SDK); prove one physical request with a transport test. Abort/time-limit the request. No function declarations or tool execution are available to Gemini.

Input is a fixed instruction/schema plus at most three minimized, currently scoped signals using per-request aliases. Titles are at most 120 characters and treated as untrusted data. Include only allowed statuses, priorities, canonical dates, bounded counts/occupancy facts, and necessary project labels. No UUID is required by the provider.

After deterministic publication commits, orchestration performs a fresh guarded service-only source read before building proactive context. Committed observation `id`/`episode` come from PostgreSQL; scanner decisions never create observation authority. The same bounded internal references supply canonical `seen`/`lastCheckedAt` for the existing privacy guard's unseen/freshness requirements. These fields are not added to browser DTOs or provider-visible contents.

Output is a strict object with one known source alias, one category from `review_deadline`, `consider_scheduling`, `review_quiet_project`, or `review_tomorrow`, a title of at most 120 characters, and advisory text of at most 400 characters. Reject unknown keys, unknown aliases/categories, multiple ideas, invalid encoding/size, tool requests, mutation instructions represented as executable objects, and malformed JSON. Bound raw response ingestion to 8 KB and discard it after validation; persist only the normalized accepted fields.

The server supplies evidence, rank, navigation, identifiers, source token, and state. The model cannot supply authoritative dates, free slots, ownership, SQL, routes, actions, or completion claims. Reject explicit numeric/date/range claims not present in the supplied evidence. Generated prose is still advisory and cannot be completely fact-verified by shape validation; label it as an AI idea and keep factual evidence separately server-rendered. Render text as escaped plain text, not HTML or trusted links. Do not store hidden reasoning or raw provider responses. Validation failure produces a safe outcome code, not a partially accepted idea.

## 23. Privacy and consent

There are two explicit choices: enable deterministic background workspace checks, and additionally enable background Gemini ideas for selected projects. Manual Chat/Agent consent is insufficient. Off is the default for every existing/new account. AI scope starts empty; choosing AI mode without selected projects sends nothing.

Before AI consent, disclose that periodic checks may send selected private project/task/milestone titles and bounded facts to the configured Gemini service. Explain the applicable provider data-use terms, cadence, caps, scope, and revocation. Minimization does not guarantee a private title is non-sensitive. The owner must be able to retain deterministic checks without AI, remove scope, or turn everything off. Record versioned affirmative consent; a changed disclosure requiring new consent disables AI until accepted.

A dedicated proactive context guard uses an allowlist and a total UTF-8 byte limit. Allowed fields are selected titles, statuses, priorities, canonical deadlines, necessary project labels, and deterministic evidence. Exclude notes, files, source code, repository contents, GitHub text, descriptions, objectives, next-action prose, credentials, auth metadata, audit payloads, `before_state`, prompts, and hidden reasoning. Do not reuse a broad manual context loader and redact afterward.

Known credential/token/private-key patterns must be rejected from selected text; this is additional protection, not a complete sensitive-data detector. If context fails the guard, skip AI and retain deterministic facts privately. Missing consent, lost ownership, or changed scope must prevent reservation/publication. Recheck immediately before outbound transmission; a revocation after transmission cannot unsend data, and this limitation must be stated truthfully.

AI project scope includes only facts for that owned project and its task/milestone children. A cross-project tomorrow aggregate is not sent wholesale: derive a correctly labeled scoped aggregate from complete facts, or skip that signal for AI. Deterministic Inbox checks can cover the opted-in owner's workspace independently of narrower AI scope. Provider aliases are ephemeral and not user identities.

Offer deletion of Agent-owned memory through a separately confirmed owner action, without deleting workspace entities or existing Agent audit history. A clear operation invalidates leases/fences and removes observations/baseline/text; it retains minimal recent owned reservation/slot metadata for owner accounting. It cannot erase required installation events. Account deletion may cascade all owner-scoped Agent data, while the content-free installation ledger survives its normal short operational window. Explain this distinction and that clearing suppression allows later rediscovery if checks stay enabled. No export into user notes occurs automatically.

Clear may remove current-episode attempt state and permit later rediscovery as new Agent memory, but it never refunds recent owner provider reservations or installation accounting and never reopens established dispatch slots. No hidden long-term owner tombstone is retained solely to survive explicit clear. Automatic retention/Journal pruning preserves signal attempt authority; account deletion may cascade it normally.

## 24. Security

The worker dependency boundary consists only of fixed read projection, deterministic scanner, context guard/provider adapter, and narrow Agent-owned persistence/budget functions. Reject imports/calls to workspace CRUD, proposal storage, Apply/Cancel/Undo, snapshot capture, GitHub write functions, and arbitrary SQL/REST dispatch. Import-boundary and database-diff tests enforce this rule.

Gemini receives no service-role key, database credentials, scheduler secret, SQL capability, tool capability, or arbitrary route selection. Source titles and model text remain untrusted data. No secret, prompt, source payload, cookie, token, or raw response appears in logs. Operational logging is limited to safe outcome codes, duration, counts, coverage, and correlation identifiers.

Read/feedback/settings routes authenticate the current Supabase user server-side; browser-supplied owner IDs are rejected. Validate same origin for authenticated state-changing routes. Scheduler requests use only HMAC and the fixed dispatch contract; browser auth cookies cannot select an owner for scheduled processing. Public AI/public profile routes cannot read or import Pulse data.

The service-role credential is a trusted server capability already present in this app. Narrow functions and import boundaries restrict intended behavior; they are not a claim that a compromised service-role key cannot access other existing service RPCs. Protect the credential, keep it server-only, and test the complete reachable Pulse call graph.

## 25. Ownership and RLS

- Every row in the three Agent tables has a non-null cascading owner FK to `auth.users`; state is owner-unique. Account deletion remains allowed.
- Installation events are intentionally owner-independent, with no owner/Pulse FK or user/workspace content. Their typed uniqueness/shape constraints protect operational controls after owner deletion.
- Pulse/observation provenance uses composite owner FKs. An idea's parent observation must share its owner; reject self-parenting and non-signal parents.
- Workspace targets/scopes are checked by fixed typed owner predicates, including milestone-through-project and task/project/block links. Removing ownership makes content unavailable rather than crossing a tenant boundary.
- Enable RLS on all four private tables and add no browser policies. Explicitly revoke schema/table/sequence/function access from `PUBLIC`, `anon`, and `authenticated` as appropriate, without altering unrelated existing grants.
- Revoke direct DML on these tables from service callers; grant only the narrow public RPC entry points to `service_role`. Table ownership/definer roles provide the necessary internal access.
- Use `SECURITY DEFINER` only to cross the private-table boundary in fixed functions. Set empty `search_path`, qualify relations/functions, validate arguments/owners, and revoke default public execute grants. No dynamic SQL or caller-selected table names.

Browser requests always pass through authenticated server routes and safe DTO projection. Internal RPC owner arguments come from trusted selection/authentication, never arbitrary request data. RLS/grants are defense layers; neither replaces owner predicates in service functions.

Only narrow service-side dispatch/reservation/retention functions may access the installation ledger. No generic event-write RPC, public policy, or ledger-row projection is allowed. Inbox, Journal, Brief, normal Activity and Public AI never expose these rows; authenticated UI may receive only the already required safe aggregate usage/outcome information.

## 26. Concurrency and fencing

### Authority and lock order

PostgreSQL, not process memory or Vercel execution identity, owns scheduling authority. Acquire a row lock on `agent_pulse_state` before claiming that owner. Increment its monotonic fence and assign a random lease token with 90-second expiry. The lease exceeds the worker's 45-second internal/60-second platform budget; a worker still must check expiry on every write.

An expired running Pulse is marked abandoned before a later eligible slot is claimed. Never re-execute an abandoned slot. A new worker receives a higher fence. Only one live `running` row per owner and one owner-slot row can exist, enforced by indexes in addition to locking.

| Order | Resource | Operations that acquire it |
| --- | --- | --- |
| 1 | One transaction-scoped installation advisory lock, protecting installation events | Dispatch establishment, provider reservation, accepted-idea accounting, memory clear and operational retention |
| 2 | Owner state row, sorted owner UUID if a bounded operation needs two | Claims, settings/disable, feedback, publication, finalization, cleanup |
| 3 | Owner Pulse row | Claim/recovery, reservation, publication, finalization |
| 4 | Observation rows in sorted UUID order | Publication, feedback/acknowledgement, cleanup |

An operation may start at a later resource only if it never subsequently acquires an earlier one. Feedback/settings need only owner state then observations; they must not acquire the installation lock later. No core workspace entity is locked for writing by Pulse, and no Pulse lock spans manual Agent transactions. No new lock is added to existing Apply/Cancel/Undo paths.

Ledger establishment/insertion and its associated owner claim/reservation commit atomically under the earliest installation lock. Installation event accesses do not introduce a later-acquired global resource. Retention uses that same lock before removing aged events. Auth owner cascade never touches the installation ledger or takes a new Phase 5D deletion lock.

Do not reuse/hold the manual private-AI lease for a background Pulse: that lease also guards approval/recovery. Background can skip AI when a foreground lease is already active, but this is best-effort prioritization, not a promise that provider calls never overlap.

### Publication guards

Every deterministic write, AI reservation/publication, and finalization verifies the current lease token, unexpired SQL-clock lease, fence, Pulse status/slot, settings revision, applicable mode/consent, and current owner. Publication also checks observation row revision to preserve concurrent feedback.

Source tokens are opaque hashes of a fixed canonical projection, not simply `updated_at`. Include ownership and parent links, relevant statuses/deadlines/priorities, qualifying block IDs/statuses/ranges, working preferences where relevant, timezone, evaluated day, policy version, and coverage. Quiet-project tokens include the complete bounded aggregate used as evidence. Tomorrow tokens include the dated relevant counts/ranges. A new linked block invalidates missing-work evidence without a task-row edit. The scanner also supplies an evidence-valid-until instant for the earliest relevant local-day or time-block qualification transition; SQL rejects publication after that instant. A source hash alone cannot detect the passage of time.

SQL read/hash helpers have one shared projection definition. The TypeScript scanner alone derives signal meaning; SQL publication recomputes the projection hash and validates shape/ownership rather than maintaining another scanner algorithm. Recompute and compare hashes in the same statement snapshot used for guarded publication. Changed/missing/unknown sources discard affected output and schedule normal future re-evaluation; do not overwrite newer feedback.

These are point-in-time observations. A manual edit can commit immediately after a publication snapshot; no design can keep a displayed fact continuously current without continuous monitoring. DTOs include check times and freshness labels. Inbox detail/Review rechecks source tokens, withdraws changed evidence from the returned projection, and never treats an old card as mutation authority. This targeted validation is not a new Pulse; GET does not persist the withdrawal or acknowledgement. No shared workspace lock or new core-write hook is introduced to manufacture continuous freshness.

Settings disable/scope changes advance authority under the state lock. A stale worker cannot finalize or publish after newer authority. Disabling AI allows already committed deterministic observations to remain; it discards later AI output. Disabling all checks stops future claims. An already sent network request may finish externally, but cannot publish through revoked authority.

## 27. Idempotency

Four independent controls are required:

1. Unique owner-independent dispatch-slot events, including empty outcomes, prevent replay amplification and batch expansion across account deletion.
2. Unique `(owner, slot)` prevents duplicate execution for that owner and scheduled wake-up.
3. Owner lease/fence and one-running index prevent overlapping authoritative writers.
4. Unique owner condition key, episode fingerprints, and parent/category idea keys prevent duplicate content.

Each deterministic publication batch carries a bounded commit identity on its Pulse and is atomic with its observation writes. A lost response reloads canonical commit/outcome state instead of recreating observations. An AI reservation is one-way and unique to its Pulse. After a lost reservation response, a caller may reload its state but must not risk another provider transmission; skip AI unless it can prove no transmission was started in the current process.

Installation provider-operation keys are unique without depending on a surviving Pulse/Auth row. Recover original dispatch aggregate outcomes from the ledger even if all claimed owners disappeared. For a deleted owner, do not reconstruct owner memory or reserve a replacement request; the installation reservation remains consumed.

There is no claim of exactly-once delivery to an external provider. A crash/timeout around transmission leaves an unknown consumed reservation; the slot is not replayed. Later episode retry follows section 17 and all budgets. Feedback/acknowledgement uses optimistic row/content revisions; repeating the same operation is idempotent, and stale conflicting feedback returns a safe conflict with the current projection.

## 28. Failure recovery

| Condition | Deterministic outcome |
| --- | --- |
| Gemini unavailable, timeout, or quota exhausted | Keep deterministic commit. Consume reservation if reserved; record bounded outcome; no immediate retry. |
| Malformed/oversized Gemini result | Discard all output; keep deterministic observations; terminal AI failure for that episode. |
| Duplicate Cron invocation | Return canonical slot/nonce outcome; do not create runs/actions or extra claims. |
| Overlapping owner Pulse | Claim loses to lease/index; skip, without taking over an unexpired writer. |
| Expired worker | All writes fail fence/expiry checks; later slot abandons stale running record and can claim fresh authority. |
| Vercel unavailable | No claim means no Pulse/budget use. Skip missed slot; never backfill with a burst. |
| Supabase unavailable | No trusted claim/reservation/publication means no provider call or workspace write. Show last known check as stale. |
| Crash after deterministic commit | Keep committed observations. Operational row may remain running until abandoned; last deterministic check/coverage remains distinguishable from full success. |
| Crash after AI reservation | Reservation remains consumed even if it is unknown whether Gemini received a request. |
| Source edited during computation/network | Token mismatch discards affected output; preserve unaffected deterministic results and record partial coverage. |
| Entity or link deleted/lost | Owner recheck withdraws source text/navigation and resolves unavailable target; do not generate an idea. |
| Timezone changed | Date-source tokens fail; defer date-sensitive results until normal re-evaluation; do not rewrite deadlines. |
| Checks disabled mid-Pulse | Fence/settings checks block later publication/finalization. Keep previously committed Agent-owned history. |
| AI disabled/scope revoked mid-Pulse | Prevent unsent attempt when observed; discard returned AI output; uncertain reservation stays consumed. |
| Observation obsolete | Complete targeted recheck resolves it; partial data marks unknown rather than assuming obsolete. |
| Duplicate idea | Recover existing parent/category/episode record; do not regenerate wording or add another card. |
| Inbox capacity reached | Preserve suppression and feedback, skip new lower-ranked candidates, report capacity; never delete suppression to make room. |
| Supabase free project paused | No checks while unavailable; disclose stale last check, resume at next eligible slot after restoration. |
| Scheduler secret invalid/rotated | Reject request without claim/provider call; report safe operational auth failure only. |
| Settings/feedback conflict | Reload current owner state; do not overwrite the owner's decision with stale worker state. |
| Auth owner deleted after claim/reservation | Allow cascade of Agent-owned data. Keep installation slot/reservation events; no owner resurrection, quota refund or slot expansion. |

Safe error codes are a bounded union, separate from human explanations. Errors contain no SQL/provider payloads. A partial successful scan can advance only covered baseline portions and last deterministic-check metadata; `last_success_at` denotes a fully completed eligible scan. AI failure alone does not mean deterministic facts failed.

## 29. Retention and capacity

Initial per-owner bounds:

- At most 100 active/snoozed observations/ideas and 300 total observation rows. Stop admitting new conditions when 200 suppressed rows are retained or the total/live cap is reached. Existing user feedback can move any live row into suppression, so suppression can grow to 300 without rejecting Dismiss/Resolve.
- Journal text retained at most 30 days and at most 180 entries, whichever removes it sooner.
- Keep at least 48 hours of operational slot/reservation metadata regardless of Journal text deletion.
- Preserve thin referenced Pulse headers after text expiry, with owner/ID/slot/time/outcome only; no copied source text.

Independently retain installation events for at least 48 hours. The rolling provider count uses only the last 24 hours; a slot event remains authoritative throughout its applicable replay window. Under the installation lock, prune only events older than the operational window and outside every active accounting/replay window, in bounded batches. Memory clear and owner deletion cannot prune installation events. No FK to owner/Pulse data may cascade them away.

Each observation retains at most first/latest Pulse references. With 300 observation records this requires at most 600 distinct referenced headers, plus at most 180 retained recent headers: 780 per owner. Unreferenced headers outside the operational window are pruned. Suppression records compact evidence to identity/fingerprint/state/time and remove optional copied text; they do not lose unchanged-condition suppression simply because 30 days passed.

Suppression compaction preserves current-episode attempt count, last-attempt time and terminality alongside condition identity, episode, material fingerprint and required suppression timestamps/state. Do not retain unreferenced Pulse headers solely for attempt reconstruction. Explicit Agent Memory Clear may delete this observation memory: later rediscovery may be new Agent memory. Clear does not refund recent owner reservations, erase installation events or reopen dispatch slots; no hidden owner tombstone survives solely to undo clear. Account deletion may cascade episode memory normally; installation operational accounting/replay identity remains independent.

If an admission bound is reached, stop admitting new conditions rather than evicting still-relevant tombstones and nagging again. Existing records can update/resolve. Reopening a suppressed record also requires live capacity; defer it without discarding its suppression identity when the live cap is full. Prune a tombstone only when a complete recheck proves its old episode cannot recur unchanged (for example source deletion), or after explicit Agent-memory clear. The clear action explains rediscovery. A quiet Pulse never creates another observation just to record it ran.

Retention is bounded maintenance within already authorized checks/settings/operational dispatch paths, with the same lock order. It does not delete workspace rows or original Agent audit history. Off prevents scheduled owner processing; authorized scheduler dispatch may still establish an empty installation slot and prune aged operational events. No additional cleanup scheduler is added. Reads exclude aged Journal text immediately without writing; a later authorized check or explicit settings/maintenance POST can physically prune it. Downtime can delay physical deletion; no always-running cleanup or exact midnight deletion is promised.

## 30. UI integration

Preserve the existing notebook/sketch visual language and workspace layout. Add a small return card near the existing workspace greeting and Inbox inside Workspace AI. Keep Chat, Agent, and Activity. Put Journal in expandable secondary history inside Inbox, avoiding another primary navigation destination.

Status shows mode, last deterministic check and its coverage, approximate next check, and rolling check/AI usage. It must distinguish “AI requests” from “ideas saved,” since failed requests consume budget. Off, never checked, checking, partial, stale, budget-limited, error, and paused/unavailable states need explicit copy.

Controls are keyboard accessible, labeled, and have loading/conflict/error states. Do not hide provenance behind color alone. Snoozed cards show their revisit time; stale cards show last verified time. Resolve wording states that only the Inbox item changes. Confirm Agent-memory clear separately. No push/browser permission prompt, email, voice, animations suggesting continuous work, or visual redesign is added.

Read DTOs include only bounded safe card fields, lifecycle/revision/freshness, check provenance, safe coverage/usage, and owner-resolved navigation. Never expose raw evidence/source-token internals, HMAC material, lease authority, AI context, raw source/audit payloads, or provider response objects.

## 31. Truthful JARVIS-style language

Use persistence through observable behavior and saved memory:

- “Checked your workspace 2 hours ago.”
- “This deadline changed since the last check.”
- “No recorded workspace changes for 14 days.”
- “5 task deadlines tomorrow; 85% of saved work hours are booked.”
- “Saved an idea for you to review.”
- “Next check in about 2 hours, subject to service availability.”

“Watching this deadline” is permitted only for an active revisited observation and must remain consistent with periodic checks. Never claim consciousness, thinking overnight, continuous observation, coding progress without evidence, invented effort/availability, or independent management of the owner's work. Use “unknown” and “partial” when coverage does not support a claim.

## 32. Migration design

One future additive migration creates the three owner-scoped Agent tables, the installation operational ledger, required indexes/checks/FKs, and narrow RPCs. Do not allocate a timestamp or create SQL in this documentation task. Before later creation, inspect all local/remote history and select a timestamp after the latest migration. Applied migrations remain immutable.

The migration must include:

- Private table creation, owner primary/composite keys/FKs and account-deletion behavior.
- The owner-independent ledger's two event shapes, unique dispatch slot and reservation-operation keys, bounded safe outcomes/counts, operational-time indexes and denied browser grants. No owner/workspace fields or owner/Pulse FK; deletion must not affect it.
- Mode/state/category/reason-code checks; bounded text/JSON/arrays; valid timestamps, lease consistency, positive revisions/fence, finite counts, valid snooze/state combinations.
- Unique owner-slot and one-running-owner indexes; owner/next-due selection; owner/state/rank pagination; same-owner Pulse provenance; same-owner signal-parent idea relationships.
- Unique condition identity and parent/category/episode idea identity. Suppressed records occupy the same condition identity; insertion cannot bypass them.
- RLS and explicit deny grants for browser roles; no broad schema grants or browser table policies.
- Narrow fixed `service_role`-only RPC surfaces for owner settings, eligible claims, consistent source projection, deterministic publication, AI reservation/publication, finalization/recovery, safe Inbox/Journal/Brief reads, feedback/acknowledgement, and bounded retention/memory clear.
- Private shared canonical projection/hash helpers; no general arbitrary-table evaluator or query endpoint.
- Function overload/signature checks and explicit execute grants/revokes. Justified definer functions have empty `search_path` and fully qualified names.

Conceptual RPC naming should use `agent_pulse_*` to distinguish Pulse from existing manual action functions. Separate functions for claims, reservation, publication, and user feedback preserve transaction boundaries; a generic “write arbitrary observation JSON” function is prohibited. Publication accepts validated typed facts/IDs/fingerprints, then independently checks current source hashes/ownership/revisions under the lease.

No existing action kind, audit schema, Apply/Cancel contract, Undo lineage/evaluator, proposal parser, time-block exclusion constraint, browser grant, or core workspace mutation function changes. No seed opt-in rows are created. Schema defaults are Off.

## 33. Scheduler rollout separation

The schema migration must not enable `pg_cron`/`pg_net`, create a Cron job, provision secrets, set Vercel environment variables, or start processing. It must be safe to apply while the old production application continues to run.

A separate explicit rollout authorization is required to verify/activate extensions, provision a dedicated Vault/server secret, configure the production endpoint, create the exact disabled job, inspect its command/HTTP timeout, and enable it. Do not put live credentials in migration files, job literals, source, or logs. Verify the installed `pg_net` interface and scheduler permissions rather than assuming review-time signatures.

Preview must not activate a job against shared Production data. Code deployment or merging main cannot implicitly turn on processing. Scheduler enablement and owner opt-in are separate gates. A fixed server kill switch can disable dispatch independently of owner settings; its provisioning is part of the separately approved activation configuration, not this documentation task.

## 34. Testing strategy

Tests are requirements for later implementation/rollout; none were run or created for this documentation task. Use deterministic clocks, fixed jitter where applicable, synthetic owner fixtures, disposable databases, and exact assertions about provider calls and core row immutability.

| Area | Required cases |
| --- | --- |
| Deadline | All three entity types; today/tomorrow/three-day boundaries; overdue; null/invalid dates; Calendar UTC-midnight semantics; DST/local day transitions; statuses/parent exclusion; no completion inference |
| Important unscheduled task | High/Critical versus other priorities; Blocked; absent due date; complete absence proof; running/future/expired/cancelled/completed/break/custom blocks; cross-boundary ranges; same-owner links; new block with unchanged task version; merged deadline card |
| Quiet project | 14/60-day exact boundaries; new project baseline; child task/milestone activity; workflow change; invalid/future activity; excluded project states; no GitHub/focus/Plan Item inference |
| Tomorrow review | Exact deadline count; exact occupancy threshold; interval union/clipping; working weekdays; missing/invalid preferences; DST; tomorrow rollover; count versus effort copy; scope-limited AI aggregate |
| Completeness | Collection truncation; partial relationship/aggregate scans; timeout; targeted complete queries; absence never inferred from partial data; existing observations not falsely resolved |
| Lifecycle | Create/update/unseen revisions; unchanged check; separate row/content revisions; snooze expiry recheck; dismiss; user/system resolve; material episode resurfacing; increasing age/policy/wording cannot bypass suppression; stale/delete handling; capacity and memory clear |
| Claims and publication | Duplicate slot/nonce; different nonce same slot; global batch cap; owner lease; expired writer; higher fence; stale settings/timezone; source hash changes; lost commit response; deterministic commit survives AI failure |
| Budgets | Concurrent owner/installation reservations; exact rolling-window boundary; max one request per Pulse; max 2/4 proactive requests; count failed/unknown calls; retention cannot refund; later retry minimum interval/episode ceiling |
| Feedback races | Feedback versus publication; acknowledgement versus new content; snooze versus recheck; disable/scope change versus reservation/outbound/finalization; no stale overwrite |
| Scheduler security | Canonical signature; constant-time fixed-size comparison; wrong key/method/path/version; malformed body; stale/future timestamp; replay; owner injection; no cookie-based scheduling; no secret logging |
| Ownership/grants | Two owners; milestone/project and task/block relationships; same-owner provenance/idea FKs; owner deletion; RLS; denied PUBLIC/anon/authenticated table/RPC access; service-only execution; no arbitrary source payload writes |
| Privacy | Empty/removed scope; missing/versioned consent; dedicated context allowlist; descriptions/notes/code/GitHub/audit/auth fields excluded; secret patterns; UTF-8 byte caps; aliases; no raw prompts/responses persisted; deterministic-only path makes zero model calls |
| Gemini | Quiet scan makes zero calls; SDK makes one physical attempt; strict budget/time skip; allowed category/alias; malformed/multiple/oversized result; abort/unavailable/quota; no tool capability/retry storm; duplicate idea; stale response discarded |
| Handoff | Review only prefills; no automatic send/proposal/workspace mutation; current owner/source resolution; manual route remains authoritative; Apply/Cancel/Undo/recovery unchanged |
| UI | Brief ranking/dedupe/ack/no nagging; Inbox filters/pagination; stale/partial/loading/error/conflict/Off states; usage labels; keyboard/screen-reader controls; Journal quiet-history behavior |
| Widths | 1440, 1024, 768, 390, and 320 CSS pixels; no clipped actions, overflow, hidden provenance, or unusable dialogs |
| Regression | Phase 1 reads; Phase 2 task proposals; Phase 3A dates; Phase 3B blocks; Phase 4 Activity/Undo; Phase 5B milestones/5B.1 transport; Phase 5C Plans; Calendar; Focus; Private AI; Public AI |
| Installation ledger | Typed shapes/prohibited fields; no owner/Pulse FK; empty dispatch persistence; same/changed nonce recovery; account deletion preserves installation budget/slot; memory clear preserves controls; atomic rollback of both reservation writes; bounded retention outside active windows |

Disposable PGlite coverage proves migration/function shape, pure scanner cases, serial interleavings, and deterministic invariants in that engine. It is not multi-connection proof.

Use a disposable real PostgreSQL server with independent connections and barriers to prove: simultaneous claims, owner/installation budget races, expired worker publication after takeover, same-slot uniqueness, feedback/publication, disable/reservation/finalization, and lost-response recovery. Assert final table contents and unchanged core rows, not only HTTP outcomes. If these cases do not run successfully, do not claim concurrency readiness.

Also prove simultaneous installation reservations from different owners; account deletion immediately after reservation and another owner's subsequent attempt; same dispatch nonce twice; another nonce for an established slot; deletion of claimed owners and same-slot retry; and retention racing with reservation/dispatch accounting. Assert that deletion cannot increase installation availability or reopen a slot. Account deletion is an intentional disposable test operation; no Production account deletion is authorized.

Later verification follows repository commands and installed Next.js documentation. Focused suites precede the complete Agent Phase 1–5D suite, private/public AI tests, TypeScript, exact-file ESLint, build, and diff checks. Hosted rollout additionally verifies actual scheduler authentication, opt-in/Off behavior, one deterministic check, one separately consented AI attempt, real provenance, current ownership, and regression. No exact test count is invented here.

## 35. Rollout strategy and stop conditions

This is a sequence of future authorization/verification gates, not an implementation task plan:

1. Owner reviews and approves this written specification.
2. Produce and approve a separate concrete implementation plan and execution method.
3. Implement locally, including disposable PGlite and genuine PostgreSQL concurrency proof.
4. Perform a separate rollout/security/privacy review of code, migration hash/history, grants, provider settings, and budgets.
5. Apply only the reviewed additive schema migration after separate authorization. Verify no scheduling/opt-in/configuration side effect and old Production app health.
6. Validate exact Preview code with background scheduling disabled, owner-scoped fixtures, explicit AI consent where tested, and awareness of any shared Production database. Complete UI/legacy regression before application release.
7. Release reviewed code only when authorized. Keep checks Off and scheduler disabled initially.
8. Obtain separate scheduler/infrastructure/secret activation authorization, verify platform limits and exact job, then enable deterministic checks for one explicitly opted-in owner.
9. Verify duplicates, missed dispatch, last/next status, safe logs, coverage, budgets, kill switch, operational ledger grants/retention and that no core rows/actions changed. Account-deletion/ledger invariants must already have passed on disposable PostgreSQL; do not delete real accounts for hosted smoke tests.
10. Enable AI only with separate informed scope consent and authorized provider context. Verify one bounded idea and unchanged manual proposal boundaries.

Rollback/containment first disables dispatch and/or owner mode, invalidating authority. Keep additive schema/data for diagnosis; do not drop tables or roll back unrelated workspace rows. Turning AI off retains deterministic checks if requested. A code rollback must tolerate the additive private schema and disabled scheduler. Schema removal or test-data deletion needs separate approval where destructive.

Stop rather than weaken an invariant if:

- Owner isolation, source completeness, source hash parity, lease fencing, budget accounting, or suppression cannot be proven.
- A worker can reach core writes, manual proposal persistence, arbitrary tools/SQL, or protected audit context.
- Browser grants expose private tables/helpers or public routes expose Pulse data.
- A required signal relies on partial absence, inferred technical completion, undocumented timezone defaults, or live GitHub/Plan Items outside scope.
- Provider terms/consent cannot support the intended context, or one physical request cannot be enforced.
- Required infrastructure/dependencies/configuration exceed the explicit authorization.
- Preview processing would run against Production without the specific rollout authority.
- Migration history/hash differs, prior migrations require editing, or old application/regression checks fail.
- Genuine PostgreSQL concurrency proof is unavailable or fails.

## 36. Deferred features

Explicitly deferred: Plan actionable-step analysis; Plan Items; project/phase technical-completion inference; live GitHub polling; automatic GitHub activity interpretation; positive Apply-based preference learning; push/email notifications; voice; continuous realtime monitoring; arbitrary user-defined watches; multi-agent execution; autonomous workspace mutation; long-form AI diary; model fine-tuning; opaque personality learning; provider tool access; and a general queue/job infrastructure.

No project name, workflow/status label, or completed milestone is treated as proof that a software release or phase passed technical acceptance. Future additions require their own design/approval.

## 37. Known limitations

- Scheduled checks are approximate and can be missed during service downtime, free-project pausing, quota exhaustion, or capacity limits. The initial two-owner-per-slot batch is intentionally small.
- Saved workspace facts do not reveal coding outside the app, actual effort, concentration, or complete GitHub activity.
- Bounded coverage can leave some conditions unknown. Unknowns must remain visible and cannot support absence/completion claims.
- Cards are observations at a check time. Edits after publication can make them stale before the next check; Review always revalidates.
- Provider budgets are application ceilings, not provider quota reservations or guaranteed free operation. SDK/provider behavior must be verified for the installed version/model.
- Minimization and pattern filtering cannot guarantee that a selected private title contains no sensitive information. Explicit owner consent and applicable provider terms remain necessary.
- Cancellation after provider transmission cannot retract that transmission. Unknown outcomes consume reservations.
- Suppression consumes bounded storage; at capacity new observations may be deferred rather than silently forgetting dismissed conditions.
- Memory clear can permit rediscovery; immutable existing manual Agent audit history remains separate.
- Account deletion removes owner memory and its owner budget, but recent content-free installation controls remain until operational retention. A new registration does not restore installation quota or reopen established slots.
- Schema and concurrency designs described here have not yet been implemented or tested. Review-time platform metadata must be refreshed before rollout.

## 38. Open questions and approval gate

No architectural decision is intentionally left unresolved for implementation. This specification selects three owner-scoped Agent tables plus one installation operational ledger, normal account deletion, four signals, concrete initial thresholds/bounds, Inbox-with-expandable-Journal UX, project-only proactive AI scope, PostgreSQL authority, HMAC dispatch, and separate scheduler activation. The approved ledger clarification resolves the previous account-deletion/accounting conflict.

The owner must review these formalized product choices, especially 14/60-day quiet thresholds, five task deadlines/85% occupancy, two-owner dispatch capacity, and rolling suppression/retention limits. Those choices are specification policy, not claims about current usage.

Rollout prerequisites remain factual checks rather than open architecture: installed extension/API compatibility, appropriate scheduler permissions/timeouts, current provider model/terms/quota, actual Vercel limits, secrets provisioning, and successful multi-connection tests. If evidence conflicts with this design, stop and return the discrepancy for review.

**The specification amendment and completion of the separate implementation plan are authorized. Stop after those documents; owner review of the completed implementation plan is the next gate. Do not begin implementation.**
