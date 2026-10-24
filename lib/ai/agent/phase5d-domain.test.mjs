import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadPulse, makeSource, task, project, complete } from './phase5d-test-support.mjs';

const path = name => `lib/ai/agent/pulse/${name}.ts`;
test('partial_absence_is_unknown', async () => {
  const { isComplete, absenceTruth } = await loadPulse(path('completeness'));
  assert.equal(isComplete({ complete: false }), false);
  assert.equal(absenceTruth({ complete: false }), 'unknown');
  assert.equal(absenceTruth({ complete: true }), 'false');
  assert.notEqual('unknown', 'false');
});
test('fingerprint_ignores_age_and_unrelated_updated_at', async () => {
  const { materialFingerprint: hash } = await loadPulse(path('fingerprints'));
  assert.equal(hash({ date: '2026-10-15', ageDays: 14, updatedAt: 'a' }), hash({ updatedAt: 'b', ageDays: 90, date: '2026-10-15' }));
  assert.equal(hash({ date: '2026-10-15', urgency: 'today' }), hash({ date: '2026-10-15', urgency: 'overdue' }));
});
test('material_change_changes_fingerprint_and_preserves_null_missing', async () => {
  const { materialFingerprint: hash } = await loadPulse(path('fingerprints'));
  assert.notEqual(hash({ date: null }), hash({}));
  assert.notEqual(hash({ date: undefined }), hash({ date: null }));
  assert.notEqual(hash({ date: '2026-10-15' }), hash({ date: '2026-10-16' }));
  assert.notEqual(hash({ lastActivityAt: '2026-10-01' }), hash({ lastActivityAt: '2026-10-02' }));
});
test('stable_keys_merge_task_attention_without_a_fifth_family', async () => {
  const { conditionKey } = await loadPulse(path('fingerprints'));
  const { SIGNAL_FAMILIES } = await loadPulse(path('policy'));
  assert.equal(SIGNAL_FAMILIES.length, 4);
  assert.equal(new Set(SIGNAL_FAMILIES).size, 4);
  assert.equal(conditionKey({ type: 'task', id: 'task-a' }, 'deadline'), 'task:task-a:attention');
  assert.equal(conditionKey({ type: 'task', id: 'task-a' }, 'important_work'), 'task:task-a:attention');
  assert.equal(conditionKey({ type: 'workspace_day', id: 'owner' }, 'tomorrow', '2026-10-16'), 'workspace_day:owner:tomorrow:2026-10-16');
});
test('reason_codes_are_bounded', async () => {
  const { validateReasonCodes } = await loadPulse(path('policy'));
  assert.deepEqual(validateReasonCodes(['DEADLINE_TODAY', 'IMPORTANT_NO_WORK', 'DEADLINE_TODAY']), ['DEADLINE_TODAY', 'IMPORTANT_NO_WORK']);
  assert.throws(() => validateReasonCodes(['arbitrary model reasoning']));
  assert.throws(() => validateReasonCodes(Array(100).fill('DEADLINE_TODAY')));
});
test('unicode_limits_use_code_points', async () => {
  const { boundText, PULSE_POLICY } = await loadPulse(path('policy'));
  for (const [field, limit] of [['title', 120], ['summary', 400], ['explanation', 240], ['conditionKey', 160]]) {
    assert.equal(PULSE_POLICY.limits[field], limit);
    assert.equal([...boundText('😀'.repeat(limit + 1), limit)].length, limit);
    assert.ok(boundText('😀'.repeat(limit + 1), limit).endsWith('😀'));
  }
});
test('browser_dto_has_no_authority_fields_or_imports', () => {
  const url = new URL('../../../data/agentInbox.ts', import.meta.url);
  const ast = ts.createSourceFile('agentInbox.ts', readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
  const forbidden = /sourceToken|fingerprint|lease|fence|authority|evidence|payload|before_state/i;
  function visit(node) {
    assert.notEqual(node.kind, ts.SyntaxKind.ImportDeclaration);
    if (ts.isPropertySignature(node)) assert.doesNotMatch(node.name.getText(ast), forbidden);
    ts.forEachChild(node, visit);
  }
  visit(ast);
});
test('scanner_exposes_a_pure_typed_boundary', async () => {
  const { scanPulse } = await loadPulse(path('scanner'));
  const { PULSE_POLICY } = await loadPulse(path('policy'));
  const result = scanPulse(makeSource(), [], PULSE_POLICY);
  assert.ok(Array.isArray(result.decisions));
  assert.ok(Array.isArray(result.newCandidates));
  assert.ok(result.coverage);
});

const scanner = () => loadPulse(path('scanner'));
const policy = async () => (await loadPulse(path('policy'))).PULSE_POLICY;
test('task_card_merges_reasons_and_keeps_canonical_relationship_token', async () => {
  const { scanPulse } = await scanner();
  const source = makeSource({ tasks: [task()], taskBlocks: { 'task-a': { blocks: [], coverage: complete, sourceToken: 'sql-combined-task' } } });
  const result = scanPulse(source, [], await policy());
  const card = result.newCandidates.find(d => d.target.type === 'task');
  assert.deepEqual(card.reasonCodes, ['DEADLINE_TODAY', 'IMPORTANT_NO_WORK']);
  assert.equal(card.family, 'deadline'); assert.equal(card.sourceToken, 'sql-combined-task');
  assert.equal(result.decisions.filter(d => d.target.type === 'task').length, 1);
});
test('brief_rank_has_six_classes_and_stable_tie_breaks', async () => {
  const { rankDecisions } = await scanner();
  const item = (id, rank, extra = {}) => ({ key: id, target: { type: 'task', id }, rank, ...extra });
  const input = [item('idea', 5), item('quiet', 4), item('plus3', 3), item('tomorrow-load', 2), item('tomorrow', 1), item('overdue', 0)];
  assert.deepEqual(rankDecisions(input).map(d => d.key), ['overdue', 'tomorrow', 'tomorrow-load', 'plus3', 'quiet', 'idea']);
  const ties = [item('z', 1, { deadline: '2026-10-16', priority: 'High' }), item('b', 1, { deadline: '2026-10-16', priority: 'Critical', materialChangedAt: '2026-10-13T00:00:00Z' }), item('a', 1, { deadline: '2026-10-16', priority: 'Critical', materialChangedAt: '2026-10-14T00:00:00Z' }), item('earlier', 1, { deadline: '2026-10-15', priority: 'Low' })];
  assert.deepEqual(rankDecisions(ties).map(d => d.key), ['earlier', 'a', 'b', 'z']);
  assert.equal(input[0].key, 'idea');
});
test('admission_is_three_new_and_twenty_existing_after_ranking', async () => {
  const { scanPulse } = await scanner(); const p = await policy();
  const tasks = Array.from({ length: 30 }, (_, i) => task({ id: `task-${String(i).padStart(2, '0')}`, priority: 'Low' }));
  tasks[29].dueDate = '2026-10-01';
  const source = makeSource({ tasks });
  const initial = scanPulse(source, [], p);
  assert.equal(initial.newCandidates.length, 3); assert.equal(initial.newCandidates[0].target.id, 'task-29');
  const prior = tasks.slice(0, 25).map(t => ({ key: `task:${t.id}:attention`, target: { type: 'task', id: t.id }, family: 'deadline', state: 'active', materialFingerprint: 'old', sourceToken: 'old', evidenceValidUntil: '2026-10-15T00:00:00Z' }));
  const next = scanPulse({ ...source, existing: prior }, prior, p);
  assert.equal(next.decisions.filter(d => prior.some(o => o.key === d.key)).length, 20);
  assert.equal(next.newCandidates.length, 3); assert.ok(next.decisions.length <= 23);
});
test('unknown_does_not_resolve_or_reopen_prior_or_advance_uncovered_baseline', async () => {
  const { scanPulse } = await scanner();
  const prior = [{ key: 'task:lost:attention', target: { type: 'task', id: 'lost' }, family: 'deadline', state: 'dismissed', materialFingerprint: 'held', sourceToken: 'old', evidenceValidUntil: '2026-10-15T00:00:00Z' }];
  const source = makeSource({ coverage: { projects: complete, tasks: { complete: false }, milestones: complete, blocks: complete }, baseline: { missing: 'keep' } });
  const result = scanPulse(source, prior, await policy());
  assert.equal(result.decisions.find(d => d.key === prior[0].key).truth, 'unknown');
  assert.equal(result.decisions.find(d => d.key === prior[0].key).materialFingerprint, 'held');
  assert.equal(result.baselinePatches[prior[0].key], undefined);
  assert.equal(result.newCandidates.length, 0); assert.equal(source.baseline.missing, 'keep');
});
test('only_targeted_complete_owner_loss_can_resolve_missing_prior', async () => {
  const { scanPulse } = await scanner();
  const prior = [{ key: 'task:lost:attention', target: { type: 'task', id: 'lost' }, family: 'deadline', state: 'active', materialFingerprint: 'old', sourceToken: 'old', evidenceValidUntil: '2026-10-15T00:00:00Z' }];
  for (const [check, truth] of [[undefined, 'unknown'], [{ complete: false, exists: false, sourceToken: 'sql-check' }, 'unknown'], [{ complete: true, exists: false, sourceToken: 'sql-check' }, 'false']]) {
    const source = makeSource({ targetChecks: check ? { [prior[0].key]: check } : {} });
    const card = scanPulse(source, prior, await policy()).decisions.find(d => d.key === prior[0].key);
    assert.equal(card.truth, truth);
  }
});
test('partial_task_attention_keeps_prior_material_and_only_patches_covered_components', async () => {
  const { scanPulse } = await scanner();
  const prior = [{ key: 'task:task-a:attention', target: { type: 'task', id: 'task-a' }, family: 'deadline', state: 'dismissed', materialFingerprint: 'held', sourceToken: 'old', evidenceValidUntil: '2026-10-15T00:00:00Z' }];
  const result = scanPulse(makeSource({ tasks: [task()] }), prior, await policy());
  const card = result.decisions.find(d => d.key === prior[0].key);
  assert.equal(card.materialFingerprint, 'held');
  assert.ok(result.baselinePatches[`${card.key}/deadline`]);
  assert.equal(result.baselinePatches[`${card.key}/important_work`], undefined);
  assert.equal(result.baselinePatches[card.key], undefined);
});
test('scanner_is_byte_deterministic_and_does_not_mutate_source_or_prior', async () => {
  const { scanPulse } = await scanner();
  const source = makeSource({ tasks: [task({ id: 'b', priority: 'Low' }), task({ id: 'a', priority: 'Low' })], projects: [project({ id: 'z' }), project()] });
  const frozen = JSON.stringify(source);
  const a = scanPulse(source, [], await policy());
  const b = scanPulse({ ...source, tasks: [...source.tasks].reverse(), projects: [...source.projects].reverse() }, [], await policy());
  assert.equal(a.newCandidates.length, 2);
  assert.equal(JSON.stringify(a), JSON.stringify(b)); assert.equal(JSON.stringify(source), frozen);
});
test('scanner_bounds_unicode_text_and_utf8_evidence', async () => {
  const { scanPulse } = await scanner();
  const result = scanPulse(makeSource({ tasks: [task({ title: '😀'.repeat(2000), priority: 'Low' })] }), [], await policy());
  assert.equal(result.newCandidates.length, 1);
  for (const item of result.decisions) {
    assert.ok([...item.evidence.title].length <= 120);
    assert.ok([...item.evidence.summary].length <= 400);
    assert.ok([...item.evidence.explanation].length <= 240);
    assert.ok(Buffer.byteLength(JSON.stringify(item.evidence), 'utf8') <= 2048);
  }
});
test('bounded_domain_unions_match_approved_pulse_outcomes_and_idea_categories', () => {
  const ast = ts.createSourceFile('types.ts', readFileSync(new URL('./pulse/types.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const members = name => ast.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === name).type.types.map(node => node.literal.text);
  assert.deepEqual(members('PulseStatus'), ['running', 'succeeded', 'partial', 'failed', 'abandoned']);
  assert.deepEqual(members('IdeaCategory'), ['review_deadline', 'consider_scheduling', 'review_quiet_project', 'review_tomorrow']);
});
test('unknown_tomorrow_occupancy_does_not_advance_its_baseline_or_reopen_suppression', async () => {
  const { scanPulse } = await scanner();
  const tasks = Array.from({ length: 5 }, (_, i) => task({ id: `${i}`, dueDate: '2026-10-16', priority: 'Low' }));
  const source = makeSource({ tasks, preferences: { workdayStart: '09:00', workdayEnd: '17:00', weekdays: [5], focusMinutes: 60, bufferMinutes: 0 } });
  source.coverage.blocks = { complete: false };
  const key = 'workspace_day:owner:tomorrow:2026-10-16';
  const prior = [{ key, target: { type: 'workspace_day', id: 'owner' }, family: 'tomorrow', state: 'dismissed', materialFingerprint: 'held', sourceToken: 'old', evidenceValidUntil: '2026-10-16T00:00:00Z' }];
  const result = scanPulse(source, prior, await policy());
  const card = result.decisions.find(item => item.key === key);
  assert.equal(card.truth, 'true'); assert.equal(card.complete, false);
  assert.equal(card.materialFingerprint, 'held');
  assert.equal(result.baselinePatches[key], undefined);
  assert.equal(result.baselinePatches[`${key}/occupancy`], undefined);
  assert.ok(result.baselinePatches[`${key}/taskCount`]);
});
test('deadline_urgency_age_and_unrelated_versions_do_not_change_task_material', async () => {
  const { scanPulse } = await scanner();
  const before = makeSource({ tasks: [task({ priority: 'Low' })] });
  const after = makeSource({ evaluatedAt: '2026-10-16T08:00:00Z', tasks: [task({ priority: 'Low', updatedAt: '2026-10-16T07:00:00Z' })] });
  const a = scanPulse(before, [], await policy()).newCandidates[0];
  const b = scanPulse(after, [], await policy()).newCandidates[0];
  assert.equal(a.materialFingerprint, b.materialFingerprint);
});
test('coverage_reports_unknown_checks_even_when_no_card_is_admitted', async () => {
  const { scanPulse } = await scanner();
  const source = makeSource(); source.coverage.tasks = { complete: false };
  const result = scanPulse(source, [], await policy());
  assert.equal(result.decisions.length, 0);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.collections.tasks, false);
  assert.equal(result.coverage.unknown, 2);
});
