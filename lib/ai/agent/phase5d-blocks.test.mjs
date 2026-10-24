import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPulse, makeSource, task, block, project, complete } from './phase5d-test-support.mjs';
const source = (blocks = [], changes = {}) => makeSource({ tasks: [task()], taskBlocks: { 'task-a': { coverage: complete, blocks, sourceToken: 'sql-relationship' } }, ...changes });
const evaluate = async input => (await loadPulse('lib/ai/agent/pulse/signals.ts')).evaluateImportantTasks(input)[0];
test('high_and_critical_only', async () => {
  for (const priority of ['High', 'Critical', 'Medium', 'Low', null]) {
    const result = await evaluate(source([], { tasks: [task({ priority })] }));
    assert.equal(result.truth, ['High', 'Critical'].includes(priority) ? 'true' : 'false');
  }
});
test('no_due_date_is_not_no_work_and_past_or_far_dates_are_excluded', async () => {
  for (const dueDate of [null, '2026-10-14', '2026-10-19']) assert.equal((await evaluate(source([], { tasks: [task({ dueDate })] }))).truth, 'false');
  for (const dueDate of [undefined, 'bad']) assert.equal((await evaluate(source([], { tasks: [task({ dueDate })] }))).truth, 'unknown');
  assert.equal((await evaluate(source([], { tasks: [task({ dueDate: '2026-10-18' })] }))).truth, 'true');
});
test('partial_blocks_never_prove_absence_and_targeted_coverage_can_override_generic_cap', async () => {
  assert.equal((await evaluate(source([], { taskBlocks: {} }))).truth, 'unknown');
  assert.equal((await evaluate(source([], { taskBlocks: { 'task-a': { coverage: { complete: false }, blocks: [], sourceToken: 'sql-partial' } } }))).truth, 'unknown');
  assert.equal((await evaluate(source([], { coverage: { projects: complete, tasks: complete, milestones: complete, blocks: { complete: false } } }))).truth, 'true');
});
test('running_focus_counts_and_cross_query_boundary_blocks_count', async () => {
  for (const times of [
    { startAt: '2026-10-15T07:30:00Z', endAt: '2026-10-15T08:30:00Z' },
    { startAt: '2026-10-14T23:30:00Z', endAt: '2026-10-15T08:30:00Z' },
  ]) assert.equal((await evaluate(source([block(times)]))).truth, 'false');
});
test('cancelled_completed_break_custom_do_not_count', async () => {
  for (const change of [{ status: 'cancelled' }, { status: 'completed' }, { kind: 'break' }, { kind: 'custom' }]) {
    assert.equal((await evaluate(source([block(change)]))).truth, 'true');
  }
});
test('same_owner_task_and_canonical_project_links_required', async () => {
  for (const change of [{ userId: 'other' }, { taskId: null }, { taskId: 'other' }, { projectId: null }, { projectId: 'other' }]) {
    assert.equal((await evaluate(source([block(change)]))).truth, 'true');
  }
  for (const status of ['Completed', 'Blocked']) assert.equal((await evaluate(source([], { tasks: [task({ status })] }))).truth, 'false');
  assert.equal((await evaluate(source([], { projects: [project({ status: 'On Hold' })] }))).truth, 'false');
});
test('one_minute_remaining_boundary_and_expiry', async () => {
  for (const [endAt, truth] of [['2026-10-15T08:00:59.999Z', 'true'], ['2026-10-15T08:01:00Z', 'false'], ['2026-10-15T08:01:00.001Z', 'false']]) {
    const item = await evaluate(source([block({ startAt: '2026-10-15T07:59:00Z', endAt })]));
    assert.equal(item.truth, truth);
    if (endAt === '2026-10-15T08:01:00Z') assert.equal(item.evidenceValidUntil, '2026-10-15T08:00:00.000001Z');
  }
});
test('future_time_is_clipped_at_exclusive_deadline_end', async () => {
  for (const [startAt, endAt, truth] of [
    ['2026-10-15T23:59:00Z', '2026-10-16T01:00:00Z', 'false'],
    ['2026-10-15T23:59:00.001Z', '2026-10-16T01:00:00Z', 'true'],
    ['2026-10-16T00:00:00Z', '2026-10-16T01:00:00Z', 'true'],
  ]) assert.equal((await evaluate(source([block({ startAt, endAt })]))).truth, truth);
});
test('invalid_relevant_range_is_unknown_not_absence', async () => {
  for (const times of [{ startAt: 'bad' }, { endAt: '2026-10-15T09:00:00Z' }, { endAt: '2026-10-16T23:00:00Z' }]) {
    assert.equal((await evaluate(source([block(times)]))).truth, 'unknown');
  }
});
test('new_block_changes_source_without_task_version', async () => {
  const before = source(); const after = source([block()]);
  after.taskBlocks['task-a'].sourceToken = 'sql-relationship-with-block';
  assert.equal(before.tasks[0].updatedAt, after.tasks[0].updatedAt);
  const a = await evaluate(before), b = await evaluate(after);
  assert.notEqual(a.materialFingerprint, b.materialFingerprint);
  assert.notEqual(a.sourceToken, b.sourceToken);
  assert.equal(b.sourceToken, 'sql-relationship-with-block');
  assert.equal(a.key, 'task:task-a:attention');
  assert.deepEqual(a.reasonCodes, ['IMPORTANT_NO_WORK']);
});
test('omitted_priority_is_unknown_and_null_priority_is_known_not_important', async () => {
  assert.equal((await evaluate(source([], { tasks: [task({ priority: undefined })] }))).truth, 'unknown');
  assert.equal((await evaluate(source([], { tasks: [task({ priority: null })] }))).truth, 'false');
});
test('postgres_microseconds_cannot_turn_less_than_one_minute_into_qualifying_work', async () => {
  const evaluatedAt = '2026-10-15T08:00:00.000001Z';
  for (const [endAt, truth] of [['2026-10-15T08:01:00Z', 'true'], ['2026-10-15T08:01:00.000001Z', 'false']]) {
    const item = await evaluate(source([block({ startAt: '2026-10-15T07:59:00Z', endAt })], { evaluatedAt }));
    assert.equal(item.truth, truth);
  }
  const item = await evaluate(source([block({ startAt: '2026-10-15T23:59:00.000001Z', endAt: '2026-10-16T01:00:00Z' })]));
  assert.equal(item.truth, 'true');
});
