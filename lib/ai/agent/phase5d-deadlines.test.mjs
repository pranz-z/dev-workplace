import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPulse, makeSource, task, project, milestone } from './phase5d-test-support.mjs';
const evaluate = async source => (await loadPulse('lib/ai/agent/pulse/signals.ts')).evaluateDeadlines(source);

for (const [date, truth, reason] of [
  ['2026-10-14', 'true', 'DEADLINE_OVERDUE'], ['2026-10-15', 'true', 'DEADLINE_TODAY'],
  ['2026-10-16', 'true', 'DEADLINE_SOON'], ['2026-10-17', 'true', 'DEADLINE_SOON'],
  ['2026-10-18', 'true', 'DEADLINE_SOON'], ['2026-10-19', 'false', undefined],
]) test(`deadline_window_${date}`, async () => {
  const [item] = await evaluate(makeSource({ tasks: [task({ dueDate: date })] }));
  assert.equal(item.truth, truth); assert.equal(item.reasonCodes[0], reason);
});
test('utc_midnight_preserves_calendar_day_but_timed_values_use_saved_zone', async () => {
  for (const [dueDate, date] of [['2026-10-15T00:00:00Z', '2026-10-15'], ['2026-10-15T02:00:00Z', '2026-10-14']]) {
    const [item] = await evaluate(makeSource({ timeZone: 'America/Los_Angeles', evaluatedAt: '2026-10-15T18:00:00Z', tasks: [task({ dueDate })] }));
    assert.equal(item.evidence.date, date);
  }
});
test('milestone_project_ownership_required', async () => {
  const good = makeSource({ projects: [project({ targetDate: '2026-10-15' })], milestones: [milestone()] });
  assert.equal((await evaluate(good)).filter(d => d.truth === 'true').length, 2);
  for (const change of [{ projects: [project({ userId: 'other' })] }, { milestones: [milestone({ userId: 'other' })] }, { milestones: [milestone({ projectId: 'lost' })], targetChecks: { 'milestone:milestone-a:deadline': { complete: true, exists: false, sourceToken: 'sql-lost-link' } } }]) {
    const result = await evaluate({ ...good, ...change });
    assert.equal(result.find(d => d.target.type === 'milestone').truth, 'false');
  }
  const partial = await evaluate(makeSource({ projects: [], milestones: [milestone()], coverage: { ...good.coverage, projects: { complete: false } } }));
  assert.equal(partial[0].truth, 'unknown');
});
test('absent_parent_requires_targeted_link_loss_proof_even_with_complete_discovery', async () => {
  const source = makeSource({ tasks: [task()], projects: [] });
  assert.equal((await evaluate(source))[0].truth, 'unknown');
  source.targetChecks['task:task-a:attention'] = { complete: true, exists: false, sourceToken: 'sql-lost-link' };
  assert.equal((await evaluate(source))[0].truth, 'false');
});
test('null_missing_invalid_dates_are_distinct', async () => {
  for (const [dueDate, truth, issue] of [[null, 'false', 'MISSING_DATE'], [undefined, 'unknown', 'INCOMPLETE'], ['2026-02-30', 'unknown', 'INVALID_DATE'], ['nonsense', 'unknown', 'INVALID_DATE'], ['2026-02-30T12:00:00Z', 'unknown', 'INVALID_DATE']]) {
    const [item] = await evaluate(makeSource({ tasks: [task({ dueDate })] }));
    assert.equal(item.truth, truth); assert.equal(item.evidence.issue, issue);
  }
});
test('excluded_parent_statuses_exclude_all_deadlines', async () => {
  for (const status of ['Completed', 'Cancelled', 'On Hold']) {
    const result = await evaluate(makeSource({ projects: [project({ status, targetDate: '2026-10-15' })], tasks: [task()], milestones: [milestone()] }));
    assert.ok(result.every(d => d.truth === 'false'));
  }
  const result = await evaluate(makeSource({ tasks: [task({ status: 'Completed' })], milestones: [milestone({ status: 'completed' })] }));
  assert.ok(result.every(d => d.truth === 'false'));
});
test('blocked_deadlines_remain_visible', async () => {
  const result = await evaluate(makeSource({ projects: [project({ status: 'Blocked', targetDate: '2026-10-15' })], tasks: [task({ status: 'Blocked' })] }));
  assert.equal(result.filter(d => d.truth === 'true').length, 2);
  assert.equal(result.find(d => d.target.type === 'task').evidence.status, 'Blocked');
});
test('missing_or_invalid_saved_zone_is_unknown_without_fallback', async () => {
  for (const timeZone of [null, 'invalid/zone']) {
    const [item] = await evaluate(makeSource({ timeZone, tasks: [task()] }));
    assert.equal(item.truth, 'unknown'); assert.equal(item.evidence.issue, 'TIME_ZONE');
  }
});
test('dst_day_ends_at_next_local_midnight', async () => {
  for (const [evaluatedAt, dueDate, expiry] of [
    ['2026-03-08T05:00:00Z', '2026-03-08', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01T04:00:00Z', '2026-11-01', '2026-11-02T05:00:00.000Z'],
  ]) {
    const [item] = await evaluate(makeSource({ timeZone: 'America/New_York', evaluatedAt, tasks: [task({ dueDate })] }));
    assert.equal(item.reasonCodes[0], 'DEADLINE_TODAY'); assert.equal(item.evidenceValidUntil, expiry);
  }
});
test('leap_and_year_rollover_use_calendar_days', async () => {
  for (const [evaluatedAt, dueDate] of [['2028-02-28T23:59:00Z', '2028-02-29'], ['2026-12-31T23:59:00Z', '2027-01-01']]) {
    const [item] = await evaluate(makeSource({ evaluatedAt, tasks: [task({ dueDate })] }));
    assert.equal(item.truth, 'true'); assert.equal(item.rank, 1);
  }
});
test('positive_fact_survives_unrelated_truncation_and_preserves_sql_token', async () => {
  const source = makeSource({ tasks: [task()], coverage: { projects: { complete: true }, tasks: { complete: false }, milestones: { complete: false }, blocks: { complete: false } } });
  const [item] = await evaluate(source);
  assert.equal(item.truth, 'true'); assert.equal(item.sourceToken, 'sql-task');
  source.tasks[0].sourceToken = undefined;
  assert.equal((await evaluate(source))[0].truth, 'unknown');
});
