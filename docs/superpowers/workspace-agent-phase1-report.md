# Workspace Agent Phase 1 report

1. **Architecture:** A separate authenticated, server-only read Agent runs beside existing Chat. Chat's API, attachment processing and explicit-context implementation remain unchanged.

2. **Files changed:**
   - `app/api/ai/agent/route.ts`: authentication, persistent quota, lease, bounded JSON input, profile timezone and response handling.
   - `lib/ai/agent/contract.ts`: client-safe request/response types and limits.
   - `lib/ai/agent/registry.ts`: twelve native function declarations.
   - `lib/ai/agent/schemas.ts`: strict runtime request/tool validation using existing Calendar date and timezone validation.
   - `lib/ai/agent/tools.ts`: fixed read projections, explicit ownership and bounded scans.
   - `lib/ai/agent/executor.ts`: sequential tool loop, budget enforcement and activity summaries.
   - `lib/ai/agent/gemini.ts`: existing Gemini configuration and native SDK calls.
   - `lib/ai/agent/prompt.ts`: dedicated read-only instruction and injection protections.
   - `lib/ai/agent/agent.test.mjs`: 21 mocked tests.
   - `lib/ai/errors.ts`: safe inspection-limit error.
   - `components/ai/WorkspaceAiChat.tsx`: mode selector, separate histories, quick prompts and activity.
   - `docs/superpowers/plans/2026-10-08-workspace-agent.md` and this report: implementation/handoff documentation.

   Pre-existing changes to AGENTS.md, CLAUDE.md, RTK.md, .codex and .rtk were preserved.

3. **Endpoint:** `POST /api/ai/agent`, JSON `{ message, history?, timeZone }`; responds `{ answer, toolActivity }`. Responses and errors use `Cache-Control: no-store`.

4. **Tool catalog:** `list_projects`, `get_project`, `list_tasks`, `get_task`, `list_overdue_tasks`, `list_tasks_due_between`, `list_unscheduled_tasks`, `list_milestones`, `list_plans`, `get_plan`, `get_calendar_summary`, `list_calendar_items`.

5. **Ownership:** Server authentication supplies the user ID. Projects, tasks and plans explicitly filter by user_id. Tasks also inner-join their project and check project ownership; milestones check their project's user_id through an inner join. A supplied project UUID is verified before child reads. Project technologies and plan checklists are read only after owned parent verification. RLS remains in effect through the authenticated server client.

6. **Gemini flow:** Native function declarations are passed to @google/genai. Model parts and thought signatures are preserved internally; validated function calls execute sequentially on the server. Function responses preserve call IDs and label returned records as untrusted data. Only the final answer and bounded activity are returned to the browser; thought parts are excluded.

7. **Limits:** Six model rounds, ten total tool calls, a shared 50-second abort signal for body/model/data reads, and a 60-second route runtime. JSON body cap: 32,000 bytes. History/message bounds reuse Chat parsing. Lists default to 20 and cap at 50. Scans cap at 1,000 owned rows per entity type, using 200-row pages plus an overflow probe. Descriptions, technologies and checklist items are bounded. Tool response JSON caps at 60,000 characters; final answers cap at 6,000 characters and model output at 1,800 tokens. Budget exhaustion returns a safe error.

8. **Context minimization:** Initial model input contains the bounded conversation plus validated timezone/reference date, with no workspace dump. Workspace reads occur only after tool selection. Fixed projections exclude credentials, integration metadata and unrelated file content. List/detail reads return explicit summaries. Calendar tools alone read all three relevant entity projections.

9. **UI:** Existing panel includes Chat/Agent selection, independent transcripts, five quick prompts that populate the composer, an explicit read-only/privacy notice, a generic inspection status during requests and a compact expandable activity section after completion. Chat keeps its attachment and context controls. Agent has no workspace write controls. No production mock or preview route remains.

10. **Quota/concurrency:** Each request consumes one existing persistent private AI quota and acquires the existing private AI lease. Internal tools consume no additional public quota. Lease cleanup runs in finally after success or failure. Shared primitives and database functions were reused unchanged.

11. **Injection/privacy:** The dedicated instruction treats workspace records, notes, files, GitHub/Drive content and tool output as reference data; embedded instructions cannot authorize tools. There are no write, SQL, arbitrary-table or arbitrary-REST tools. Unknown names and extra fields are rejected. Database/provider details are normalized to safe errors. No prompt, result, token or private-record logging was added. Read-only enforcement rests on the tool boundary; model wording remains a model behavior.

12. **Database/schema:** No migration, table, policy, setting or environment change. No workspace mutations. Existing quota/lease bookkeeping is the only database write path used by the endpoint.

13. **Tests added:** Request/schema validation, UUID/date rejection, registry allowlist, project/task/plan and parent ownership, task filters, overdue/unscheduled/date ranges, completion/project filtering, Calendar event types/counts/date-only/timezone behavior, bounded projections/scans, secret exclusion, native declarations/function responses/signature preservation, sequential calls, aggregate and round limits, malformed/blocked/provider responses, cancellation, injection framing, auth/config/quota/lease failures, bounded body parsing and lease cleanup.

14. **Agent tests:** `node --test lib/ai/agent/agent.test.mjs`: 21 passed. Gemini and database reads were mocked; no live Gemini calls.

15. **Private AI regression:** `lib/ai/*.test.mjs` passed, including existing Chat attachment/context, persistent quota and concurrency coverage.

16. **Public AI regression:** `lib/public-ai/*.test.mjs` and public concierge tests passed. Public AI implementation was untouched.

17. **Full suite:** All repository `*.test.mjs` files outside marketing/node_modules: 193 total, 191 passed, 2 skipped, 0 failed. Existing portfolio CMS database/browser integration tests skip because their optional PGlite/esbuild module environment variables are absent.

18. **TypeScript:** `npx tsc --noEmit` passed.

19. **ESLint:** Changed TS/TSX and Agent test files passed. A test variable named module initially triggered the Next.js lint rule; it was renamed and ESLint rerun successfully.

20. **Build:** `npm run build` passed with `/api/ai/agent` in the output. The final build excludes the temporary browser preview.

21. **Diff/browser checks:** `git diff --check` passed. Headless Chromium exercised the real panel in a temporary local preview with intercepted Chat/Agent responses. Widths 1440, 1024, 768, 390 and 320 had no document or panel horizontal overflow. Mode selection, quick prompts, loading, answer/activity display, separate histories, Chat attachment controls, refusal rendering and absence of write controls passed with no page errors. The temporary preview was deleted and its dev server stopped.

22. **Known limitations:** Live Gemini answer quality, live refusal wording and live Supabase/RLS queries were not exercised. The browser check validates mocked refusal rendering, not a live model's behavior. Large workspaces can produce partial scans/counts; results carry explicit truncation/scope metadata and the instruction requires disclosure. No pagination continuation is implemented. Activity during requests is generic rather than streamed per tool. Auth and lease acquisition retain the existing primitives' network behavior; the shared abort signal covers the new body/model/data operations. No attachments are sent in Agent mode.

23. **Phase 2 handoff:** Verify live authenticated reads and model behavior first. Any later workspace writes should use separately designed proposals, explicit approval, revalidated ownership and auditability; keep this read registry independent. No Phase 2 write behavior was implemented. No commit or deployment was performed.
