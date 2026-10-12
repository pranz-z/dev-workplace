# Phase 4A rollout and live acceptance

Date: 2026-10-12. Branch: `codex/workspace-agent-phase4a`. Production database tested through the authenticated local app. No commit, push, or deployment performed.

1. **Linked project.** Local project ref and Supabase project metadata both confirm `peokrukgprzbmathrurv`, DevWorkplace, active PostgreSQL 17.6. Checked before mutation.
2. **Migration review.** Only `20261012090000_workspace_agent_activity.sql`: private safe-projection helper plus two narrow read RPCs. No tables/columns/indexes, prompt storage, history rewrites, or changes to approval, Auth, Public AI, Drive, or GitHub. Older applied migration hashes unchanged.
3. **Security/grant review.** Public RPCs are stable SECURITY DEFINER with empty search_path and qualified relations; only service_role can execute. Private helper is invoker and not service-executable directly. SQL enforces ownership and bounded pagination. PUBLIC/anon/authenticated/service_role have no direct audit-table grants; browser RPC execution is denied.
4. **Migration history before.** Nineteen local/remote versions matched; only the new Phase 4A version was pending. No divergence or unknown remote version.
5. **Dry run.** `npx supabase db push --linked --skip-vault --dry-run` selected only the expected migration.
6. **Rehearsal result.** No existing staging branch was available. Linked PostgreSQL transaction applied the exact SQL, exercised assertions, then rolled back. Functions compiled; old records, empty runs, mixed statuses, owner isolation, cursor ties and microseconds passed. Unknown historical type fallback was tested locally because the production schema disallows inserting unknown types. Zero synthetic users/runs remained. An initial rehearsal fixture omitted a required action ID; corrected the fixture and reran successfully.
7. **Migration apply result.** After an exact-ref guard, `npx supabase db push --linked --skip-vault --yes` applied only `20261012090000_workspace_agent_activity.sql`. No reset, history repair, old replay, seed, or vault change.
8. **Migration history after.** Twenty local/remote versions match, including Phase 4A.
9. **Post-push dry run.** Reports database up to date; no pending migrations.
10. **Rollback-safe security result.** Service path can read owner A history; owner B gets no rows/details. Authenticated RPC/table access and direct service table read/write are denied. Malformed HTTP run ID returns 400; unavailable run returns 403 without details. Synthetic tests rolled back; new RPCs remain installed. GET implementation has no mutation path.
11. **Real historical compatibility.** Baseline: 36 runs, 40 actions. Actual create/update task, task due-date scheduling, milestone/project scheduling, create/update/cancel time block, applied/cancelled/conflict/pending records displayed. No failed actions, empty runs, or unknown types existed; these were not fabricated in production.
12. **Activity list result.** Real authenticated Workspace AI → Activity displayed newest-first groups, readable labels/statuses, action counts, timestamps and original-prompt disclaimer. No raw JSON.
13. **Filter result.** All six status and four date filters exercised. Baseline pending 2 runs, applied 13, cancelled 15, conflict 7, failed 0. Mixed runs retain all outcomes in details. Today initially contained 2 runs. Counts are labelled Loaded runs, not global totals.
14. **Pagination result.** UI loaded baseline 20 + 16 runs. After acceptance, SQL pagination returned 20 + 18 = 38 distinct runs, matching all 38 database runs. Stable newest-first ordering, no duplicates/omissions. Microsecond/tied cursors proven in rollback rehearsal and tests; page size bounded.
15. **Run detail result.** Representative task/date/time-block and mixed runs showed human labels, before/after diffs, statuses, created/approved/executed times where applicable, safe conflict reason and owned links. No raw payloads.
16. **Task navigation.** Existing task-create and task-scheduling details opened the correct task editor. Closed without saving.
17. **Project navigation.** Existing project scheduling opened dev-workplace project details.
18. **Milestone navigation.** Integrate Google Apps opened the correct milestone editor with its current date. Closed without saving.
19. **Time-block/Calendar navigation.** Existing and new blocks opened the correct local date and editor. Navigation was consumed once: saving, leaving/remounting Calendar and browser reload did not reopen the editor.
20. **Deleted-entity handling.** After removing only the acceptance-created block, its genuine applied audit row displays “Item no longer exists” without Calendar navigation or crash.
21. **Pending recovery.** Created two harmless unlinked focus-block proposals through the real Agent. Reloaded and reopened Activity: canonical pending cards restored from database, without regeneration. Original two pending actions remained untouched.
22. **Apply from Activity.** Existing POST `/api/ai/agent/apply` returned 200 for action `75558220-432d-40e9-aa4e-61b83d5debe1`. Exactly one block was created; canonical Activity status became applied and approval controls disappeared. Block content was later restored by removing that acceptance-only block.
23. **Cancel from Activity.** Existing POST `/api/ai/agent/cancel` returned 200 for `7c9efb30-73c9-4499-81c2-3620e9058cf9`. Status became cancelled, with no created entity. A rollback-safe attempt to Apply this cancelled action returned cancelled and created nothing.
24. **Transport-loss recovery.** Actual production transport loss was not injected. Temporary local instrumentation exercised the real authenticated recovery GET after Apply: HTTP 200, persisted applied status, no second Apply POST. Reload also recovered the durable outcome. Automated lost-response test covers POST uncertainty → GET without replay.
25. **Review again.** Existing gmail overlap conflict populated the Agent composer with owned task/project names, local date and duration. No UUID leak, auto-submit, stale replay or new audit row. Draft cleared afterward. Failed-record review is covered automatically; none exists live.
26. **Old-record compatibility.** Pre-Phase-4A rows render using existing metadata without prompt fields. Empty/mixed runs exercised in rollback rehearsal; safe unknown-type fallback tested locally. No fabricated navigation.
27. **Responsive hosted/local final pass.** Real authenticated local UI passed at 1440/1024/768/390/320 for lists, filters, loaded counts, details, diffs, pending controls, Review again, links and timestamps. Document client/scroll widths matched: 1425/1425, 1009/1009, 753/753, 375/375, 305/305. No clipped approval controls or browser console errors. Hosted UI was not deployed or verified. See [responsive metrics](rollout/responsive.json) and screenshots below.
28. **Privacy projection review.** Actual authenticated list/detail response inspection found no raw payload/before_state, reasoning, original prompts, credentials, token/cookie fields or server secret values. Only safe projection keys were returned. Temporary inspection forwarded cookies only to the same local origin and logged metadata, never secret values.
29. **Workspace data integrity.** Before migration, after migration and after cleanup counts/checksums matched exactly (table below). Migration did not alter workspace content. Acceptance created one temporary block; only that block was removed using exact ID/title and canonical audit ownership guards.
30. **Cleanup.** Zero synthetic users/runs, acceptance blocks or acceptance pending actions remain. Two genuine acceptance audit actions remain: applied and cancelled. Original pending actions and all historical audit rows preserved. Instrumented route restored byte-for-byte (matching SHA256); dev server stopped. Temporary browser cleanup encountered the browser tool’s blocked error-page URL after server shutdown; tab closure was not confirmed. No further browser action attempted.
31. **Phase 4A tests.** 32 passed, 0 failed, 0 skipped after instrumentation removal.
32. **Phase 3B regressions.** Included in final full suite; passed, including time-block approval/concurrency and scheduling paths.
33. **Phase 3A regressions.** Included in final full suite; passed.
34. **Phase 2 regressions.** Included in final full suite; passed.
35. **Phase 1 regressions.** Included in final full suite; passed. Private AI, Public AI, Calendar and Focus regression files also passed.
36. **Full suite.** 344 total, 342 passed, 0 failed, 2 known optional CMS skips. No new skips.
37. **TypeScript.** `npx tsc --noEmit` passed after the final build.
38. **ESLint.** Changed product TypeScript files passed; no output/errors.
39. **Build.** `npm run build` passed with route generation completed.
40. **Diff.** Tracked `git diff --check` and new Phase 4A text-file whitespace checks passed. Existing Phase 3B evidence preserved. No staging or commit. Older migration hashes and restored route hash verified.
41. **Defects discovered/fixed.** No new product defect found; no product architecture/code changes during rollout. Rehearsal fixture ID and an inspection SQL typo were corrected and rerun. An ambiguous Agent cancellation-worded prompt produced clarification; explicit new-block intent resolved it without a product change.
42. **Remaining limitations.** Hosted acceptance awaits a separately authorized release. No real failed/unknown/empty historical rows; automated/transactional coverage used where possible. No actual transport fault injected. Existing unrelated Supabase advisor warnings remain: legacy public definer RPCs, leaked-password protection disabled, and private RLS-without-policy informational entries. No Phase 4A advisor finding. No Undo or Phase 4B added.
43. **Ready to commit/push/deploy?** Ready for user release review: database migration and local authenticated live acceptance complete, checks green, reversible workspace content restored. Hosted smoke check remains after deployment. No commit, push or deployment performed.

## Workspace integrity

Checksums use MD5 over ordered per-row JSON hashes, including all columns; values below are identical at all three checkpoints.

| Table | Rows | Checksum |
| --- | ---: | --- |
| projects | 5 | `68572651e9747427f8aa144a7c969393` |
| tasks | 16 | `7c260a4336420fe7cce80e2f49f05989` |
| milestones | 7 | `53f7cb15281a162923a81e09fef1949e` |
| plans | 2 | `a7ff64e456ef6d318913b1a5614fd37b` |
| workspace_time_blocks | 9 | `5f5759b64783c206e55efd07db31d78f` |

## Evidence and commands

Screenshots and responsive metrics below are local acceptance evidence, intentionally excluded from the release commit. Links resolve in the acceptance workspace only.

Local command/SQL logs are retained in ignored `.superpowers/phase4a-rollout/`: migration history, dry runs, exact rehearsal/security SQL, apply output and final check logs. Tests used the existing PGlite runtime via `PGLITE_MODULE_PATH`, with `node --test lib/ai/agent/phase4a*.test.mjs` and the repository-wide discovered `*.test.mjs` files.

Screenshots for each requested width: `rollout/list-{width}.png`, `rollout/pending-{width}.png`, `rollout/conflict-{width}.png`.

- [Final authenticated Activity](rollout/final-1440.png)
- [Pending controls at 320px](rollout/pending-320.png)
- [Apply outcome](rollout/apply-result.png)
- [Cancel outcome](rollout/cancel-result.png)
- [Review composer](rollout/review-composer.png)

![Pending Activity at 320px](rollout/pending-320.png)
