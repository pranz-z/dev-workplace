import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`;
const configUrl = moduleUrl(await read('../../components/portfolio/ascii-scene-config.ts'));
const { ACTIONS, EYES, SCENE_CONFIG, actionPose } = await import(configUrl);
const { SceneDirector, SceneCompositor, SceneAttention, isNight, sampleCharacterSource, prepareCharacterSampler, sampleGazeEye } = await import(moduleUrl((await read('../../components/portfolio/ascii-scene-runtime.ts')).replace('"./ascii-scene-config"', JSON.stringify(configUrl))));
const clip = JSON.parse(await read('../../components/portfolio/ascii-data/animation.json'));
const cols=clip.columns??180,rows=clip.rows??105,sx=cols/180,sy=rows/105;
const awaitCrop=await read('./hero-eye-source.json');
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
  assert.equal(first.rows.length, rows);
  first.rows.forEach(row => assert.equal(row.map(run => run[1]).join('').length, cols));
  const sourceRows = clip.frames[0].map(i => clip.runs[i][1]).join('').split('\n');
  for (let y = Math.ceil(60*sy); y < rows; y++) assert.equal(first.rows[y].map(run => run[1]).join(''), sourceRows[y], 'chair, legs, floor and boots unchanged');
  assert.ok(compositor.render(state, 0, 469, false).rows.every(row => row === null));
  for (const action of Object.keys(ACTIONS)) {
    const result = compositor.render({ ...state, action, progress: .5, time: 2000 }, 50, 300, true);
    result.rows.filter(Boolean).forEach(row => assert.equal(row.map(run => run[1]).join('').length, cols));
    assert.ok(result.glow >= 0 && result.glow <= .08);
  }
  compositor.reset();
  const night = compositor.render({ ...state, night: true }, 0, 469, false);
  const nightRow=night.rows[Math.round(49*sy)].map(run=>run[1]).join('');
  assert.equal([..."still working"].map((_,i)=>nightRow[Math.round((111+i)*sx)]).join(''),'still working');
  assert.equal(compositor.render({ ...state, action: 'think', progress: .7 }, 50, 469, false).glow, 0);
});

test('cursor activity freezes routine time; idle, scroll/leave release it without catch-up', () => {
  const attention = new SceneAttention(), director = new SceneDirector(seeded(9));
  director.advance(8000);
  const before = director.time;
  assert.equal(attention.tracking(0), false);
  for (let now = 100; now <= 2000; now += 100) {
    assert.equal(attention.move(now, 200, now), true);
    director.advance(attention.tracking(now) ? 0 : 100);
    assert.equal(director.time, before, 'gestures, source clips and environmental clocks freeze');
  }
  assert.equal(attention.move(2000, 200, 2200), false, 'identical coordinates do not extend attention');
  assert.equal(attention.tracking(2000 + SCENE_CONFIG.pointer.idleMs - 1), true);
  assert.equal(attention.tracking(2000 + SCENE_CONFIG.pointer.idleMs), false);
  assert.equal(director.advance(50).time, before + 50, 'resume without consuming cursor wall time');
  attention.move(30, 50, 3000);
  attention.release();
  assert.equal(attention.tracking(3001), false, 'scroll or leaving the window resumes immediately');
  assert.equal(attention.move(31, 50, 3002), true, 'next real movement re-enters tracking');
});

test('tracking changes the connected head/eyes while body, props and effects stay frozen', () => {
  const state = { action: 'idle', progress: 0, time: 8000, night: false, sleepy: false, sourceFrame: 0 };
  const snapshot = (x, y) => {
    const compositor = new SceneCompositor(clip, seeded(7));
    compositor.point(x, y);
    return compositor.render(state, 1000, 469, false, true).rows.map(row => row.map(run => run[1]).join(''));
  };
  const left = snapshot(-1, -.5), right = snapshot(1, .5);
  assert.notDeepEqual(left.slice(Math.floor(15*sy), Math.ceil(29*sy)), right.slice(Math.floor(15*sy), Math.ceil(29*sy)), 'head and eye region follows direction');
  assert.deepEqual(left.slice(Math.ceil(36*sy)), right.slice(Math.ceil(36*sy)), 'no torso, typing, mug or furniture movement');
  const compositor = new SceneCompositor(clip, seeded(7));
  compositor.point(1, .5);
  const first = compositor.render(state, 10000, 469, false, true);
  const second = compositor.render(state, 10000, 469, false, true);
  assert.ok(second.rows.every(row => row === null), 'environment and body remain unchanged at a settled gaze');
  assert.equal(first.glow, second.glow, 'lighting clock also stays frozen');
  const mobile = new SceneCompositor(clip, seeded(7));
  mobile.point(1, 1);
  assert.deepEqual(mobile.render(state, 1000, 469, true, true), new SceneCompositor(clip, seeded(7)).render(state, 1000, 469, true, true), 'coarse/mobile ignores gaze');
});

test('gaze moves the original eye pixels identified in the supplied crop, never paints eyes on the brow', () => {
  const source=clip.frames[0].flatMap(i=>{
    const [tone,text]=clip.runs[i];return [...text].filter(c=>c!=='\n').map(glyph=>({tone:Number(tone),glyph}));
  });
  const crop=JSON.parse(awaitCrop);
  const at=(x,y)=>{const c=crop.cells[Math.round(y)-17][Math.round(x)-74];return{tone:c&255,glyph:String.fromCharCode(c>>8)}};
  assert.equal(at(82,22).tone,0,'original left eye cream highlight');
  assert.equal(at(89,22).tone,1,'original right eye cream highlight');
  const neutral=new SceneCompositor(clip,seeded(7)).render({action:'idle',progress:0,time:0,night:false,sleepy:false,sourceFrame:0},0,469,false,true);
  for(let y=Math.ceil(15*sy);y<=Math.floor(25*sy);y++){
    const row=neutral.rows[y].flatMap(([tone,text])=>[...text].map(glyph=>({tone:Number(tone),glyph})));
    for(let x=Math.ceil(76*sx);x<=Math.floor(94*sx);x++)assert.deepEqual(row[x],source[y*cols+x],'neutral face exactly preserves original eyes, brows, glasses and mouth');
  }
  // These literal source coordinates catch the previous mistaken y=17/18 brow overlay.
  for(let y=15;y<=19;y++)for(let x=76;x<=94;x++)assert.equal(sampleGazeEye(x,y,1,1),undefined);
  for(let y=24;y<28;y++)for(let x=76;x<=94;x++)assert.equal(sampleGazeEye(x,y,1,1),undefined);
  const highlightCenter=(eye,gazeX,gazeY)=>{
    const cells=[];
    for(let y=20;y<=23;y++)for(let x=Math.ceil(eye.x-eye.radiusX);x<=Math.floor(eye.x+eye.radiusX);x++){
      const sample=sampleGazeEye(x,y,gazeX,gazeY)??{x,y};
      const cell=at(sample.x,sample.y);
      if(cell.tone<=2 && cell.glyph!==' ')cells.push({x,y});
      const neutral=sampleGazeEye(x,y,0,0)??{x,y};
      assert.deepEqual(at(neutral.x,neutral.y),at(x,y),'neutral keeps original glyph AND color, not a replacement drawing');
    }
    assert.ok(cells.length,'original eye highlights remain visible');
    return {x:cells.reduce((s,c)=>s+c.x,0)/cells.length,y:cells.reduce((s,c)=>s+c.y,0)/cells.length};
  };
  for(const eye of EYES){
    const left=highlightCenter(eye,-1,0),right=highlightCenter(eye,1,0),up=highlightCenter(eye,0,-1),down=highlightCenter(eye,0,1);
    assert.ok(right.x-left.x>=1,`original eye texture moves horizontally: ${JSON.stringify({eye,left,right})}`);
    assert.ok(down.y-up.y>=1,`original eye texture moves vertically: ${JSON.stringify({eye,up,down})}`);
  }
});

test('cursor head turn is visibly larger than the old four-degree capped map and stays connected', () => {
  const pose=actionPose('idle',0);pose.head.degrees=14;pose.head.x=3;
  const small=sampleCharacterSource(76,8,pose),turn=sampleCharacterSource(76,8,pose,true);
  assert.ok(Math.abs(turn.x-76)>Math.abs(small.x-76)+2,'turn exceeds the former subpixel-looking displacement');
  for(let y=0;y<36;y++)for(let x=60;x<103;x++){
    const a=sampleCharacterSource(x,y,pose,true),b=sampleCharacterSource(x,y+1,pose,true);
    assert.ok(Math.abs(a.x-b.x)<2,'continuous neck, no horizontal tear');
    assert.ok(Math.abs(a.y-b.y)<2,'continuous rows, no detached head');
    assert.ok(a.x>=0&&a.y>=0&&a.x<180&&a.y<105);
  }
});

// Keep the original map as an independent equivalence oracle for the hot path.
test('prepared fine-grid sampler matches the original continuous deformation exactly',()=>{
 for(const action of Object.keys(ACTIONS))for(const tracking of [false,true]){
  const pose=actionPose(action,.45);pose.head.x+=2;pose.head.degrees+=5;
  const prepared=prepareCharacterSampler(pose,tracking);
  for(let y=0;y<54;y+=.625)for(let x=42;x<126;x+=2.5){
   const a=sampleCharacterSource(x,y,pose,tracking),b=prepared(x,y);
   assert.ok(Math.abs(a.x-b.x)<1e-10&&Math.abs(a.y-b.y)<1e-10);
  }
 }
});
