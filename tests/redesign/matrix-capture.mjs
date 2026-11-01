import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';
import { ready, selectSurface, fontMetadata, settle, controlTargets } from './matrix-utils.mjs';

const output = process.argv[2];
const phase=process.argv[3]==='--after'?'after':'before';
await mkdir(resolve(output, phase), { recursive: true });
const harness = await createHarness(resolve(output, 'assets'));
const dimensions = [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]];
const supplemental=process.argv[3]==='--supplement';
const resume=process.argv.includes('--resume');
const core=['public','public-projects','case-study','dashboard','projects','project-detail','project-screenshots','tasks','tasks-list','files','settings','calendar','ai','ai-settings'];
const extra=['today','plans','notes','tech','accountability','github','portfolio'];
const surfaces = supplemental ? extra : phase==='after'?[...core,...extra]:core;
const previous=(supplemental||resume)?JSON.parse(await readFile(resolve(output,`${phase}-manifest.json`),'utf8')):null;
const currentBuild=JSON.parse(await readFile(resolve(output,'assets/build-manifest.json'),'utf8'));
if(previous){assert.equal(previous.build.cssSha256,currentBuild.cssSha256);assert.deepEqual(previous.build.sources,currentBuild.sources);}
const captures = previous?.captures??[];
const previousRequests=(supplemental||resume)?JSON.parse(await readFile(resolve(output,`${phase}-request-log.json`),'utf8')):[];
try {
  for (const [width,height] of dimensions) for (const theme of ['dark','light']) for (const surface of surfaces) {
    if(resume&&captures.some(row=>row.surface===surface&&row.theme===theme&&row.viewport.width===width&&row.viewport.height===height))continue;
    const { context, page, errors } = await harness.session('unseen', { width, height }, theme, { surface: surface === 'public-projects' ? 'public' : surface });
    page.setDefaultTimeout(6000);
    try {
      if (surface.startsWith('public')) await page.getByText('Synthetic Developer', { exact: true }).first().waitFor();
      else if (surface === 'case-study') await page.getByRole('heading', { name: 'Synthetic project with a deliberately long descriptive title', exact: true }).waitFor();
      else await ready(page);
      await selectSurface(page, surface);
      await settle(page);
      const fixture = await page.evaluate(() => window.matrixFixture);
      assert.deepEqual(fixture.unexpected, [], `Unimplemented fixture boundary on ${surface}`);
      assert.deepEqual(errors, [], `Browser errors on ${surface}`);
      const filename = `${surface}--${theme}--${width}x${height}--${phase}.png`;
      await page.screenshot({ path: resolve(output, phase, filename) });
      captures.push({ filename, surface, theme, viewport: { width, height }, fonts: await fontMetadata(page),targets:phase==='after'?await controlTargets(page):undefined,
        fixtureCalls: fixture.calls, overflow: await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth })) });
      console.log(`${captures.length}: ${surface} ${theme} ${width}x${height}`);
    } catch (error) {
      await writeFile(resolve(output, 'failure.txt'), `${surface} ${width}x${height} ${theme}\n${error.stack}\n${JSON.stringify({ errors, fixture: await page.evaluate(() => window.matrixFixture) },null,2)}\n${await page.locator('body').innerText()}`);
      throw error;
    } finally { await context.close(); }
  }
  assert.equal(harness.requestLog.filter(event => event.disposition.startsWith('denied')).length, 0, 'Unexpected network attempt during baseline');
} finally {
  await writeFile(resolve(output, `${phase}-manifest.json`), JSON.stringify({ source: '0e2997da8de0076c33c2bc074ed35741524e784d', browser: harness.browser.version(), phase, fixtureVersion: 'phase0b-v1', timezone: 'Asia/Manila', fixedTime:'2026-10-26T02:00:00.000Z',
    harnessLimitations: 'Actual components and CSS; Next Link/router/service boundaries replaced only in test bundle. No Next app/API server or hosted data. Not a full Next runtime or navigation/server integration test.',
    build: JSON.parse(await readFile(resolve(output, 'assets/build-manifest.json'), 'utf8')), captures }, null, 2));
  await writeFile(resolve(output, `${phase}-request-log.json`), JSON.stringify([...previousRequests,...harness.requestLog], null, 2));
  await harness.close();
}
