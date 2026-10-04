import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { config, sceneList } from "../config/demo.config.mjs";
import { createDemoContext, closeRecordContext, fileExists, injectCaptureCursor } from "./demo-helpers.mjs";
import { readReport, writeManifest, writeReport } from "./demo-state.mjs";

const id = process.argv[2] || process.argv.find((arg) => arg.startsWith("--scene="))?.split("=")[1];
const scene = sceneList.find((item) => item.id === id);
if (!scene) {
  console.error(`Choose one scene: ${sceneList.map((item) => item.id).join(", ")}`);
  process.exitCode = 2;
} else {
  const report = await readReport();
  const authPresent = await fileExists(config.authFile);
  report.authentication = authPresent ? "owner storage state available (gitignored)" : "required; owner.json missing";
  if (scene.requiresAuth && !authPresent) {
    report.authentication = "required; owner.json missing";
    report.scenes[scene.id] = { status: "blocked", reason: "Run npm run demo:auth and complete the manual owner sign-in." };
    await writeReport(report); await writeManifest(report);
    console.error("This scene needs an owner session. Run npm run demo:auth, finish the manual login, then rerun this scene.");
    process.exitCode = 3;
  } else {
    await fs.mkdir(config.rawScenesDir, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const context = await createDemoContext(browser, { authenticated: scene.requiresAuth, recordDir: config.rawScenesDir });
    const page = await context.newPage();
    const started = Date.now();
    let source;
    try {
      await injectCaptureCursor(page);
      const sceneRunner = await import(`../scenes/${scene.id}.mjs`);
      await sceneRunner.run({ page, config, report });
      await page.waitForTimeout(650);
      source = await closeRecordContext(context, page);
      const target = path.join(config.rawScenesDir, `${scene.file}.webm`);
      await fs.copyFile(source, target);
      report.scenes[scene.id] = { status: "recorded", file: `${scene.file}.webm`, durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)), restored: scene.id === "focus" ? true : !scene.mutatesData, mutationJournal: [] };
      if (scene.id === "workspace-ai") report.demoEntities.workspaceAiProject = config.demoProject;
      if (scene.id === "kanban") report.demoEntities.kanban = "Read-only current board; no task status or order changed.";
      if (scene.id === "calendar") report.demoEntities.calendar = "Current month view; no task date changed.";
      if (scene.id === "github") report.demoEntities.github = "Read-only authorized public repository cards; no GitHub writes.";
      if (scene.id === "focus") report.demoEntities.focus = "General focus session; no task attached; browser session state restored.";
      if (scene.id === "public-ai") report.demoEntities.publicAi = "Public portfolio knowledge only; no private attachment.";
      if (scene.id === "workspace-ai") report.workspaceAi = "success";
      if (scene.id === "public-ai") report.publicAi = "success";
    } catch (error) {
      try { source = await closeRecordContext(context, page); } catch { /* closed during failure */ }
      const reason = error instanceof Error ? error.message : String(error);
      const safelySkipped = scene.id === "workspace-ai" && reason.startsWith("Approved project ");
      report.scenes[scene.id] = { status: safelySkipped ? "skipped" : "failed", reason, durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)) };
      if (safelySkipped) report.demoEntities.workspaceAiProject = { requested: config.demoProject, available: false, contextAttached: false, requestSent: false };
      if (scene.id === "workspace-ai") report.workspaceAi = `${safelySkipped ? "skipped" : "failure"}: ${reason}`;
      if (scene.id === "public-ai") report.publicAi = `failure: ${report.scenes[scene.id].reason}`;
      console.error(`Scene ${scene.id} ${safelySkipped ? "skipped" : "failed"}: ${reason}`);
      process.exitCode = safelySkipped ? 0 : 1;
    } finally {
      await browser.close().catch(() => {});
      await writeReport(report); await writeManifest(report);
    }
  }
}
