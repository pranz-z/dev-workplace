# Phase 5B milestone implementation report

2026-10-13. Local implementation complete. Ready for separate rollout review; rollout/concurrency acceptance remains UNVERIFIED. No Production operations, commit, push, deployment, external settings change or Phase5C/5D work.

## Requested 42-point report

1. **Repository entry:** Original checkout C:\webprac\software-workplace, main, base/HEAD 182a0f45a51f22148c9f0616bfa845ad78ff926a, tracked clean at entry. Uncommitted implementation remains in C:\Users\Franz\.codex\worktrees\workspace-agent-phase5b\software-workplace on codex/workspace-agent-phase5b, same HEAD. Original checkout/unrelated artifacts preserved. Resumed Tasks4–10 without restarting Tasks1–3.
2. **Migration/order:** Owner-approved 20261013090001_workspace_agent_milestones.sql. Removed ONLY verified zero-byte/unapplied 20261013022231_workspace_agent_milestones.sql. Before SQL, listed filenames, checked unique versions, max existing 20261013090000, empty stub and old hashes. Final version sorts strictly after every existing migration. No applied rename/edit, clock change, CLI installation or history repair. Executed only in disposable PGlite.
3. **Files:** Changed components/ai/{AgentProposalCards,AgentActivity}.tsx; data/{agentActivity,agentProposalReview}.ts; lib/ai/agent/{contract,proposal-schema,registry,tools,proposals,prompt,schedule-summary,store,activity,time-blocks,block-resolution}.ts; intentional inventory expectations in agent.test.mjs/phase2.test.mjs; supabase/schema.sql documentation. Added milestone migration, phase5b-fixture.mjs, five phase5b test suites, this report and approved plan/spec copies. Ignored ledger/evidence/harness under .superpowers/sdd/2026-10-13-workspace-agent-phase5b-plan/. No package/lockfile/dependency/environment/route changes.
4. **Contracts:** Discriminated create_milestone/update_milestone drafts; strict parsers. Title trimmed/nonblank/180; description string/4000/empty clear; status pending/active/completed; valid YYYY-MM-DD or null. Creation intent cannot supply status/order/identity/version. Legacy union retained and consumer narrowing completed. Missing differs from null.
5. **get_milestone:** Owned project join, title/project label180, description4000, status40, nullable date, truncation flags. No authoritative timestamps/owner/audit internals. Ownership/projection tests and disposable browser read pass.
6. **Canonicalization:** Reload raw owned state/version; create defaults pending/empty/null. Update records affected fields only plus project context; semantic no-ops removed, same-target calls merged. Exact text/byte boundaries enforced. Unrelated manually oversized description survives; affecting unrepresentable history rejects, never silently truncates.
7. **One new action:** Collector rejects mixed new/legacy/task/block mutation calls in both orders. SQL independently requires exactly one action for any new milestone kind. Old-only maximum remains ten. New update plus legacy date for same target cannot coexist.
8. **Shared primitive:** private.agent_milestone_patch_valid(jsonb,boolean) and private.agent_apply_milestone_patch(uuid,uuid,uuid,jsonb,timestamptz). Project SHARE before milestone UPDATE; owned relationship/exact version/strict four fields; exactly one target write. False means stale. No audit mutation, public Apply call or second approval.
9. **Create Apply:** Service-only apply_agent_milestone_action locks action then owned project UPDATE, computes append order, inserts database UUID and completes audit atomically. Repeated Apply returns same entity; Cancel creates none. Audit-trigger failure proves workspace rollback and safe MILESTONE_SAVE_FAILED. Agent append serialization does not claim globally unique manual ordering.
10. **Update Apply:** Same primitive, strict stored whole-row timestamp, grouped fields in one write/audit outcome. No task/project-deadline/block/availability/Plan mutations. Stale/unavailable cannot partially apply. Snapshots and progress checks pass.
11. **Legacy reschedule:** Only milestone workspace UPDATE delegates to helper. Original date-only payload/before shape, null/no-op/date/stale/ownership/error semantics and one audit transition preserved. Old-shape Apply/Undo snapshots, existing recovery suites and browser date Apply pass. Legacy SQL comparison found no additional behavior change.
12. **Persistence:** Old seven kinds/CHECK branches preserved; appended new branches. Creation parent/null version, null entity until applied; update parent/entity/version. Read-only duplicate guard then partial unique (run_id,entity_id) index for update_milestone/reschedule_milestone. Disposable historical preflight zero rows; all old kinds/inverse snapshots unchanged. Existing lineage/FK/live-inverse/history limits retained. Production preflight unrun.
13. **Dispatch/fallback:** Explicit nine-kind RPC map, unknown ordinary action never falls through to task logic. Inverse guard remains first. Unsupported cards display-only without selection/Apply/Review Again. Reviewer found unsupported failed/conflict Activity task retry; regression reproduced, projection guard fixed. New build fallback does not repair old deployed clients.
14. **Safe Undo:** Existing SQL evaluator/context/guard extended only; no second TypeScript inverse algorithm. update_milestone restores every affected field or none; create unsupported. Unrelated pre-Prepare edits tolerated, current version captured, post-Prepare whole-row change conflicts. Each field/grouped/null/empty/truncated/missing history/repeated Prepare/Apply/cancel-fresh/inverse-of-inverse tested. No Gemini in eligibility/Prepare/Apply/Cancel/recovery.
15. **Immutability:** Source action snapshots unchanged through inverse preparation/Apply/repeated Apply. Direct immediate-source lineage preserved; reversed states derived. History corruption only in disposable fail-closed fixtures, never external audit edits.
16. **Activity/cards:** Explicit new labels, owned parent/target names, full create defaults, affected-only update diffs, milestone navigation/Review Again, safe errors and derived reversed-later label. Existing projection bounds retained: explanation240, inverseSummary180, displayed text4000. No raw payload/before_state/version/prompt/hidden reasoning. Opening Activity creates no actions.
17. **Refresh:** Existing app/app/page.tsx callback unchanged. AST behavior test executes callback and proves tasks/projects/milestones refresh. Actual cards/Activity browser refresh updates/restores completion count. Lost-response component recovery refreshes once.
18. **Security:** New public Apply SECURITY DEFINER, empty search_path, qualified relations; PUBLIC/anon/authenticated denied, service_role only. Private helpers denied even service_role; replaced RPC grants reaffirmed; audit private. Disposable role/grant checks and existing auth/origin/rate-limit suites pass. Prepare exactly runId/actionId; Apply/Cancel exactly runId/actionIds; recovery identifiers only.
19. **Migration hashes:** 21 existing migrations, zero hash changes, zero duplicate versions, one new file only; removed empty stub absent. New SHA256 E820045188DF2E65AA49CA2773CAF504D7EF52486642D6D52F80AAF71D00F976. No migration history mutation.
20. **Phase5B:** 37/37 passed: intent/read/collection/prefilter8, database11, SQL policy8, routes3, recovery/UI7. Zero failed/skipped. RED/GREEN observed for implementations and final reviewer fix. Overlapping executions not summed.
21. **Phase4B:** 29/29 passed, zero skipped. Existing policy/database/routes/recovery/lineage preserved. Single-engine evidence only.
22. **Phase4A:** 32/32 passed, zero skipped, including Activity/database/recovery/review/routes.
23. **Phase3B:** 58/58 passed, zero skipped. Deterministic scheduling/time-block SQL retained; exclusion authority unchanged.
24. **Phase3A:** 19/19 passed, zero skipped, including legacy schedule database.
25. **Phase2:** 17/17 passed, zero skipped. Intentional exact proposal inventory extension; approval/persistence/injection checks retained.
26. **Phase1:** 21/21 passed, zero skipped; read inventory sixteen to seventeen for approved get_milestone. Complete final Agent run 213/213, zero failed/cancelled/skipped.
27. **AI:** test:ai21/21; test:public-ai21/21. Public/private boundaries and credentials unchanged.
28. **Calendar/Focus:** test:calendar10/10; test:focus-session10/10. Implementation unchanged. Full authenticated Calendar/Focus browser operation remains hosted rollout verification, not proven by milestone harness.
29. **Accountability/workspace:** test:accountability19/19; test:workspace-shell5/5. Six related suites86/86, zero failures/skips. Disjoint Agent+related total299/299; not every unrelated repository test command was run.
30. **Manual milestones:** Fixture extracts real baseline table/policy/trigger/FK definitions. SQL covers owner/foreign/anon, parent CASCADE and task SET NULL. Actual existing manual service create/edit/status/delete exercised through disposable browser adapters. Authenticated full workspace CRUD wiring remains hosted verification.
31. **TypeScript:** Fresh npx tsc --noEmit passes. Normal Next typegen/build resolves missing LayoutProps/PageProps; introduced union narrowing fixed explicitly. No code workaround for absent generated types.
32. **ESLint:** Changed TypeScript/TSX/MJS plus new Phase5B tests/fixture pass with no warnings/errors, including conditional block-resolution/time-blocks files.
33. **Build:** Fresh default npm run build passes. Initial external node_modules junction rejected by Turbopack; replaced only verified worktree junction with local copy of installed dependencies. No install/lockfile changes. No credentials copied; Supabase-disabled local configuration warning expected.
34. **Diff:** git diff --check passes, index empty, HEAD unchanged. Changes isolated; scratch ignored/preserved. No secrets output/copied/staged.
35. **Browser widths:** 1440/1024/768/390/320 pass; screenshots use actual built CSS. Real production components/domain/store/SQL/manual service exercise read, pending Cancel, create Apply/canonical recovery, grouped update, read-only Activity, Prepare/Cancel/fresh inverse Apply, legacy date, Review Again, progress, manual CRUD, long text and missing targets. No horizontal overflow. Harness is isolated, not full authenticated Next workspace.
36. **Console/network:** Zero page/console errors and zero HTTP4xx/5xx in disposable browser. Missing target shows safe failed action and missing-item Activity state. Identifier-only mutation bodies captured. Lost-response simulated in component test; browser canonical create recovery proves no duplicate. No hosted claim.
37. **Defects/fixes:** Migration-order gate resolved exactly by owner decision; milestone pipeline RED/GREEN; explicit milestone intent prefilter fixed; union errors fixed; intentional catalogs updated; junction environment fixed; reviewer unknown Activity retry fixed with exact task-labelled RED then 7/7 recovery GREEN and 213/213 suite. Browser cancellation assertion corrected to terminal Activity state without product change. Invalid historical block fixture seed failed existing Phase3B index BEFORE new migration: corrected distinct block targets, no valid history or constraint weakened.
38. **Unverified:** Zero skips in executed tests. Hosted auth/provider/Gemini/full workspace/Calendar/Focus UI, Production preflight/migration and genuine PostgreSQL multi-session cases not run. Adapter success does not prove deployment/auth wiring.
39. **Concurrency:** UNVERIFIED. PGlite single-engine/serial interleavings do not prove independent connections. Separate matrix: duplicate create/update Apply; distinct appends; manual edit in both lock orders; project deletion; relationship drift/reparent; task-link change; duplicate Prepare; Prepare versus Cancel; inverse Apply versus manual edit/Cancel/repeated Apply. Independent connections/barriers/bounded timeouts/committed rows required. Any failure blocks rollout.
40. **Rollback:** New build unknown fallback proven. Unchanged pre-5B code is not proven safe after new durable kinds. Require verified fallback-capable compatibility build or forward-fix; no audit rewrite/deletion/forced cancellation. Existing nonunique manual order and same-transaction now() timestamp limits remain.
41. **Rollout prerequisites:** Separately authorize target history/signature/grant inspection and duplicate preflight, requiring zero conflicts. Transactional migration, service-only grants/old-app health, then matching deployed SHA. Genuine PostgreSQL matrix plus hosted auth/Agent/provider/Activity projection/recovery/manual/Calendar/Focus/five widths. Verify rollback target; never bypass missing RPC through direct manual mutation.
42. **Review readiness:** YES for separate rollout review, NO claim of rollout/concurrency acceptance. Tasks4–10 locally complete. Fresh-context gpt-6-astra review found one Important issue, fixed by regression. No Critical/deferred Minor findings. Work retained uncommitted; stop before release/later phases.

## Transaction/lock boundaries

| Path | Order and boundary |
| --- | --- |
| Save | Validate canonical state; insert run/actions atomically; no workspace write |
| Create Apply | Current action UPDATE; owned project UPDATE; insert milestone; audit/run completion. Workspace+audit failure rollback together |
| Update/legacy date | Current action UPDATE; owned project SHARE; milestone UPDATE; strict version; one write/audit |
| Prepare | Source UPDATE; existing inverse UPDATE if present; project SHARE; milestone UPDATE; SQL evaluator; insert inverse run/action; no workspace write |
| Inverse Apply | Source UPDATE; inverse UPDATE; project SHARE; milestone UPDATE; existing guard/evaluator/version; delegated mutation re-enters held locks |
| Cancel | Pending actions in deterministic order; audit/run only |

Existing task/block context paths retained. Never source after inverse/entity. Relationship drift fails without acquiring another parent out of order. Multi-session proof still required.

## Validation commands/evidence

Run in isolated worktree. Existing external PGlite runtime supplied through AGENT_TEST_PGLITE_MODULE; no install.

```powershell
$files = @(Get-ChildItem lib/ai/agent -Filter '*.test.mjs' | ForEach-Object FullName)
node --test --test-concurrency=1 @files
npm run test:ai
npm run test:public-ai
npm run test:calendar
npm run test:focus-session
npm run test:accountability
npm run test:workspace-shell
npx tsc --noEmit
$changed = @(git diff --name-only -- '*.ts' '*.tsx' '*.mjs')
$added = @(Get-ChildItem lib/ai/agent -Filter 'phase5b*.mjs' | ForEach-Object { 'lib/ai/agent/' + $_.Name })
npx eslint @changed @added
npm run build
node .superpowers/sdd/2026-10-13-workspace-agent-phase5b-plan/browser-acceptance.mjs
git diff --check
git status --short
```

Ignored evidence directory: .superpowers/sdd/2026-10-13-workspace-agent-phase5b-plan/. Final suite/build/type/lint outputs, per-phase totals, migration-final.json, browser-results.json and five browser-<width>.png screenshots retained. Counts reflect actual fresh outputs, never overlapping sums.

## Rulings I made

- Managed isolated worktree; retain evidence without commits/cleanup per owner. Cost: evidence remains local only.
- Cached Supabase CLI absolute path, no installation. Cost: version/order must be checked; original bad timestamp was stopped, then explicit owner version used.
- Extend exact Phase2 inventory by two approved proposals. Cost: inventory could conceal extra capability; explicit registry/parser tests constrain it.
- Narrow milestone prefilter at block-resolution after observed regression. Cost: ambiguous routing risk; explicit block checks/old suites constrain it.
- Extend Phase1 inventory to seventeen. Cost: could conceal extra read; exact registry/projection tests constrain it.
- Copy installed dependencies locally after verified junction build failure. Cost: disk/copy fidelity; fresh build/type/lint pass, packages unchanged.
- Disposable real-component/domain/SQL/manual-service browser adapters. Cost: hosted/full-workspace wiring remains unproven.
- Reviewer declined concurrency: require independent-session proof before rollout. Cost: races may remain undiscovered locally.
- Reviewer declined hosted auth/browser: require hosted acceptance. Cost: adapters may differ from deployment.
- Reviewer declined old rollback: never assume unchanged downgrade safe. Cost: rollback target still needs proof.
- Reviewer declined global append/version strengthening: retain/disclose existing limits. Cost: callers must not overestimate guarantees.
- Reviewer declined unrelated Plans/deletion/reorder/AI: keep approved milestone scope. Cost: unrelated issues remain outside this work.
- Reviewer declined stale report during review: replace it with final evidence. Cost: must compare final outputs before handoff.

## Final review

One fresh-context gpt-6-astra reviewer inspected tracked diff, untracked migration/tests/fixture and compared replaced SQL with previous definitions. No confirmed SQL defect/Critical/Minor. One Important P2 unknown failed/conflict Activity task-labelled Review Again was reproduced RED, fixed with unsupported-state guard, then recovery7/7 and whole Agent213/213 GREEN. No second review or task agents. Hosted/concurrency/rollback limits above remain explicit. No deferred minors.