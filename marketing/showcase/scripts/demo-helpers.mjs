import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "../config/demo.config.mjs";

export async function createDemoContext(browser, { authenticated = false, recordDir, signedOut = false } = {}) {
  const options = { viewport: { width: config.width, height: config.height }, deviceScaleFactor: 1, reducedMotion: "reduce" };
  if (authenticated && !signedOut) options.storageState = config.authFile;
  if (recordDir) {
    await fs.mkdir(recordDir, { recursive: true });
    options.recordVideo = { dir: recordDir, size: { width: config.width, height: config.height } };
  }
  return browser.newContext(options);
}

export async function waitForAppReady(page) {
  await page.goto(config.baseURL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("body").waitFor({ state: "visible" });
  await page.waitForTimeout(1000);
}

export async function waitForWorkspace(page) {
  await page.goto(`${config.baseURL}/app`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("navigation", { name: "Workspace sections" }).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1200);
  if (process.env.DEMO_HIDE_PRIVATE_WORKSPACE === "1") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { frameTree } = await cdp.send("Page.getFrameTree");
    const { styleSheetId } = await cdp.send("CSS.createStyleSheet", { frameId: frameTree.frame.id });
    await cdp.send("CSS.setStyleSheetText", { styleSheetId, text: `
      body::before { content: "Private workspace details hidden in this walkthrough"; position: fixed;
        inset: 0; z-index: 1000; display: grid; place-items: center; pointer-events: none;
        color: #e8e5ed; font: 500 22px/1.4 system-ui, sans-serif; letter-spacing: .02em;
        background: radial-gradient(ellipse at 50% 8%, rgba(126, 108, 190, .2), transparent 42%), #171820; }
      #demo-capture-cursor { display: none !important; }
    ` });
    await cdp.detach();
  }
}

export async function injectCaptureCursor(page) {
  const install = () => {
    if (!document.getElementById("demo-capture-cursor-style")) {
      const style = document.createElement("style"); style.id = "demo-capture-cursor-style";
      style.textContent = `#demo-capture-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 18px; height: 24px; pointer-events: none; transform: translate(-2px,-2px); filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); } #demo-capture-cursor svg { display:block; width:18px; height:24px; } #demo-capture-cursor path { fill:#fff; stroke:#111; stroke-width:1.5; stroke-linejoin:round; } #demo-capture-cursor.demo-click { animation: demo-cursor-click 260ms ease-out; } @keyframes demo-cursor-click { 0% { scale:1 } 45% { scale:.82 } 100% { scale:1 } }`;
      document.head.append(style);
    }
    if (document.getElementById("demo-capture-cursor")) return;
    const cursor = document.createElement("div"); cursor.id = "demo-capture-cursor";
    cursor.innerHTML = '<svg viewBox="0 0 20 28" aria-hidden="true"><path d="M2 1.5v22l5.2-5.1 3.2 7.1 3.1-1.4-3.3-7h7.1L2 1.5Z"/></svg>';
    document.body.append(cursor);
    document.addEventListener("mousemove", (event) => { cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`; });
    document.addEventListener("mousedown", () => { cursor.classList.remove("demo-click"); void cursor.offsetWidth; cursor.classList.add("demo-click"); });
  };
  await page.addInitScript(install);
  await page.evaluate(install);
}

export async function moveCursorTo(page, locator, { hoverMs = 240, steps = 24 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Cannot move cursor to an element outside the viewport.");
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const current = await page.evaluate(() => ({ x: Number(document.getElementById("demo-capture-cursor")?.style.left.replace("px", "")) || 40, y: Number(document.getElementById("demo-capture-cursor")?.style.top.replace("px", "")) || 40 }));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps; const eased = t * t * (3 - 2 * t);
    await page.mouse.move(current.x + (target.x - current.x) * eased, current.y + (target.y - current.y) * eased);
    await page.waitForTimeout(12);
  }
  await page.waitForTimeout(hoverMs);
  return target;
}

export async function demoClick(page, locator, options) {
  await moveCursorTo(page, locator, options);
  await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
}

export async function smoothScrollTo(page, selector, { durationMs = 700 } = {}) {
  const locator = page.locator(selector).first();
  if (await locator.count()) {
    const box = await locator.boundingBox();
    if (box) {
      const start = await page.evaluate(() => window.scrollY);
      const end = Math.max(0, start + box.y - 120);
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps; const eased = t * t * (3 - 2 * t);
        await page.evaluate((y) => window.scrollTo(0, y), start + (end - start) * eased);
        await page.waitForTimeout(durationMs / steps);
      }
    }
  }
}

export const pauseForShot = (page, ms = 650) => page.waitForTimeout(ms);

export async function closeRecordContext(context, page) {
  const video = page.video();
  await context.close();
  return video ? await video.path() : null;
}

export async function launchBrowser() { return chromium.launch({ headless: false }); }
export async function fileExists(file) { try { await fs.access(file); return true; } catch { return false; } }
export const sceneOutputPath = (name) => path.join(config.finalDir, name);
