# Workspace Agent Phase 4B rollout gate report

Date: 2026-10-12 (Asia/Manila). Branch: `codex/workspace-agent-phase4b`.

**Outcome:** rollout stopped before production mutation. The prompt makes migration/application conditional on passing pre-application PostgreSQL concurrency gates. No disposable or staging PostgreSQL is available, local PostgreSQL is not running, and there are no Supabase branches. The required independent-session tests therefore could not be run. The prompt explicitly says not to treat PGlite as proof. No migration was applied; no commit, push or deployment occurred.

## Acceptance report

1. **Linked project:** Supabase project listing confirms expected `peokrukgprzbmathrurv` (DevWorkplace, ACTIVE_HEALTHY, PostgreSQL 17.6). All database reads targeted that exact ref. Local CLI project_id is only `software-workplace`; explicit `--project-ref` was used for the authoritative CLI migration list.
2. **Migration review:** reviewed `20261013090000_workspace_agent_safe_undo.sql`; contains Phase 4B lineage constraints/index, private evaluator/projector/context-lock helpers, service-only RPCs and safe Activity projection additions. No data backfill, task deletion, generic rollback, Gemini tool or browser grant found.
3. **Migration ordering:** candidate `20261013090000` follows all local files and remote migration history; remote latest is `20261012090000`. CLI migration list with explicit expected project ref agrees.
4. **Dry run:** `npx supabase db push --linked --skip-vault --dry-run` reported exactly `20261013090000_workspace_agent_safe_undo.sql`; no seed or role changes. Migration listing was additionally run against explicit ref `peokrukgprzbmathrurv`.
5. **PostgreSQL rehearsal:** not run. No authorized disposable/staging instance or local PostgreSQL is available. The linked production database was not used for DDL rehearsal.
6. **Concurrent Prepare:** blocked, not run. Requires true independent PostgreSQL sessions.
7. **Prepare/Cancel race:** blocked, not run in true independent sessions.
8. **Apply/manual-edit race:** blocked, not run in true independent sessions.
9. **Concurrent repeated Apply:** blocked, not run in true independent sessions.
10. **Overlap/restoration race:** blocked, not run in true independent sessions.
11. **Link/parent concurrency:** blocked, not run in true independent sessions.
12. **Migration apply:** not applied. The mandatory concurrency gate did not pass because it could not be exercised.
13. **Post-migration history:** not applicable. Pre-apply remote history was read; Phase 4B version was absent.
14. **Audit integrity:** read-only production aggregate found 44 existing actions across supported action families/statuses and zero rows with null payload/before_state/diff. No audit row was modified. This aggregate is not a complete semantic proof of historical completeness.
15. **Workspace integrity:** no production or workspace mutations were made.
16. **Live Activity read:** Phase 4B Activity projection cannot be live-verified; migration and app code are not released. No production response was claimed.
17. **Task Undo:** local implementation previously passed disposable PGlite/browser acceptance. Production task Undo is blocked pending migration and app release.
18. **Unrelated-edit behavior:** local PGlite coverage passed. Not live-verified.
19. **Affected-edit rejection:** local PGlite coverage passed. Not live-verified.
20. **Post-Prepare stale behavior:** local PGlite coverage passed, including microsecond version behavior. Not live-verified.
21. **Multi-field behavior:** local field and multi-field coverage passed. Not live-verified.
22. **Null behavior:** local coverage passed with missing distinct from null. Not live-verified.
23. **create_task unsupported:** local policy/UI coverage passed. Not live-verified.
24. **Date Undo:** local milestone/project date coverage passed. Not live-verified.
25. **Created-block Undo:** local coverage passed. Not live-verified.
26. **Updated-block Undo:** local coverage passed. Not live-verified.
27. **Cancelled-block Undo:** local restoration coverage passed. Not live-verified.
28. **Occupied/expired behavior:** local future/occupied/past coverage passed. Production exclusion constraint exists (one matching constraint found); no concurrency claim from this observation.
29. **Pending recovery:** local reload/lost-response recovery path passed. Not live-verified.
30. **Applied inverse detection:** local lineage and already-reversed UI tests passed. Not live-verified.
31. **Inverse-of-inverse:** local direct-lineage test passed. Not live-verified.
32. **Owner isolation:** local SQL/route tests passed. No live authenticated owner-isolation test was run.
33. **Network contract:** local route tests verified identifier-only Prepare contract and existing Apply/Cancel contracts. No production browser network inspection was performed.
34. **No Gemini:** static route/store paths and tests show no Gemini calls in Undo flows. No production instrumentation was used.
35. **Lost-response recovery:** deterministic local recovery/fault-injection tests passed. No production transport test was run.
36. **Responsive UI:** isolated browser checked 1440, 1024, 768, 390 and 320 widths with no horizontal overflow; Prepare, Apply, lineage and same-run reselection worked. This used the actual components/projection with disposable SQL fixtures, not the hosted app. No production UI acceptance claim.
37. **Privacy:** migration and projection code statically reviewed; local projection/grant tests passed. Production Phase 4B response privacy cannot be checked because Phase 4B is not live.
38. **Cleanup:** no users/projects/tasks/blocks, pending inverse, instrumentation or debug route was created in production. Isolated browser and local harness were closed.
39. **Phase 4B tests:** 29 passed, 0 failed/skipped before rollout; expanded DB file rerun 18/18 after service-grant assertions. PGlite only.
40. **Regression suites:** Phase 4A 32/32; Phase 3B 58/58; Phase 3A 19/19; Phase 2 17/17; Phase 1 21/21. No failures.
41. **Full suite:** 373 total: 371 passed, 0 failed, 2 existing optional CMS skips.
42. **TypeScript:** `npx tsc --noEmit` passed.
43. **ESLint:** changed/new product TypeScript files passed.
44. **Build:** `npm run build` passed locally. No deployment occurred.
45. **Diff:** `git diff --check` and checks for new files passed. Existing migration files match the accepted Phase 4B implementation hash manifest and Git HEAD; no old migration edit detected.
46. **Defects discovered/fixed:** previous implementation review defects (unrelated long text, time-block context drift, same-run reselection, milestone UUID labels) were fixed and regression-tested before this rollout task. No new migration defect was established by static review; production compatibility remains unproven.
47. **Known limitations:** genuine multi-session PostgreSQL behavior, rollback-safe PostgreSQL rehearsal, live Phase 4B app/API, authenticated Prepare/Apply/Cancel/recovery, owner isolation, live privacy and production cleanup remain unverified. Supabase project has no development branches. Do not infer release readiness from PGlite or static review.
48. **Ready to commit/push/deploy:** **No.** The user's task forbids these actions, and mandatory concurrency/compatibility gates remain unverified. Phase 4B is ready for a separate staging-validation step once an approved disposable PostgreSQL target is available; production rollout must remain stopped until all required race cases pass.

## Production observations (read only)

- Phase 4B migration version `20261013090000`: absent from migration history.
- Server version: PostgreSQL 17.6.
- Existing Agent action rows: 44; grouped by action type/status in the read-only query; incomplete-field count (any null payload, before_state or diff): 0.
- Existing time-block overlap constraint: one matching constraint found.
- Existing Supabase branches: none.
- No secrets, tokens, cookies or credentials were read or emitted.

## Evidence and commands

Dry run:

```powershell
npx supabase db push --linked --skip-vault --dry-run
```

Explicit-target migration list:

```powershell
npx supabase migration list --linked --project-ref peokrukgprzbmathrurv
```

The first command returned exactly one pending migration, no seeds, no roles. The second matched local/remote history through `20261012090000` and showed the new local migration as pending. Supabase read-only project/migration/branch tools and a single aggregate read-only SQL query supplied production observations above.

No database DDL/DML, migration apply, production UI mutation, commit, push or deployment occurred.

## Resume check — 2026-10-12

Per the resume request's Step 1, checked existing local capabilities before creating anything:

- Docker/Docker Desktop: command not installed/on PATH (`docker: command not found`).
- Podman: unavailable (`supabase status` reports Docker and Podman both absent).
- Local PostgreSQL server/client: `postgres`, `pg_ctl`, and `psql` commands absent; no matching PostgreSQL service found.
- Supabase local development stack: unavailable because its required container runtime is absent. `npx supabase status` failed with `StatusDbInspectError` and reported `docker: command not found`.
- Supabase CLI still reports the linked project as `peokrukgprzbmathrurv` / DevWorkplace; no operation beyond status inspection was run.

Stopped at Step 1 as instructed. Did not install software, start a container, create a database, run races, or touch production. All PostgreSQL concurrency cases remain unrun. Next prerequisite: owner makes an already-approved local Docker Desktop/Podman or PostgreSQL 17 server available; then resume with a disposable localhost-only database and temporary credentials. No credentials were created or retained.

## Owner-authorized rollout resume — 2026-10-12

The owner authorized this production Supabase project (`peokrukgprzbmathrurv`) for Phase 4B PostgreSQL concurrency and live acceptance. This supersedes the earlier disposable-database-only blocker. Commit, push, and deployment remain prohibited.

### Migration and integrity

- Reconfirmed the linked target is exactly `peokrukgprzbmathrurv` (DevWorkplace, PostgreSQL 17.6).
- Reviewed only `supabase/migrations/20261013090000_workspace_agent_safe_undo.sql`. It is additive; it does not rewrite existing audit/entity rows, add task deletion or generic rollback, or grant browser access to private audit data.
- Pre-apply history had exactly this migration pending. Normal linked `db push` applied only this file. Post-apply migration list shows local/remote match through `20261013090000`; fresh dry-run returned `upToDate: true`, zero pending migrations/seeds/roles.
- Post-apply catalog checks passed: lineage column, same-owner FK, self-reference check, pending/applied partial unique index, private helpers, service-only public RPC grants, `SECURITY DEFINER`, empty `search_path`, browser denial, private audit denial, and existing time-block exclusion constraint.
- Pre/post migration counts and full-row hashes matched: `private.agent_actions` 44 / `1e0397ff81f49c5d19d8dbd037ce5d4d`; `private.agent_runs` 40 / `07ce6a4c6bd770d5924601d14a3de3ba`; projects 5 / `389f9b4da216135e208174c80863583a`; tasks 16 / `7c268dbe76789af04f0d94ade35870f9`; milestones 7 / `68cafba28d2b9d9d6e53b6f61efc2f2e`; plans 2 / `1c336da18e93cb15f471be8a5d1c64b5`; time blocks 9 / `0d22f2689e4bccdf0633526fd78edc58`. The snapshot was taken before acceptance fixtures; existing rows were unchanged by migration application.

### True PostgreSQL concurrency evidence

All races used separate `npx supabase db query --file` OS processes, bounded timeouts, and clearly labeled synthetic owner records. Backend PIDs and barrier observations confirm independent sessions. No deadlock or lock timeout occurred.

| Case | Evidence | Result |
| --- | --- | --- |
| A: same-source Prepare | Holder 1229526; probe 1229529; caller 1229532; measured wait 23,178 ms | Both callers resolved to run `8912f04d-f152-4991-ac5b-f595195a5c29`, action `63aac8c8-8f0f-4bb6-aef1-5fbe2fda5869`; exactly one live inverse; no orphan draft observed. |
| B: Prepare then Cancel | Holder 1231110; probe 1231113; caller 1231116; wait 26,120 ms | Caller recovered the same pending inverse, then cancelled it; final live-inverse count 0. |
| B: Cancel then fresh Prepare | Sequential follow-up after cancellation | New pending inverse created with a different run/action; at most one live inverse. |
| C1: inverse Apply then manual edit | Holder 1230216; probe 1230219; update caller 1230225; wait 25,567 ms | Inverse restored title; waiting manual description edit committed after it. No lost update. |
| C2: manual edit before inverse Apply | Ordered independent check | Apply returned `STALE_ENTITY`; inverse did not partially mutate the task. |
| D: same inverse Apply | Holder 1231131; probe 1231134; caller 1231138; wait 25,865 ms | Both calls returned `applied`; second read persisted outcome; one task state transition. |
| E: block restore vs overlapping insert | Holder 1230322; probe 1230325; insert caller PID not captured; wait 25,837 ms | Restore committed. Competing insert failed with SQLSTATE `23P01` from `workspace_time_blocks_no_overlap`; final active-overlap count 1. |
| F: milestone parent move vs inverse Apply | Holder 1230389; probe 1230392; Apply caller 1230397; wait 25,034 ms | Parent move committed; inverse safely failed `FORBIDDEN`; task retained no invalid milestone link. |

Case A caller backend PID was not preserved in the earlier harness result. Case E insert PID was not preserved; holder/probe PIDs, independent-process execution, wait, SQLSTATE, and final state were captured. No credential, JWT, cookie, or password was logged.

### Cleanup, tests, and release gate

- Deleted temporary acceptance projects, tasks, milestone, and time blocks after restoring test-only manual fields and cancelling the active block through the existing proposal/Apply path. Final targeted query: zero fixture project/task/milestone/block rows and zero pending test inverses. Acceptance audit entries remain intentionally.
- Fresh Phase 4B focused run with the existing external PGlite runtime: 50 passed, 0 failed, 0 skipped.
- Existing implementation baseline remains current: full suite 371 passed, 0 failed, 2 optional CMS skips (373 total); TypeScript, changed-file ESLint, build, and diff checks passed before this no-code-change rollout resume.
- Live authenticated UI/network/privacy/responsive acceptance was not run. The app code is not deployed by instruction; the browser rejected local `http://localhost:3100/phase3b-acceptance` under its URL policy. I stopped the local server and did not try another browser surface. Route/privacy/no-Gemini and Activity behavior have focused local tests, but those do not substitute for live authenticated acceptance.
- No code or migration files were changed during rollout. No commit, push, deployment, or additional migration occurred. Production migration is applied; app release remains stopped pending a separately authorized deployment and hosted authenticated acceptance.



- Final audit aggregate after fixture cleanup: 19 post-migration runs, 19 actions, 0 orphan runs; all seven acceptance source actions remained applied.
