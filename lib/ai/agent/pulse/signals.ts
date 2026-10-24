import { isValidCalendarDate, localCalendarDate, taskCalendarDate } from '@/data/workspaceCalendar';
import { dayBoundaryInstant, workWindow } from '@/data/timeBlocks';
import { isComplete } from './completeness';
import { conditionKey, materialFingerprint } from './fingerprints';
import { boundText, PULSE_POLICY } from './policy';
import type {
  ConditionDecision, CoverageReason, MaterialFacts, MilestoneFact, ProjectFact,
  PulseReason, PulseSourceSnapshot, PulseTarget, SignalFamily, TaskFact, Truth,
} from './types';

const DAY = 86400000;
const MICRO = BigInt(1000);
const EXCLUDED = new Set(['Completed', 'Cancelled', 'On Hold']);
type DatedFact = TaskFact | MilestoneFact | ProjectFact;
/** Calendar arithmetic on date labels only; never use this to add elapsed local days. */
function plusDays(date: string, count: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}
function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !isValidCalendarDate(value.slice(0, 10))) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
/** PostgreSQL clock/activity values have microseconds. Keep threshold arithmetic exact. */
function micros(value: unknown): bigint | null {
  const milliseconds = instant(value);
  if (milliseconds === null) return null;
  const fraction = /\.(\d{1,6})(?:Z|[+-])/.exec(value as string)?.[1] ?? '';
  return BigInt(milliseconds) * MICRO + BigInt(fraction.slice(3).padEnd(3, '0'));
}
function timestamp(value: bigint): string {
  let milliseconds = value / MICRO, remainder = value % MICRO;
  if (remainder < BigInt(0)) { milliseconds -= BigInt(1); remainder += MICRO; }
  const iso = new Date(Number(milliseconds)).toISOString();
  return remainder === BigInt(0) ? iso : iso.replace(/\.(\d{3})Z$/, (_, fraction) => `.${fraction}${remainder.toString().padStart(3, '0')}Z`);
}
const minimum = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);
const maximum = (a: bigint, b: bigint) => a > b ? a : b;
function localDay(source: PulseSourceSnapshot): string | null {
  if (!source.timeZone || instant(source.evaluatedAt) === null) return null;
  try { return localCalendarDate(new Date(source.evaluatedAt), source.timeZone); }
  catch { return null; }
}
function expiry(source: PulseSourceSnapshot): string | null {
  const today = localDay(source);
  return today ? dayBoundaryInstant(plusDays(today, 1), source.timeZone!) : null;
}
function dateValue(value: string | null | undefined, isTask: boolean, source: PulseSourceSnapshot): { date: string | null; issue?: CoverageReason } {
  if (value === undefined) return { date: null, issue: 'INCOMPLETE' };
  if (value === null) return { date: null, issue: 'MISSING_DATE' };
  if (isValidCalendarDate(value)) return { date: value };
  if (!isTask || instant(value) === null) return { date: null, issue: 'INVALID_DATE' };
  return { date: taskCalendarDate(value, source.timeZone!) };
}
function eligibility(source: PulseSourceSnapshot, fact: DatedFact, type: PulseTarget['type']): { truth: Truth; issue?: CoverageReason; sourceToken?: string } {
  if (fact.userId !== source.userId) return { truth: 'false', issue: 'OWNER_LINK' };
  if (type === 'project') return { truth: EXCLUDED.has(fact.status) ? 'false' : 'true' };
  if ((type === 'task' && fact.status === 'Completed') || (type === 'milestone' && fact.status === 'completed')) return { truth: 'false', issue: 'EXCLUDED' };
  const parent = source.projects.find(project => project.id === (fact as TaskFact).projectId);
  if (!parent) {
    const check = source.targetChecks[conditionKey({ type, id: fact.id }, 'deadline')];
    const lost = check?.complete === true && !check.exists && Boolean(check.sourceToken);
    return { truth: lost ? 'false' : 'unknown', issue: 'OWNER_LINK', sourceToken: check?.sourceToken };
  }
  return { truth: parent.userId !== source.userId || EXCLUDED.has(parent.status) ? 'false' : 'true', issue: EXCLUDED.has(parent.status) ? 'EXCLUDED' : undefined };
}
function decision(source: PulseSourceSnapshot, target: PulseTarget, family: SignalFamily,
  facts: MaterialFacts, token: string | undefined, title: string): ConditionDecision {
  return {
    key: conditionKey(target, family), target, family, truth: 'unknown', reasonCodes: [],
    materialFingerprint: materialFingerprint(facts), sourceToken: token ?? null,
    evidenceValidUntil: expiry(source),
    evidence: { title: boundText(title, PULSE_POLICY.limits.title), summary: '', explanation: '', evaluatedAt: source.evaluatedAt },
    importance: 'normal', rank: 3, complete: false,
  };
}
function deadline(source: PulseSourceSnapshot, fact: DatedFact, type: 'task' | 'milestone' | 'project'): ConditionDecision {
  const rawDate = type === 'task' ? (fact as TaskFact).dueDate : (fact as ProjectFact).targetDate;
  const today = localDay(source);
  const parsed = today ? dateValue(rawDate, type === 'task', source) : { date: null, issue: 'TIME_ZONE' as const };
  const allowed = eligibility(source, fact, type);
  const item = decision(source, { type, id: fact.id }, 'deadline', {
    target: { type, id: fact.id }, date: parsed.date, rawDate: parsed.issue ? rawDate : undefined,
    status: fact.status, priority: (fact as TaskFact).priority,
    projectId: type === 'project' ? undefined : (fact as TaskFact).projectId,
    parentStatus: source.projects.find(p => p.id === (fact as TaskFact).projectId)?.status,
  }, allowed.sourceToken ?? fact.sourceToken, fact.title);
  item.evidence.date = parsed.date;
  item.evidence.status = fact.status;
  item.priority = (fact as TaskFact).priority;
  item.materialChangedAt = fact.materialChangedAt;
  if (!item.sourceToken) item.evidence.issue = 'SOURCE_TOKEN';
  else if (allowed.truth !== 'true') { item.truth = allowed.truth; item.evidence.issue = allowed.issue; }
  else if (parsed.issue) { item.truth = parsed.issue === 'MISSING_DATE' ? 'false' : 'unknown'; item.evidence.issue = parsed.issue; }
  else {
    const date = parsed.date!;
    item.deadline = date;
    item.truth = date <= plusDays(today!, PULSE_POLICY.signals.approachingDays) ? 'true' : 'false';
    if (item.truth === 'true') {
      const reason: PulseReason = date < today! ? 'DEADLINE_OVERDUE' : date === today ? 'DEADLINE_TODAY' : 'DEADLINE_SOON';
      item.reasonCodes = [reason];
      item.rank = date <= today! ? 0 : date === plusDays(today!, 1) ? 1 : 3;
      item.importance = date <= today! ? 'high' : 'normal';
      item.evidence.summary = date < today! ? 'Deadline overdue.' : date === today ? 'Deadline today.' : 'Deadline approaching.';
    }
  }
  item.complete = item.truth !== 'unknown';
  return item;
}
export function evaluateDeadlines(source: PulseSourceSnapshot): ConditionDecision[] {
  return [
    ...source.tasks.map(fact => deadline(source, fact, 'task')),
    ...source.milestones.map(fact => deadline(source, fact, 'milestone')),
    ...source.projects.map(fact => deadline(source, fact, 'project')),
  ];
}

export function evaluateImportantTasks(source: PulseSourceSnapshot): ConditionDecision[] {
  return source.tasks.map(task => {
    const due = deadline(source, task, 'task');
    const relation = source.taskBlocks[task.id];
    const relevant = (relation?.blocks ?? []).filter(block => block.userId === source.userId &&
      block.taskId === task.id && block.projectId === task.projectId &&
      block.status === 'scheduled' && (block.kind === 'task' || block.kind === 'focus'))
      .slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const item = decision(source, due.target, 'important_work', {
      deadline: due.materialFingerprint, blocks: relevant,
    }, relation?.sourceToken ?? task.sourceToken, task.title);
    item.evidence.date = due.evidence.date;
    item.evidence.status = task.status;
    item.deadline = due.deadline;
    item.priority = task.priority;
    item.materialChangedAt = task.materialChangedAt;
    item.rank = 1;
    item.importance = 'high';
    const today = localDay(source);
    let requiresRelationship = false;
    if (task.priority === undefined) item.evidence.issue = 'INCOMPLETE';
    else if (!['High', 'Critical'].includes(task.priority ?? '') || task.status === 'Blocked') {
      item.truth = 'false'; item.evidence.issue = 'EXCLUDED';
    } else if (due.truth !== 'true') {
      item.truth = due.truth; item.evidence.issue = due.evidence.issue; item.sourceToken = due.sourceToken;
    } else if (due.deadline! < today!) item.truth = 'false';
    else {
      requiresRelationship = true;
      const now = micros(source.evaluatedAt)!;
      const end = micros(dayBoundaryInstant(plusDays(due.deadline!, 1), source.timeZone!))!;
      item.evidence.checkedStart = source.evaluatedAt;
      item.evidence.checkedEnd = timestamp(end);
      let invalid = false;
      const transitions: bigint[] = [];
      for (const block of relevant) {
        const startAt = micros(block.startAt), endAt = micros(block.endAt);
        if (startAt === null || endAt === null || endAt <= startAt || endAt - startAt > BigInt(12 * 3600000) * MICRO) { invalid = true; continue; }
        const clippedEnd = minimum(end, endAt);
        const minimumWork = BigInt(PULSE_POLICY.signals.minimumBlockMs) * MICRO;
        if (clippedEnd - maximum(now, startAt) >= minimumWork) transitions.push(clippedEnd - minimumWork + BigInt(1));
      }
      if (!relation?.sourceToken) item.evidence.issue = 'SOURCE_TOKEN';
      else if (transitions.length) {
        item.truth = 'false';
        item.evidenceValidUntil = timestamp(minimum(micros(item.evidenceValidUntil!)!, ...transitions));
      } else if (invalid) item.evidence.issue = 'INVALID_RANGE';
      else if (!isComplete(relation?.coverage)) item.evidence.issue = 'INCOMPLETE';
      else {
        item.truth = 'true'; item.reasonCodes = ['IMPORTANT_NO_WORK'];
        item.evidence.summary = 'Important task has no qualifying scheduled work before its deadline.';
        item.evidence.explanation = 'This checks scheduled time, not the effort needed to finish the task.';
      }
    }
    item.complete = item.truth !== 'unknown' && (!requiresRelationship || isComplete(relation?.coverage));
    return item;
  });
}

export function evaluateQuietProjects(source: PulseSourceSnapshot): ConditionDecision[] {
  const statuses = new Set(['Planning', 'Research', 'In Development', 'Testing', 'Deployment']);
  return source.projects.map(project => {
    const aggregate = source.projectActivity[project.id];
    const thresholdDays = project.workflowStage === 'maintenance' ? PULSE_POLICY.signals.maintenanceQuietDays : PULSE_POLICY.signals.quietDays;
    const values = [project.createdAt, project.updatedAt, aggregate?.lastActivityAt];
    const now = micros(source.evaluatedAt);
    const invalid = now === null || typeof project.createdAt !== 'string' || typeof project.updatedAt !== 'string' || project.workflowStage === undefined || aggregate?.invalidActivity !== false || values.some(value =>
      value === undefined || (value !== null && (micros(value) === null || micros(value)! > now!)));
    const latest = invalid ? null : values.filter((value): value is string => typeof value === 'string')
      .sort((a, b) => micros(a)! > micros(b)! ? -1 : micros(a)! < micros(b)! ? 1 : a < b ? -1 : a > b ? 1 : 0)[0];
    const item = decision(source, { type: 'project', id: project.id }, 'quiet_project', {
      status: project.status, workflowStage: project.workflowStage, thresholdDays, lastActivityAt: latest,
    }, aggregate?.sourceToken ?? project.sourceToken, project.title);
    item.rank = 4;
    item.evidence.status = project.status;
    item.evidence.thresholdDays = thresholdDays;
    if (project.userId !== source.userId || !statuses.has(project.status)) item.truth = 'false';
    else if (!isComplete(aggregate?.coverage)) item.evidence.issue = 'INCOMPLETE';
    else if (invalid || !latest) item.evidence.issue = 'INVALID_ACTIVITY';
    else if (!aggregate?.sourceToken) item.evidence.issue = 'SOURCE_TOKEN';
    else {
      const threshold = micros(latest)! + BigInt(thresholdDays * DAY) * MICRO;
      item.evidence.lastActivityAt = latest;
      item.materialChangedAt = latest;
      item.truth = now! >= threshold ? 'true' : 'false';
      // Quiet is elapsed-time based and can be checked without a usable saved timezone.
      const freshUntil = item.evidenceValidUntil ? micros(item.evidenceValidUntil)! : now! + BigInt(4 * 3600000) * MICRO;
      item.evidenceValidUntil = timestamp(item.truth === 'false' ? minimum(freshUntil, threshold) : freshUntil);
      if (item.truth === 'true') {
        item.reasonCodes = ['PROJECT_QUIET'];
        item.evidence.summary = `No recorded workspace changes for at least ${thresholdDays} days.`;
        item.evidence.explanation = 'Based on recorded project, task and milestone changes only.';
      }
    }
    item.complete = item.truth !== 'unknown';
    return item;
  });
}

export function evaluateTomorrow(source: PulseSourceSnapshot): ConditionDecision[] {
  const today = localDay(source), tomorrow = today ? plusDays(today, 1) : undefined;
  const sorted = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const blocks = sorted(source.blocks.filter(block => block.userId === source.userId && block.status === 'scheduled'));
  const item = decision(source, { type: 'workspace_day', id: source.userId }, 'tomorrow', { date: tomorrow }, source.tomorrowSourceToken, 'Tomorrow workload review');
  item.key = conditionKey(item.target, 'tomorrow', tomorrow);
  item.rank = 2;
  item.evidence.date = tomorrow ?? null;
  if (!tomorrow) { item.evidence.issue = 'TIME_ZONE'; return [item]; }
  const counted: Record<string, Array<{ id: string; date: string }>> = { task: [], milestone: [], project: [] };
  function count(facts: readonly DatedFact[], type: 'task' | 'milestone' | 'project', complete: boolean): number | null {
    if (!complete) return null;
    let total = 0;
    for (const fact of facts) {
      const allowed = eligibility(source, fact, type);
      if (allowed.truth === 'false') continue;
      if (allowed.truth === 'unknown') return null;
      const raw = type === 'task' ? (fact as TaskFact).dueDate : (fact as ProjectFact).targetDate;
      const parsed = dateValue(raw, type === 'task', source);
      if (parsed.issue && parsed.issue !== 'MISSING_DATE') return null;
      if (parsed.date === tomorrow) { total++; counted[type].push({ id: fact.id, date: parsed.date }); }
    }
    return total;
  }
  const taskCount = count(source.tasks, 'task', isComplete(source.coverage.tasks));
  item.evidence.taskCount = taskCount;
  item.evidence.milestoneCount = count(source.milestones, 'milestone', isComplete(source.coverage.milestones));
  item.evidence.projectCount = count(source.projects, 'project', isComplete(source.coverage.projects));
  let occupancyTruth: Truth = 'false';
  let occupancyFacts: MaterialFacts = {};
  item.evidence.occupancyPercent = null;
  if (!source.preferences) item.evidence.occupancyIssue = 'PREFERENCES_MISSING';
  else {
    try {
      const window = workWindow({ date: tomorrow, timeZone: source.timeZone!, preferences: source.preferences, blocks: [], durationMinutes: 1 });
      if (!window) item.evidence.occupancyIssue = 'NONWORKING_DAY';
      else if (!isComplete(source.coverage.blocks)) {
        occupancyTruth = 'unknown'; item.evidence.occupancyIssue = 'INCOMPLETE';
      } else {
        const start = micros(window.startAt)!, end = micros(window.endAt)!;
        const ranges: bigint[][] = [];
        const relationships: Array<{ id: string; start: string; end: string }> = [];
        let invalid = false;
        for (const block of blocks) {
          const from = micros(block.startAt), to = micros(block.endAt);
          if (from === null || to === null || to <= from || to - from > BigInt(12 * 3600000) * MICRO) { invalid = true; break; }
          if (to > start && from < end) {
            ranges.push([maximum(start, from), minimum(end, to)]);
            relationships.push({ id: block.id, start: timestamp(maximum(start, from)), end: timestamp(minimum(end, to)) });
          }
        }
        if (invalid) { occupancyTruth = 'unknown'; item.evidence.occupancyIssue = 'INVALID_RANGE'; }
        else {
          ranges.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
          let occupied = BigInt(0), cursor = start;
          for (const [from, to] of ranges) { occupied += maximum(BigInt(0), to - maximum(cursor, from)); cursor = maximum(cursor, to); }
          item.evidence.occupancyPercent = Number(occupied * BigInt(10000) / (end - start)) / 100;
          item.evidence.checkedStart = window.startAt; item.evidence.checkedEnd = window.endAt;
          occupancyFacts = { window, relationships };
          occupancyTruth = occupied * BigInt(100) >= (end - start) * BigInt(PULSE_POLICY.signals.occupancyPercent) ? 'true' : 'false';
        }
      }
    } catch { item.evidence.occupancyIssue = 'PREFERENCES_INVALID'; }
  }
  const countTruth: Truth = taskCount === null ? 'unknown' : taskCount >= PULSE_POLICY.signals.tomorrowDeadlines ? 'true' : 'false';
  item.truth = countTruth === 'true' || occupancyTruth === 'true' ? 'true' : countTruth === 'unknown' || occupancyTruth === 'unknown' ? 'unknown' : 'false';
  if (countTruth === 'true') item.reasonCodes.push('TOMORROW_DEADLINES');
  if (occupancyTruth === 'true') item.reasonCodes.push('TOMORROW_OCCUPANCY');
  if (item.truth === 'true') {
    item.evidence.summary = [countTruth === 'true' ? `${taskCount} task deadlines tomorrow.` : '', occupancyTruth === 'true' ? `${item.evidence.occupancyPercent}% of saved working time booked.` : ''].filter(Boolean).join(' ');
    item.evidence.explanation = 'Deadline counts and calendar occupancy are separate facts.';
  }
  const baselineParts: Record<string, string> = {};
  for (const [type, count] of [['task', taskCount], ['milestone', item.evidence.milestoneCount], ['project', item.evidence.projectCount]] as const) {
    if (count !== null) baselineParts[`${type}Count`] = materialFingerprint({ date: tomorrow, facts: sorted(counted[type]) });
  }
  if (occupancyTruth !== 'unknown') baselineParts.occupancy = materialFingerprint({ date: tomorrow, ...occupancyFacts, omitted: item.evidence.occupancyIssue });
  item.baselineParts = baselineParts;
  item.materialFingerprint = materialFingerprint(baselineParts);
  item.complete = taskCount !== null && item.evidence.milestoneCount !== null && item.evidence.projectCount !== null && occupancyTruth !== 'unknown';
  if (!source.tomorrowSourceToken) { item.truth = 'unknown'; item.reasonCodes = []; item.evidence.issue = 'SOURCE_TOKEN'; }
  if (item.truth === 'unknown' && !source.tomorrowSourceToken) { item.complete = false; item.baselineParts = {}; }
  return [item];
}
