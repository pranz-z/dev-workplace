# Developer Workplace — Agent Instructions

## Project

Developer Workplace is a personal developer workspace and portfolio for project and task management, planning, notes, progress tracking, public project sharing, and GitHub integration.

The app uses Next.js, TypeScript, React, Supabase, PostgreSQL, and Supabase Auth. GitHub authentication and GitHub repository authorization are separate concerns.

## Working principles

- Make the smallest correct change that fulfills the request.
- Follow the repository’s existing patterns and architecture.
- Keep work within the requested task or phase.
- Avoid unrelated refactors, redesigns, renames, dependencies, abstractions, and future work.
- Do not replace working systems without evidence that they cause the problem.
- Do not guess when the repository can answer the question.

## Before changing code

For non-trivial work:

1. Inspect the relevant instructions, code, schema, and tests.
2. Trace the actual execution and data path.
3. Identify the smallest set of changes needed.
4. Briefly state the plan, then implement it.

For debugging, follow the failure to its root cause and fix that cause. Avoid speculative fixes. Ask a question only when missing information blocks a sound implementation.

## Scope

Implement only what the user requested. If an unrelated issue is discovered, report it; fix it only if it blocks the requested work or the user asks.

Do not commit, deploy, change production settings, or perform other external side effects unless requested.

## Data and security boundaries

- Supabase is the source of truth for authenticated workspace data when valid Supabase configuration is present.
- Do not silently substitute mock data, seeded prototype data, localStorage, or hardcoded records for authenticated data.
- Keep demo data in a clearly separate, explicit demo or unauthenticated mode. Do not mix demo and authenticated entities.
- Preserve the app’s existing ownership model, RLS policies, and public/private data boundaries.
- Keep service-role credentials and other secrets on the server. Never expose them to browser code.
- Public pages and Public AI may use only data explicitly made public. Keep them separate from private workspace data and Workspace AI.
- Supabase Auth identifies the user. GitHub repository authorization remains a separate concern; do not treat sign-in as repository access authorization.
- Use existing internal UUID relationships for database entities, including projects, tasks, milestones, plans, notes, and technologies.

## Next.js guidance

Before writing code that uses Next.js APIs or conventions, read the relevant guide under `node_modules/next/dist/docs/`, resolved from this file’s directory. In a monorepo, locate the installed `next` package first. Follow the installed version’s documentation and deprecation notices.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Verification and reporting

- Run the relevant checks defined by the repository, such as focused tests, lint, type checks, or build.
- Fix failures caused by the change; report unrelated failures separately.
- In the final response, summarize what changed, what checks passed or failed, and any remaining limitations.

@RTK.md
