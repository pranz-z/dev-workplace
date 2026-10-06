const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto("http://localhost:3102/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(300, 360);
  await page.waitForTimeout(800);
  const before = (await cdp.send("Performance.getMetrics")).metrics;
  const get = (metrics, name) => metrics.find(({ name: key }) => key === name)?.value ?? 0;
  const start = performance.now();
  let moves = 0;
  while (performance.now() - start < 5000) {
    const elapsed = performance.now() - start;
    const x = 320 + (elapsed / 5000) * 560;
    const y = 340 + Math.sin(elapsed / 145) * 145;
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
    moves++;
  }
  const duration = performance.now() - start;
  const after = (await cdp.send("Performance.getMetrics")).metrics;
  const canvas = await page.locator("canvas.notebook-trail").evaluate((node) => ({ pointerEvents: getComputedStyle(node).pointerEvents, width: node.width, height: node.height }));
  console.log(JSON.stringify({ durationMs: Number(duration.toFixed(1)), moves, taskMs: Number(((get(after,"TaskDuration") - get(before,"TaskDuration"))*1000).toFixed(2)), scriptMs: Number(((get(after,"ScriptDuration") - get(before,"ScriptDuration"))*1000).toFixed(2)), layoutMs: Number(((get(after,"LayoutDuration") - get(before,"LayoutDuration"))*1000).toFixed(2)), canvas, url: page.url() }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
