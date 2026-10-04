import { demoClick, pauseForShot, waitForWorkspace } from "../scripts/demo-helpers.mjs";

export async function run({ page }) {
  await waitForWorkspace(page);
  await pauseForShot(page, 900);
  const rail = page.getByRole("navigation", { name: "Workspace sections" });
  await rail.waitFor();
  await demoClick(page, page.getByRole("button", { name: "Today", exact: true }));
  await pauseForShot(page, 700);
  await demoClick(page, page.getByRole("button", { name: "Dashboard", exact: true }));
  await pauseForShot(page, 1000);
}
