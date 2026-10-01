# AGENTS.md

# Developer Workplace — Agent Instructions

## Project Overview

Developer Workplace is a personal productivity, project-management, and public portfolio application built specifically for a software / AI developer.

The application combines:

- private developer workspace
- project tracking
- task management
- Kanban workflows
- milestones
- plans and checklists
- notes
- technologies
- progress tracking
- public project sharing
- portfolio presentation
- GitHub integration
- future developer accountability features

The product should feel like a creative developer notebook/workspace rather than a generic enterprise dashboard.

The application currently uses:

- Next.js
- TypeScript
- React
- Supabase
- PostgreSQL
- Supabase Auth
- GitHub OAuth for authentication

GitHub repository integration is a separate architectural concern from GitHub authentication.

---

# Core Engineering Philosophy

Be pragmatic, surgical, and outcome-focused.

Default to the smallest correct change that solves the requested problem.

Do not widen scope unless explicitly requested.

Do not:

- refactor unrelated code
- rename unrelated files
- reorganize the project unnecessarily
- introduce speculative abstractions
- rewrite working systems
- redesign working UI
- add dependencies without a concrete need
- implement future phases without permission

Prefer modifying existing architecture over replacing it.

Preserve existing conventions unless they are directly responsible for the problem being solved.

---

# Before Making Changes

For non-trivial work:

1. Identify the requested objective.
2. Inspect the relevant implementation.
3. Trace the actual execution/data path.
4. Identify the smallest required change points.
5. Briefly state the implementation plan.
6. Then make the changes.

Do not guess about architecture when the repository can be inspected.

When debugging:

- reproduce or trace the actual failure
- start from concrete evidence
- follow the execution path
- identify the root cause
- fix the root cause instead of masking symptoms

Do not make speculative fixes.

---

# Scope Discipline

Work only on the phase or task explicitly requested.

If asked to implement Phase 3A, do not begin:

- Phase 3B
- accountability scoring
- GitHub webhooks
- CI monitoring
- GitHub write operations
- unrelated portfolio work
- unrelated UI cleanup

Stop when the requested phase is complete.

If you discover an unrelated issue:

- mention it in the final report
- do not fix it unless it blocks the requested work

---

# Existing Application Architecture

The application has three important data/security boundaries.

## Authentication

Supabase Auth is responsible for user authentication.

GitHub OAuth through Supabase currently answers:

> Who is the user?

It must not automatically be treated as the permanent authorization system for GitHub repository access.

Authentication and GitHub repository authorization are separate concerns.

---

# Supabase Rules

For authenticated users with valid Supabase configuration:

> Supabase is the source of truth for workspace data.

Authenticated workspace data must NOT silently fall back to:

- mock data
- seeded prototype data
- localStorage
- hardcoded records

Prototype/demo data may exist only in a clearly separate unauthenticated or explicit demo mode.

Never mix mock entities with authenticated Supabase entities.

---

# Database Identity Rules

Internal database relationships use UUIDs.

Example:

```text
project.id
task.id
milestone.id
plan.id
note.id
technology.id