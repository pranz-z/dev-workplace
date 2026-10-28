import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`;
const configUrl = moduleUrl(await read('../../components/portfolio/ascii-scene-config.ts'));
const { ACTIONS, SCENE_CONFIG, actionPose } = await import(configUrl);
const { SceneDirector, SceneCompositor, isNight, sampleCharacterSource } = await import(moduleUrl((await read('../../components/portfolio/ascii-scene-runtime.ts')).replace('"./ascii-scene-config"', JSON.stringify(configUrl))));
const clip = JSON.parse(await read('../../components/portfolio/ascii-data/animation.json'));
const seeded = seed => () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };

function simulate(seed, hour = 12) {
  const director = new SceneDirector(seeded(seed), () => hour), events = [];
  let previous = 'idle', ended = 0;
  for (let t = 0; t < 120000; t += 50) {
    const state = director.advance(50);
    if (state.action === 'idle' && previous !== 'idle') ended = state.time;
    if (state.action !== 'idle' && state.action !== previous) {
      assert.ok(state.time - ended >= 3000, 'at least three seconds neutral between actions');
      assert.notEqual(state.action, events.at(-1)?.action, 'no immediate automatic repeats');
      events.push({ action: state.action, at: state.time });
    }
    previous = state.action;
  }
  return events;
}

test('weighted two-minute routines vary, are reproducible with a seed, and respect cooldowns', () => {
  assert.deepEqual(simulate(42), simulate(42));
  assert.notDeepEqual(simulate(42), simulate(43));
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const events = simulate(seed);
    events.forEach(e => seen.add(e.action));
    const stretches = events.filter(e => e.action === 'stretch');
    assert.ok(stretches[0].at >= 40000);
    for (let i = 1; i < stretches.length; i++) assert.ok(stretches[i].at - stretches[i - 1].at >= 40000);
    const builds = events.filter(e => ['celebrate', 'frustrated'].includes(e.action));
    builds.forEach((e, i) => assert.equal(e.action, i % 2 ? 'celebrate' : 'frustrated'));
  }
  assert.deepEqual([...seen].sort(), Object.keys(ACTIONS).sort());
});

test('all gestures are 1.5–4s and return to neutral at both endpoints', () => {
  for (const [action, config] of Object.entries(ACTIONS)) {
    assert.ok(config.durationMs >= 1500 && config.durationMs <= 4000);
    for (const progress of [0, 1]) for (const offset of Object.values(actionPose(action, progress))) {
      for (const value of Object.values(offset)) assert.ok(Math.abs(value) < .000001, `${action} returns to neutral`);
    }
  }
  assert.ok(SCENE_CONFIG.fps >= 20 && SCENE_CONFIG.fps <= 24);
});

test('head, neck and shoulders use a continuous source map instead of cut-and-fill seams', () => {
  assert.equal(typeof sampleCharacterSource, 'function');
  for (const action of ['stretch', 'lean', 'look', 'yawn', 'celebrate']) {
    const pose = actionPose(action, .45);
    pose.head.x += 2; pose.head.degrees += 4;
    for (let y = 20; y < 42; y++) for (let x = 65; x < 100; x++) {
      const a = sampleCharacterSource(x, y, pose), b = sampleCharacterSource(x, y + 1, pose);
      assert.ok(Math.abs((a.x - x) - (b.x - x)) < .75, 'no displacement step at the neck/shoulder border');
      assert.ok(Math.abs((a.y - y) - (b.y - y - 1)) < .75, 'no row cut or inversion at a part boundary');
      assert.ok(a.x >= 0 && a.x < 180 && a.y >= 0 && a.y < 105);
    }
  }
});

test('night weighting is bounded to local 22:00–04:59 and clock failures are harmless', () => {
  for (const h of [22, 23, 0, 4.99]) assert.equal(isNight(h), true);
  for (const h of [5, 12, 21, 24, -1, undefined, NaN]) assert.equal(isNight(h), false);
  assert.equal(new SceneDirector(seeded(3), () => { throw Error('clock unavailable'); }).advance(4000).night, false);
  const yawns = hour => Array.from({ length: 60 }, (_, i) => simulate(i + 1, hour).filter(e => e.action === 'yawn').length).reduce((a, b) => a + b, 0);
  assert.ok(yawns(23) > yawns(12));
});

test('interaction cooldown, first-entry greeting, zero-weight disable, and frozen active time', () => {
  const director = new SceneDirector(seeded(5));
  assert.equal(director.request('hero-enter'), true);
  assert.equal(director.request('hero-enter'), false);
  assert.equal(director.request('click'), true);
  assert.equal(director.request('click'), false);
  director.advance(5000);
  assert.equal(director.request('click'), true);
  const before = director.time;
  // Suspended/paused driver does not advance the director; no wall-clock catch-up.
  assert.equal(director.advance(0).time, before);
  const weights = Object.fromEntries(Object.entries(ACTIONS).map(([a, c]) => [a, c.weight]));
  try {
    ACTIONS.frustrated.weight = 0;
    const withoutErrors = simulate(9);
    assert.ok(withoutErrors.some(e => e.action === 'celebrate'), 'disabling errors must not also disable success');
    assert.ok(withoutErrors.every(e => e.action !== 'frustrated'));
    Object.values(ACTIONS).forEach(c => { c.weight = 0; });
    const disabled = new SceneDirector(seeded(1));
    assert.equal(disabled.request('click'), false);
    assert.equal(disabled.request('hero-enter'), false);
    for (let i = 0; i < 1000; i++) assert.equal(disabled.advance(100).action, 'idle');
  } finally { Object.entries(weights).forEach(([a, weight]) => { ACTIONS[a].weight = weight; }); }
});

test('dirty-row compositor keeps the grid and furniture intact, and skips unchanged rows', () => {
  const compositor = new SceneCompositor(clip, seeded(7));
  const state = { action: 'idle', progress: 0, time: 0, night: false, sleepy: false, sourceFrame: 0 };
  const first = compositor.render(state, 0, 469, false);
  assert.equal(first.rows.length, 105);
  first.rows.forEach(row => assert.equal(row.map(run => run[1]).join('').length, 180));
  const sourceRows = clip.frames[0].map(i => clip.runs[i][1]).join('').split('\n');
  for (let y = 60; y < 105; y++) assert.equal(first.rows[y].map(run => run[1]).join(''), sourceRows[y], 'chair, legs, floor and boots unchanged');
  assert.ok(compositor.render(state, 0, 469, false).rows.every(row => row === null));
  for (const action of Object.keys(ACTIONS)) {
    const result = compositor.render({ ...state, action, progress: .5, time: 2000 }, 50, 300, true);
    result.rows.filter(Boolean).forEach(row => assert.equal(row.map(run => run[1]).join('').length, 180));
    assert.ok(result.glow >= 0 && result.glow <= .08);
  }
  compositor.reset();
  const night = compositor.render({ ...state, night: true }, 0, 469, false);
  assert.ok(night.rows[49].map(run => run[1]).join('').includes('still working'));
  assert.equal(compositor.render({ ...state, action: 'think', progress: .7 }, 50, 469, false).glow, 0);
});
