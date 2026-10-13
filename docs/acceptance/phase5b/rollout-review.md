# Workspace Agent Phase 5B rollout review

Date: 2026-10-13. **READY FOR STAGED ROLLOUT AUTHORIZATION.** Production migration/deployment were not performed. Hosted acceptance remains pending and is a required gate before Production application release.

## Requested 36-point report

1. **Candidate:** codex/workspace-agent-phase5b; HEAD/base 182a0f45a51f22148c9f0616bfa845ad78ff926a. Candidate includes uncommitted work, so HEAD alone does not identify its release contents.
2. **Worktree:** C:\Users\Franz\.codex\worktrees\workspace-agent-phase5b\software-workplace. Index empty. Expected 18 tracked files plus new Phase5B migration/tests/documents; no package/lockfile/environment changes. All diff sections and authorized new-file scope reviewed. No Phase5C/5D work. Secret-pattern scan of 28 candidate files found zero hits; no credential content copied/output. Source modification times precede final implementation validation. No application/migration edits during rollout review; only this report and ignored evidence/harness added.
3. **Migration:** supabase/migrations/20261013090001_workspace_agent_milestones.sql; sole new migration, unique and greater than old maximum 20261013090000. Removed empty stub remains absent.
4. **Migration SHA256:** E820045188DF2E65AA49CA2773CAF504D7EF52486642D6D52F80AAF71D00F976, exact expected value.
5. **Existing migration integrity:** 21/21 captured SHA256 values unchanged; no duplicate versions, applied-file edits or dependency changes. git diff --check passes. Existing implementation evidence remains applicable: Agent213/213 plus related86/86 =299/299, focused37/37; type/lint/build and five-width disposable browser passed previously on matching candidate. These were not needlessly rerun as rollout tests.
6. **Production latest migration:** 20261013090000_workspace_agent_safe_undo. All 21 versions/names match repository baseline. Target peokrukgprzbmathrurv, PostgreSQL17.6 Linux. Inspection used SELECT/catalog/list operations only.
7. **Production Phase5B presence:** NOT APPLIED. Version90001 absent; apply_agent_milestone_action absent; only seven old kinds present/allowed. No Production acceptance fixtures or concurrency operations.
8. **Schema/function drift:** None found in inspected dependency surface. Actual nine milestone columns/defaults/nullability, owned RLS policy, enabled RLS, updated_at trigger/body, project/milestone/task FK delete behavior, all audit CHECK/FK/index definitions match repository assumptions. Exact CRLF-normalized source hashes, identity/result signatures, definer/search_path and effective anon/authenticated/service_role privileges match for 24 relevant functions, first in baseline fixture and then on true PostgreSQL full-chain replay. Not an assertion about every unrelated Production object.
9. **Duplicate history:** Exact authorized query returned zero rows. No history rewrite/delete/cancel or index weakening. Migration repeats guard; real target must be rechecked immediately before release because this read is a point-in-time result.
10. **Target grants:** Existing Agent public RPCs service_role/owner only; no PUBLIC/anon/authenticated execution. Private evaluator/context/projection owner only. Audit actions/runs deny SELECT/INSERT/UPDATE/DELETE to anon/authenticated/service_role. owns_project remains authenticated-callable as intended; set_updated_at retains original trigger-function grants, not modified. No unexpected ACL on replaced functions found.
11. **Disposable migration:** PASS. Official EDB PostgreSQL17.6 Windows binaries, dedicated localhost cluster, temporary database. All 21 baseline migrations executed unchanged, each transactionally, then Phase5B transactionally. Clean empty-audit baseline Phase5B dry-run + ROLLBACK succeeded and left new RPC absent; representative history rehearsal succeeded and retained exact audit snapshot. Six malformed canonical creation variants reject SQLSTATE22023 with no orphan run. Supabase auth/storage platform prerequisites are local stand-ins; repository migrations are not rewritten.
12. **Legacy-kind compatibility:** All seven old CHECK branches accept historical rows before/after migration; exact rows survive. Existing lineage/self-reference/byte/live-inverse constraints unchanged. Actual old schedule Apply/Undo succeeds on true PostgreSQL and leaves original source audit unchanged. Prior comprehensive Agent regressions remain299/299.
13. **True harness:** PostgreSQL17.6, 127.0.0.1:55435, database phase5b_review_1791863841902; independent psql backend PIDs recorded in postgres-results.json. Three connections: A, B, observer. Explicit BEGIN holds first transaction, second command starts independently, observer verifies pg_blocking_pids before first COMMIT. lock_timeout5s, statement_timeout10s, deadlock_timeout100ms; harness deadline12s. Committed rows and workspace/audit event triggers inspect mutation counts. Task-link case overlaps two open transactions without expected blocking. No Production connections in harness.
14. **Same create Apply:** PASS. Both callers return same canonical applied entity; one inserted milestone, one applied transition, total milestones2 including seed. No duplicate creation.
15. **Same update Apply:** PASS. Both return identical terminal result; one milestone UPDATE and one applied transition.
16. **Distinct appends:** PASS. Different action locks compete on project UPDATE; two inserts/two applied transitions; seed+two creations have three distinct sort values. This proves Agent serialization only, not global manual uniqueness.
17. **Update/manual edit:** PASS both orders. Manual-first yields STALE_ENTITY conflict, manual title survives, zero Agent applied transition. Agent-first commits then waiting manual edit commits its later title; no lost manual edit.
18. **Update/project delete:** PASS both orders. Delete-first yields safe FORBIDDEN with no milestone/Agent mutation. Agent-first performs one real mutation/applied transition, then subsequent legitimate deletion cascades; no orphan or audit falsely claiming an update that never occurred.
19. **Relationship drift:** PASS. Manual reparent holds milestone while Agent retains original canonical parent context; after wait, Apply returns FORBIDDEN and retains new relationship. No second parent acquired out of order by Apply. Schema permits this test on owned parents. Existing schema does not promise cross-parent task-link consistency for manual reparent; Agent operation adds no link mutation.
20. **Task-link race:** PASS. Manual transaction clears link/edits task while Agent milestone update commits in other session. Manual commit retains both changes; no Agent task write. No blocking required for independent target rows.
21. **Duplicate Prepare:** PASS. Second waits source; both recover identical pending inverse run/action; exactly one live inverse.
22. **Prepare/Cancel:** PASS both orders. Prepare-first returns existing inverse, then Cancel terminates it; fresh Prepare succeeds. Cancel-first makes waiting Prepare create a fresh canonical inverse. Never two live inverses.
23. **Inverse/manual edit:** PASS. Manual affected-field edit before inverse obtains target results STALE_ENTITY; neither field partially reversed, manual value preserved.
24. **Inverse/Cancel:** PASS both orders. Apply-first leaves applied inverse; Cancel returns that applied state, no second mutation. Cancel-first causes inverse Apply to return cancelled, zero reversal.
25. **Repeated inverse Apply:** PASS genuinely overlapping callers; identical terminal applied result. One reversal only (two updates total including original source Apply).
26. **Legacy schedule concurrency:** PASS manual-first wait then STALE_ENTITY, original date unchanged/manual description retained. Separately old-shape legacy Apply and Undo restore null date, original source row unchanged, no nested transition. No legacy payload/before change.
27. **Deadlocks/timeouts:** Zero in final 17 scenarios; pg_stat_database.deadlocks=0. All racing SQL commands SQLSTATE00000, with expected safe domain conflict/failure results. Six intentional malformed tests22023; four intentional browser denials42501. Initial harness-only failures42601 (UPDATE incorrectly wrapped in SELECT) and42710 (cluster role recreation) were fixed in scratch and are not product/concurrency successes. Their evidence retained; no application changes. Observed contention turnaround33–64ms, not a benchmark or universal timing bound.
28. **Lock order:** PASS for exercised interleavings. Ordinary action; project; milestone; audit. Prepare source; existing inverse; project; milestone; insert. Inverse source before inverse, then context. Cancel touches pending inverse/action and run only, no entity/source wait inversion. Actual blocking graph captured; no lock upgrade/inversion identified. This is bounded scenario evidence, not proof of every possible workload.
29. **Real grants:** New Apply SECURITY DEFINER/empty search_path; qualified SQL reviewed; owner/service_role execute only. PUBLIC/anon/authenticated denied. Private helpers/evaluator/context/projection owner only. Replaced RPC ACL/settings checked after migration. Real SET ROLE anon/authenticated calls to Apply and audit SELECT reject42501. No browser grants added; audit remains private.
30. **Old action compatibility:** PASS in full-chain metadata/history rehearsal and legacy execution. Existing task/block mutation function hashes are unchanged. Phase4B inverse linkage, same-owner FK, self-reference rejection, one-live-inverse, payload/before40000 and diff80000 remain unchanged. Activity retains old fields/p_detail behavior/bounds, adding only new safe error allowance. No production history touched.
31. **Rollback floor:** First separately committed/deployed build containing this candidate's explicit unknown-kind dispatch/cards/Activity guards. Its future SHA must be recorded before release. Current HEAD182a0f45 is pre-5B and NOT a safe downgrade after new kinds exist. Until a fallback-capable rollback build is proven, use forward-fix from verified Phase5B. Preserve additive schema and all audits; never delete/rewrite history as rollback. Cached old clients are a release risk; hosted checks must confirm fresh assets/recovery.
32. **Hosted plan:** Prepared below; NOT EXECUTED. Preview shares Production database unless a separate approved backend is configured, so fixtures require explicit labels/scope and cleanup authorization. No silent OAuth/config changes or arbitrary unknown audit-row insertion.
33. **Rollout order:** Prepared below; NOT EXECUTED. Separate authorization required. Production application deployment remains gated on Preview acceptance.
34. **Risks:** Hosted auth/provider/full-workspace paths unverified. Windows PostgreSQL matches engine17.6, not managed Linux/Supabase Auth/Storage deployment. Platform stubs cover migration prerequisites only. Races are explicit bounded barriers, not load testing. Existing now()-same-transaction and manual nonunique ordering limits retained. Read-only preflight can become stale. Candidate remains uncommitted, so no deployable release SHA/verified rollback build yet.
35. **READY FOR ROLLOUT:** YES for the proposed staged rollout, with real PostgreSQL gate now passed. This is not final hosted acceptance or permission to bypass Preview/old-app health/rollback gates.
36. **Next separate authorization:** May authorize final read-only preflight, Production additive migration, old-app health check, candidate commit/push and Preview deployment/acceptance as a staged task. Production application release should remain conditional on successful Preview evidence and explicit release decision. No release action performed by this review.

## Production read-only duplicate query

```sql
select run_id, entity_id, count(*) as conflicting_actions
from private.agent_actions
where action_type in ('update_milestone', 'reschedule_milestone')
  and entity_id is not null
group by run_id, entity_id
having count(*) > 1;
```

Result: zero rows. No raw payload/before_state rows retrieved. Metadata definitions contain field names only, not user prompts or action contents.

## Real PostgreSQL race ledger

Wait is wall time from second dispatch through release/completion, including observer/commit overhead. Each blocked case recorded the actual blocking PID and wait event. G overlaps open transactions and is correctly nonblocking.

| Scenario | Waiting session | ms | Result | Workspace updates/inserts; applied transitions |
| --- | --- | ---: | --- | --- |
| A same create | B on A | 48 | Both same applied entity | 0/1;1 |
| B same update | B on A | 43 | Both same applied state | 1/0;1 |
| C distinct creates | B on A parent | 50 | Both applied/distinct order | 0/2;2 |
| D manual first | B Agent on A manual | 37 | conflict/STALE_ENTITY | 1 manual/0;0 |
| D Agent first | B manual on A Agent | 42 | Later manual edit preserved | 2/0;1 |
| E delete first | B Agent on A delete | 33 | failed/FORBIDDEN | 0/0;0 |
| E Agent first | B delete on A Agent | 64 | Applied then deleted | 1/0;1 |
| F reparent first | B Agent on A target | 45 | failed/FORBIDDEN | 1 manual/0;0 |
| G task-link overlap | None | N/A | Both independent writes preserved | 1 milestone/0;1 |
| H duplicate Prepare | B on A source | 40 | One recovered inverse | 1 source/0;1 |
| I Prepare first | B Cancel on A inverse | 41 | Cancel then fresh Prepare works | 1 source/0;1 |
| I Cancel first | B Prepare on A inverse | 60 | Fresh inverse/one live | 1 source/0;1 |
| J manual first | B inverse on A target | 53 | conflict/STALE_ENTITY | 2 source+manual/0;1 |
| K inverse first | B Cancel on A inverse | 33 | Both report applied | 2 source+inverse/0;2 |
| K Cancel first | B inverse on A inverse | 34 | Cancelled/no reversal | 1 source/0;1 |
| L duplicate inverse Apply | B on A source | 44 | Same terminal result | 2 source+inverse/0;2 |
| Legacy/manual | B legacy on A target | 48 | conflict/STALE_ENTITY | 1 manual/0;0 |

Final race run17/17. Clean baseline rollback rehearsal, immutable seven-kind history, legacy Apply/Undo, six malformed rejections and four real-role denials also pass. These are rollout checks, not added to the299 implementation test count.

## Hosted Preview acceptance plan — later authorization

Record exact committed SHA, deployment URL/type, backend project and authenticated owner before fixtures. Use an explicitly approved disposable project with prefix [Phase5B Acceptance] and unique suffix. Capture network identifiers/status only; inspect Activity responses for private fields without copying credentials/cookies.

| Area | Exact journey and expected proof |
| --- | --- |
| Owned read | Ask Agent for full details of named owned milestone. Verify title/description/status/date/project match UI; bounded/truncation behavior. Foreign/missing ID returns safe unavailable state; do not expose another owner's data |
| Create pending/Cancel | Ask to create labelled milestone in exact owned project, description/date included. Inspect defaults pending, description/date. Confirm no milestone before Apply; Cancel and reload, still absent |
| Create Apply/recovery | Fresh labelled creation. Apply, record database UUID via normal response, reload/recover identical canonical entity. Simulate lost response via authorized browser tooling after server commit; recover by runId. Repeat Apply must return same entity and no duplicate |
| Individual update | Separate title, description, status and date proposals; inspect exact diff, no pre-Apply mutation; Apply and reload each |
| Grouped/date clear | One description+date action; one grouped Apply. Then explicit target-date clear to null; unaffected fields preserved |
| Stale | Propose update, manually edit target before Apply, Apply conflicts safely; manual value preserved. Review Again uses correct milestone and fresh canonical state |
| Legacy date | Existing reschedule_milestone date/null path still applies and old Activity/date-only diff renders; no nested audit transition |
| Undo | Eligible update: Prepare makes pending inverse without workspace mutation; Cancel it. Fresh Prepare, Apply inverse, check full affected reversal. Original audit immutable, immediate-source lineage correct. Prepare inverse-of-inverse remains an explicit new approval |
| Unsupported | Creation Undo unavailable. Unknown historical kind remains display-only without task label/Apply/Review Again. Use an isolated fixture or approved harness; never insert arbitrary unknown rows into Production audit |
| Privacy/contracts | Activity contains no payload/before_state/expected versions/original prompts/reasoning/credentials. Explanations<=240 and inverse summaries<=180. Prepare body exactly runId/actionId; Apply/Cancel exactly runId/actionIds. No Gemini request for those/recovery |
| Refresh | Milestone list/status/date and project progress refresh after ordinary/inverse Apply and recovery, without manual page reload requirement |
| Responsive | Repeat cards/Activity/details/long-description/missing-target views at1440/1024/768/390/320. No horizontal overflow or hidden Apply/Cancel controls; keyboard controls usable |
| Other workspace | Agent Chat/Mode, historical Activity, existing projects/tasks, Calendar/time blocks, Focus Session and manual milestone create/edit/status/delete still work. Inspect console/page errors and unexpected HTTP4xx/5xx |
| Cleanup | Record exact fixture entities and status. Do not permanently delete shared-backend data without explicit scope/authorization. Immutable audit history stays; no cleanup to conceal failures |

Stop hosted acceptance on ownership/privacy/invariant regression, mismatched deployed SHA, failed RPC, unexpected terminal state, OAuth mismatch or unsafe cleanup. Diagnose concrete defects before code/settings changes; authorization remains scoped.

## Proposed rollout order — no operations performed

1. Reconfirm branch/diff/empty index/migration hash; capture immutable candidate manifest and intended commit contents.
2. Re-run final read-only target migration/schema/function/grant/duplicate preflight; stop on drift/conflicts.
3. Under separate authorization, apply only90001 transactionally to Production. Never edit/repair old history.
4. Verify migration history, new/replaced signatures, grants, constraints and service-only access.
5. Verify currently deployed old app health before creating any new milestone actions: Production login/return hostname, workspace/tasks/milestones/Calendar/Focus, Agent/Activity/old proposal Apply/Cancel. No new Phase5B kinds until matching application is accepted.
6. Commit exactly reviewed Phase5B implementation, tests and approved documentation; exclude ignored runtime/harness data, dependencies and credentials. Record commit SHA and migration SHA.
7. Push feature branch and create/verify Preview deployment for that exact SHA; record backend identity.
8. Authenticate Preview using existing approved configuration. Stop for explicit approval if settings/OAuth changes are required.
9. Execute hosted matrix above using explicitly scoped fixtures; verify network privacy/recovery/legacy/manual paths and five widths. Fix concrete defects with regression proof; re-review candidate integrity if code changes.
10. Confirm fallback-capable rollback build or forward-fix decision; record release rollback floor. Merge/fast-forward main only under release authorization, preserving reviewed SHA/content.
11. Deploy Production application intentionally, verify deployment SHA/alias/type, then run short authorised Production smoke. No automatic promotion before Preview passes.
12. Report exact results, preserve audit history and approved cleanup evidence. Stop; no Phase5C/5D.

## Evidence, limitations and temporary setup

Ignored evidence under .superpowers/sdd/2026-10-13-workspace-agent-phase5b-plan/:

- production-function-preflight.json:24 function signatures/body hashes/security attributes; function-comparison.json:zero differences.
- production-schema-preflight.json and rollout-preflight.mjs: schema/catalog baseline comparison. PGlite newer-engine NOT NULL catalog rows were accounted for using explicit column nullability; actual PostgreSQL17 replay matches directly without normalization beyond source CRLF.
- postgres-rollout.mjs, postgres-rollout.txt, postgres-results.json: full migration replay, clean transactional rehearsal, unchanged historical snapshots, real ACL/denial/malformed tests, barriers/PIDs/wait events/results/counts/SQLSTATE.
- postgres-attempt1.json/txt: harness-only syntax failure preserved. Cluster-global role recreation was also a harness setup error, not a concurrency outcome.
- postgres.log: server startup/diagnostics; final database reports zero deadlocks. No observed lock/statement timeouts.
- Vendor archive SHA256 D378882ABD001A186735ACD6F6BA716BCA6CCD192E800412D4FD15ED25376B3E; downloaded via HTTPS from get.enterprisedb.com, postgres --version verified17.6. This is recorded local digest, not a claim of independent vendor-signature verification. [EDB binary distribution](https://www.enterprisedb.com/download-postgresql-binaries).

Owner explicitly approved temporary local PostgreSQL setup after no installed PostgreSQL/Docker/WSL or Supabase branch was available. Local server bound only127.0.0.1 with disposable fixtures/platform stand-ins, no Production credentials or copied user data. No service installation, system PATH, Supabase Auth or Vercel settings changed. Runtime/data/evidence remain ignored; server is stopped after review. No product code/migration changes found necessary.