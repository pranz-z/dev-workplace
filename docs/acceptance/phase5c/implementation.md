# Workspace Agent Phase 5C local implementation report

2026-10-14. READY FOR ROLLOUT REVIEW; no rollout performed.

Checkout: `C:/Users/Franz/.codex/worktrees/workspace-agent-phase5b/software-workplace`, reused clean managed worktree on new local branch `codex/workspace-agent-phase5c`. HEAD remains `7efc8b8962d4ad784068d2196d7acac420e19cf4`; all implementation work is uncommitted. Primary main checkout remains at the same baseline.

1. **Migration:** `supabase/migrations/20261014114242_workspace_agent_plans.sql`, version `20261014114242`. CLI generated this current UTC timestamp after preflight; the provisional `20261014113000` file was never created.
2. **Migration SHA256:** `7B3C0E2CA084C16A971E621A23032910DD958FD1FEB56C22A0296FD05F38BAF4` (working-tree bytes).
3. **Prior migrations:** all 22 SHA256 values captured before creation and compared at completion; zero mismatches. Local versions matched read-only Production migration history. Prior latest was `20261013090001`. Duplicate Plan-target audit preflight returned zero.
4. **Exact implementation files:** listed below. Approved spec/plan were copied unchanged into the isolated checkout; primary checkout application files were not modified.
5. **get_plan:** existing read retained; adds bounded description/timeframe and title/description/timeframe/goal truncation flags; canonical nullable date; legacy goal/checklist compatibility preserved. Missing/foreign both refuse safely; no owner/version/audit metadata.
6. **create_plan:** required nonblank trimmed title; optional description/timeframe/status/targetDate. Canonical defaults description='', timeframe=null, status=Planning, targetDate=null. Owner/IDs/timestamps server-derived; no items/project ownership input.
7. **update_plan:** supplied keys only, canonical no-op rejected, exact affected before/diff captured, grouped atomic update. All five fields supported; null description/title/status rejected.
8. **Timeframe:** missing update key leaves unchanged; null persists SQL NULL; supplied string is trimmed, including whitespace-only to ''. Empty and null remain distinct in SQL/history/Undo/UI/recovery.
9. **Canonicalization:** title/timeframe 180 Unicode code points; description 4000; meaningful description whitespace preserved; malformed/lone-surrogate/NUL input rejected. ECMAScript trim set validated consistently by SQL. Plan-specific date validator accepts real four-digit Gregorian years 0001–9999 without changing old date validators.
10. **Ownership:** all Plan reads/proposal validation/save/Apply/Undo use plans.user_id. Plan audit project_id/taskId are null. No project/profile/item locks introduced.
11. **SQL objects:** new private.agent_plan_patch_valid(jsonb,boolean), private.agent_apply_plan_patch(uuid,uuid,jsonb,timestamptz), public.apply_agent_plan_action(uuid,uuid,uuid); replaced save_agent_proposal_batch, agent_undo_evaluate, agent_undo_lock_context, apply_agent_inverse_action, agent_activity_run; extended action checks and added agent_actions_one_plan_target_idx. No Plan/item columns, global Plan constraints, RLS policies or manual CRUD grants changed.
12. **Apply/idempotency:** canonical action locked first; Plan insertion/update and action association/status occur atomically. Pending update locks owner-scoped Plan. Terminal Apply returns stored entity association before checking whether entity still exists. One create action cannot create twice; duplicate titles are not identity.
13. **Stale protection:** exact PostgreSQL updated_at compared after row lock; no application JS Date precision round-trip. Accepted transaction-start timestamp limitations remain. Manual-first conflicts; Agent-first permits later manual writes.
14. **Dispatch:** explicit create_plan/update_plan forward routes; inverse update_plan uses guarded inverse RPC and shared Plan primitive. Unknown kind rejected, never inferred as task/Plan. All nine legacy kinds retained.
15. **One-action rule:** collector and SQL save enforce one Plan mutation as the only mutation in its run. Same-Plan patch calls can coalesce; different Plans/repeated creates/mixed kinds rejected.
16. **Safe Undo:** creation unsupported even for empty Plan; update supported via existing shared SQL evaluator. Exact affected history, current-state comparison, current version capture, direct immediate-source lineage and source immutability verified. Prepare does not mutate Plan; Cancel/fresh Prepare/inverse Apply/repeat Apply/inverse-of-inverse covered. Existing owner FK/self/live-inverse guards retained.
17. **Activity/UI:** Plan cards, labels, affected-field diffs, null/empty timeframe display, safe navigation, Review Again and setPlans workspace refresh. SQL/TS allowlists include timeframe. Activity clipping is code-point safe; eligibility explanation/summary bounds remain 240/180. No raw payload/before_state/version/prompt/reasoning/credentials in Activity.
18. **Recovery:** identifier-only Apply/Cancel/Prepare retained. Lost response reloads canonical batch; repeated applied create after target deletion recovers historical applied ID without resurrection. No model call in deterministic paths.
19. **Security/grants:** service_role can execute public Apply; anon/authenticated cannot. New private helpers and direct audit access denied. PGlite execution tests and real PostgreSQL role/SQLSTATE checks passed. Existing authenticated owns_plan predicate preserved.
20. **Focused Phase 5C tests:** 36/36 pass, zero failures/skips. Command `node --test lib/ai/agent/phase5c*.test.mjs` with existing external PGlite runtime.
21. **Full Agent suite:** 269/269 pass, zero failures/skips. Command `node --test lib/ai/agent/*.test.mjs`.
22. **Private AI:** `npm run test:ai`, 21/21 pass.
23. **Public AI:** `npm run test:public-ai`, 21/21 pass.
24. **Retry regression:** `node --test lib/ai/agent/gemini-retry.test.mjs`, 20/20 pass. Transport implementation/configuration unchanged; no live provider retry induced.
25. **Workspace/UI:** workspace shell 5/5; Phase 5C component/projection/recovery tests 5/5 are included in focused/full counts. Existing milestone recovery/refresh tests also pass with setPlans added to the callback stub/assertion.
26. **TypeScript:** fresh `npx tsc --noEmit`, exit 0.
27. **ESLint:** exact changed TS/TSX/MJS files, exit 0; no reported errors/warnings.
28. **Build:** fresh `npm run build`, exit 0.
29. **Diff:** `git diff --check`, exit 0. New source/migration files also checked for trailing whitespace; none. Git LF/CRLF advisory messages are not whitespace failures.
30. **Browser:** actual component synthetic static fixture checked at 1440/1024/768/390/320. Long Plan title/cards/Activity wrapped; no horizontal overflow; Apply/Cancel visible within viewport. Screenshots and DOM width metrics saved. This is local visual evidence, not authenticated end-to-end/Gemini/Apply acceptance. No Production browser data used.
31. **Disposable migrations:** PostgreSQL 17.6 replayed all 23 unchanged migration files in order, each using single-transaction mode. Platform auth/storage prerequisites were local stand-ins. Nine historical legacy action rows retained identical snapshot hash across new migration. PGlite Plan fixtures match actual Plan columns, RLS, triggers and indexes.
32. **True concurrency:** 14 synchronized cases passed using distinct PostgreSQL backend PIDs and observed pg_blocking_pids barriers, READ COMMITTED. Cases A–J and both manual/deletion/inverse/Cancel orderings exercised. Evidence includes final values/action counts, duplicate-create/live-inverse guards, source hashes and canonical responses.
33. **Deadlocks/timeouts:** zero observed; final pg_stat_database.deadlocks=0; 5-second lock and 10-second statement timeouts did not fire. Initial harness-only deleted-row JSON observer failure and a subsequent script quoting error were corrected; no product defect or race failure was hidden as success.
34. **Migration integrity:** exactly one new nonempty Phase 5C file, strictly after all old versions; no prior hashes changed, no empty migration artifacts. Migration never applied remotely. Local PostgreSQL server and fixture HTTP server stopped after validation; evidence retained.
35. **Limitations:** no hosted/authenticated live acceptance or live Gemini retry exercised; local visual fixture has static controls. updated_at is not a perfect logical revision counter. Local PostgreSQL platform stand-ins do not replace later hosted catalog/security/old-app-health preflight.
36. **Readiness:** READY FOR SEPARATE ROLLOUT REVIEW. No commits, pushes, Preview/Production deployments, remote migrations, configuration changes, Plan item writes or Phase 5D work.

## Exact files

Modified tracked files:

- app/app/page.tsx
- components/ai/AgentActivity.tsx
- components/ai/AgentProposalCards.tsx
- data/agentActivity.ts
- data/agentProposalReview.ts
- lib/ai/agent/activity.ts
- lib/ai/agent/contract.ts
- lib/ai/agent/phase2.test.mjs
- lib/ai/agent/phase5b-recovery.test.mjs
- lib/ai/agent/prompt.ts
- lib/ai/agent/proposal-schema.ts
- lib/ai/agent/proposals.ts
- lib/ai/agent/schedule-summary.ts
- lib/ai/agent/store.ts
- lib/ai/agent/tools.ts

New implementation/test files:

- supabase/migrations/20261014114242_workspace_agent_plans.sql
- lib/ai/agent/phase5c.test.mjs
- lib/ai/agent/phase5c-fixture.mjs
- lib/ai/agent/phase5c-database.test.mjs
- lib/ai/agent/phase5c-policy.test.mjs
- lib/ai/agent/phase5c-route.test.mjs
- lib/ai/agent/phase5c-recovery.test.mjs
- docs/acceptance/phase5c/implementation.md

Approved documents preserved in this checkout:

- docs/superpowers/specs/2026-10-14-workspace-agent-phase5c-design.md
- docs/superpowers/plans/2026-10-14-workspace-agent-phase5c-plan.md

## Review and rulings

Native executing-plans with RED/GREEN evidence; final independent gpt-6-astra read-only review found no Critical/Important defect. Two inherited issues affecting the explicit Plan contract were regraded by effect and fixed in one verified pass: Unicode-safe Activity clipping and four-digit early-year Plan date parity. A missing lost-response/deleted-target regression was added and passed against already-correct terminal recovery.

Rulings made:

- Latest execution request authorized real local PostgreSQL concurrency, superseding plan's separate execution gate. Reused existing PostgreSQL binaries with own isolated localhost cluster. Cost if wrong: local resource use; no remote access/write.
- User's no-commit rule overrides commit-based task scripts/cleanup. Preserve uncommitted work and evidence. Cost if wrong: manual integration/review needed later.
- CLI-generated current timestamp 20261014114242 used after the same ordering gate instead of allocating provisional 113000. Cost if wrong: deployment tooling must use recorded actual filename/hash.
- Unicode truncation and early-year parity were treated as explicit Plan contract defects despite reviewer Minor labels. Cost if wrong: shared Activity display clipping semantics and acceptance of valid historical Plan dates; legacy task/milestone date validators unchanged.

Deferred review minors: none. No second reviewer pass; covering RED/GREEN tests and fresh full suite verify final fixes.

## Evidence and rollout prerequisites

Ignored evidence: `.superpowers/sdd/2026-10-14-workspace-agent-phase5c-plan/` contains ledger, pre-change migration SHA manifest, RED/GREEN logs, final logs, PostgreSQL harness/results/lock observations, and five-width screenshots/metrics. Existing disposable PGlite runtime was reused; no package/lockfile or infrastructure installation.

Separate rollout authorization still requires exact candidate/migration review, fresh Production read-only migration/schema/function/grant/duplicate preflight, exact transactional migration application, old Production app health, reviewed commit/push, exact-SHA Preview acceptance, and intentional Production application release. Keep established release compatibility floor. This report authorizes none of those writes.
