import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

test('case study shows an opted-in controlled video beside screenshots, with bounded manual recovery', async () => {
  const root = resolve(import.meta.dirname, '../..');
  const { build } = await import(pathToFileURL(process.env.PORTFOLIO_TEST_ESBUILD_MODULE).href);
  const project = { name: 'Demo project', description: 'Description', publicSummary: '', links: {}, technologies: [], type: 'Personal', status: 'Testing' };
  const bundle = await build({
    stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import Page from '@/app/projects/[slug]/page';createRoot(document.getElementById('root')).render(<Page/>);", resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: resolve(root, 'tsconfig.json'), nodePaths: [resolve(root, 'node_modules')],
    plugins: [{ name: 'public-boundaries', setup(b) {
      b.onResolve({ filter: /^next\/(link|navigation)$|^@\/(data\/(projectService|projectScreenshotService)|lib\/supabase\/env|components\/(public-ai\/public-ai-concierge|accountability\/public-accountability-card))$/ }, a => ({ path: a.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', resolveDir: root, contents:
        a.path === 'next/link' ? "import React from 'react';export default function Link(p){return React.createElement('a',p)}" :
        a.path === 'next/navigation' ? "export const useParams=()=>({slug:'demo'});" :
        a.path.endsWith('/projectService') ? `export const getPublicProjectBySlug=async()=>(${JSON.stringify(project)});export const toProjectViewFromPublicProject=p=>p;` :
        a.path.endsWith('/projectScreenshotService') ? "export const listPublicProjectScreenshots=async()=>[{id:'one',caption:'Public screenshot',signedUrl:'/cover.svg'}];" :
        a.path.endsWith('/env') ? 'export const isSupabaseConfigured=()=>true;' :
        'export const PublicAiConcierge=()=>null;export const PublicAccountabilityCard=()=>null;' }));
    } }],
  });
  let status = 200, calls = 0;
  const server = createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); return res.end(bundle.outputFiles[0].text); }
    if (req.url === '/cover.svg') { res.setHeader('content-type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"/>'); }
    if (req.url === '/api/public/projects/demo/preview-video') {
      calls++; res.statusCode = status; res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(status === 200 ? { url: `https://example.private.blob.vercel-storage.com/demo.mp4?signature=${calls}`, mimeType: 'video/mp4', expiresAt: Date.now() + 900000 } : { error: 'Preview unavailable' }));
    }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Hold media traffic so the explicit error/retry checks remain deterministic.
    // Real opening-frame decoding is verified separately against the deployed video.
    await page.route('https://example.private.blob.vercel-storage.com/**', () => {});
    const url = `http://127.0.0.1:${server.address().port}/projects/demo`;
    await page.goto(url);
    await page.getByRole('heading', { name: 'Gallery', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Project video', exact: true }).waitFor();
    const video = page.getByLabel('Demo project video', { exact: true });
    assert.equal(await video.getAttribute('preload'), 'metadata');
    assert.equal(await video.evaluate(v => new URL(v.src).hash), '#t=0.1');
    assert.equal(await video.evaluate(v => v.controls && v.playsInline && !v.autoplay && v.paused), true);
    assert.equal(calls, 1);
    assert.equal(await page.getByAltText('Public screenshot').count(), 1);
    const screenshot = page.getByRole('button', { name: 'View screenshot: Public screenshot', exact: true });
    await screenshot.click();
    const viewer = page.getByRole('dialog', { name: 'Screenshot viewer', exact: true });
    await viewer.waitFor();
    assert.equal(await viewer.getByAltText('Public screenshot').count(), 1);
    assert.equal(await viewer.evaluate(dialog => dialog.matches(':modal')), true);
    assert.equal(await viewer.getByRole('button', { name: 'Close screenshot', exact: true }).evaluate(b => b === document.activeElement), true);
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
    assert.equal(await screenshot.evaluate(b => b === document.activeElement), true);
    await screenshot.click();
    await viewer.getByRole('button', { name: 'Close screenshot', exact: true }).click();
    await viewer.waitFor({ state: 'detached' });
    await screenshot.click();
    await page.mouse.click(1, 1);
    await viewer.waitFor({ state: 'detached' });
    await video.dispatchEvent('error');
    await page.getByRole('button', { name: 'Retry video', exact: true }).waitFor();
    assert.equal(await page.locator('video').count(), 0);
    assert.equal(calls, 1, 'media failures must not cause an automatic retry loop');
    await page.getByRole('button', { name: 'Retry video', exact: true }).click();
    await video.waitFor();
    assert.equal(calls, 2, 'explicit retry obtains a fresh signed URL');
    for (const unavailable of [404, 503]) {
      status = unavailable;
      await page.reload();
      await page.getByRole('heading', { name: 'Gallery', exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('video'));
      if (unavailable === 404) assert.equal(await page.getByRole('heading', { name: 'Project video', exact: true }).count(), 0);
      else await page.getByRole('button', { name: 'Retry video', exact: true }).waitFor();
    }
    status = 200;
    await page.getByRole('button', { name: 'Retry video', exact: true }).click();
    await video.waitFor();
    assert.equal(errors.length, 0, errors.join('\n'));
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
});
