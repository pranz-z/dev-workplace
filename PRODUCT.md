# Developer Workplace — product contract

Implemented local redesign contract, updated 2026-10-27. This describes the accepted Phase 1–6 implementation and Phase 7 handoff; it is not a deployment or later-phase authorization.

## Authority and current work

- Source base: `0e2997da8de0076c33c2bc074ed35741524e784d`, branch `codex/full-site-redesign`.
- Approved plans: `C:/webprac/redesign-baseline/redesign-stage-a-plan.md`, `redesign-stage-b-plan.md` and `phase-0a-authorization-and-phase-blocks.md`. User amendments override earlier draft language.
- Phases 0a–6 are accepted in the isolated local worktree, with the user’s visual review still pending. Phase 7 integrates fresh evidence and handoff. No commits or deployments have been performed.
- Only this clean redesign worktree is a valid base. `C:/webprac/software-workplace` is FROZEN LEGACY WORKTREE; do not copy, stage, stash, clean, reset or use its dirty work.
- Section 27, AI skill assignment: **PENDING SKILLS**. This assignment-plan section is unused; no supplied skill assignment was executed. Local UI/UX and web guidance informs review only.

## Purpose and audiences

Developer Workplace combines a public developer portfolio with a private personal workspace for managing projects, daily work and progress. The public experience helps a visitor evaluate work and reach a case study, resume or contact action. The private experience helps the owner choose and carry out the next useful action across projects.

Prospective collaborators, employers and clients are working public-audience assumptions, not conclusions from user research. The primary workspace audience is its authenticated owner. Do not invent testimonials, impact metrics or biographical claims to support the redesign.

## Product modes

### Public portfolio

Public home presents identity, selected projects, About, Experience, Skills, Education and Contact, with resume access. Case studies present explicitly shared project information and permitted media/links. Public AI is an optional public-context assistant; it cannot access private workspace data. A project must remain understandable without AI or hover playback.

Keep existing route families, legacy redirects, anchors, links and publication semantics. Public resume access remains distinct from the code-disabled private Resume view. Current production content remains factual authority for eventual implementation; synthetic fixtures are evidence inputs only.

### Private workspace

Enabled destinations: Dashboard, Today, Projects, Tasks, Plans, Files, Accountability, Calendar, Notes, Tech Stack, Portfolio, GitHub and Settings. Existing account/profile, search, open-document/project tabs, focus mode/session controls and create/edit overlays are part of the working experience.

Learning, Applications, private Resume and Freelance are **PRESERVED (code-disabled)** through `unavailableViews`. Do not activate, remove or redesign them as working destinations.

The implemented navigation groups are presentation only; destination identities and backend scope are unchanged:

| Group | Existing destinations |
|---|---|
| Work | Dashboard, Today, Projects, Tasks, Calendar |
| Planning and review | Plans, Notes, Tech Stack, Accountability |
| Publishing and connections | Portfolio, Files, GitHub |
| Personal settings | Settings and existing account/profile access |

The shell implements these four groups in labeled/compact navigation and its drawer. At widths below1280, context opens through its own drawer and AI uses a bounded modal. At700 and below, Dashboard, Projects, Tasks, Calendar and More form the bottom navigation. Focus mode restores the prior panels. Existing URL/history behavior, integration callback query parameters and view state remain; no route/deep-link system was added.

### Workspace AI and Agent

Chat, Agent, Activity, Inbox and Settings have separate purposes. Preserve explicit context, proposal/review/apply distinctions, consent and scope, cancellation and existing validation. Keep Public AI and Workspace AI data paths separate.

Inbox loads when its existing parent condition mounts it and ACKs exact unseen displayed content revisions after render. Do not make it always mounted, auto-select it, or change ACK semantics for styling or captures. Phase 0a accepted evidence uses the actual component with synthetic identity and in-memory ACK; no live observations are touched. Later Inbox redesign requires that isolation and lifecycle evidence to remain valid.

## Primary jobs and capability contracts

| Area | Owner/visitor job | Capability to preserve |
|---|---|---|
| Dashboard/Today | Choose next work and inspect attention needs | Existing calculations, dates, actions and source status |
| Projects | Compare/filter projects, then work on selected detail | Grid/List/Kanban, all actions, selection and history |
| Project detail | Edit and inspect one project | Overview, Workflow, Tasks, Milestones, Screenshots, GitHub; public controls and media |
| Tasks | Execute across projects or by date | List/Kanban/Today/Upcoming, seven statuses, filters, ordering and edits |
| Calendar/focus | See dates/time blocks and run a focus session | Timezone/date logic, preferences, pause/resume/end and restoration |
| Plans/Notes/Tech Stack | Maintain supporting plans and reference | Existing fields, associations and editing behavior |
| Accountability | Review progress and explicit limited public summary | Private review data and publication boundary |
| Files/Drive | Browse private files and associate uploads | Project/task association, folders, list/grid, search limits, removal semantics |
| GitHub | Authorize repository access and inspect/import/link explicitly | Separate sign-in/repository grants and existing operation guards |
| Portfolio editor | Control public content and preview it | Editing versus saving/publishing distinctions |
| Settings/account | Manage preferences and identity | Existing saved defaults, theme choice, sign-out and consent behavior |

Project collection is the compare/filter surface. The approved future layout makes selected detail primary with a compact switcher and clear collection return. It must retain mode/filter/selection/history and every existing action. Retain all New Project fields even if grouped progressively. Long descriptions and optional settings must not bury all tab content.

## Data, ownership and integrations

- Supabase Auth is authenticated identity; valid configured authenticated data comes from Supabase. Never silently substitute demo/seed/localStorage data.
- Preserve ownership/RLS, server-only credentials and internal UUID relationships across projects, tasks, milestones, plans, notes and technologies.
- Demo/unauthenticated behavior stays explicit and separate. Test identities, fixtures, bundle aliases and memory responses belong only in `tests/redesign/`, never shipped runtime.
- GitHub sign-in does not authorize repository access. Preserve install/grant/link/import/write boundaries.
- Drive content remains private. Removing a workspace reference must not imply deleting its Drive contents.
- Preserve the committed project-video architecture: private storage/delivery, signed URL expiry, owner operations, size/type validation, enable/public projection, replacement/removal, eligibility/fallback and CSP. No stale preview patch or storage redesign.

## Publication and protected behavior

Public pages and Public AI use only explicitly public projections. Private tasks, reports, observations, notes, repository activity and other owner records must not leak into a public redesign. Visibility and public-accountability choices remain explicit.

Preserve Gate I: mode/cadence/settings revisions, checks consent, AI consent, project scope, observations/unseen revisions, budgets/usage, scheduler, provider reservations and lifecycle. No live ACK/provider/settings/scheduler request is part of design evidence. No backend schema, policy, API, environment or integration grant changes are implied by visual approval.

## Evidence and acceptance

Historical production-audit screenshots at `C:/webprac/redesign-baseline/` have no1024 baseline. The original **local Phase0b** manifest has210 core BEFORE frames at1440×1000,1024×768,768×1024,390×844 and320×844, both themes. Original anonymous/preview addendum evidence is separately identified. These sources must not be confused.

Phase7 evidence lives outside the repo at `C:/webprac/redesign-baseline/phase-7/`. The comparison manifest identifies original Phase0b frames, supplemental BEFORE renders rebuilt from the exact Git HEAD/Phase0b source and original stylesheet, and genuinely unpaired states. A previous phase’s BEFORE is not relabeled as Phase0b. All AFTER measurements are fresh on final source; there is no carried measurement masquerading as a new measurement. Fixtures retain their declared data, clock/timezone and local assets. Supplemental old-source navigation may activate an existing handler programmatically where the old rail is clipped; this is render evidence, not a successful old keyboard/pointer journey.

The full86-file suite runs in fresh external HEAD and final-source snapshots with no env files/credentials and blocked outbound network. The observed28 pre-existing failures are27 retained-local-PostgreSQL prerequisites and one CMS CSS/esbuild output-path failure; the Phase7 report records exact introduced/pre-existing results and final build separately. Do not equate a fixture pass with a hosted integration pass.

### Implemented experience

- Projects: compare/filter collection, primary detail, compact switcher/back preserving the prior mode/query/status/history, compact pre-tab information, six existing tabs and all actions. The editor starts with Title, Status and Next action; all12 fields remain in essentials/optional groups and validation reveals invalid groups. Screenshot captions have usable width.
- Tasks: List, Kanban, Today and Upcoming remain. Board overflow is contained, orientation controls remain visible, and keyboard/click reordering uses the existing ordering behavior. Mixed-project boards explain why ordering is disabled.
- Daily work: Dashboard puts Next tasks/attention before counts; Today, Calendar, focus sessions, time blocks, Plans, Notes, Tech Stack, Accountability and Settings retain their calculations, meanings, timezone and persistence behavior.
- Files/GitHub: project navigation, Drive folders, current results and location are distinguished; upload association and removal-versus-delete are explicit. Repository authorization stays separate from sign-in; existing import selection/confirmation remains.
- Workspace AI: existing Chat, Agent, Activity, Settings, Brief and real Inbox presentation share operational typography and state styling. This was CSS presentation; protected AI effects/state/service calls and consent copy were not rewritten. Further structural AI regrouping is deferred.
- Public: factual hero/body, signature headings/underline, one code illustration, media/text featured cards, existing no-cover fallback, case studies, supporting sections, resume and optional public concierge. No achievements, metrics, testimonials or logos were invented. Public concierge disclosure uses14px Geist and public-only context. Existing drawing-pad interaction remains.

### Open gaps and verification boundaries

Physical devices and browser-native media controls, screen-reader announcement quality, zoom/platform-specific behavior, real user media, signed URL expiry/CSP delivery, real provider consent/scope flows and hosted preview behavior remain manual checks. The harness replaces transport and Next router boundaries and is not a live full-stack routing/deployment certification. Existing PostgreSQL and CMS harness prerequisites/failures remain separate from redesign defects. User visual acceptance of comparison frames is pending. See the Phase7 gap/exception ledgers, report and recommended manual checks for current evidence and limits.

## Non-goals and phase authority

No new features, auth flow, integration provider, data store, migration, route system or broad refactor. No reactivation of disabled views. No factual-copy replacement or new claims. No commits, deployment, production requests, credentials/.env.local/.auth use or hosted mutation. Phase7 authorizes evidence, handoff docs and fixes limited to defects the redesign introduced. New features, new visual direction or later work require separate authorization.

Use DESIGN.md for the approved visual/interaction contract. Use the external phase blocks for objective/scope/files/must-not-change/validation/done boundaries. Stop for review at the end of the authorized phase.
