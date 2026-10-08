# Workspace Agent Phase 1 Implementation Plan

**Goal:** Add authenticated, read-only Gemini tool calling to the existing Workspace AI panel.

**Architecture:** Separate `/api/ai/agent` endpoint and server-only `lib/ai/agent` modules. Reuse private authentication, persistent quota, concurrency lease, Gemini configuration, and Calendar normalization. Send only requested bounded projections to Gemini.

**Tech Stack:** Existing Next.js, TypeScript, React, Supabase and @google/genai.

- [x] Add mocked regression tests for strict schemas, twelve allowlisted tools, ownership, Calendar behavior, result bounds and native tool loop.
- [x] Implement contract, registry/schema validation, read projections and bounded database scans. Reject unknown fields, invalid UUIDs/dates and unowned parents. Report truncation explicitly.
- [x] Implement native Gemini conversation loop preserving model parts/signatures and function IDs, six rounds, ten calls, bounded outputs and a shared 50-second deadline.
- [x] Add authenticated endpoint using existing quota/lease controls and safe errors. Resolve profile timezone using Calendar's existing precedence over browser timezone.
- [x] Add Chat/Agent selector, separate histories, natural-language quick prompts, read-only status and compact activity. Keep Chat attachments and explicit context behavior.
- [x] Run Agent, private/public AI and Calendar tests, full tests, TypeScript, changed-file ESLint, build and diff checks. Exercise browser UI with mocks where possible and report exact limitations.

No commits, deployment, schema changes, workspace mutations or external integration changes.
