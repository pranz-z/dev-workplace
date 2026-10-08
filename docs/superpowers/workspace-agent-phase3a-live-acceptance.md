# Workspace Agent Phase 3A — production rollout and live acceptance

Run: October 9, 2026, Asia/Manila. Real local Workspace UI connected to production Supabase; real Gemini `gemini-3.5-flash-lite`. No commit, push or application deployment performed.

## 39-point report

1. **Linked project:** verified exact ref `peokrukgprzbmathrurv`, DevWorkplace, ACTIVE_HEALTHY before mutation.
2. **Migration review:** only Phase 3A migration extends existing action constraints, canonical batch persistence and narrow date Apply. Existing Phase 2 migration is untouched. Existing action/status values remain valid. No generic mutation/SQL, browser mutation grant, reasoning/credential storage, or Public AI/Drive/GitHub/Auth schema change.
3. **History before:** 17 existing versions matched; only `20261008231753` was local-only. No repair or replay.
4. **Dry run:** `npx supabase db push --linked --skip-vault --dry-run` identified exactly `20261008231753_workspace_agent_date_scheduling.sql`; no seeds or roles.
5. **Apply:** authorized `npx supabase db push --linked --skip-vault` succeeded for that migration only.
6. **History after:** all 18 versions matched.
7. **Post-push dry run:** database up to date; empty migrations, seeds and roles.
8. **RLS/grants:** private runs/actions/action-limit tables retain RLS and no anon/authenticated SELECT. Privileged save/task/schedule RPCs are service-only SECURITY DEFINER with empty search_path and qualified static SQL. Private helpers have no browser/service execute grant. Ownership, parent ownership, locked version comparison and atomic audit remain enforced.
9. **Rollback tests A–T:** production BEGIN/ROLLBACK tests passed legacy task Apply, proposal-only persistence, milestone/project Apply and clearing, stale conflicts, repeated idempotent Apply, terminal cancellation, cross-user rejection, milestone parent ownership, malformed/unsupported rejection and mixed batches. An injected transactional audit trigger failure preserved the entity row. Actual anon/authenticated role tests denied audit reads and privileged Apply. Synthetic users/projects and temporary trigger counts returned zero. Disposable PostgreSQL assertions additionally check actual cleared values and all safety outcomes.
10. **Data integrity:** migration before/after full-row hashes matched exactly: projects 5 / `cd805f86d14c69f6ae462fc513b45602`; tasks 13 / `d1b159a06dfc0c2ae5aa0b4623127c4d`; milestones 7 / `b0e37e4da6e12bca6188450d49da2174`; plans 2 / `09bf94a278d5d74faadb0d6ea7960ad3`. After live restoration, the same full-table hashes matched when only the three acceptance entities' expected updated_at changes were normalized to their originals. No timestamp was written back.
11. **Task reschedule:** real Gemini proposed ai agent at devplace October 15 → October 10 (tomorrow). Unchanged before Apply. Cancel persisted; regenerated Apply changed due_date plus updated_at only. Restored October 15 through normal task editor.
12. **Clear task date:** real null proposal generated with no mutation and was cancelled. Card originally said None; fixed to Unscheduled for date fields with red/green regression test. Other empty fields retain None. Updated label is unit-verified; no second live clear request after the fix.
13. **Milestone:** real Integrate Google Apps proposal October 29 → October 20, canonical before state, no pre-Apply mutation. Apply changed target_date plus updated_at only. Restored October 29 through normal editor.
14. **Project:** real dev-workplace proposal October 26 → November 2 (one week back). Apply changed target_date plus updated_at only. Restored October 26 through normal editor.
15. **Stale milestone:** real proposal October 22 → October 21; normal UI edit restored October 29 before Apply. Conflict/Review again appeared; manual date preserved, no force option. Earlier native-input fill attempt changed only version; rerun used native keyboard and DB-confirmed date changes.
16. **Stale project:** real proposal November 2 → November 3; normal UI restored October 26 before Apply. Conflict/Review again; manual edit preserved.
17. **Plan my week:** initial request failed safely with malformed provider output; another exhausted six rounds on sequential reads. Fixed prompt to batch discovery and reserve proposal/final rounds without increasing limits. Real retry used four discovery calls including get_calendar_load, two proposal calls and final response: six tools/three rounds. Actual two cards: ai agent October 12 and gmail October 14. Both cancelled. No claim of complete scheduling.
18. **Unscheduled/high-priority:** two real attempts returned safe Gemini availability errors (503), with no saved batch. First used four discovery reads plus two priority-scoped unscheduled reads before provider failure. Production has zero incomplete High/Critical tasks without dates. Final successful model explanation for this case remains unverified; do not count it as a live pass.
19. **Mixed batch:** real single run `eda1e14d-b937-42d8-bba2-7115d58f5ce6` contained task October 9, milestone October 12 and project October 16. Selected only task for Apply; DB states confirmed update_task applied, both reschedules cancelled. Task restored afterward. No inferred missing actions.
20. **Hourly scheduling:** real response: Calendar time blocks are not enabled yet. No pretend time-block proposal.
21. **Google Calendar:** real response: Calendar integrations are not enabled yet. No integration write or proposal.
22. **Timezone:** Asia/Manila reference Friday October 9. Real tomorrow October 10; today/Friday October 9; next Monday October 12; following Monday–Friday October 12–16, end Friday October 16. Calendar thisWeek semantics unchanged.
23. **Calendar load:** real Gemini successfully called get_calendar_load in weekly planning. Unit tests verify inclusive max 31 days, zero days, owner filters, incomplete task counts, bounded results and explicit truncation at scan cap. Live production did not have a truncation-scale fixture; boundary/truncation behavior is test-backed rather than observed from the real model on large data.
24. **Refresh:** Calendar showed applied milestone October 20, project November 2 and mixed task October 9 without browser reload. Normal project/milestone/task editors showed canonical dates during restoration. Shared reload populates all three collections; separate Tasks-list visual verification was not captured.
25. **Network contract:** temporary server request tracing recorded Apply/Cancel JSON keys exactly runId/actionIds. No patch, date, before state, expected version, userId or ownership sent. Server fetched stored canonical actions.
26. **No Gemini during Apply:** outbound tracing observed Gemini for generation, only Supabase RPCs for Apply, Cancel and recovery GET. Temporary recovery route rendered real canonical cards through the normal authenticated endpoint, then was removed.
27. **Partial safety:** deterministic answer states actual count, groups dates, says nothing changed and only listed actions can be approved, and explicitly warns schedule may be partial. Weekly two-card and mixed three-card responses matched stored actions.
28. **Cleanup:** restored task October 15, milestone October 29, project October 26 via normal UI. No live temporary tasks created. Genuine audit rows retained. Zero new pending actions; two earlier Phase 2 pending actions left untouched. Synthetic rollback records/trigger absent. Temporary Gemini diagnostic, trace preload and recovery route removed; dev parent/child stopped and temporary browser tabs closed. No secret written to files or output; service credential existed only in child environment. Ordinary local command logs remain in OS temp.
29. **Phase 3A:** 19/19 (17 unit + 2 database), including new prompt and clear-label regression tests.
30. **Phase 2:** 17/17, including disposable PostgreSQL regression.
31. **Phase 1:** 21/21.
32. **Full suite:** after instrumentation cleanup, 229 total: 227 passed, zero failed, two optional portfolio CMS skips. Includes private/Public AI, Calendar and relevant entity regressions. PGlite module supplied from existing temporary test runtime.
33. **TypeScript:** `npx tsc --noEmit` passed after temporary route removal and Next route regeneration.
34. **ESLint:** changed agent/UI/page paths passed with no issues.
35. **Build:** `npm run build` passed, Next 16.3.6. Temporary route absent from build routes.
36. **Diff:** `git diff --check` passed. No diff in applied Phase 2 migration or temporarily instrumented gemini.ts. No commit/push/deploy.
37. **Defects:** fixed planning read-round exhaustion by prompt batching; fixed cleared-date card label. Both focused tests observed failing before their fixes and passing afterward. Initial malformed model output was safely rejected but exact provider cause remains unknown. Later intermittent provider unavailability remains a dependency limitation. Native date-fill and overlapping automation requests were acceptance harness issues, resolved using keyboard input and waiting for completion.
38. **Commit/push/deploy readiness:** implementation checks pass and migration is rolled out. Full live acceptance is qualified by item 18 and the explicit observation gaps in items 12/23/24. Do not call every live case passed. Re-run the high-priority prompt when Gemini is available before unconditional live sign-off. No commit, push or deploy performed.
39. **Phase 3B planning:** may begin as planning only with these limitations recorded; no Phase 3B implementation was performed. Phase 3A live sign-off should close item 18 first.

## Commands and safeguards

- Focused phases: `node --test lib/ai/agent/phase3a.test.mjs lib/ai/agent/phase3a-database.test.mjs lib/ai/agent/phase2.test.mjs lib/ai/agent/phase2-database.test.mjs lib/ai/agent/agent.test.mjs` — 57 passed.
- Full suite: enumerate repository `*.test.mjs` excluding node_modules/marketing, then `node --test`; existing `AGENT_TEST_PGLITE_MODULE` supplied for database tests.
- Runtime caps unchanged: ten actions, ten tools, six model rounds. Quota, lease, auth, ownership, audit and approval controls unchanged.
- Only rollout source fixes beyond the existing Phase 3A implementation: planning instruction, cleared-date display and their focused tests.
