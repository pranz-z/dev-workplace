import { demoClick, pauseForShot, waitForWorkspace } from "../scripts/demo-helpers.mjs";

export async function run({ page }) {
  await waitForWorkspace(page);
  const rail = page.getByRole("navigation", { name: "Workspace sections" });
  await demoClick(page, rail.getByRole("button", { name: "GitHub", exact: true }));
  await page.getByRole("heading", { name: "Repository access", exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await pauseForShot(page, 2500);
  // Show read-only integration information only; no repository connect/write action.
  await pauseForShot(page, 1600);
}
