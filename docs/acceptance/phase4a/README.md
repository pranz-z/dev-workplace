# Phase 4A implementation and acceptance report

Historical implementation report. The production migration and subsequent live acceptance are recorded in the [43-point rollout report](rollout.md); its rollout status supersedes the pre-rollout statements below.

Date: 2026-10-12. Branch: `codex/workspace-agent-phase4a`. Base: `a7c6f54`.

1. **Architecture.** Existing private proposal audit records feed service-only read RPCs, an authenticated GET route, a safe server projection, and Workspace AI Activity. Approval remains in the existing canonical backend.

2. **Files changed.** Product additions: `supabase/migrations/20261012090000_workspace_agent_activity.sql`, `data/agentActivity.ts`, `lib/ai/agent/activity.ts`, `app/api/ai/agent/activity/route.ts`, `components/ai/AgentActivity.tsx`. Integrations: `components/ai/WorkspaceAiChat.tsx`, `components/calendar/WorkspaceCalendar.tsx`, `app/app/page.tsx`. Five `lib/ai/agent/phase4a*.test.mjs` files, the implementation plan, this report, and local screenshots were added. Existing Phase 3B evidence was preserved.

3. **Audit fields reused.** Runs: id, user_id, created_at, completed_at. Actions: id, run_id, user_id, action_type, entity_id, project_id, title, payload, before_state, diff, expected_updated_at, status, created_at, approved_at, executed_at, error_code. Canonical payload/before state remain internal; Activity reads safe projected fields.

4. **Database change.** One additive migration is necessary because audit tables deny direct service-role access and the existing recovery RPC requires a known run ID. It adds a private projection helper and two service-only read RPCs. No columns, tables, indexes, browser grants, prompt storage, history rewrites, or production migration. Applied Phase 2/3A/3B migration SHA256 hashes are unchanged.

5. **Read service.** `listAgentRuns` calls `list_agent_activity`; `getAgentRun` calls `get_agent_activity_run`. `/api/ai/agent/activity` authenticates first, derives the owner server-side, validates filters/run IDs, rejects cross-site reads, and returns no-store responses. It exports GET only and calls no Gemini or mutation service.

6. **Run projection.** ID, created/completed timestamps, counts, action count, primary action label, readable status and summary. Mixed outcomes remain explicit; pending takes precedence. Empty legacy runs remain readable.

7. **Action projection.** Known action label, entity label, safe diff fields, status, timestamps, whitelisted error code, owned navigation target, and optional Review again text. No raw payload, before_state object, hidden reasoning, or raw error is returned by Activity.

8. **Activity UI.** Workspace AI has an Activity entry alongside Chat and Agent. Compact chronological groups, dates, statuses and loaded counts fit the existing workspace panel. The UI explains that original requests are not stored.

9. **Run detail.** Shows action summaries, field changes, creation/decision/execution times, safe conflict/failure reasons, entity links and recovery controls. Raw JSON is not displayed.

10. **Filters.** All/pending/applied/cancelled/conflict/failed, plus Today/7 days/30 days/All dates. Date windows use the supplied profile timezone and half-open boundaries. Search is deferred.

11. **Counts.** Counts aggregate actions in loaded runs and are explicitly labelled “Loaded runs.” They are not global totals or productivity scores. A status filter selects runs containing that status; details preserve all outcomes in each selected run.

12. **Navigation.** Tasks, projects and milestones reuse app editors/openers. Time blocks select their persisted local date in Calendar and open the existing editor. A handled Calendar request is consumed and cleared, preventing save/reload/remount from reopening it. Existing owned milestone labels now resolve milestone diffs.

13. **Pending recovery.** Opening a pending run reads the existing GET Apply recovery endpoint, then renders unchanged AgentProposalCards. Closing/reopening Activity or refreshing reloads database-backed history. Old pending actions are never silently cancelled or applied.

14. **Transport loss.** Existing cards recover with GET after an uncertain POST. Activity refreshes canonical status after decisions. No action is replayed merely to discover status. Tests verify one Apply POST followed by recovery GET.

15. **Review again.** Failed/conflicted details use the existing action-aware builder and owner-resolved task/project names. The callback fills Agent composer without submitting. Time-block creation reviews preserve date/duration and avoid UUID leakage. Old action types use the existing readable builder or safe fallback.

16. **Old records.** Task create/update, milestone/project dates, block create/update/cancel, mixed outcomes, empty runs and unknown action types have coverage. Unknown types use “Historical action” and no navigation. There is no requirement for newly stored prompt text.

17. **Deleted entities.** Owner-scoped entity reads return a non-navigable “Item no longer exists” state. Uncreated proposals remain distinct. Unknown actions have no fabricated navigation.

18. **Security.** Audit tables remain private. PUBLIC/anon/authenticated cannot execute the new RPCs. service_role can execute only the public read entry points and still cannot directly select/update audit tables. Run/action owner checks apply inside SQL. Entity resolution uses the authenticated client and owner filters, including milestone project ownership. Apply/Cancel still receive stored identifiers and revalidate canonical records through unchanged code.

19. **Pagination/performance.** Page size defaults to 20, maximum 30. Ordering is created_at and UUID descending; cursors preserve microsecond precision. Queries use existing owner/created and run/action indexes; list projection aggregates only returned runs. Selective status filters can traverse additional indexed owner history to find matches. No unbounded result set or client-side full-history download.

20. **Retention.** No deletion policy or extra prompt retention. Existing proposal history will grow; monitor indexed query cost and table size before deciding on retention/archive policy. Any retention decision needs separate product approval.

21. **Tests added.** 32 focused checks across database, domain/service, route, canonical card recovery, and review regressions. PostgreSQL tests use disposable local PGlite. Route/card tests stub transport/dependencies; UI wiring tests include source checks. Three review bugs were reproduced failing, then fixed and passed.

22. **Phase 4A result.** 32 passed, zero failed/skipped with the existing PGlite runtime enabled.

23. **Phase 3B regression.** Existing scheduling, ownership, overlap exclusion, preferences, canonical actions, references and review tests pass in the full suite. No scheduling/deadline mutation code changed.

24. **Phase 3A regression.** Existing date-scheduling and disposable PostgreSQL safety tests pass. Applied migration unchanged.

25. **Phase 2 regression.** Existing proposal/approval/cancel/idempotency/stale-state tests pass, including preservation within Phase 3A database tests. Canonical cards/backend unchanged.

26. **Phase 1 regression.** Existing read-only Agent/private AI tests pass. No new tools or Gemini mutation permissions. Chat, Public AI, Drive and GitHub implementation paths were not changed.

27. **Full suite.** `node --test` over repository `*test.mjs` files: 344 tests, 342 passed, zero failed, 2 existing optional CMS database/browser skips. Private/Public AI, Calendar, Focus and shell checks pass. The optional CMS live harnesses were not configured for this task.

28. **TypeScript.** `npx tsc --noEmit` passes. Production build TypeScript also passes.

29. **ESLint.** Changed TypeScript/TSX/test files pass ESLint with zero warnings/errors. Initial effect-state diagnostics were fixed using cancellable async synchronization following existing Calendar style.

30. **Build.** `npm run build` passes on Next.js 16.3.6. Temporary acceptance route was removed before build. The build includes the authenticated Activity route.

31. **Diff.** `git diff --check` passes for tracked changes. New text files also checked for whitespace errors. No applied migration changes, generated/config/dependency edits, commit, push, deployment, or production DB changes.

32. **Browser/responsive.** Isolated local fixture rendered the real Activity and canonical cards. Mixed history, applied/cancelled/conflict/failed/pending details, task/project/Calendar callback targets, safe Review again, pending reload, Apply, Cancel, status refresh and simulated lost Apply response were exercised. At 1440/1024/768/390/320 viewports, document client/scroll widths matched: 1425/1425, 1009/1009, 753/753, 375/375, 305/305. Screenshots are in `screenshots/`. Titles/status/actions wrapped without horizontal document overflow. Fixture auth warning/dev badge came from intentionally blocked external auth requests. Browser tab and viewport override were cleaned up. The temporary route was removed. Final review fixes have targeted automated regression coverage; viewport screenshots precede those fixes.

33. **Limitations.** No hosted/production acceptance or real authenticated history navigation was performed. Browser navigation proof checks callbacks; app wiring and server ownership have separate tests. Fixture reload recreated its pending records; it does not prove hosted persistence after an applied action. Disposable DB and canonical recovery tests provide the persistence/status evidence. Read-only chats produce no saved run; original requests cannot be reconstructed. Search, global summary totals, automatic retention and undo are absent by design. Pre-existing account-switch lifetime of onAgentApplied was not changed; Workspace AI remains keyed/gated by authenticated workspace owner and Activity reads abort on unmount.

34. **Rollout readiness.** Implementation and local gates pass after the fresh review fixes. Ready for a separately authorized rollout step, including additive migration application and authenticated acceptance. Not deployed or production-signed-off. No production migration, commit, push or deployment was performed.

35. **Phase 4B.** Start with narrowly defined inverse proposals for reversible actions. Require canonical current-state/version checks, ownership/link validation, explicit approval and durable audit linkage. Do not implement arbitrary rollback, snapshot restoration or automatic retries.

## Review and execution decisions

- Existing checkout/new feature branch preserves user evidence; no worktree copy or commit. Cost: uncommitted changes remain local.
- One approved read-RPC migration preserves private tables. Cost: rollout depends on applying it separately.
- Production checks were excluded by explicit user instruction. Cost: hosted grants/data remain unverified.
- Browser acceptance used an isolated fixture. Cost: authenticated app integration still needs rollout acceptance.
- Existing account-switch callback lifetime remains outside this change; keyed owner UI and canonical endpoint authentication remain enforced. Cost: that pre-existing callback lifetime has no new end-to-end test.
- Search, retention, original prompts and undo follow approved exclusions. Cost: those capabilities remain unavailable.
- Scratch ledger/evidence are retained while changes are uncommitted. Cost: local disk use; no Git history exists to replace them.

No deferred minor review findings. All three Important findings were fixed with failing-then-passing tests; full suite remains green.
