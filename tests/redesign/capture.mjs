import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';

const output = process.argv[2];
if (!output) throw new Error('Usage: node tests/redesign/run.mjs capture ABSOLUTE_EXTERNAL_OUTPUT');
await mkdir(resolve(output, 'inbox-captures'), { recursive: true });
const harness = await createHarness(resolve(output, 'assets'));
const captures = [];
try {
  for (const scenario of ['unseen','seen','loading','empty','error','stale','unavailable','revision-race']) {
    const { context, page, errors } = await harness.session(scenario);
    try {
      await page.getByRole('button', { name: 'Inbox', exact: true }).click();
      const text = { empty: 'No current Inbox items.', error: 'Synthetic Inbox data unavailable.', loading: 'Loading Inbox…' }[scenario] ?? 'Synthetic deadline revision 2';
      await page.getByText(text, { exact: true }).waitFor();
      if (!['loading','empty','error','seen'].includes(scenario)) await page.waitForFunction(() => window.redesignFixture.snapshot().events.some(event => event.kind === 'ack-in-memory'));
      const filename = `inbox-${scenario}-synthetic-dark-1440x1000.png`;
      await page.screenshot({ path: resolve(output, 'inbox-captures', filename) });
      const snapshot = await page.evaluate(() => window.redesignFixture.snapshot());
      if (scenario === 'revision-race') {
        assert.equal(snapshot.pendingAckCount, 1);
        assert.equal(snapshot.events.filter(event => event.kind === 'ack-resolved').length, 0);
      }
      const fonts = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, title: getComputedStyle(document.querySelector('h2')).fontFamily, loaded: [...document.fonts].filter(font => font.status === 'loaded').map(font => `${font.family}:${font.weight}`) }));
      assert.deepEqual(errors, []);
      captures.push({ filename, scenario, viewport: { width: 1440, height: 1000 }, theme: 'dark', fonts, snapshot });
      if (scenario === 'revision-race') {
        await page.evaluate(() => window.redesignFixture.advanceRevision());
        await page.getByRole('button', { name: 'Refresh Inbox', exact: true }).click();
        await page.waitForFunction(() => window.redesignFixture.snapshot().events.filter(event => event.kind === 'ack-in-memory').length === 2);
        const held = await page.evaluate(() => window.redesignFixture.snapshot());
        assert.deepEqual(held.events.filter(event => event.kind === 'ack-in-memory').map(event => event.input.items[0].contentRevision), [2,3]);
        assert.equal(held.events.filter(event => event.kind === 'ack-resolved').length, 0);
        await page.evaluate(() => window.redesignFixture.releaseAcks());
        await page.waitForFunction(() => window.redesignFixture.snapshot().events.some(event => event.kind === 'ack-resolved'));
        captures.at(-1).revisionProgression = { held, afterRelease: await page.evaluate(() => window.redesignFixture.snapshot()) };
      }
      await page.evaluate(() => { window.redesignFixture.releaseRead(); window.redesignFixture.releaseAcks(); });
    } finally { await context.close(); }
  }
  // One narrow example for Inbox legibility, not the Phase 0b BEFORE matrix.
  const { context, page, errors } = await harness.session('unseen', { width: 390, height: 844 }, 'light');
  try {
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    await page.waitForFunction(() => window.redesignFixture.snapshot().events.some(event => event.kind === 'ack-resolved'));
    const filename = 'inbox-unseen-synthetic-light-390x844.png';
    await page.screenshot({ path: resolve(output, 'inbox-captures', filename) });
    const fonts = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, title: getComputedStyle(document.querySelector('h2')).fontFamily, loaded: [...document.fonts].filter(font => font.status === 'loaded').map(font => `${font.family}:${font.weight}`) }));
    captures.push({ filename, scenario: 'unseen', viewport: { width: 390, height: 844 }, theme: 'light', fonts, snapshot: await page.evaluate(() => window.redesignFixture.snapshot()) });
    await page.locator('[aria-live="polite"]').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const scrolledFilename = 'inbox-unseen-synthetic-light-390x844-scrolled.png';
    await page.screenshot({ path: resolve(output, 'inbox-captures', scrolledFilename) });
    captures.push({ filename: scrolledFilename, scenario: 'unseen', viewport: { width: 390, height: 844 }, theme: 'light', fonts, scroll: 'Inbox content scrolled to bottom' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  assert.equal(harness.requestLog.filter(event => event.disposition.startsWith('denied')).length, 0, 'captures attempted unexpected transport');
  const build = JSON.parse(await readFile(resolve(output, 'assets/build-manifest.json'), 'utf8'));
  await writeFile(resolve(output, 'capture-manifest.json'), JSON.stringify({ scope: 'Phase 0a Inbox component fixture only; not full-app or Phase 0b baseline', browser: harness.browser.version(), timezone: 'Asia/Manila', syntheticTimestamp: '2026-10-26T02:00:00.000Z', build, captures }, null, 2));
  console.log(`${captures.length} real-component synthetic Inbox captures saved outside repository.`);
} finally {
  await writeFile(resolve(output, 'capture-request-log.json'), JSON.stringify(harness.requestLog, null, 2));
  await harness.close();
}
