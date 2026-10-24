import { conditionKey, materialFingerprint } from './fingerprints';
import { isValidCalendarDate } from '@/data/workspaceCalendar';
import { boundText, PULSE_POLICY, validateReasonCodes } from './policy';
import { evaluateDeadlines, evaluateImportantTasks, evaluateQuietProjects, evaluateTomorrow } from './signals';
import type { ConditionDecision, PulsePolicy, PulseScan, PulseSourceSnapshot, StoredObservation } from './types';

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const priority: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
export function rankDecisions(items: readonly ConditionDecision[]): ConditionDecision[] {
  return [...items].sort((a, b) => a.rank - b.rank || compare(a.deadline ?? '9999-12-31', b.deadline ?? '9999-12-31') ||
    (priority[b.priority ?? ''] ?? 0) - (priority[a.priority ?? ''] ?? 0) ||
    compare(b.materialChangedAt ?? '', a.materialChangedAt ?? '') || compare(a.target.id, b.target.id) || compare(a.key, b.key));
}

/** Decisions are instructions for a later guarded publisher, never workspace writes. */
export function scanPulse(source: PulseSourceSnapshot, prior: readonly StoredObservation[], policy: PulsePolicy): PulseScan {
  const raw = [...evaluateDeadlines(source), ...evaluateImportantTasks(source), ...evaluateQuietProjects(source), ...evaluateTomorrow(source)];
  const grouped = new Map<string, ConditionDecision[]>();
  for (const item of raw) grouped.set(item.key, [...(grouped.get(item.key) ?? []), item]);
  const previous = new Map(prior.map(item => [item.key, item]));
  const merged = new Map<string, ConditionDecision>();
  const incomplete = new Set<string>();
  for (const [key, parts] of grouped) {
    const ordered = [...parts].sort((a, b) => compare(a.family, b.family));
    const positive = rankDecisions(ordered.filter(item => item.truth === 'true'));
    const hasUnknown = ordered.some(item => item.truth === 'unknown');
    const partial = ordered.some(item => !item.complete);
    const base = ordered.find(item => item.family === 'deadline') ?? ordered[0];
    const item: ConditionDecision = {
      ...base, evidence: { ...base.evidence },
      truth: positive.length ? 'true' : hasUnknown ? 'unknown' : 'false',
      reasonCodes: validateReasonCodes(ordered.flatMap(item => item.reasonCodes)),
      complete: !partial,
      expectedRowRevision: previous.get(key)?.rowRevision,
      materialFingerprint: ordered.length === 1 ? base.materialFingerprint : materialFingerprint(Object.fromEntries(ordered.filter(item => item.truth !== 'unknown').map(item => [item.family, item.materialFingerprint]))),
    };
    if (positive.length) { item.rank = positive[0].rank; item.importance = positive[0].importance; }
    const work = ordered.find(item => item.family === 'important_work');
    if (work) {
      item.sourceToken = work.sourceToken ?? item.sourceToken;
      // The work evaluator already clips its expiry to the same next-local-day boundary.
      item.evidenceValidUntil = work.evidenceValidUntil ?? item.evidenceValidUntil;
      if (work.truth === 'true') {
        item.evidence.summary = [item.evidence.summary, work.evidence.summary].filter(Boolean).join(' ');
        item.evidence.explanation = work.evidence.explanation;
        item.evidence.checkedStart = work.evidence.checkedStart; item.evidence.checkedEnd = work.evidence.checkedEnd;
      }
    }
    if (partial) {
      incomplete.add(key);
      // Partial rechecks may refresh known context but must not manufacture a new suppressed episode.
      item.materialFingerprint = previous.get(key)?.materialFingerprint ?? item.materialFingerprint;
    }
    merged.set(key, item);
  }
  for (const observation of prior) {
    if (merged.has(observation.key)) continue;
    const check = source.targetChecks[observation.key];
    const lost = check?.complete === true && check.exists === false && Boolean(check.sourceToken);
    const date = observation.key.slice(-10);
    const dated = observation.family === 'tomorrow' && observation.target.type === 'workspace_day' &&
      isValidCalendarDate(date) && observation.key === conditionKey(observation.target, observation.family, date);
    merged.set(observation.key, {
      key: observation.key, target: observation.target, family: observation.family,
      truth: lost ? 'false' : 'unknown', reasonCodes: [], materialFingerprint: observation.materialFingerprint,
      sourceToken: check?.sourceToken ?? null, evidenceValidUntil: null,
      expectedRowRevision: observation.rowRevision,
      evidence: { title: '', summary: '', explanation: '', evaluatedAt: source.evaluatedAt, issue: lost ? 'OWNER_LINK' : 'INCOMPLETE', ...(dated ? { date } : {}) },
      importance: 'normal', complete: lost, rank: observation.family === 'quiet_project' ? 4 : observation.family === 'tomorrow' ? 2 : 3,
    });
  }
  const all = rankDecisions([...merged.values()]);
  const existing = all.filter(item => previous.has(item.key)).slice(0, Math.min(20, Math.max(0, policy.maxExisting)));
  const newCandidates = all.filter(item => !previous.has(item.key) && item.truth === 'true').slice(0, Math.min(3, Math.max(0, policy.maxNew)));
  const decisions = rankDecisions([...existing, ...newCandidates]);
  const baselinePatches: Record<string, string> = {};
  for (const item of decisions) {
    const parts = grouped.get(item.key) ?? [];
    for (const part of [...parts].sort((a, b) => compare(a.family, b.family))) {
      if (part.baselineParts) {
        for (const [name, fingerprint] of Object.entries(part.baselineParts).sort(([a], [b]) => compare(a, b))) baselinePatches[`${item.key}/${name}`] = fingerprint;
      } else if (part.complete) baselinePatches[`${item.key}/${part.family}`] = part.materialFingerprint;
    }
    if (item.truth !== 'unknown' && !incomplete.has(item.key)) baselinePatches[item.key] = item.materialFingerprint;
    item.evidence.title = boundText(item.evidence.title, PULSE_POLICY.limits.title);
    item.evidence.summary = boundText(item.evidence.summary, PULSE_POLICY.limits.summary);
    item.evidence.explanation = boundText(item.evidence.explanation, PULSE_POLICY.limits.explanation);
    if (Array.from(item.key).length > PULSE_POLICY.limits.conditionKey || Buffer.byteLength(JSON.stringify(item.evidence), 'utf8') > PULSE_POLICY.limits.evidenceBytes) {
      throw new Error('Pulse source exceeds projection bounds.');
    }
  }
  return {
    decisions, newCandidates, baselinePatches,
    coverage: {
      true: all.filter(item => item.truth === 'true').length,
      false: all.filter(item => item.truth === 'false').length,
      unknown: all.filter(item => item.truth === 'unknown').length,
      complete: all.every(item => item.complete) && Object.values(source.coverage).every(value => value.complete),
      collections: { projects: source.coverage.projects.complete, tasks: source.coverage.tasks.complete,
        milestones: source.coverage.milestones.complete, blocks: source.coverage.blocks.complete },
    },
  };
}
