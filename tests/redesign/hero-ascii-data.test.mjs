import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const data = async name => JSON.parse(await readFile(new URL(`../../components/portfolio/ascii-data/${name}.json`, import.meta.url), 'utf8'));

test('every animation frame fits the reserved poster grid and uses the approved ramp', async () => {
  const poster = await data('poster'), clip = await data('animation');
  assert.deepEqual([poster.columns, poster.rows], [180, 105]);
  assert.equal(clip.frames.length, 56);
  assert.equal(clip.source, '2d-anime-illustration');
  assert.equal(clip.sourceColorSampling, true);
  assert.deepEqual(clip.palette, poster.palette);
  assert.ok(poster.palette.slice(0, 32).every(([dark, light]) => dark === light), 'both themes preserve the same source illustration colors');
  const frames = clip.frames.map(indices => indices.map(index => {
    assert.ok(Number.isInteger(index) && index >= 0 && index < clip.runs.length);
    return clip.runs[index];
  }));
  assert.equal(clip.frames.length / clip.fps * 1000, clip.durationMs);
  assert.ok(clip.durationMs < 6000);
  assert.deepEqual(frames[0], poster.runs);
  assert.ok(new Set(frames.map(JSON.stringify)).size > 40, 'the loop contains rendered motion');
  assert.deepEqual([...new Set(clip.poses)].sort(), ['reach', 'rest', 'sip', 'typing']);
  for (const runs of [poster.runs, ...frames]) {
    for (const layer of [1, 2]) {
      const lines = runs.map(run => {
        const [tone] = run;
        const text = run[layer];
        assert.ok(Number.isInteger(Number(tone)) && poster.palette[Number(tone)], 'run color exists in the source palette');
        assert.equal(typeof text, 'string', 'both themes have a rendered glyph layer');
        assert.match(text, /^[ .:\-=+*#%@&\n]*$/);
        return text;
      }).join('').split('\n');
      assert.equal(lines.length, poster.rows);
      assert.ok(lines.every(line => line.length === poster.columns));
    }
  }
});
