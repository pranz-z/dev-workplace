# Phase 3B — 37-point implementation report

2026-10-11 · Local branch `codex/workspace-agent-phase3b` · Uncommitted, undeployed.

1. **Architecture:** Shared scheduling domain, owner-scoped Supabase services, Calendar/settings UI, canonical private Agent proposals and dedicated SQL Apply RPC. Gemini selects intent/tools and explains server results.
2. **Files:** New `data/timeBlocks.ts`, `timeBlockService.ts` and tests; Calendar editor/preferences; Agent `time-block-schema.ts`, `time-blocks.ts` and Phase 3B tests; migration, plan and evidence. Updated Calendar/app, Agent cards/chat/contracts/tools/proposals/store/prompt/context/summary, focus helper/tests and domain/database types. Phase 1/2 catalog assertions updated for additive tools. Applied migrations unchanged.
3. **Schema:** UUID owner/block identity; optional internal project/task links; title, timestamptz start/end, kind, status, notes and versions. Composite FKs enforce owned relationships. Entity deletion unlinks historical blocks and stamps versions.
4. **Preferences:** Working weekdays, local start/end, default focus duration and buffer only. Suggested values remain unsaved until Save. Missing settings require clarification or an explicit window.
5. **Timezone:** Reuses `profiles.time_zone`; UTC instants displayed locally. User wall times reject DST gaps/folds. Generated day boundaries tolerate midnight transitions; Havana/Santiago regressions pass.
6. **Calendar:** Bounded visible-grid reads, month labels, selected-day agenda, local times/statuses, entity links and editing. Deadlines retain separate date-only semantics.
7. **Manual CRUD:** Owner-scoped create/edit/complete/soft-cancel, range validation, overlap errors and optimistic version checks. Refresh reloads persisted blocks.
8. **Overlap:** GiST exclusion on owner and half-open timestamp range; cancelled blocks excluded, completed blocks occupy time, adjacency allowed. Actual database constraint tested in PGlite. PostgreSQL documents this guarantee in [range constraints](https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT). No race-prone SELECT fallback.
9. **Free time:** Server computes work window, clips elapsed time, merges buffered occupancy and allocates duration-sized candidates. Reads include neighboring-day buffers. Ten returned candidates maximum, with truncation metadata; excessive occupancy fails closed.
10. **Read tools:** `list_time_blocks`, `get_day_schedule`, `find_free_time`; owner-scoped, bounded, timezone/preferences/deadline context. Deadline caps disclose omissions.
11. **Proposal tools:** Create/update/cancel block plus `propose_plan_day` and `propose_find_time`. Strict fields/local wall times; server derives owned links, before values and versions. Generation does not mutate workspace entities.
12. **Apply:** Browser sends stored IDs only. Server reloads canonical actions and validates owner/version/links/payload/range/exclusion. Mutation and applied audit outcome share a SQL subtransaction. Apply/Cancel do not call Gemini.
13. **Staleness:** Row locks/version checks and exclusion protect against changed entities/availability. Applied/conflict/failed outcomes stay distinct; repeated Apply is idempotent. Existing reload/review-again recovery retained.
14. **Plan my day:** Server filters completed tasks and ranks urgency, task priority, earliest task/milestone/project deadline, project priority, then stable ID. Verified allocation proposes at most six blocks within existing batch limits; omissions disclosed. Deadlines and existing blocks are not moved.
15. **Find time:** Owned incomplete task plus explicit/saved duration and verified availability. Missing settings request clarification; no fitting slot creates no action.
16. **Durations:** Blocks greater than zero and at most twelve hours; default focus 1–180 minutes, buffer 0–120. Explicit planning duration supported; absent duration is not invented.
17. **Focus:** Explicit Start focus reuses existing timer state for scheduled task-linked blocks; bounded remaining duration, maximum 180 minutes, never beyond block end. Active/expired guards; no automatic entity completion.
18. **Agent UI:** Local start/end diffs, readable action/entity labels, existing approval states and conflict recovery. Cancelling a proposal differs from cancelling a persisted block.
19. **Settings:** Minimal preferences form in settings/Calendar; existing timezone reused. Load/save errors surfaced.
20. **Audit:** Existing private action store extended. Forced audit failure proves workspace rollback. Mixed time-block outcomes tested; a mixed legacy/time-block batch was not separately exercised.
21. **Migration:** `supabase/migrations/20261011090000_workspace_agent_time_blocks.sql`. Additive schema/indexes/triggers/RLS/action RPC. Executed only against disposable local PGlite.
22. **Security:** Owner SELECT/INSERT/UPDATE RLS; no authenticated DELETE privilege. Owned composite links, immutable owner, private audit tables and service-only Apply RPC. No Public AI access or arbitrary SQL tool added.
23. **Performance:** Owner/start/end, project/task/status indexes plus GiST. Bounded reads, candidate results and action batches. No dependency or external calendar service added.
24. **Tests:** Domain/timezone/DST/ranking/buffers, owner services, strict tools/canonical proposals, database exclusion/RLS/link/deletion/version/audit, and focus handoff edges. Review fixes received failing regressions first. Browser acceptance covers UI instead of a new component harness.
25. **Phase 3B:** Domain/service/Agent/database suites: **37 passed, zero failures/skips**, PGlite enabled.
26. **Phase 3A:** Agent and database suites: **19 passed**.
27. **Phase 2:** Agent and database suites: **17 passed**.
28. **Phase 1:** `agent.test.mjs`: **21 passed**.
29. **Full suite:** All discovered repository `.test.mjs` files: **267 total, 265 passed, zero failed, two optional CMS skips** (database/browser). Private/Public AI, Calendar, entities, GitHub/Drive and focus regressions included.
30. **TypeScript:** `npx tsc --noEmit` passed after review fixes.
31. **ESLint:** All changed/new TypeScript/TSX/MJS files passed after review fixes.
32. **Build:** `npm run build` passed after review fixes. Temporary acceptance routes removed.
33. **Diff:** `git diff --check` passed. Applied Phase 2/3A migrations unchanged. Local validation logs retained under ignored `.superpowers/sdd/2026-10-11-workspace-agent-phase3b/`.
34. **Browser:** Local actual Calendar/editor/cards with mock authenticated transport, disposable PGlite and deterministic model responses. Exercised saved preferences, manual CRUD/overlap, explicit focus, Find 90 minutes, Plan my day, no pre-Apply mutation, Apply persistence, changed-availability conflict, proposal Cancel and refresh. Agent/editor had no document overflow at 1440/1024/768/390/320 pixels. Evidence: [Calendar](calendar-1440.png), [Agent](agent-320.png), [editor](editor-320.png), [metrics](responsive.json). Final review fixes received automated regression/build validation, not another browser pass.
35. **Limitations:** No live production Supabase/Gemini acceptance. PGlite runs one backend: parallel submitted inserts are not a genuine two-connection race test. Two optional CMS suites unavailable. Bounded results disclose omissions. One independent review found five P2 issues; all fixed in one pass, no second review.
36. **Rollout:** Review diff/migration; stage against production-compatible PostgreSQL; confirm btree_gist availability/extension schema and column-specific FK SET NULL support; apply via reviewed staging migration process; run real two-connection overlap and authenticated acceptance; deploy matching app and live-verify. Production migration/deployment needs separate authorization. None performed here.
37. **Next phase:** Stage and live-verify Phase 3B before expanding capabilities. Recurrence, external calendar sync and autonomous writes remain outside scope.

## Validation commands

```powershell
# Existing local disposable PGlite installation supplied via AGENT_TEST_PGLITE_MODULE.
node --test data/timeBlocks.test.mjs data/timeBlockService.test.mjs lib/ai/agent/phase3b.test.mjs lib/ai/agent/phase3b-database.test.mjs
node --test lib/ai/agent/phase3a.test.mjs lib/ai/agent/phase3a-database.test.mjs
node --test lib/ai/agent/phase2.test.mjs lib/ai/agent/phase2-database.test.mjs
node --test lib/ai/agent/agent.test.mjs
$allTests = @(rg --files -g '*.test.mjs' -g '!node_modules' -g '!marketing')
node --test $allTests
npx tsc --noEmit
$changed = @(git diff --name-only --diff-filter=ACM; git ls-files --others --exclude-standard) | Where-Object { $_ -match '\.(ts|tsx|mjs)$' }
npx eslint $changed
npm run build
git diff --check
```
