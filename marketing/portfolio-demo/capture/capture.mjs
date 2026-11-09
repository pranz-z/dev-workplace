// Records real footage of the live site for the Remotion edit.
// Read-only: the editor scene types into the unsaved draft and never clicks "Save portfolio".
// Usage (from repo root): node marketing/portfolio-demo/capture/capture.mjs [portfolio|editor|all]
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "public", "footage");
const raw = path.resolve(here, "raw");
const authFile = path.resolve(here, "..", "..", "showcase", ".auth", "owner.json");
const base = (process.env.DEMO_BASE_URL || "https://frami-devplace.vercel.app").replace(/\/$/, "");
const W = 1920, H = 1080;
const which = process.argv[2] || "all";

const cursorScript = () => {
  const install = () => {
    if (document.getElementById("cap-cursor")) return;
    const s = document.createElement("style");
    s.textContent = `#cap-cursor{position:fixed;z-index:2147483647;left:-40px;top:-40px;width:22px;height:30px;pointer-events:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.4))}#cap-cursor path{fill:#F3EBDD;stroke:#1C1917;stroke-width:1.6;stroke-linejoin:round}`;
    document.head.append(s);
    const c = document.createElement("div"); c.id = "cap-cursor";
    c.innerHTML = '<svg viewBox="0 0 20 28" width="22" height="30"><path d="M2 1.5v22l5.2-5.1 3.2 7.1 3.1-1.4-3.3-7h7.1L2 1.5Z"/></svg>';
    document.body.append(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; });
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install); else install();
};

let cursor = { x: W / 2, y: H / 2 };
async function moveTo(page, x, y, ms = 700) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = { ...cursor };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t * t * (3 - 2 * t);
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(16);
  }
  cursor = { x, y };
}
async function moveToLocator(page, loc, ms) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error("element not visible");
  await moveTo(page, b.x + b.width / 2, b.y + b.height / 2, ms);
}
async function click(page, loc, ms) { await moveToLocator(page, loc, ms); await page.waitForTimeout(150); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up(); }
async function smoothScroll(page, top, ms = 1400) {
  await page.evaluate(async ({ top, ms }) => {
    const start = scrollY, t0 = performance.now();
    await new Promise((r) => { const f = (now) => { const t = Math.min(1, (now - t0) / ms), e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; scrollTo(0, start + (top - start) * e); t < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  }, { top, ms });
}
const yOf = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top + scrollY - 40 : null; }, sel);

async function record(name, { auth }, run) {
  await fs.mkdir(raw, { recursive: true }); await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "msedge" }));
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "dark",
    recordVideo: { dir: raw, size: { width: W, height: H } },
    ...(auth ? { storageState: authFile } : {}),
  });
  await ctx.addInitScript(cursorScript);
  const page = await ctx.newPage();
  const marks = {}; const t0 = Date.now();
  const mark = (k) => { marks[k] = Number(((Date.now() - t0) / 1000).toFixed(2)); };
  try { await run(page, mark); } finally {
    await page.waitForTimeout(500);
    const video = page.video(); await ctx.close();
    const src = await video.path();
    await fs.copyFile(src, path.join(raw, `${name}.webm`));
    await fs.writeFile(path.join(raw, `${name}.marks.json`), JSON.stringify(marks, null, 2));
    await browser.close();
  }
  console.log(name, marks);
}

async function portfolio() {
  await record("portfolio", { auth: false }, async (page, mark) => {
    await page.goto(base, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(800);
    mark("hero");
    await moveTo(page, 1300, 520, 1200);   // let the character react to the pointer
    await page.waitForTimeout(2200);
    await moveTo(page, 1500, 420, 900);
    await page.waitForTimeout(1600);
    const proj = await yOf(page, "#projects");
    mark("projects");
    if (proj != null) await smoothScroll(page, proj, 1600);
    await moveTo(page, 700, 600, 800);
    await page.waitForTimeout(1800);
    await smoothScroll(page, (proj ?? 900) + 900, 1800);
    await page.waitForTimeout(1200);
    mark("sections");
    for (const sel of ["#experience", "#skills"]) { const y = await yOf(page, sel); if (y != null) { await smoothScroll(page, y, 1500); await page.waitForTimeout(1300); } }
    mark("services");
    await page.goto(`${base}/services`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1800);
    await smoothScroll(page, 700, 1800);
    await page.waitForTimeout(1500);
    mark("end");
  });
}

async function editor() {
  await fs.access(authFile).catch(() => { throw new Error("Owner session missing: run `npm run demo:auth` in the repo root first."); });
  await record("editor", { auth: true }, async (page, mark) => {
    await page.goto(`${base}/app`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const nav = page.getByRole("navigation", { name: "Workspace sections" });
    await nav.waitFor({ state: "visible", timeout: 45000 }).catch(() => { throw new Error("Workspace did not load — the saved owner session is probably expired. Run `npm run demo:auth`."); });
    await page.waitForTimeout(1500);
    mark("workspace");
    await click(page, nav.getByRole("button", { name: /Portfolio/ }).or(nav.getByRole("link", { name: /Portfolio/ })).first(), 1000);
    const tabs = page.getByRole("navigation", { name: "Portfolio editors" });
    await tabs.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(1600);
    mark("overview");
    await click(page, tabs.getByRole("button", { name: "Hero & Bio", exact: true }), 900);
    await page.waitForTimeout(1200);
    mark("hero-tab");
    const field = page.getByLabel(/headline/i).first();
    if (await field.count()) {
      await click(page, field, 800);
      await page.keyboard.press("End");
      await page.waitForTimeout(400);
      mark("typing");
      await page.keyboard.type(" · Builds with AI", { delay: 75 });
      await page.waitForTimeout(1400);
    }
    mark("services-tab");
    await click(page, tabs.getByRole("button", { name: "Services", exact: true }), 900);
    await page.waitForTimeout(2200);
    mark("settings-tab");
    await click(page, tabs.getByRole("button", { name: "Public Settings", exact: true }), 900);
    await page.waitForTimeout(2200);
    const save = page.getByRole("button", { name: "Save portfolio" });
    mark("save-hover");
    if (await save.count()) { await moveToLocator(page, save, 900); await page.waitForTimeout(1600); } // hover only — never clicked
    mark("end");
  });
}

if (which === "portfolio" || which === "all") await portfolio();
if (which === "editor" || which === "all") await editor();
