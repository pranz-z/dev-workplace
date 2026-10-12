# Phase 4B implementation report

Date: 2026-10-12. Branch: `codex/workspace-agent-phase4b`.
Base unchanged: `89d8200cc888ea560f1c6ea0339b47b674bad9e9`.
No commit, push, deployment, production migration or production mutation performed.

1. **Architecture:** one deterministic private SQL evaluator serves Activity, Prepare and guarded inverse Apply. TypeScript performs no inverse derivation. No Gemini calls added.
2. **Supported mapping:** update_task → update_task; reschedule_milestone → reschedule_milestone; reschedule_project → reschedule_project; create_time_block → cancel_time_block; update_time_block → update_time_block; cancel_time_block → update_time_block. Each delegates its existing mutation RPC.
3. **Unsupported:** create_task, unknown actions and non-applied sources fail closed. No deletion, bulk undo, snapshots or redo subsystem.
4. **Eligibility:** validates owner/source status/history/current affected values, direct inverse state, links and canonical resulting state. Stable reason-code union; explanation ≤240 characters; inverseSummary ≤180.
5. **Compatibility:** all affected fields must still match the source result; no partial multi-field undo. Unrelated pre-Prepare edits survive. Missing and null differ. Truncated/incomplete affected history fails closed.
6. **Current state:** preparation captures current updated_at; Apply rejects any subsequent whole-row version change, including microseconds. Discovery is revalidated under locks.
7. **Endpoint:** POST /api/ai/agent/activity/undo-proposal authenticates, checks origin, bounds body, rate limits, obtains lease and returns canonical recovery with no-store.
8. **Browser contract:** Prepare accepts exactly {runId,actionId}; Apply/Cancel retain {runId,actionIds}. No mutation payload accepted from browser.
9. **Tasks:** title, description, status, priority, dueDate and milestoneId supported; nulls and multi-field actions covered. Unrelated long descriptions do not invalidate a title-only inverse.
10. **Task creation:** undo remains unsupported; Activity explains why.
11. **Milestones:** restores canonical UUID/date values; proposal cards resolve UUIDs to labels. Missing/foreign links deny preparation or Apply.
12. **Projects:** restores targetDate through existing project scheduling path; no collateral date changes.
13. **Created blocks:** cancellation requires compatible canonical created state; annotations/changed context fail closed.
14. **Updated blocks:** restores historically affected fields with complete resulting range/link validation. Unrelated compatible edits survive preparation.
15. **Cancelled blocks:** restores scheduled state only when resulting future range, ownership and links are valid.
16. **Availability:** checks at Prepare and Apply; occupied/past slots deny restoration. Existing PostgreSQL exclusion constraint remains final overlap authority.
17. **Activity UI:** Prepare undo, pending inverse recovery, Undo of/Reversed by navigation and explicit unchanged-until-Apply introduction. Existing proposal cards reused.
18. **Unavailable UX:** bounded safe explanation, unsupported/missing/changed/past/occupied states. Same-run reselection preserves pending cards; late navigation responses ignored.
19. **Audit:** immutable source actions; inverse.undo_of_action_id references immediate source only. Reversed state derived; inverse-of-inverse retains direct lineage.
20. **Migration:** one additive 20261013090000_workspace_agent_safe_undo.sql, after prior maximum 20261012090000. Prior four Agent migration hashes unchanged. Not applied to production.
21. **Security:** same-owner composite FK, referenced unique key, self-reference rejection, partial unique pending/applied inverse index. Service-only RPCs; SECURITY DEFINER, empty search_path and qualified relations. Private audit tables/helpers remain inaccessible to browser roles. Safe Activity projection excludes raw payload/before_state/prompts/reasoning.
22. **Tests added:** four Phase4B test files plus disposable fixture. Policy, DB, route and recovery coverage; 29 tests including six field subtests. Four review regressions fixed RED→GREEN.
23. **Phase4B:** 29 passed, zero failed/skipped. Expanded DB file separately rerun after service-grant assertions: 18 passed. Deterministic uniqueness fault injection verifies canonical winner recovery and orphan rollback; unrelated uniqueness errors propagate.
24. **Phase4A:** 32 passed, zero failed/skipped. Updated obsolete no-POST source assertion solely for authorized Prepare endpoint.
25. **Phase3B:** 58 passed, zero failed/skipped.
26. **Phase3A:** 19 passed, zero failed/skipped.
27. **Phase2:** 17 passed, zero failed/skipped.
28. **Phase1:** agent.test.mjs: 21 passed, zero failed/skipped.
29. **Full suite:** 373 tests: 371 passed, zero failed, two existing optional portfolio CMS skips. PGlite enabled. Agent phase files combined: 155 passed; Phase1 separately 21.
30. **TypeScript:** npx tsc --noEmit passed.
31. **ESLint:** all changed/new product TypeScript paths passed.
32. **Build:** npm run build passed; new route included. No deploy performed.
33. **Diff:** git diff --check passed after EOF normalization. Existing unrelated untracked Phase3B/4A artifacts preserved; nothing staged or committed.
34. **Browser:** isolated localhost harness using actual components/server projection and disposable real SQL. Prepare, Apply, immutable source lineage, same-run reselection and 1440/1024/768/390/320 widths passed; no horizontal overflow or console errors. Earlier fixture run also exercised reload recovery, Cancel and fresh preparation. This is not live Supabase Auth acceptance.
35. **Limitations:** PGlite is a single engine. Serial interleavings and uniqueness fault injection do not prove multi-connection PostgreSQL concurrency. Auth/HTTP boundaries tested with mocks; live authenticated Supabase integration unverified. Historical missing/truncated values intentionally deny undo.
36. **Rollout prerequisites:** separately authorize disposable real PostgreSQL multi-session validation, migration review/application, live authenticated acceptance and eventual release. Run all concurrency cases below before any concurrency-readiness claim. Recheck migration ordering against remote history before application.
37. **Readiness:** implementation ready for separate rollout review/authorization; production release readiness blocked on genuine PostgreSQL concurrency and live integration verification. No next phase started.

## Transaction and lock order

| Order | Rows | Mode / boundary |
|---|---|---|
| 1 | Immediate source action | FOR UPDATE; Prepare and inverse Apply |
| 2 | Existing/new inverse action | FOR UPDATE where existing; source serializes creation |
| 3 | Parent projects, sorted UUID | FOR SHARE; target date project FOR UPDATE |
| 4 | Milestones, sorted UUID | FOR SHARE; target date milestone FOR UPDATE |
| 5 | Linked tasks, sorted UUID | FOR SHARE |
| 6 | Target task/time block | FOR UPDATE |
| 7 | New inverse run/action completion | Existing save/Apply paths; run updates last |

Prepare holds locks through atomic run/action save and lineage attachment; named uniqueness loser rolls back its save subtransaction then reloads canonical pending winner. Link discovery retries inside a bounded subtransaction so earlier-class locks are released before retry. Guarded Apply locks/re-evaluates/validates version and canonical inverse before calling existing mutation RPC within the same transaction. Cancel retains existing inverse/run locks and never locks source. No workspace write occurs during Prepare.

## Coverage and rollout concurrency gate

Disposable coverage includes all supported fields/actions, multi-field/null compatibility, unrelated/affected edits, milestone UUIDs, long/truncated history, entity/link loss, unsupported creation, future/occupied blocks, repeated Apply, inverse-of-inverse, cancellation/fresh preparation, serial Prepare/Cancel and Apply/manual-edit orderings, audit immutability, same-owner FK, grants, identifier-only contracts, recovery and UI states.

True multi-session PostgreSQL cases remain **unverified**:

- Two Prepare sessions contend on one source; identical canonical IDs, exactly one live inverse, no orphan runs.
- Prepare versus Cancel in both barrier orders.
- Inverse Apply versus manual edit in both barrier orders; strict stale behavior.
- Repeated concurrent Apply; one mutation, idempotent canonical result.
- Concurrent overlapping insert versus block restoration; exclusion accepts at most one.
- Parent/link edits/deletes versus inverse Apply; no lock-order cycle, ownership/link stability or safe rejection/retry.

Use separate connection IDs, explicit transaction barriers, bounded lock_timeout/statement_timeout; record waits, SQLSTATE and final counts without credentials. Any invariant failure stops rollout; do not weaken controls.

## Validation commands and evidence

Set AGENT_TEST_PGLITE_MODULE to the existing external PGlite runtime before SQL tests; no dependency installed.

```powershell
$tests = @(rg --files -g '*.test.mjs' -g '!node_modules' -g '!marketing')
node --test @tests
node --test lib/ai/agent/phase4b*.test.mjs
npx tsc --noEmit
npx eslint components/ai/AgentActivity.tsx components/ai/AgentProposalCards.tsx data/agentActivity.ts lib/ai/agent/activity.ts lib/ai/agent/contract.ts lib/ai/agent/proposal-schema.ts lib/ai/agent/store.ts lib/ai/agent/undo.ts lib/ai/agent/undo-route.ts app/api/ai/agent/activity/undo-proposal/route.ts
npm run build
git diff --check
```

Logs and screenshots retained locally under .superpowers/sdd/2026-10-12-workspace-agent-phase4b/ (ignored scratch), including full-tests.log, phase*-final.log, grants-final.log, build.log, review-red.log, responsive.json and screenshots/. The ledger records task gates and rulings. No external infrastructure was added.
