import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPulse, makeSource, project, complete } from './phase5d-test-support.mjs';
const source = (changes = {}) => makeSource({ projects: [project({ createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z' })], projectActivity: { 'project-a': { coverage: complete, lastActivityAt: null, invalidActivity: false, sourceToken: 'sql-activity' } }, ...changes });
const evaluate = async input => (await loadPulse('lib/ai/agent/pulse/signals.ts')).evaluateQuietProjects(input)[0];
test('normal_quiet_exact_14_days_and_just_below', async () => {
  assert.equal((await evaluate(source())).truth, 'true');
  assert.equal((await evaluate(source({ evaluatedAt: '2026-10-15T07:59:59.999Z' }))).truth, 'false');
});
test('maintenance_exact_60_days_and_just_below', async () => {
  const projects = [project({ workflowStage: 'maintenance', createdAt: '2026-08-16T08:00:00Z', updatedAt: '2026-08-16T08:00:00Z' })];
  assert.equal((await evaluate(source({ projects }))).truth, 'true');
  assert.equal((await evaluate(source({ projects, evaluatedAt: '2026-10-15T07:59:59.999Z' }))).truth, 'false');
  assert.equal((await evaluate(source({ projects: [project({ workflowStage: 'maintenance', createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z' })] }))).truth, 'false');
});
test('child_aggregate_change_resets_quiet_and_is_material', async () => {
  const before = await evaluate(source());
  const changed = source(); changed.projectActivity['project-a'].lastActivityAt = '2026-10-14T12:00:00Z';
  changed.projectActivity['project-a'].sourceToken = 'sql-new-activity';
  const after = await evaluate(changed);
  assert.equal(after.truth, 'false'); assert.equal(after.evidence.lastActivityAt, '2026-10-14T12:00:00Z');
  assert.notEqual(before.materialFingerprint, after.materialFingerprint);
});
test('new_project_has_creation_baseline', async () => {
  assert.equal((await evaluate(source({ projects: [project({ createdAt: '2026-10-15T07:59:00Z', updatedAt: '2026-10-15T07:59:00Z' })] }))).truth, 'false');
});
test('future_invalid_or_incomplete_activity_is_unknown', async () => {
  for (const activity of [undefined, { coverage: { complete: false }, lastActivityAt: null, invalidActivity: false }, { coverage: complete, lastActivityAt: null, invalidActivity: true }, { coverage: complete, lastActivityAt: '2026-10-16T00:00:00Z', invalidActivity: false }, { coverage: complete, lastActivityAt: 'bad', invalidActivity: false }, { coverage: complete, invalidActivity: false }]) {
    const projectActivity = activity ? { 'project-a': { sourceToken: 'sql-activity', ...activity } } : {};
    assert.equal((await evaluate(source({ projectActivity }))).truth, 'unknown');
  }
  for (const updatedAt of ['bad', '2026-10-16T00:00:00Z', undefined]) assert.equal((await evaluate(source({ projects: [project({ updatedAt })] }))).truth, 'unknown');
});
test('eligible_statuses_only_and_foreign_project_excluded', async () => {
  for (const status of ['Planning', 'Research', 'In Development', 'Testing', 'Deployment']) assert.equal((await evaluate(source({ projects: [project({ status })] }))).truth, 'true');
  for (const status of ['Completed', 'Cancelled', 'On Hold', 'Blocked']) assert.equal((await evaluate(source({ projects: [project({ status })] }))).truth, 'false');
  assert.equal((await evaluate(source({ projects: [project({ userId: 'other' })] }))).truth, 'false');
});
test('elapsed_age_does_not_change_material_fingerprint', async () => {
  const a = await evaluate(source()), b = await evaluate(source({ evaluatedAt: '2026-11-15T08:00:00Z' }));
  assert.equal(a.materialFingerprint, b.materialFingerprint);
  assert.match(a.evidence.summary, /recorded workspace changes/);
  assert.doesNotMatch(a.evidence.summary, /coding|GitHub|abandon|Focus|completion/i);
});
test('quiet_uses_elapsed_time_across_dst_and_needs_no_timezone', async () => {
  const input = source({ evaluatedAt: '2026-11-08T05:00:00Z', timeZone: 'America/New_York', projects: [project({ createdAt: '2026-10-25T05:00:00Z', updatedAt: '2026-10-25T05:00:00Z' })] });
  assert.equal((await evaluate(input)).truth, 'true');
  assert.equal((await evaluate({ ...input, evaluatedAt: '2026-11-08T04:59:59.999Z' })).truth, 'false');
  assert.equal((await evaluate({ ...input, timeZone: null })).truth, 'true');
});
test('omitted_workflow_and_null_required_project_activity_fail_closed', async () => {
  for (const changes of [{ workflowStage: undefined }, { createdAt: null }, { updatedAt: null }]) {
    assert.equal((await evaluate(source({ projects: [project(changes)] }))).truth, 'unknown');
  }
});
test('quiet_elapsed_threshold_preserves_postgres_microseconds', async () => {
  const input = source({ projects: [project({ createdAt: '2026-10-01T08:00:00.000001Z', updatedAt: '2026-10-01T08:00:00.000001Z' })] });
  assert.equal((await evaluate(input)).truth, 'false');
  assert.equal((await evaluate({ ...input, evaluatedAt: '2026-10-15T08:00:00.000001Z' })).truth, 'true');
  const future = source(); future.projectActivity['project-a'].lastActivityAt = '2026-10-15T08:00:00.000001Z';
  assert.equal((await evaluate(future)).truth, 'unknown');
});
