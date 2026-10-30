PHASE5D ONE-SHOT PROACTIVE AUTHORIZATION

DESIGN APPROVED WITH AMENDMENTS.

You are now authorized to IMPLEMENT and locally validate the proposed one-shot
authorization architecture.

This authorization is for CODE + MIGRATION + TESTS + OWNER UI only.

It does NOT authorize:

- Production migration
- Production deployment
- live one-shot authorization
- AI consent
- persistent AI scope
- provider reservation
- live Gemini
- manual Pulse
- scheduler replay
- Gate I execution

==================================================
APPROVED CORE ARCHITECTURE
==================================================

Approve:

1. Independent server-side one-shot authorization capability.

2. Persistent AI consent may remain false.

3. Persistent project scope may remain empty.

4. Exact binding to:

   owner
   project
   observation
   contentRevision
   episode/family where required
   source token
   context fingerprint/policy
   natural scheduler slot
   provider
   exact model
   maximum provider requests = 1

5. Fresh-dispatch-only admission capability.

6. Unpredictable single-use credential:

   - plaintext returned only by the initial fresh claim
   - only hash stored
   - never logged
   - never returned by replay/recovery/API/UI
   - bound to authorization + Pulse
   - required for one-shot consumption

7. Exact-candidate provider context.

8. No normal candidate ranking/top-three context during one-shot execution.

9. Existing provider accounting/budget/advisory machinery reused rather than
   duplicated.

10. Accepted-idea provenance for one-shot outputs.

11. Project-linked signal families only for v1:

   - deadline
   - important_work
   - quiet_project

12. Workspace-wide observations that cannot truthfully bind to one project must
   be rejected for one-shot authorization.

13. One effective pending authorization per owner.

14. No new scheduler/Cron/provider implementation.

15. Existing HMAC/service authority limitation remains documented rather than
   falsely claiming stronger provenance.

==================================================
AMENDMENT 1 — NEXT NATURAL SLOT ONLY
==================================================

For v1, do NOT allow selection of an arbitrary future natural slot.

Authorization creation may target only the NEXT applicable natural scheduler
boundary under the currently deployed four-hour schedule.

The server must validate that the proposed slot:

- is in the future
- is aligned to the canonical natural four-hour schedule
- is the next allowed natural boundary for this authorization flow
- is strictly before parent evidence expiry
- is compatible with current canonical owner scheduling state

Do not trust browser slot arithmetic.

Build/validate canonical slot server-side.

If current owner scheduling state means the apparent next boundary is already
past or otherwise ambiguous:

reject preview/creation and require refresh.

Do not silently select a later slot.

==================================================
AMENDMENT 2 — EXPIRY
==================================================

Execution expiry must be:

MIN(
  parent.evidenceValidUntil,
  authorizedNaturalSlot + 600 seconds
)

The parent evidence expiry always dominates.

The authorization must not be consumable:

before its exact natural slot

or

after its effective execution expiry.

The 600-second window is authorization execution tolerance only.

It does NOT convert another natural slot into an authorized slot.

==================================================
AMENDMENT 3 — CONSUMED IS IN-FLIGHT
==================================================

State model may use:

pending
consumed
completed
blocked
expired
cancelled
failed

but define:

consumed = irreversible in-flight state

NOT terminal success.

Once consumed:

- request allowance is spent
- authorization can never return to pending
- duplicate worker cannot send
- failure does not refund permission
- lost response does not permit resend

Then transition truthfully to:

completed

failed

or

blocked

as appropriate.

If a worker disappears after consumption:

bounded maintenance may terminalize the abandoned attempt according to the
approved timeout/evidence rules.

It must NEVER reopen it.

==================================================
AMENDMENT 4 — NO NORMAL-AI FALLTHROUGH
==================================================

If a Pulse has a matching one-shot authorization attempt:

the one-shot path owns proactive-AI admission for that Pulse.

If the one-shot becomes:

blocked

expired

model-mismatched

parent-invalid

budget-blocked

transport-failed

output-rejected

or otherwise unsuccessful

DO NOT fall through to normal persistent-consent candidate ranking.

DO NOT choose another parent.

DO NOT send another request.

One-shot attempt means:

zero or one provider request for that Pulse.

==================================================
AMENDMENT 5 — PROVIDER ACCOUNTING LANGUAGE
==================================================

The product/audit UI must distinguish:

AUTHORIZATION PENDING

ALLOWANCE CONSUMED / RESERVED

SEND ATTEMPTED

TRANSPORT CONFIRMED

TRANSPORT UNKNOWN

PROVIDER RESPONSE RECEIVED

OUTPUT ACCEPTED

OUTPUT REJECTED

PUBLICATION COMPLETED

Do not report:

"one Gemini request sent"

merely because an authorization became consumed.

Existing uncertainty semantics remain authoritative.

A lost reservation response must result in:

NO RESEND.

A physical transport failure may remain uncertain when the infrastructure
cannot prove whether bytes reached the provider.

==================================================
DATABASE
==================================================

Implement one new immutable self-contained migration after the current verified
main migration head.

Do NOT edit:

20261015132608_workspace_agent_pulse

or any other applied migration.

Before choosing the migration timestamp/name:

verify current origin/main again

and rediscover the actual latest migration.

==================================================
IMPLEMENTATION BASE
==================================================

IMPORTANT:

Do NOT build from the stale Phase5D reconciliation checkout HEAD.

Before editing:

1. fetch origin
2. verify current origin/main
3. create/use a clean feature branch/worktree from exact current main
4. record HEAD and clean status
5. confirm relevant Agent source identity

Suggested branch:

codex/phase5d-one-shot-authorization

Do not copy dirty files from older worktrees.

==================================================
DATABASE CAPABILITY
==================================================

Implement the proposed private authorization storage and transition controls.

Use repository naming conventions after inspecting current migrations.

Properties:

- RLS enabled
- no browser direct table mutation
- HTTP derives owner from authenticated session
- browser cannot choose owner identity
- browser cannot submit provider facts/context payload
- browser cannot override model
- browser cannot override max requests
- immutable authorization identity
- legal transition enforcement
- atomic consumption
- no reusable consumed grant
- no authorization transfer between project/parent/revision/slot

Maximum requests for v1:

exactly 1.

==================================================
RESOURCE REFERENCES
==================================================

Do not introduce restrictive foreign keys that would break:

memory clear

observation deletion

project deletion

existing retention/accounting behavior.

Use immutable identity/audit references plus transactional existence/authority
checks where appropriate.

Pending authorizations must be invalidated correctly when referenced source
state disappears.

Consumed accounting must remain truthful.

==================================================
CREATION FLOW
==================================================

Implement:

read-only candidate preview

explicit confirmed authorization creation

read-only authorization status

pending authorization cancellation.

Browser may submit only narrow identifiers and expected preview identity.

Server must rebuild canonical:

owner

project

observation

revision

family

source token

minimized facts

provider/model

slot

evidence expiry.

Reject stale/tampered previews.

No authorization row exists before explicit owner confirmation.

==================================================
PERSISTENT CONSENT INDEPENDENCE
==================================================

One-shot creation and execution must work while:

mode=workspace

checks consent=checks-v1

AI consent=false

persistent scope=[].

DO NOT temporarily enable broad AI consent.

DO NOT insert fake consent into ProactiveSettings.

Normal proactive behavior remains unchanged when no one-shot exists.

==================================================
EXACT PROVIDER CONTEXT
==================================================

Provider context must contain exactly ONE authorized parent.

No:

top-three observations

siblings

fallback signal

unrelated project

notes

files

Drive

GitHub

code

excluded descriptions/objectives

credentials.

Reuse the existing minimized canonical serializer where safe.

Separate:

normal admission/ranking

from

shared minimized serialization.

Tests must inspect exact provider bytes.

==================================================
FRESH-DISPATCH CREDENTIAL
==================================================

Implement the proposed fresh-only capability credential.

Requirements:

- cryptographically unpredictable
- single use
- plaintext available only to the original fresh dispatch worker
- hash stored
- authorization + newly-created Pulse bound
- never logged
- never persisted as plaintext
- never exposed through API/UI
- unavailable from replay/recovery

Consumption additionally checks:

slot
fence
lease
authorization
parent
revision
credential

and existing safety/budget predicates.

Replay must not be able to reconstruct the credential from:

Pulse ID
dispatch event
slot
fence
nonce
authorization ID.

==================================================
MODEL BINDING
==================================================

Preview records expected configured provider/model.

Creation reloads it.

Execution reloads it.

If current configured model differs materially:

BLOCK.

No fallback.

No automatic reauthorization.

Do not accept browser-supplied model override.

==================================================
BUDGETS
==================================================

All existing budgets remain mandatory.

One-shot authorization is permission, not capacity.

Retain:

owner request cap

installation cap

idea cap

parent attempts

retry policy

owner Pulse cap

lease/fence rules.

==================================================
ADVISORY OUTPUT
==================================================

Reuse existing advisory validator.

No automatic execution.

Successful output may create only the existing owner-review idea/proposal
artifact.

Do not alter Apply/Cancel authority.

==================================================
ACCEPTED IDEA PROVENANCE
==================================================

Implement one-shot publication provenance so a successfully accepted advisory
remains safely viewable even though persistent AI consent remains false.

Do NOT globally bypass consent checks.

Only ideas produced through a canonically consumed one-shot authorization may
use the alternate provenance rule.

Safe projection must continue checking:

ownership

parent/source integrity

existing stale/unavailable/output policies

and accepted one-shot provenance.

Execution-window expiry must not erase an already accepted advisory result.

==================================================
ACK SAFETY
==================================================

One-shot preview/create/status/cancel must not:

mount Inbox

ACK parent

change seenContentRevision

change contentRevision.

Keep the control inside the independent Agent Settings/review surface or another
non-ACK surface.

Add regression tests.

==================================================
RETENTION
==================================================

Approve v1 bounded authorization metadata retention:

30 days after terminal state

maximum 200 retained authorization metadata rows per owner

maximum one effective pending authorization.

Before rejecting a new authorization because of retained capacity:

perform only the approved safe pruning of terminal records whose retention
period has expired.

Never delete fresh accounting merely to make room.

Authorization audit rows store no copied signal text/provider fact payload.

Use:

identities
hashes
versions
timestamps
bounded reasons.

==================================================
EFFECTIVE EXPIRY
==================================================

Queries must compute effective expiry from database time.

A pending authorization whose slot/window has passed must no longer be
executable even if its physical status row has not yet been materialized to
expired.

Safe UI/status should present effective truth.

Lazy physical expiry materialization is approved.

No new Cron is required.

==================================================
DISPATCH SKIP OBSERVABILITY
==================================================

Do NOT broaden this implementation solely to fix general dispatch skip
observability.

If adding bounded skip reason instrumentation is extremely small and isolated,
document it separately.

Do not change rolling-cap behavior.

Do not change scheduler semantics.

Do not let this delay the core one-shot capability.

==================================================
MEMORY CLEAR / SOURCE LOSS
==================================================

Explicitly support:

memory clear while pending

memory clear after consumption

project deletion

observation deletion

source-token change

parent resolution

parent seen transition.

Pending invalidation must occur safely.

Consumed permission must never be refunded.

Publication after source loss must be prevented when the existing safety
contract requires it.

==================================================
TESTS
==================================================

Implement all tests proposed in the approved design plus the amendments.

At minimum prove:

- exact owner
- exact project
- exact parent
- exact revision
- exact family/episode where applicable
- exact source token
- exact next natural slot
- wrong slot blocked
- later slot blocked
- pre-slot consumption blocked
- slot+600/evidence expiry enforced
- seen parent blocked
- resolved parent blocked
- changed parent blocked
- source mismatch blocked
- model mismatch blocked
- budget exhausted blocked
- attempt limit blocked
- duplicate consume cannot double-send
- concurrent consumers cannot double-send
- replay cannot obtain fresh credential
- replay racing original worker cannot consume
- cancellation vs consume race
- provider failure no retry
- rejected output no retry
- no normal-AI fallthrough
- siblings excluded
- exact provider bytes contain one parent only
- persistent AI consent remains false
- persistent scope remains empty
- authorization creation does not ACK
- cancellation terminal
- missed slot effectively expires
- accepted one-shot idea remains safely viewable
- advisory output cannot auto-Apply
- normal Phase5D behavior unchanged without one-shot
- memory clear behavior
- project deletion
- parent deletion
- audit retention/pruning
- accounting UI does not overclaim physical transmission.

Use synthetic provider transport only.

NO live Gemini.

==================================================
CONCURRENCY
==================================================

Use PGlite for deterministic functional coverage.

Also run true multi-connection PostgreSQL race tests using already available
local infrastructure for:

duplicate consume

cancel vs consume

normal vs one-shot budget reservation

expiry vs consume

publication vs source invalidation.

Do not install new infrastructure/dependencies without authorization.

==================================================
REGRESSIONS
==================================================

Keep existing suites unchanged and green:

phase5d-gemini

phase5d-ui

phase5d-handoff

private AI

public AI

plus new one-shot suites.

Then run:

typecheck

focused lint

production build

git diff --check

migration replay/from-scratch validation.

==================================================
PRODUCTION BOUNDARY
==================================================

STOP before Production rollout.

Do NOT:

push Production migration

deploy

create live authorization

enable AI

select persistent scope

call Gemini

invoke/replay Pulse.

Produce implementation evidence first.

==================================================
FINAL REPORT
==================================================

Produce:

# Phase5D One-Shot Authorization — Implementation Report

## 1. Final result
## 2. Starting source identity
## 3. Product gap solved
## 4. Architecture
## 5. Migration
## 6. Authorization identity
## 7. State machine
## 8. Next-slot enforcement
## 9. Effective expiry
## 10. Fresh admission credential
## 11. Replay resistance
## 12. Atomic consumption
## 13. Provider/model binding
## 14. Exact candidate/context enforcement
## 15. Provider accounting semantics
## 16. Accepted-idea provenance
## 17. ACK safety
## 18. Memory/source-loss behavior
## 19. Owner UI
## 20. Retention
## 21. Tests
## 22. True PostgreSQL concurrency tests
## 23. Existing regressions
## 24. Typecheck/lint/build/diff
## 25. Migration replay
## 26. Security review
## 27. Files changed
## 28. Remaining limitations
## 29. Production rollout requirements
## 30. Gate I restart requirements

PASS requires that the system can enforce:

Owner authorized exactly observation X,
at contentRevision Y,
for project Z,
for the next exact natural slot S,
using provider/model M,
for at most one provider request.

If any of those identities differ:

NO PROVIDER SEND IS PERMITTED.

STOP after implementation/reporting.

Do not deploy.
Do not begin Gate I.