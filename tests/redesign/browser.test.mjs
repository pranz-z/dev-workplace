import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';

const output = process.env.REDESIGN_TEST_OUTPUT;
if (!output) throw new Error('Run through tests/redesign/run.mjs test EXTERNAL_OUTPUT');

test('real Inbox and parent lifecycle with isolated transport', async t => {
  const harness = await createHarness(resolve(output, 'assets'));
  const states = [];
  const acknowledgements = page => page.evaluate(() => window.redesignFixture.snapshot().events.filter(event => event.kind === 'ack-in-memory'));
  const openInbox = async page => { await page.getByRole('button', { name: 'Inbox', exact: true }).click(); await page.getByRole('region', { name: 'Agent Inbox', exact: true }).waitFor(); };
  try {
    await t.test('Chat and Settings do not mount Inbox; unseen rendered revisions ACK only in memory', async () => {
      const { context, page, errors } = await harness.session('unseen');
      try {
        assert.equal(await page.getByRole('region', { name: 'Agent Inbox', exact: true }).count(), 0);
        assert.deepEqual(await acknowledgements(page), []);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.waitForFunction(() => window.redesignFixture.snapshot().events.some(event => event.kind === 'settings-read-in-memory'));
        assert.equal(await page.getByRole('region', { name: 'Agent Inbox', exact: true }).count(), 0);
        assert.deepEqual(await acknowledgements(page), []);
        await page.getByRole('button', { name: 'Chat', exact: true }).click();
        assert.deepEqual(await acknowledgements(page), []);
        await openInbox(page);
        await page.waitForFunction(() => window.redesignFixture.snapshot().events.some(event => event.kind === 'ack-resolved'));
        const acks = await acknowledgements(page);
        assert.equal(acks.length, 1);
        assert.deepEqual(acks[0].input, { items: [{ id: '44444444-4444-4444-8444-444444444444', contentRevision: 2 }], brief: false });
        assert.equal(acks[0].renderedTitle, 'Synthetic deadline revision 2');
        await page.evaluate(() => window.redesignFixture.holdNextRead());
        await page.getByRole('button', { name: 'Refresh Inbox', exact: true }).click();
        await page.getByText('Loading Inbox…', { exact: true }).waitFor();
        await page.evaluate(() => window.redesignFixture.releaseRead());
        await page.getByText('Loading Inbox…', { exact: true }).waitFor({ state: 'hidden' });
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Refresh Inbox')?.disabled);
        assert.equal((await acknowledgements(page)).length, 1, 'same revision is not ACKed twice in one mount');
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        assert.equal(await page.getByRole('region', { name: 'Agent Inbox', exact: true }).count(), 0);
        assert.equal((await acknowledgements(page)).length, 1);
        assert.deepEqual(errors, []);
        states.push(await page.evaluate(() => window.redesignFixture.snapshot()));
      } finally { await context.close(); }
    });

    for (const scenario of ['seen', 'empty', 'error', 'loading']) await t.test(`${scenario} does not ACK undisplayed unseen content`, async () => {
      const { context, page, errors } = await harness.session(scenario);
      try {
        await openInbox(page);
        const text = { seen: 'Synthetic deadline revision 2', empty: 'No current Inbox items.', error: 'Synthetic Inbox data unavailable.', loading: 'Loading Inbox…' }[scenario];
        await page.getByText(text, { exact: true }).waitFor();
        assert.deepEqual(await acknowledgements(page), []);
        if (scenario === 'loading') {
          await page.evaluate(() => window.redesignFixture.releaseRead());
          await page.waitForFunction(() => window.redesignFixture.snapshot().events.some(event => event.kind === 'ack-in-memory'));
          assert.equal((await acknowledgements(page))[0].renderedTitle, 'Synthetic deadline revision 2');
        }
        assert.deepEqual(errors, []);
        states.push(await page.evaluate(() => window.redesignFixture.snapshot()));
      } finally { await context.close(); }
    });

    await t.test('new revision while ACK is pending remains unseen and gets its own revision ACK', async () => {
      const { context, page, errors } = await harness.session('revision-race');
      try {
        await openInbox(page);
        await page.waitForFunction(() => window.redesignFixture.snapshot().events.some(event => event.kind === 'ack-in-memory'));
        await page.evaluate(() => window.redesignFixture.advanceRevision());
        await page.getByRole('button', { name: 'Refresh Inbox', exact: true }).click();
        await page.waitForFunction(() => window.redesignFixture.snapshot().events.filter(event => event.kind === 'ack-in-memory').length === 2);
        const acks = await acknowledgements(page);
        assert.deepEqual(acks.map(event => event.input.items[0].contentRevision), [2, 3]);
        assert.deepEqual(acks.map(event => event.renderedTitle), ['Synthetic deadline revision 2', 'Synthetic deadline revision 3']);
        await page.evaluate(() => window.redesignFixture.releaseAcks());
        await page.getByText('1 displayed revisions acknowledged. Newer revisions may remain unseen.', { exact: true }).waitFor();
        assert.match(await page.getByRole('article').innerText(), /New \/ unseen/);
        assert.deepEqual(errors, []);
        states.push(await page.evaluate(() => window.redesignFixture.snapshot()));
      } finally { await context.close(); }
    });

    await t.test('external fetch, unknown loopback path, endpoint-shaped requests and WebSockets are blocked before network', async () => {
      const { context, page } = await harness.session('empty');
      try {
        const beforeServer = harness.requestLog.filter(event => event.layer === 'server').length;
        const outcomes = await page.evaluate(async () => {
          const values = [];
          for (const [url, method] of [['https://transport-probe.invalid/blocked','GET'], ['/unexpected','GET'], ['/api/ai/agent/inbox/ack','POST'], ['/api/ai/agent/settings','POST'], ['/api/ai/agent','POST']]) {
            try { await fetch(url, { method, credentials: 'omit' }); values.push('unexpected response'); } catch { values.push('blocked'); }
          }
          await new Promise(resolve => { const ws = new WebSocket('wss://transport-probe.invalid/socket'); ws.onclose = resolve; ws.onerror = resolve; });
          return values;
        });
        assert.deepEqual(outcomes, ['blocked','blocked','blocked','blocked','blocked']);
        assert.equal(harness.requestLog.filter(event => event.layer === 'server').length, beforeServer, 'denied probes never reached fixture server');
        assert.ok(harness.requestLog.some(event => event.layer === 'websocket' && event.disposition === 'denied-before-network'));
      } finally { await context.close(); }
    });
    assert.equal(harness.requestLog.filter(event => event.layer === 'server' && event.path.startsWith('/api/')).length, 0);
  } finally {
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'test-request-log.json'), JSON.stringify(harness.requestLog, null, 2));
    await writeFile(resolve(output, 'test-ack-log.json'), JSON.stringify(states, null, 2));
    await harness.close();
  }
});
