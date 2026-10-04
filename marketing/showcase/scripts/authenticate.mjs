import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { config } from "../config/demo.config.mjs";

await fs.mkdir(path.dirname(config.authFile), { recursive: true });
let browser;
let context;
let page;
try {
  // Prefer the installed Edge Chromium runtime on Windows; the Playwright-downloaded
  // Chrome binary may be blocked by Windows side-by-side configuration in desktop hosts.
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: false });
  context = await browser.newContext({ viewport: { width: config.width, height: config.height } });
  page = await context.newPage();
  await page.goto(`${config.baseURL}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
} catch (error) {
  if (!process.platform.startsWith("win") || !String(error).includes("spawn UNKNOWN")) throw error;
  const port = Number(process.env.DEMO_CDP_PORT || 9222);
  const profile = path.join(config.root, ".auth", "manual-browser-profile");
  const quotePs = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-first-run-ui", "--new-window", `${config.baseURL}/login`];
  const command = `$exe=${quotePs(chromium.executablePath())}; $browserArgs=@(${args.map(quotePs).join(",")}); Start-Process -FilePath $exe -ArgumentList $browserArgs -WindowStyle Normal`;
  const launched = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
  if (launched.status !== 0) throw new Error(`Could not open the manual login browser: ${launched.stderr || launched.error || "PowerShell Start-Process failed"}`);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  if (!browser) throw new Error("Headed Chromium opened, but its local debugging connection was unavailable.");
  context = browser.contexts()[0];
  page = context.pages()[0] ?? await context.newPage();
  await page.setViewportSize({ width: config.width, height: config.height });
}
console.log("Log in manually in the opened Chromium window. This recorder does not handle GitHub credentials.");
try {
  await page.waitForURL((url) => url.pathname === "/app" || url.pathname.startsWith("/app/"), { timeout: 10 * 60 * 1000 });
  await page.getByRole("navigation", { name: "Workspace sections" }).waitFor({ state: "visible", timeout: 30000 });
  await context.storageState({ path: config.authFile });
  console.log("Owner session saved to the gitignored showcase auth directory.");
} finally {
  await browser.close().catch(() => {});
}
