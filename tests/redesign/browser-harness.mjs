import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createFixtureServer } from './fixture-server.mjs';
import { installBrowserIsolation } from './isolation.mjs';
import { checkSources } from './source-guard.mjs';

export async function createHarness(assets, { embeddedFonts = false } = {}) {
  await checkSources();
  const requestLog = [];
  const fonts = JSON.parse(await readFile(resolve(assets, 'font-manifest.json'), 'utf8'));
  const family = { caveat: 'Caveat', kalam: 'Kalam', geist: 'Geist', 'geist-mono': 'Geist Mono' };
  const fontFaces = [];
  for (const font of fonts) {
    const url = embeddedFonts ? `data:font/woff2;base64,${(await readFile(resolve(assets,'fonts',font.filename))).toString('base64')}` : `/fonts/${font.filename}`;
    fontFaces.push(`@font-face{font-family:"${family[font.name]}";font-style:normal;font-weight:${font.weight};font-display:swap;src:url('${url}') format('woff2');}`);
  }
  const fontCss = fontFaces.join('\n') + '\n:root{--font-caveat:"Caveat";--font-kalam:"Kalam";--font-geist-sans:"Geist";--font-geist-mono:"Geist Mono";}';
  const resources = new Map([
    ['/', { type: 'text/html', body: '<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Inbox — Phase 0a</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' }],
    ['/fixture.js', { type: 'application/javascript', body: await readFile(resolve(assets, 'fixture.js')) }],
    ['/style.css', { type: 'text/css', body: `${fontCss}\n${await readFile(resolve(assets, 'app.css'), 'utf8')}` }],
    ['/brand/frami-icon.svg', { type: 'image/svg+xml', body: await readFile(new URL('../../public/brand/frami-icon.svg', import.meta.url)) }],
  ]);
  for (const font of fonts) resources.set(`/fonts/${font.filename}`, { type: 'font/woff2', body: await readFile(resolve(assets, 'fonts', font.filename)) });
  const server = await createFixtureServer(resources, requestLog);
  const browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--no-pings'] });
  const session = async (scenario, viewport = { width: 1440, height: 1000 }, theme = 'dark', config = {}) => {
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Manila', locale: 'en-US', serviceWorkers: 'block', colorScheme: theme, ...config.contextOptions });
    await installBrowserIsolation(context, server.origin, requestLog);
    await context.addInitScript(({ config, theme }) => { window.matrixConfiguration = config; localStorage.setItem('developer-workspace-theme', theme); if(config.focusSnapshot&&!sessionStorage.getItem('redesign-focus-seeded')){sessionStorage.setItem('developer-workspace-focus-session-v1:11111111-1111-4111-8111-111111111111',JSON.stringify(config.focusSnapshot));sessionStorage.setItem('redesign-focus-seeded','true');} }, { config, theme });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(config.fixedTime??'2026-10-26T02:00:00.000Z'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.origin);
    await page.waitForFunction(() => !!window.redesignFixture);
    await page.evaluate(({ scenario, theme }) => { document.documentElement.dataset.theme = theme; window.redesignFixture.reset(scenario); }, { scenario, theme });
    await page.evaluate(async () => { await document.fonts.load('400 16px Kalam'); await document.fonts.load('700 28px Caveat'); await document.fonts.load('400 16px Geist'); await document.fonts.load('400 16px "Geist Mono"'); await document.fonts.ready; });
    if (!await page.evaluate(() => document.fonts.check('400 16px Kalam') && document.fonts.check('700 28px Caveat'))) throw new Error('Fixture fonts not ready');
    return { context, page, errors };
  };
  return { browser, server, requestLog, session, close: async () => { await browser.close(); await server.close(); } };
}
