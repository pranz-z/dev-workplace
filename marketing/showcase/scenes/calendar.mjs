import { demoClick, pauseForShot, waitForWorkspace } from "../scripts/demo-helpers.mjs";

export async function run({ page }) {
  await waitForWorkspace(page);
  const rail = page.getByRole("navigation", { name: "Workspace sections" });
  await demoClick(page, rail.getByRole("button", { name: "Calendar", exact: true }));
  await page.locator("#workspace-content").getByRole("heading", { name: "Calendar", exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await pauseForShot(page, 1800);
  // Calendar stays read-only so there is no production due-date mutation to restore.
  await pauseForShot(page, 1100);
}
