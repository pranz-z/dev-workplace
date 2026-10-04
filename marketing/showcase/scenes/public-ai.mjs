import { config } from "../config/demo.config.mjs";
import { demoClick, pauseForShot, waitForAppReady } from "../scripts/demo-helpers.mjs";

export async function run({ page }) {
  await waitForAppReady(page);
  await demoClick(page, page.getByRole("button", { name: "Ask AI about Franz" }));
  await page.getByRole("dialog", { name: "Ask about the Developer" }).waitFor({ state: "visible", timeout: 15000 });
  await pauseForShot(page, 700);
  await page.getByLabel("Question about the developer").fill("What AI systems has Franz built?");
  await demoClick(page, page.getByRole("button", { name: "Send question" }));
  const dialog = page.getByRole("dialog", { name: "Ask about the Developer" });
  const answer = dialog.locator(".chat-note").last();
  await answer.waitFor({ state: "visible", timeout: config.aiTimeoutMs });
  await page.waitForFunction(() => !document.querySelector("[role='dialog'] [role='status']"), null, { timeout: config.aiTimeoutMs }).catch(() => {});
  const text = (await answer.innerText()).trim();
  if (!text || text === "What AI systems has Franz built?") throw new Error("Public AI did not show a real assistant response.");
  await pauseForShot(page, 1600);
}
