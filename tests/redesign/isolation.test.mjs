import assert from 'node:assert/strict';
import test from 'node:test';
import { requestAllowed } from './isolation.mjs';
import { createFixtureServer } from './fixture-server.mjs';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Catches an allow-all policy, arbitrary loopback paths, credential URLs,
// and application endpoints being mistaken for safe fixture requests.
test('only exact static GET resources on the assigned loopback origin are allowed', () => {
  const origin = 'http://127.0.0.1:54321';
  for (const path of ['/', '/fixture.js', '/style.css', '/brand/frami-icon.svg', '/fonts/caveat.woff2', '/fonts/geist-3.woff2']) {
    assert.equal(requestAllowed(`${origin}${path}`, 'GET', origin), true, path);
  }
  for (const [url, method] of [
    ['https://transport-probe.invalid/blocked', 'GET'],
    ['http://127.0.0.1:54322/', 'GET'],
    [`${origin}/api/ai/agent/inbox/ack`, 'POST'],
    [`${origin}/api/ai/agent/settings`, 'GET'],
    [`${origin}/api/ai/agent/scheduler`, 'POST'],
    [`${origin}/api/ai/chat`, 'POST'],
    [`${origin}/unknown`, 'GET'],
    [`${origin}/fixture.js?proxy=anything`, 'GET'],
    ['http://user:pass@127.0.0.1:54321/', 'GET'],
    [`${origin}/`, 'POST'],
    ['file:///C:/not-a-fixture', 'GET'],
  ]) assert.equal(requestAllowed(url, method, origin), false, `${method} ${url}`);
});

test('static server denies unknown paths and writes even without the browser guard', async () => {
  const log = [];
  const server = await createFixtureServer(new Map([['/', { type: 'text/plain', body: 'Synthetic only' }]]), log);
  const read = (path, method) => new Promise((resolve, reject) => {
    const req = request(`${server.origin}${path}`, { method }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    }); req.on('error', reject); req.end();
  });
  try {
    assert.deepEqual(await read('/', 'GET'), { status: 200, body: 'Synthetic only' });
    for (const [path, method] of [['/unknown', 'GET'], ['/', 'POST'], ['/fixture.js', 'GET']]) {
      assert.equal((await read(path, method)).status, 403);
    }
    assert.equal(log.filter(event => event.disposition === 'denied').length, 3);
  } finally { await server.close(); }
});

test('CLI rejects relative and repository-contained evidence output before launching a child', () => {
  for (const output of ['tests/redesign/output', resolve('tests/redesign/output'), resolve('..not-external')]) {
    const result = spawnSync(process.execPath, ['tests/redesign/run.mjs', 'capture', output], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Evidence output must be an absolute path outside the repository/);
  }
});
