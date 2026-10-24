import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPulse, makeSource, project, task, milestone, block } from './phase5d-test-support.mjs';
const preferences = { workdayStart: '09:00', workdayEnd: '17:00', weekdays: [0, 1, 2, 3, 4, 5, 6], focusMinutes: 60, bufferMinutes: 120 };
const dueTasks = count => Array.from({ length: count }, (_, index) => task({ id: `task-${index}`, dueDate: '2026-10-16' }));
const evaluate = async source => (await loadPulse('lib/ai/agent/pulse/signals.ts')).evaluateTomorrow(source)[0];
test('five_deadlines_exact_and_four_below', async () => {
  for (const [count, truth] of [[4, 'false'], [5, 'true']]) {
    const item = await evaluate(makeSource({ tasks: dueTasks(count) }));
    assert.equal(item.truth, truth); assert.equal(item.evidence.taskCount, count);
    assert.equal(item.evidence.occupancyIssue, 'PREFERENCES_MISSING');
  }
});
test('counts_keep_project_and_milestone_context_separate_from_task_effort', async () => {
  const item = await evaluate(makeSource({ tasks: dueTasks(4), projects: [project({ targetDate: '2026-10-16' })], milestones: [milestone({ targetDate: '2026-10-16' })] }));
  assert.equal(item.truth, 'false'); assert.equal(item.evidence.taskCount, 4);
  assert.equal(item.evidence.milestoneCount, 1); assert.equal(item.evidence.projectCount, 1);
  assert.doesNotMatch(item.evidence.summary, /effort|overload|hours of tasks/i);
});
test('excluded_completed_and_foreign_tasks_do_not_count', async () => {
  const tasks = [...dueTasks(4), task({ id: 'completed', status: 'Completed', dueDate: '2026-10-16' }), task({ id: 'foreign', userId: 'other', dueDate: '2026-10-16' })];
  assert.equal((await evaluate(makeSource({ tasks }))).truth, 'false');
  assert.equal((await evaluate(makeSource({ tasks: dueTasks(5), projects: [project({ status: 'On Hold' })] }))).evidence.taskCount, 0);
});
test('occupancy_85_percent_exact_and_one_millisecond_below', async () => {
  for (const [endAt, truth] of [['2026-10-16T15:48:00Z', 'true'], ['2026-10-16T15:47:59.999Z', 'false']]) {
    const item = await evaluate(makeSource({ preferences, blocks: [block({ startAt: '2026-10-16T09:00:00Z', endAt })] }));
    assert.equal(item.truth, truth);
    if (truth === 'true') assert.equal(item.evidence.occupancyPercent, 85);
  }
});
test('union_clips_overlaps_and_break_custom_count_once', async () => {
  const blocks = [
    block({ startAt: '2026-10-16T08:00:00Z', endAt: '2026-10-16T13:00:00Z' }),
    block({ id: 'b', kind: 'break', startAt: '2026-10-16T12:00:00Z', endAt: '2026-10-16T15:00:00Z' }),
    block({ id: 'c', kind: 'custom', startAt: '2026-10-16T15:00:00Z', endAt: '2026-10-16T18:00:00Z' }),
  ];
  const item = await evaluate(makeSource({ preferences, blocks }));
  assert.equal(item.evidence.occupancyPercent, 100); assert.equal(item.truth, 'true');
});
test('completed_cancelled_foreign_blocks_and_buffers_are_not_occupancy', async () => {
  const blocks = [block({ startAt: '2026-10-16T09:00:00Z', endAt: '2026-10-16T10:00:00Z' }),
    ...[{ status: 'completed' }, { status: 'cancelled' }, { userId: 'other' }].map((change, i) => block({ id: `${i}`, startAt: '2026-10-16T10:00:00Z', endAt: '2026-10-16T17:00:00Z', ...change }))];
  const item = await evaluate(makeSource({ preferences, blocks }));
  assert.equal(item.truth, 'false'); assert.equal(item.evidence.occupancyPercent, 12.5);
});
test('nonworking_or_missing_invalid_preferences_omit_occupancy_without_defaults', async () => {
  for (const [saved, issue] of [[null, 'PREFERENCES_MISSING'], [{ ...preferences, weekdays: [0] }, 'NONWORKING_DAY'], [{ ...preferences, workdayStart: 'bad' }, 'PREFERENCES_INVALID']]) {
    const item = await evaluate(makeSource({ preferences: saved, tasks: dueTasks(5) }));
    assert.equal(item.truth, 'true'); assert.equal(item.evidence.occupancyPercent, null);
    assert.equal(item.evidence.occupancyIssue, issue);
    assert.deepEqual(item.reasonCodes, ['TOMORROW_DEADLINES']);
  }
});
test('partial_or_invalid_counts_and_occupancy_are_unknown', async () => {
  const source = makeSource({ preferences });
  for (const change of [{ coverage: { ...source.coverage, tasks: { complete: false }, blocks: { complete: false } } }, { tasks: [task({ dueDate: 'bad' })], blocks: [block({ startAt: 'bad' })] }]) {
    const item = await evaluate({ ...source, ...change });
    assert.equal(item.truth, 'unknown'); assert.equal(item.evidence.taskCount, null);
    assert.equal(item.evidence.occupancyPercent, null);
  }
});
test('independent_valid_trigger_survives_other_unknown_metric', async () => {
  const source = makeSource({ preferences, tasks: dueTasks(5), blocks: [block({ startAt: 'bad' })] });
  const item = await evaluate(source);
  assert.equal(item.truth, 'true'); assert.deepEqual(item.reasonCodes, ['TOMORROW_DEADLINES']);
  assert.equal(item.evidence.occupancyIssue, 'INVALID_RANGE');
});
test('tomorrow_rollover_expires_at_next_local_day', async () => {
  const a = await evaluate(makeSource({ tasks: dueTasks(5) }));
  const b = await evaluate(makeSource({ tasks: dueTasks(5), evaluatedAt: '2026-10-16T00:00:00Z' }));
  assert.equal(a.evidenceValidUntil, '2026-10-16T00:00:00.000Z');
  assert.notEqual(a.key, b.key); assert.equal(b.truth, 'false');
});
test('dst_work_window_uses_actual_instants_and_ambiguous_hours_are_omitted', async () => {
  const input = makeSource({ timeZone: 'America/New_York', evaluatedAt: '2026-03-07T12:00:00Z', preferences: { ...preferences, workdayStart: '00:00', workdayEnd: '08:00' }, blocks: [block({ startAt: '2026-03-08T05:00:00Z', endAt: '2026-03-08T12:00:00Z' })] });
  assert.equal((await evaluate(input)).evidence.occupancyPercent, 100);
  const invalid = { ...input, preferences: { ...preferences, workdayStart: '02:30', workdayEnd: '08:00' } };
  assert.equal((await evaluate(invalid)).evidence.occupancyIssue, 'PREFERENCES_INVALID');
});
test('missing_zone_and_canonical_token_fail_closed', async () => {
  assert.equal((await evaluate(makeSource({ timeZone: null }))).truth, 'unknown');
  assert.equal((await evaluate(makeSource({ tasks: dueTasks(5), tomorrowSourceToken: undefined }))).truth, 'unknown');
});
test('tomorrow_source_order_does_not_change_material_fingerprint', async () => {
  const source = makeSource({ preferences, tasks: dueTasks(5), blocks: [block({ startAt: '2026-10-16T09:00:00Z', endAt: '2026-10-16T10:00:00Z' }), block({ id: 'b', startAt: '2026-10-16T11:00:00Z', endAt: '2026-10-16T12:00:00Z' })] });
  const a = await evaluate(source), b = await evaluate({ ...source, tasks: [...source.tasks].reverse(), blocks: [...source.blocks].reverse() });
  assert.equal(a.materialFingerprint, b.materialFingerprint);
});
test('unrelated_undated_task_and_blocks_outside_tomorrow_do_not_change_material', async () => {
  const input = makeSource({ preferences, tasks: dueTasks(5) });
  const changed = { ...input, tasks: [...input.tasks, task({ id: 'undated', dueDate: null })], blocks: [block()] };
  assert.equal((await evaluate(input)).materialFingerprint, (await evaluate(changed)).materialFingerprint);
});
test('occupancy_threshold_preserves_postgres_microseconds', async () => {
  const item = await evaluate(makeSource({ preferences, blocks: [block({ startAt: '2026-10-16T09:00:00.000001Z', endAt: '2026-10-16T15:48:00Z' })] }));
  assert.equal(item.truth, 'false');
});
