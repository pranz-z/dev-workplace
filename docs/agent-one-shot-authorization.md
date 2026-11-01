# Exact one-shot proactive AI authorization

This capability authorizes one project-linked signal, at one content revision and episode, for the next canonical four-hour natural UTC slot. It does not enable persistent AI consent or add persistent project scope. Supported signal families are deadline, important_work and quiet_project; workspace-wide aggregates are rejected.

## Owner flow

Use the independent Agent Settings surface. Preview is read-only and does not mount Inbox or ACK observations. The server supplies the next slot, source-validated minimized context, provider/model and expiry. Confirming submits only parentId and the preview identity. The server rebuilds the preview, then the locked create RPC compares the entire reviewed binding before inserting permission; it cannot silently adopt a newer settings revision, episode, project or expiry. A pending authorization can be cancelled; cancellation cannot reactivate it.

Status/audit shows bounded current project/signal labels, slot, model, state and safe reason. No copied signal text or provider payload is stored in authorization audit rows. No credential is exposed. Source loss yields an unavailable label rather than retained private text.

## Identity and execution

Immutable permission binds owner, project, observation, contentRevision, episode, family, source token, context fingerprint/policy, exact UTC slot, provider and exact model. Maximum provider requests is exactly one. The server rejects past, arbitrary later, unaligned or owner-state-incompatible slots. The next canonical boundary must precede parent evidence expiry strictly.

Execution expires at min(parent evidence expiry, authorized slot + 600 seconds). The 600-second tolerance is a narrower one-shot execution policy, not permission for another slot. Consumption before the slot or at/after expiry fails closed.

Only a new claim from the authenticated dispatcher can receive fresh admission plaintext. Two UUIDv4 values provide 244 unpredictable random bits; only its SHA256-based hash is stored, bound to the permission and new Pulse. Replay/recovery exposes no plaintext and cannot reconstruct it from public identity/nonce/fence fields. A replay also cannot prematurely finish the original one-shot worker's running Pulse.

After deterministic publication, the exact branch independently checks permission without forging persistent consent. It evaluates only the bound family/parent and serializes exactly one signal using existing minimization. No ranking, siblings, fallback parent or fallback model is used. A matching one-shot attempt owns AI admission for the Pulse even when blocked, expired or cancelled.

Source ownership, active/unseen state, revision/episode/family, attempts, evidence, source token, relationship coverage, model and context fingerprint are checked again before reservation and physical send. Normal request/installation/idea/Pulse/attempt budgets and lease/fence rules still apply. One-shot permission creates no capacity.

## Atomicity and uncertainty

The existing global accounting transaction lock is acquired before owner state, ordered Pulse rows, ordered observations and authorization rows. Consumption atomically spends permission and writes the existing Pulse/installation reservation and parent attempt. Only the original successful consume response permits sending. Duplicate/uncertain consume responses never permit another send. The existing adapter remains single-attempt with an independent physical fetch guard.

States are pending, consumed, completed, blocked, expired, cancelled and failed. Consumed is irreversible in-flight permission, not terminal success. No failure refunds it. Maintenance terminalizes abandoned attempts; it never reopens them.

Audit phases distinguish pending, allowance consumed/reserved, send attempted, transport confirmed/unknown, response received, output accepted/rejected and publication completed. A reservation is not proof that one HTTP request reached Gemini. A lost response or transport interruption can remain unknown.

## Advisory persistence and lifecycle

The existing advisory validator remains authoritative. Successful output creates only the existing owner-review idea. No workspace mutation or automatic Apply occurs.

Accepted one-shot provenance is immutable on the idea header, established by the guarded consumption/publication transaction. Safe reads do not require persistent consent or an unexpired execution window for an already accepted idea. They retain normal ownership, source, parent/episode, stale/unavailable and output rules. Ordinary proactive ideas retain their existing persistent-consent withdrawal behavior.

Memory clear invalidates pending permission and interrupts consumed permission without refunding accounting. Parent/project loss, seen/resolved transitions and changed source prevent unauthorized consumption/publication. No restrictive resource FK prevents ordinary deletion or memory clear.

## Expiry and retention

Read projections compute effective expiry from database time without writes. Thus a missed slot cannot remain executable or appear indefinitely pending. Existing bounded natural maintenance materializes expiry/abandonment, including when no owner is claimed. If the scheduler is stopped, physical materialization waits, but effective expiry still applies.

At most one effective pending permission and 200 retained metadata rows per owner are allowed. Terminal metadata may be pruned after 30 days, before rejecting creation for retained capacity. Fresh accounting is never removed to make space. Accepted idea provenance survives metadata pruning; existing idea expiry/redaction rules still apply.

## Trust and rollout boundaries

Scheduler schedule, HMAC and rolling cap semantics are unchanged. The signing-secret/service-role authority remains trusted: a valid signed request cannot independently prove its sender was pg_cron rather than another holder of that secret. Fresh-only admission adds replay resistance inside that established boundary.

Application SHA remains an external release/Gate I precondition. The worker makes no GitHub/Vercel network request to discover its source identity. Billing tier remains unknown unless separately verified; the owner disclosure conservatively treats the provider as unpaid/free.

Local implementation does not authorize Production migration/deployment, a live permission, provider generation or Gate I. Rollout requires separate review of migration/grants, PostgreSQL races, old-app compatibility and hosted non-ACK behavior. The previous October 29 20:00 authorization is unused. Gate I must restart with a new baseline, newly valid natural candidate and new explicit owner authorization.
