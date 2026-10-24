import 'server-only';
import { randomUUID } from 'node:crypto';
import { scanPulse } from './scanner';
import { PULSE_POLICY } from './policy';
import { buildProactiveContext, isProactiveSelection, type ProactiveContext } from './privacy';
import { generatePulseIdea } from './gemini';
import type { PulseAiOutcome, PulseRecovery, PulseRepository } from './db';
import type { PulseAuthority, PulseError, PulseStatus } from './types';

export interface PulseOutcome {
  status: PulseStatus | 'skipped'; aiOutcome: PulseAiOutcome; code: PulseError | null;
  createdCount: number; updatedCount: number; resolvedCount: number;
}
export interface PulseEngineDeps {
  repository: PulseRepository; signal: AbortSignal; fetch: typeof fetch;
  clock?: { now(): number; monotonic(): number };
  scan?: typeof scanPulse; buildContext?: typeof buildProactiveContext; provider?: typeof generatePulseIdea;
  log?: (fields: PulseOutcome & { durationMs: number }) => void;
}
/** processingEnabled is trusted server configuration, never part of the signed HTTP body. */
export interface PulseDispatchInput { scheduledSlot: string; nonce: string; issuedAt: number; processingEnabled: boolean }
export interface DispatchOutcome {
  outcome: 'claimed' | 'empty' | 'disabled' | 'recovered' | 'failed'; claimed: number; processed: number;
  succeeded: number; partial: number; failed: number; skipped: number;
}
const clockFor = (deps: PulseEngineDeps) => deps.clock ?? { now: Date.now, monotonic: () => performance.now() };
const empty = (code: PulseError): PulseOutcome => ({ status: 'skipped', aiOutcome: 'none', code, createdCount: 0, updatedCount: 0, resolvedCount: 0 });
const failureCode = (error: unknown): PulseError => error instanceof Error && error.message==='AUTHORITY_LOST' ? 'AUTHORITY_LOST' : 'SOURCE_UNAVAILABLE';

/** Bounds waits as well as start gates. An uncertain RPC may have committed; it is never retried here. */
function execution(deps: PulseEngineDeps, end: number) {
  const clock = clockFor(deps), controller = new AbortController();
  const abort = () => controller.abort();
  deps.signal.addEventListener('abort', abort, { once: true });
  if (deps.signal.aborted) abort();
  const timer = setTimeout(abort, Math.max(0, end - clock.monotonic()));
  const remaining = () => Math.max(0, end - clock.monotonic());
  async function call<T>(start: () => Promise<T>): Promise<T> {
    if (controller.signal.aborted || remaining()<=0) throw new Error('AUTHORITY_LOST');
    let cancel: () => void = () => undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error('AUTHORITY_LOST'));
      controller.signal.addEventListener('abort', cancel, { once: true });
    });
    try { return await Promise.race([start(), stopped]); }
    finally { controller.signal.removeEventListener('abort', cancel); }
  }
  return { clock, signal: controller.signal, remaining, call,
    dispose() { clearTimeout(timer); deps.signal.removeEventListener('abort', abort); } };
}
function outcome(state: PulseRecovery | null, code: PulseError | null): PulseOutcome {
  if (!state) return empty(code ?? 'AUTHORITY_LOST');
  return { status: state.status, aiOutcome: state.aiOutcome, code, createdCount: state.createdCount, updatedCount: state.updatedCount, resolvedCount: state.resolvedCount };
}

export async function runClaimedPulse(authority: PulseAuthority, deps: PulseEngineDeps): Promise<PulseOutcome> {
  return runOwner(authority, deps, Infinity);
}
async function runOwner(authority: PulseAuthority, deps: PulseEngineDeps, dispatchEnd: number): Promise<PulseOutcome> {
  const clock = clockFor(deps), started = clock.monotonic();
  const work = execution(deps, Math.min(started + 20_000, dispatchEnd));
  const repository = deps.repository;
  let stored: PulseRecovery | null = null, aiOutcome: Exclude<PulseAiOutcome,'reserved'> = 'none';
  let code: PulseError | null = null;
  const remaining = (context?: ProactiveContext) => Math.min(work.remaining(), Date.parse(authority.leaseExpiresAt) - clock.now(),
    context ? Date.parse(context.evidenceValidUntil) - clock.now() : Infinity);
  const recover = async () => { stored = await work.call(() => repository.recover(authority)); return stored; };
  async function finish(): Promise<PulseOutcome> {
    if (work.signal.aborted || remaining()<=0) return outcome(stored, code ?? 'AUTHORITY_LOST');
    try {
      await recover();
      if (!stored || stored.status!=='running') return outcome(stored, code);
      const selected = stored.ideaAccepted ? 'accepted' : stored.aiOutcome==='malformed' ? 'malformed' :
        stored.reserved && aiOutcome==='none' ? 'unknown' : aiOutcome;
      stored = await work.call(() => repository.finish(authority, selected));
    } catch {
      try {
        await recover();
        if (!stored || stored.status==='running') code ??= 'AUTHORITY_LOST';
      } catch { code ??= 'SOURCE_UNAVAILABLE'; /* Preserve last canonical state; no stale write or unbounded retry. */ }
    }
    return outcome(stored, code);
  }
  async function contextNow(): Promise<ProactiveContext | null> {
    const settings = await work.call(() => repository.getSettings(authority.userId));
    if (settings.mode!=='workspace_ai' || !settings.aiEligible || settings.settingsRevision!==authority.settingsRevision) return null;
    const source = await work.call(() => repository.readSource(authority));
    if (source.settingsRevision!==authority.settingsRevision || source.policyVersion!==authority.policyVersion) return null;
    const scan = (deps.scan ?? scanPulse)(source, source.existing, PULSE_POLICY);
    const candidates = scan.decisions.flatMap(decision => {
      const matches = source.existing.filter(parent => parent.key===decision.key && parent.family===decision.family &&
        parent.target.type===decision.target.type && parent.target.id===decision.target.id);
      if (matches.length!==1) return [];
      const parent = matches[0];
      return [{ ...decision, parentId: parent.id, parentEpisode: parent.episode, state: parent.state,
        seen: parent.seen, lastCheckedAt: parent.lastCheckedAt, sourceToken: parent.sourceToken, evidenceValidUntil: parent.evidenceValidUntil }];
    });
    const result = (deps.buildContext ?? buildProactiveContext)(source, candidates, settings);
    return result.ok ? result.context : null;
  }
  try {
    const settings = await work.call(() => repository.getSettings(authority.userId));
    if (settings.mode==='off' || !settings.checksConsented) return empty('AUTHORITY_LOST');
    if (settings.settingsRevision!==authority.settingsRevision || settings.policyVersion!==authority.policyVersion || remaining()<=5000) {
      code = 'AUTHORITY_LOST'; return await finish();
    }
    stored = await recover();
    if (!stored || stored.status!=='running') return outcome(stored, code);
    await work.call(() => repository.retain(authority.userId, 20));
    if (!stored.commitId) {
      const source = await work.call(() => repository.readSource(authority));
      const scan = (deps.scan ?? scanPulse)(source, source.existing, PULSE_POLICY), commitId = randomUUID();
      if (remaining()<=5000) { aiOutcome = 'skipped_time_budget'; return await finish(); }
      try {
        const commit = await work.call(() => repository.publishDeterministic(authority, commitId, scan));
        stored = { ...stored, commitId: commit.commitId, createdCount: commit.createdCount, updatedCount: commit.updatedCount, resolvedCount: commit.resolvedCount };
      } catch {
        stored = await recover();
        if (!stored?.commitId) { code = 'SOURCE_UNAVAILABLE'; return await finish(); }
      }
    }
    // A previous worker may have transmitted. A recovered reservation never permits another send.
    if (!stored) return empty('AUTHORITY_LOST');
    if (stored.reserved) { aiOutcome = stored.aiOutcome==='reserved' ? 'unknown' : stored.aiOutcome; return await finish(); }
    if (settings.mode!=='workspace_ai') return await finish();
    if (remaining()<=15_000) { aiOutcome = 'skipped_time_budget'; return await finish(); }
    const context = await contextNow();
    if (!context) { aiOutcome = 'skipped_scope'; return await finish(); }
    if (remaining(context)<=15_000) { aiOutcome = 'skipped_time_budget'; return await finish(); }
    let reservation;
    try { reservation = await work.call(() => repository.reserveAi(authority, context.parentId, context.parentEpisode)); }
    catch {
      // Lost response is transmission uncertainty, even if canonical reservation is found.
      aiOutcome = 'unknown'; await recover(); return await finish();
    }
    if (!reservation.sendAllowed) {
      aiOutcome = reservation.reserved ? 'unknown' : reservation.reason==='BUDGET' ? 'skipped_budget' : 'skipped_scope';
      return await finish();
    }
    // This is a confirmed SQL commit, not in-memory attempt authority.
    stored = { ...stored, reserved: true, aiOutcome: 'reserved' };
    aiOutcome = 'unknown';
    if (remaining(context)<=15_000 || work.signal.aborted) { aiOutcome = 'skipped_time_budget'; return await finish(); }
    let idea;
    try {
      idea = await work.call(() => (deps.provider ?? generatePulseIdea)(context, {
        signal: work.signal, deadlineAt: clock.now() + remaining(context),
        fetch: async (input, init) => {
          const current = await contextNow();
          if (!current || current.parentId!==context.parentId || current.parentEpisode!==context.parentEpisode ||
            current.sourceToken!==context.sourceToken || current.contents!==context.contents ||
            remaining(current)<=15_000 || work.signal.aborted || init?.signal?.aborted) throw new Error('AUTHORITY_LOST');
          return deps.fetch(input, init);
        },
      }));
    } catch { return await finish(); }
    if ('ok' in idea) {
      aiOutcome = idea.code==='AI_MALFORMED' ? 'malformed' : idea.code==='AI_TIMEOUT' ? 'timeout' : idea.code==='AI_UNAVAILABLE' ? 'unavailable' : 'unknown';
      return await finish();
    }
    const current = await contextNow();
    if (!current || current.parentId!==context.parentId || current.parentEpisode!==context.parentEpisode || current.sourceToken!==context.sourceToken || current.contents!==context.contents ||
      !isProactiveSelection(context, idea.sourceAlias, idea.category) || remaining(current)<=0) return await finish();
    try {
      const publication = await work.call(() => repository.publishAi(authority, { category: idea.category, title: idea.title, summary: idea.advisoryText }));
      aiOutcome = publication.accepted ? 'accepted' : publication.reason==='AI_MALFORMED' ? 'malformed' : 'unknown';
      if (publication.accepted) stored = { ...stored, ideaAccepted: true, aiOutcome: 'accepted' };
    } catch { await recover(); }
    return await finish();
  } catch (error) {
    code = failureCode(error);
    return await finish();
  } finally {
    const result = outcome(stored, code);
    try { deps.log?.({ ...result, durationMs: Math.min(20_000, Math.max(0, clock.monotonic() - started)) }); } catch { /* Logging cannot change execution state. */ }
    work.dispose();
  }
}

export async function runPulseDispatch(input: PulseDispatchInput, deps: PulseEngineDeps): Promise<DispatchOutcome> {
  const clock = clockFor(deps), end = clock.monotonic() + 45_000, work = execution(deps, end);
  const result: DispatchOutcome = { outcome: 'failed', claimed: 0, processed: 0, succeeded: 0, partial: 0, failed: 0, skipped: 0 };
  try {
    if (typeof input.processingEnabled!=='boolean') return result;
    await work.call(() => deps.repository.retainInstallation(20));
    const batch = await work.call(() => deps.repository.claimDispatch(input.scheduledSlot, input.nonce, new Date(input.issuedAt * 1000).toISOString(), input.processingEnabled));
    if (batch.claims.length>2 || batch.claimCount>2) return result;
    result.outcome = batch.replay ? 'recovered' : batch.outcome; result.claimed = batch.claimCount;
    if (!input.processingEnabled) return result;
    for (const authority of batch.claims) {
      if (work.signal.aborted || work.remaining()<=5000) break;
      const owner = await runOwner(authority, { ...deps, signal: work.signal }, end);
      result.processed++;
      if (owner.status==='succeeded') result.succeeded++;
      else if (owner.status==='partial') result.partial++;
      else if (owner.status==='failed' || owner.status==='abandoned') result.failed++;
      else result.skipped++;
    }
  } catch { /* Established or uncertain claims remain canonical; never claim another batch here. */ }
  finally { work.dispose(); }
  return result;
}
