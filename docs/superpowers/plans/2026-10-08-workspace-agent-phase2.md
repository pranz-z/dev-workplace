# Workspace Agent Phase 2 implementation plan

**Goal:** Persist task creation/update proposals, require explicit Apply/Cancel, and improve Agent text presentation.

**Architecture:** Preserve the twelve read tools and their loop budgets. Add two proposal tools with strict schemas and server-read before state, grouping patches per task. Persist a completed proposal batch only when the model loop succeeds; read-only requests persist nothing. Store operational records in private tables behind service-only RPCs. Apply retrieves canonical proposals, validates them again, and uses a narrow static SQL RPC that locks each action/task, checks ownership/version, mutates the task and records its result together. Cancel changes only pending audit records. Apply/Cancel use a separate persistent 30/minute counter, not Gemini quota.

**Decisions:** Ten actions maximum (matching the existing total tool-call budget). Selected actions supported. Per-action results; each action is atomic, independent actions can have mixed outcomes. No raw prompt text or model reasoning stored. Existing task status/priority/date/completion and ordering rules preserved. Agent-specific text cleanup protects code blocks/inline code. No production database operations, commit, push or deploy.

- [x] Add proposal validation, grouping, formatting and endpoint regression tests before implementation.
- [x] Implement contracts, proposal schemas, before-state construction and durable persistence. Integrate proposal dispatch without changing read executor behavior.
- [x] Add new migration with private run/action/counter tables, narrow service-only persistence/read/apply/cancel RPCs, validation, locks and grants. Test on disposable PostgreSQL.
- [x] Implement authenticated Apply/Cancel and recovery GET using canonical stored IDs, revalidation and per-action outcomes. No Gemini dependency in approval handlers.
- [x] Add selectable proposal cards, Apply/Cancel/conflict feedback, workspace refresh callback and clean Agent-only answer rendering.
- [x] Run Phase 2/Phase 1/private/public/task/calendar and database tests, full suite, TypeScript, ESLint, build and diff checks. Browser-check mocked flows and all five requested widths.
- [x] Document results, migration rollout, limits and Phase 3 handoff.
