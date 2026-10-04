import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "../config/demo.config.mjs";
import { createDemoContext, closeRecordContext, fileExists, injectCaptureCursor } from "./demo-helpers.mjs";
import { readReport, writeReport } from "./demo-state.mjs";

const report = await readReport();
const authPresent = await fileExists(config.authFile);
report.authentication = authPresent ? "owner storage state available (gitignored)" : "required; owner.json missing";
if (!authPresent) {
  report.authentication = "required; owner.json missing";
  report.fullDemo = { status: "blocked", reason: "Run npm run demo:auth and complete the manual owner sign-in." };
  await writeReport(report);
  console.error("The full walkthrough needs an owner session. Run npm run demo:auth, finish manual login, then rerun npm run demo:full.");
  process.exitCode = 3;
} else {
  await fs.mkdir(config.rawFullDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await createDemoContext(browser, { authenticated: true, recordDir: config.rawFullDir });
  const page = await context.newPage();
  const started = Date.now();
  try {
    await injectCaptureCursor(page);
    const ids = ["portfolio", "workspace", "kanban", "calendar", "github", "workspace-ai", "focus", "portfolio", "public-ai", "outro"];
    const failures = [];
    for (const id of ids) {
      const previousPrivacySetting = process.env.DEMO_HIDE_PRIVATE_WORKSPACE;
      if (["workspace", "kanban", "calendar", "github", "focus"].includes(id)) process.env.DEMO_HIDE_PRIVATE_WORKSPACE = "1";
      else delete process.env.DEMO_HIDE_PRIVATE_WORKSPACE;
      try {
        const sceneRunner = await import(`../scenes/${id}.mjs`);
        await sceneRunner.run({ page, config, report });
      } catch (error) {
        failures.push({ scene: id, reason: error instanceof Error ? error.message : String(error) });
        console.warn(`Full demo continued after ${id} failed: ${failures.at(-1).reason}`);
      } finally {
        if (previousPrivacySetting === undefined) delete process.env.DEMO_HIDE_PRIVATE_WORKSPACE;
        else process.env.DEMO_HIDE_PRIVATE_WORKSPACE = previousPrivacySetting;
      }
    }
    await page.waitForTimeout(800);
    const source = await closeRecordContext(context, page);
    const output = path.join(config.rawFullDir, "developer-workplace-full-demo.webm");
    await fs.copyFile(source, output);
    report.fullDemo = { status: failures.length ? "partial" : "recorded", file: "developer-workplace-full-demo.webm", durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)), failures };
  } catch (error) {
    report.fullDemo = { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    console.error(report.fullDemo.reason); process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    await writeReport(report);
  }
}
