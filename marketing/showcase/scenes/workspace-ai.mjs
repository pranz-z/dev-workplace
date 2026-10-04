import { config } from "../config/demo.config.mjs";
import { demoClick, pauseForShot, waitForWorkspace } from "../scripts/demo-helpers.mjs";

export async function run({ page }) {
  if (!config.demoProject) throw new Error("Set DEMO_PROJECT to an explicitly approved, non-sensitive project name before recording Workspace AI.");
  await waitForWorkspace(page);
  // The authenticated workspace behind the floating assistant can contain unrelated
  // private records. Add a browser-only privacy veil below the chat panel.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { styleSheetId } = await cdp.send("CSS.createStyleSheet", { frameId: frameTree.frame.id });
  await cdp.send("CSS.setStyleSheetText", { styleSheetId, text: `
    body::before { content: ""; position: fixed; inset: 0; z-index: 35; pointer-events: none;
      background: radial-gradient(ellipse at 50% 8%, rgba(126, 108, 190, .2), transparent 42%), #171820; }
    .workspace-ai-panel.is-open { position: fixed !important; inset: 3vh auto auto 50% !important;
      transform: translateX(-50%) !important; width: min(920px, 90vw) !important;
      height: 94vh !important; z-index: 36 !important; border-radius: 24px !important; }
  ` });
  const open = page.getByRole("button", { name: "Open Workspace AI chat" });
  await demoClick(page, open);
  await page.getByRole("region", { name: "Workspace AI chat" }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel("Context type").selectOption("project");
  const projectPicker = page.getByLabel("Workspace item to attach");
  const projectValue = await projectPicker.locator("option").evaluateAll((options, projectName) => {
    const exact = options.find((option) => option.textContent?.trim() === projectName);
    return exact?.value ?? "";
  }, config.demoProject);
  if (!projectValue) throw new Error(`Approved demo project not found: ${config.demoProject}`);
  await projectPicker.selectOption(projectValue);
  await demoClick(page, page.getByRole("button", { name: "Add context", exact: true }));
  const contextChips = page.locator('[aria-label="Attached workspace context"] .ai-context-chip');
  await contextChips.first().waitFor({ state: "visible" });
  if (await contextChips.count() !== 1 || (await contextChips.first().innerText()).trim() !== `project: ${config.demoProject}`) {
    throw new Error("Workspace AI did not show exactly the approved project context chip; no AI request was sent.");
  }
  if (await page.locator('[aria-label="Attached workspace context"] [data-kind="file"]').count() !== 0) {
    throw new Error("Files must not be attached to the Workspace AI demo request.");
  }
  await pauseForShot(page, 600);
  const message = page.getByLabel("Message Workspace AI");
  await message.fill("What should I prioritize next for this project?");
  await pauseForShot(page, 500);
  await demoClick(page, page.getByRole("button", { name: "Send message" }));
  const answer = page.locator(".workspace-ai-panel .chat-note").last();
  await answer.waitFor({ state: "visible", timeout: config.aiTimeoutMs });
  await page.waitForFunction(() => !document.querySelector(".workspace-ai-panel [role='status']"), null, { timeout: config.aiTimeoutMs }).catch(() => {});
  const text = (await answer.innerText()).trim();
  if (!text || text === "What should I prioritize next for this project?") throw new Error("Workspace AI did not show a real assistant response.");
  await pauseForShot(page, 2500);
  await cdp.detach();
}
