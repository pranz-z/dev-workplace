import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const data = async name => JSON.parse(await readFile(new URL(`../../components/portfolio/ascii-data/${name}.json`, import.meta.url), 'utf8'));

test('every animation frame fits the reserved poster grid and uses the approved ramp', async () => {
  const poster = await data('poster'), clip = await data('animation');
  assert.deepEqual([poster.columns, poster.rows], [180, 105]);
  assert.equal(clip.frames.length, 56);
  assert.equal(clip.frames.length / clip.fps * 1000, clip.durationMs);
  assert.ok(clip.durationMs < 6000);
  assert.deepEqual(clip.frames[0], poster.runs);
  assert.ok(new Set(clip.frames.map(JSON.stringify)).size > 40, 'the loop contains rendered motion');
  for (const runs of [poster.runs, ...clip.frames]) {
    const lines = runs.map(([tone, text]) => {
      assert.match(tone, /^[ildtapmfb]$/);
      assert.match(text, /^[ .:\-=+*#%@\n]*$/);
      return text;
    }).join('').split('\n');
    assert.equal(lines.length, poster.rows);
    assert.ok(lines.every(line => line.length === poster.columns));
  }
});
