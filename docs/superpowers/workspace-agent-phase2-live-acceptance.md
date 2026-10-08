# Workspace Agent Phase 2 — rollout and live acceptance

Completed October 9, 2026 (Asia/Manila). Acceptance used the local Phase 2 application, the real Gemini API, and the linked production Supabase database. The hosted application was not deployed or tested with Phase 2 code.

1. **Linked project:** `peokrukgprzbmathrurv`, DevWorkplace, ACTIVE_HEALTHY. Verified both the CLI link file and project API before mutation. The application's public Supabase target also matched.

2. **Migration review:** Passed after one pre-application correction. Added `UNIQUE (id, user_id)` on runs and a composite action `(run_id, user_id)` foreign key, so an action owner cannot differ from its run owner. Added focused disposable-database assertions for the owner constraint and invalid status values. No applied migration was edited. Proposal persistence inserts only operational Agent records; task writes occur only in the Apply RPC. There is no arbitrary SQL/generic mutation RPC, client-authoritative patch, persisted reasoning, or credential field. All SECURITY DEFINER functions set an empty search path and use qualified tables. Browser roles cannot invoke privileged RPCs. No changes were made to Public AI, Drive, GitHub, portfolio, authentication settings, or existing task/project schema.

3. **Before push:** All 16 existing local migration versions matched remote history. Only `20261008152535` was local-only. There were no unknown remote versions or divergent entries.

4. **Dry run:** `npx supabase db push --linked --skip-vault --dry-run` listed exactly:
   - `20261008152535_workspace_agent_task_proposals.sql`
   - No seeds or role files.
   The same result was rechecked after the owner-constraint correction and before application.

5. **Apply:** `npx supabase db push --linked --skip-vault` successfully applied that migration only. The first connection attempt terminated before applying anything; history and the dry run were rechecked before the successful retry. No reset, history repair, seed replay, Vault update, or manual production workspace-row mutation was used.

6. **After push:** Migration list showed `20261008152535` in both local and remote columns. All versions matched.

7. **Post-push dry run:** `upToDate: true`, `migrations: []`, `seeds: []`, `roles: []`.

8. **Production RLS/grants/schema:** Verified all three private tables, seven indexes, primary/foreign keys, owner composite relationship, payload/diff bounds, action-type/status checks, and limiter bounds. All three tables have RLS enabled with no browser policies. Anon, authenticated, and service_role have no direct table SELECT/INSERT/UPDATE/DELETE privileges. The five public Agent RPCs grant execution to service_role only. Production catalog assertions verified safe search paths and role permissions. Security advisors reported no privileged Agent RPC exposed to browser roles. Informational private-table "RLS enabled, no policy" notices are intentional. Existing public-projection function warnings and the existing leaked-password protection warning were reported without changing configuration; see advisory notes below.

9. **Rollback-only security/isolation acceptance:** All requested checks passed in one explicit BEGIN/ROLLBACK transaction using synthetic users/project/task. No synthetic records committed:
   - Anon and authenticated private reads failed; authenticated privileged Apply execution failed. Catalog checks covered every privileged RPC and all three tables.
   - Service-role RPC path saved an owner-scoped batch.
   - User B could not retrieve, cancel, or apply user A's action.
   - Mismatched run/action owner failed the composite foreign key.
   - Invalid status value failed its check constraint; terminal actions remained terminal through the RPC paths.
   - Applied update was idempotent, with an unchanged row on retry.
   - Cancelled create could not execute.
   - Limiter allowed requests 1–30 and denied request 31.
   - Saving update/create proposals left task rows/count unchanged.
   - Unsupported canonical fields failed validation.
   Follow-up queries confirmed zero synthetic security-test users, runs, actions, or limiter records.

10. **Existing workspace integrity:** Exact before/after-migration counts and full-row checksums matched:

    | Entity | Count | Before and immediately after migration |
    | --- | ---: | --- |
    | Projects | 5 | `cd805f86d14c69f6ae462fc513b45602` |
    | Tasks | 13 | `9172f6dbb3700feec1b48ea9a0b83b87` |
    | Milestones | 7 | `b0e37e4da6e12bca6188450d49da2174` |
    | Plans | 2 | `09bf94a278d5d74faadb0d6ea7960ad3` |

    Live acceptance subsequently changed one existing task's due date, then restored it through the normal task editor. Its original full-row checksum `c374d29dd78bdfe52f84b828203a71d3` matches after substituting only the captured original `updated_at` for comparison. The database timestamp itself was not reset. After deleting the temporary task, the entire task-table checksum also matches the original after this one timestamp normalization. Other entity checksums remain exactly unchanged.

11. **Live read (A):** Real Gemini called `list_overdue_tasks`. Answer: "You have one overdue task: gmail in the dev-workplace project, which was due on October 7, 2026." Grounded against production data. Zero proposal runs and no task mutation. No raw bold markers.

12. **Update proposal (B):** "Move ai agent at devplace to tomorrow." Real Gemini requested `propose_update_task`. Canonical proposal showed October 15 → October 10, 2026, using the current local reference day, October 9. The server read authoritative state/version. Production row checksum remained `c374d29dd78bdfe52f84b828203a71d3`. The answer explicitly said it was prepared, pending approval, and nothing had changed.

13. **Cancel (C):** UI Cancel persisted `cancelled`. The task checksum stayed identical. A temporary browser acceptance page replayed the normal authenticated Apply endpoint with that stored run/action ID; HTTP 200 returned `cancelled`, with no mutation.

14. **Update + Apply (D):** Generated a fresh proposal; verified the same unchanged checksum before Apply. UI Apply changed only the reviewed due date to October 10. Production action became `applied` and the task timestamp advanced. Dashboard/Kanban refreshed to show October 10. The network trace showed canonical load, deterministic Apply RPC, refreshed batch, and lease release, with no Gemini traffic. Restored October 15 through the normal editor afterward.

15. **Repeat Apply (E):** Normal authenticated endpoint replay returned HTTP 200 / `applied`. The post-Apply task checksum `efe4b926b8426b7994f4c7b01ca91bd8` and updated timestamp were unchanged on retry.

16. **Create task (F):** First real Gemini proposal for "Agent Phase 2 Live Test" under dev-workplace inserted no task. Cancelled it and confirmed task count zero. Regenerated, verified zero tasks before Apply, then applied. Exactly one task was created under project `92f94afa-cfda-4142-8a37-c02faadbaea5`, with Backlog/Medium defaults, empty description, and null date/milestone. Replaying Apply created no duplicate. The temporary task was later deleted through the normal Tasks list UI.

17. **Stale-state conflict (G):** Real proposal requested Backlog → In Progress on the temporary task. Before approval, changed it to Completed through the normal task editor. Production `updated_at` no longer matched the proposal. Apply persisted `conflict` / `STALE_TASK`. Completed, completion timestamp, and the full manual-edit checksum `29a5e90f4b48907bc4e392bf4bddd1e4` remained unchanged. UI displayed conflict and Review again, with no force overwrite.

18. **Multi-action selection (H):** The first title-only request while the temporary task was Completed produced only one action for the other task; cancelled that partial proposal. Reopened the temporary task through normal UI and retried in a fresh conversation with both task IDs. Real Gemini produced one batch with two canonical actions for October 16. Unchecked the existing task, applied only the temporary task, and verified production statuses `applied` / `pending`. The existing task stayed October 15. Cancelled the remaining pending action and verified `applied` / `cancelled`. No pending actions remained. The initial partial model result is a limitation: review the actual action list, especially for completed or ambiguous targets; natural-language requests are not guaranteed to produce every intended action.

19. **Unsupported deletion (I):** Real response: "Task deletion is not enabled yet, so I cannot delete completed tasks for you." No deletion tool, proposal, or workspace mutation.

20. **Formatting (J) / Chat regression:** Real attention answer: "The project dev-workplace needs the most attention. It carries a critical priority level and currently has an overdue task in its backlog." Concise, grounded, no raw **, excessive heading, or backticks. Proposal dates were readable. Separate real Chat formatting request retained `**Formatting check**` and its existing bullet text behavior. Chat context/attachment controls remained present. Agent normalization did not affect Chat.

21. **Apply network contract:** Temporary server instrumentation observed the parsed browser request keys exactly `["runId", "actionIds"]`, operation `apply`. No task patch, before state, user ID, ownership, or current state was sent as authority. The server loaded stored actions. Endpoint replays also exercised the ordinary authenticated route rather than bypassing it.

22. **Cancel network contract:** The same instrumentation observed exactly `["runId", "actionIds"]`, operation `cancel`. The RPC identified persisted records and could only cancel pending actions.

23. **No Gemini during Apply/Cancel/recovery:** Temporary server fetch instrumentation recorded real outbound service names, paths, statuses, function-call names, and JSON key names without body values or credential headers. Gemini traffic occurred during generation. Apply/Cancel sequences used Supabase RPCs only. A final recovery GET plus Apply and Cancel replays, after all generation completed, produced zero Gemini requests. Recovery returned HTTP 200 and persisted applied status. Static approval-handler imports also have no Gemini dependency. Across the acceptance requests there were 33 real model calls for 10 Agent prompts and one small Chat prompt; no Gemini mocking was used.

24. **Privacy:** Every observed Gemini body had zero matches against configured credential/token/secret values checked in memory. Logs stored only metadata and never credential values or authorization headers. Source tracing confirmed only prompts, bounded conversation history, declared tool schemas, timezone/date, and owner-scoped projected tool data enter Gemini; Supabase clients/session tokens, integration credentials, environment objects, and Agent RPC internals do not. The stored audit schema and sampled live batches contained operational canonical payload/before/diff/version/status/timestamps, not model reasoning, raw prompts, API credentials, or unrelated context. Native Gemini thought signatures are used only in the transient tool loop and are not persisted.

25. **Cleanup:** Zero temporary users/projects/tasks/proposals/actions remain. The security transaction rolled back. The temporary task was deleted through normal UI. After verifying outcomes, removed only the seven known acceptance run IDs (eight actions) with count guards, terminal-state guards, and cascade cleanup. No workspace row was manually deleted/updated through SQL. The genuine action anti-abuse row and standard private AI quota usage remain, preserving rate-limit accounting. Temporary replay page, request log instrumentation, credential launcher, observer script, and metadata log were removed. Local server and browser tabs were stopped/closed. No test authentication bypass, environment-file change, or production setting change remains.

26. **Tests:** Full suite rerun after the pre-application fix and again after removing instrumentation: 210 tests, 208 passed, two existing optional portfolio CMS skips, zero failures. Includes 21 Phase 1 tests, 17 Phase 2 tests, private/public AI, task list/Kanban, and Calendar regressions. The real production rollback-only security suite also passed. Disposable PostgreSQL exercised the corrected migration with `AGENT_TEST_PGLITE_MODULE` pointing to the existing temporary test dependency outside the repository.

27. **TypeScript:** Final `npx tsc --noEmit` passed after removing temporary source.

28. **ESLint:** Final changed-file ESLint passed for Agent routes, workspace page, WorkspaceAiChat, AgentProposalCards, and `lib/ai/agent`.

29. **Build:** Final `npm run build` passed with the temporary acceptance route absent.

30. **Git diff:** Final `git diff --check` passed. No commit, push, or deployment was performed. Permanent changes during rollout are the pre-application owner constraint, its focused regression assertions, and acceptance documentation.

31. **Defects / environment findings:** Fixed missing database enforcement of run/action owner equality before applying. The local `.env.local` lacked `SUPABASE_SERVICE_ROLE_KEY`; initial read attempts failed before Gemini. Loaded the existing project key through the authenticated CLI directly into the temporary server process without printing/saving it or changing configuration. Normal local development still requires that server configuration to be supplied by the operator. One transient CLI DB connection failed before migration; confirmed unchanged history, then retried successfully. One completed-target multi-action generation returned a partial batch; no unsafe write occurred, and the explicit two-active-task acceptance passed. No application-code fix was needed from live testing.

32. **Ready to commit/push/deploy:** Yes, with the documented model limitation and normal server configuration requirement. Production migration is applied and live core flows passed. Existing hosted server credentials/configuration must remain valid when releasing the application. This run did not inspect or modify hosted deployment environment values and did not deploy Phase 2 application code.

33. **Phase 3:** Safe to begin separate planning/development while preserving the approval, ownership, version, privacy, and deterministic-write boundaries. Release Phase 2 application code and smoke-test the hosted authenticated path before treating its production rollout as finished. This acceptance does not authorize Phase 3 scope or broader mutations.

## Advisory notes

Supabase's private-table [RLS enabled without policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is intentional for these inaccessible operational tables. Existing [anonymous SECURITY DEFINER notices](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [authenticated SECURITY DEFINER notices](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) refer to pre-existing public portfolio projections, not the new service-only Agent RPCs. The existing [leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains unchanged.
