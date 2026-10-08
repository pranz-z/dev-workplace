# Workspace Agent Phase 2 report

Implementation-time report below. The migration was subsequently reviewed, corrected to enforce run/action owner equality, applied to production, and live-tested on October 9, 2026. See [rollout and live acceptance](workspace-agent-phase2-live-acceptance.md) for current deployment state and verification evidence.

1. **Architecture:** Existing read tools remain intact. Two native Gemini proposal tools collect validated drafts without mutating tasks. After the model loop succeeds, only runs containing proposals persist a private canonical batch. Separate authenticated approval handlers load stored actions and invoke deterministic SQL. Gemini has no Apply tool or approval-handler dependency.

2. **Files changed:**
   - `app/api/ai/agent/route.ts`: persist successful proposal batches; preserve authentication/quota/lease behavior.
   - `app/api/ai/agent/apply/route.ts`: Apply POST and persisted-status recovery GET.
   - `app/api/ai/agent/cancel/route.ts`: Cancel POST.
   - `lib/ai/agent/contract.ts`: proposal/action contracts and ten-action cap.
   - `lib/ai/agent/proposal-schema.ts`: strict task field/ID/date validation and native proposal declarations.
   - `lib/ai/agent/proposals.ts`: authoritative before-state, parent checks, grouping and display diffs.
   - `lib/ai/agent/store.ts`: narrow persistence/application RPC calls.
   - `lib/ai/agent/action-route.ts`: authenticated approval/status orchestration, anti-abuse and safe errors.
   - `lib/ai/agent/request.ts`: existing bounded JSON parser extracted for approval reuse.
   - `lib/ai/agent/executor.ts`, `gemini.ts`, `prompt.ts`: proposal dispatch, native declarations, pending-approval policy and answer style.
   - `lib/ai/agent/format.ts`: client-safe Agent-only text normalization.
   - `components/ai/AgentProposalCards.tsx`: selectable structured proposals, Apply/Cancel and per-action state.
   - `components/ai/WorkspaceAiChat.tsx`: proposal cards per response, normalized Agent answers, bounded conversation-only history.
   - `app/app/page.tsx`: refresh task state through existing listTasks after successful application.
   - `lib/ai/agent/phase2.test.mjs`, `phase2-database.test.mjs`: new tests.
   - `lib/ai/agent/agent.test.mjs`: adapt two Phase 1 expectations for approval policy and extra proposal declarations while retaining twelve-read-tool assertions.
   - `supabase/migrations/20261008152535_workspace_agent_task_proposals.sql`: new migration.
   - `docs/superpowers/plans/2026-10-08-workspace-agent-phase2.md` and this report.

3. **Proposal tools:** `propose_create_task` and `propose_update_task`. No delete, SQL, generic mutation, Apply, project/plan/milestone mutation or integration-write tool exists.

4. **Persistence:** Private `agent_runs`, `agent_actions` and `agent_action_limits`. Actions contain canonical patches, bounded DB-derived before-state, reviewed diffs, expected task version and operational status/timestamps. Updates for the same task merge into one action. Read requests persist no runs. Raw prompts and model thoughts are not stored.

5. **Migration:** New CLI-generated migration `20261008152535_workspace_agent_task_proposals.sql`. It adds constraints, indexes, private-table RLS, restrictive grants and five service-only public RPCs. Existing migrations were not edited. It was applied only to disposable PostgreSQL test engines, never a linked/production database.

6. **Apply:** `POST /api/ai/agent/apply` accepts only `{ runId, actionIds }`. The route authenticates, rejects cross-origin requests, consumes an independent persistent action limit, acquires the existing private AI lease and loads owner-scoped canonical data. Each selected action calls `apply_agent_task_action`; there is no Gemini call or client-supplied patch. `GET /api/ai/agent/apply?runId=...` recovers persisted status after uncertain transport outcomes.

7. **Stale-state protection:** SQL locks the action and task, compares task.updated_at with expected_updated_at and persists conflict without updating the task if they differ. Workspace mutation and applied audit status commit together per action. An injected audit failure test confirms task updates roll back if audit recording fails.

8. **Ownership:** Session-derived user ID only. Generation verifies task and parent project ownership, plus milestone/project association. Apply rechecks project ownership under a share lock, task owner/project under an update lock and milestone association under a share lock. Private records and RPCs are inaccessible to anon/authenticated callers directly. Even service_role cannot directly read private audit tables; it uses narrow RPCs.

9. **Create-task behavior:** No task insertion during proposal generation. Apply inserts the exact canonical title/fields, applies existing Backlog/Medium/empty-description defaults, chooses max sort_order + 1 in the project/status, and sets completed_at when creating Completed tasks. Repeated Apply cannot create duplicates.

10. **Update-task behavior:** Only title, description, status, priority, dueDate and milestoneId. Empty/unsupported/invalid patches are rejected during generation and independently revalidated in SQL at Apply. Status transitions preserve the existing completed_at invariant; unrelated updates preserve the completion timestamp. Date-only values are stored at UTC midnight so existing Calendar date-only interpretation is preserved regardless of database timezone. Null clears due date or milestone.

11. **Batch behavior:** Actions execute sequentially and independently; the whole batch is not atomic. The response reports per-action applied/conflict/failed/pending status and reloads canonical state. One conflict does not invalidate successful independent actions. Transport uncertainty is not falsely persisted as failure; status recovery/idempotency make retries safe.

12. **Cancel:** `POST /api/ai/agent/cancel` accepts stored run/action IDs and cancels pending actions only. UI Cancel selects all remaining pending actions in that batch. Applied actions stay applied. Cancelled actions remain in audit records and cannot be reactivated or applied.

13. **Answer formatting:** Dedicated Agent instructions request concise plain language, human-readable dates, short paragraphs and a few bullets without excessive emphasis/headings. Agent-only normalization removes paired bold markers and Markdown heading/list syntax while protecting fenced/inline code. Chat formatting is unchanged. For proposal responses, the server uses a canonical pending-approval sentence so a model cannot falsely describe its proposals as already applied.

14. **Example:**

   Before: `The **\`dev-workplace\`** project needs attention. 1. **Priority**: Critical.`

   After:

   > The dev-workplace project needs attention.
   >
   > • Priority: Critical.
   >
   > Handle the overdue task first.

15. **UI:** Selectable cards show task titles and server-built before/after diffs, human-readable dates and milestone names. Apply selected prevents duplicate clicks and shows Applying. Per-action states and batch feedback show success/conflict/failure/cancellation. Review again populates a fresh-review prompt without sending it. Task state refreshes after successful Apply. No forced overwrite. Browser transcript history excludes proposal payloads when sent to Agent.

16. **Limits:** Ten actions per run, consistent with the existing ten total tool calls and six model rounds. Existing request/output/read-scan/timeout and partial-result bounds remain. Apply/Cancel/status recovery share a separate persistent 30 requests per minute per user; they do not charge Gemini quota. The existing private AI lease prevents overlapping user operations. Before-state title/description excerpts are bounded and visibly ellipsized when truncated.

17. **Privacy/security review:** No credential fields, raw prompts, hidden reasoning or unrelated private files are persisted/sent. Workspace text remains untrusted data. All task SQL is static with explicit allowed columns. Stored payloads cannot be edited by the browser. Approval SQL revalidates fields and ownership inside locks. Pending checks plus atomic audit updates prevent duplicate execution and Cancel/Apply races. User-facing errors omit database/provider details. No auth/RLS weakening, Public AI changes, Drive OAuth changes or GitHub permission changes.

18. **Tests added:** Fifteen Phase 2 unit/route/loop tests and two migration/database tests. Coverage combines schema rejection, authoritative DB values, grouping/caps, ownership/milestones, draft-only generation, private persistence, Apply input/CSRF/auth/quota/lease controls, per-action outcomes, Cancel, style/code preservation and injection framing. Real PostgreSQL assertions cover private grants, duplicate creation/update, cancellation, stale completed tasks, rechecked ownership, tampered payload rejection, completion/reopening, nullable fields, UTC dates, task ordering, mixed outcomes, audit rollback and persistent anti-abuse limits. Gemini responses remain mocked.

19. **Phase 2 result:** 17 passed with `AGENT_TEST_PGLITE_MODULE` pointing to a temporary PGlite installation outside the repository. No application dependency changes. The database test follows existing optional-module test conventions and skips its engine case when that variable is absent.

20. **Phase 1 result:** 21 passed. Twelve read tools, native function-response/signature behavior, bounds, auth/quota/lease and Calendar semantics remain covered.

21. **Regressions:** Private AI, Public AI, task-list/Kanban and Calendar checks passed. Focused validation had 116 passes, zero failures. No dedicated taskService test harness existed; new SQL tests verify the task mutation semantics and completion invariant directly. Existing Chat API/attachments/context, Public AI, Drive and GitHub source paths were not changed.

22. **Full suite:** 210 total; 208 passed, two existing optional portfolio CMS tests skipped, zero failures. This run included the real disposable PostgreSQL Agent test. The two skips require the existing optional portfolio PGlite/esbuild environment variables.

23. **TypeScript:** `npx tsc --noEmit` passed. A temporary browser-preview route initially left a stale generated dev type after deletion; regenerating Next dev types resolved it. No product source workaround or generated type edit was needed.

24. **ESLint:** All changed TS/TSX and Agent test files passed changed-file ESLint.

25. **Build:** `npm run build` passed with Agent, Apply and Cancel endpoints. Temporary preview routes are removed. No deployment.

26. **Diff/browser:** `git diff --check` passed. Chromium checked 1440, 1024, 768, 390 and 320 widths with no page/panel horizontal overflow or page errors. The real panel used mocked Gemini/browser transport backed by disposable PostgreSQL running this migration. Read/no-proposal, clean formatting, selection, unchanged tasks before Apply, persisted Cancel, Apply + refresh callback, preserved manual completion on stale conflict, creation only after Apply, unsupported deletion and unchanged Chat formatting passed. Temporary preview source was deleted and its dev server stopped.

27. **Migration rollout:** Review the new SQL and confirm the intended linked Supabase project. Run `npx supabase db push --linked --skip-vault --dry-run` and inspect the pending migration list. If it contains only the intended changes, an authorized operator can apply with `npx supabase db push --linked --skip-vault`. Apply the migration before releasing Phase 2 app code; proposal/approval RPCs require it. Verify the service-only RPC grants and run authenticated create/update/cancel/stale smoke checks in staging before production release. These rollout commands were not executed; only CLI help and local migration creation were used.

28. **Known limitations:** No live Gemini request or production/linked Supabase mutation was performed. Natural-language interpretation/model refusal quality remains unverified live. Database tests use a disposable minimal workspace schema and the real new migration, not a full linked Supabase instance. Batches are deliberately not atomic across actions. Existing read scan truncation remains explicit. Audit records are durable, but a browsable audit-history/reload restoration UI is outside this phase; recovery requires the run ID. Long before descriptions/titles are excerpts. Proposal changes larger than the preserved tool/action budget fail safely rather than updating an unbounded workspace. Activity is not streamed per tool.

29. **Phase 3 handoff:** Roll out the migration and verify authenticated live proposal/approval flows first. Then separately scope history/recovery UX and audit retention. Any expansion beyond task create/update should keep stored canonical proposals, explicit user approval, ownership/version revalidation and narrow deterministic mutation paths. Task deletion and other entity/integration writes remain unsupported. No commit, push, deployment or production environment change was made.
