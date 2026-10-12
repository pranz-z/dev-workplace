# Phase 4A: Agent Activity, History and Recovery

Approved brief: user attachment `2937f14e-785d-4e90-ad5f-366b5fa091b4`, followed by explicit design approval on 2026-10-12.

## Design

Reuse private agent_runs and agent_actions. Runs currently store id, user_id, created_at and completed_at. Actions store owner/run IDs, action type, entity/project IDs, title, canonical payload/before/diff, expected version, status, created/approved/executed times and safe error code. Original requests and reasoning are absent and stay absent. Read-only Agent conversations have no durable run; history covers proposal runs only.

One additive migration adds service-only owner-scoped list/detail RPCs because audit tables deny direct service-role access and existing get_agent_proposal_batch requires a known ID. No table columns, browser grants, history edits or production migration. List uses bounded keyset pagination, status/date filters, existing owner/created and run/action indexes. Counts describe loaded runs, never imply global totals.

Authenticated no-store GET endpoints project safe run/action fields, whitelisted diffs, human labels, safe reasons and owned navigation targets. No raw payload projection. Detail derives Review again using the existing prompt builder. Unknown types and removed entities remain readable, non-navigable history.

Workspace AI gains an Activity view with compact grouped runs, filters, counts, detail and explicit Refresh status. Pending approval loads the existing canonical batch through existing GET recovery; AgentProposalCards retains the exact Apply/Cancel/recovery implementation. Review again populates Agent composer without submitting. Navigation uses app entity openers and a Calendar date/block target. No automatic mutation, replay or retry.

## Tasks / execution order

1. Write failing database tests, add read RPC migration, prove grants/owner isolation/filtering/keyset ordering/counts/historical detail/no writes in local PGlite.
2. Write failing domain/service/route tests. Implement validated queries, safe projections, owned navigation and authenticated GET list/detail using repository conventions.
3. Write failing UI/recovery tests. Add Activity list/detail; connect composer and app navigation; reuse canonical cards. Check historical and deleted entities.
4. Validate focused Phase 4A, all Agent phases, full suite, TypeScript, changed-file ESLint, build, diff/migration hashes. Exercise isolated browser fixtures at 1440/1024/768/390/320 with mixed history, recovery, navigation and approval.
5. One fresh whole-change review; resolve important findings with regression tests. Produce requested 35-point report, distinguish fixture proof from real database/hosted proof.

## Constraints / completion

No commit, push, deploy, production migration, credentials/config changes, new dependencies, new mutation tools, audit editing/deletion, original prompts or reasoning retention. Existing applied migrations immutable. Preserve user local evidence. Search is deferred; status/date filters are required. No retention policy introduced.

Review focus: cross-user IDs, private payload leakage, cursor ties, mixed statuses, old nullable/missing values, deleted/foreign entities, transport loss without replay, late async responses/account switches, double approval, time-zone date boundaries, responsive overflow and no Gemini on read/approval paths.
