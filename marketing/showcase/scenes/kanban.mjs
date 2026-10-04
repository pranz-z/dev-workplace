import { demoClick, pauseForShot, waitForWorkspace } from "../scripts/demo-helpers.mjs";

export async function run({ page }) {
  await waitForWorkspace(page);
  await demoClick(page, page.getByRole("button", { name: "Tasks", exact: true }));
  await page.getByRole("region", { name: "Task Kanban board" }).waitFor({ state: "visible", timeout: 20000 });
  await pauseForShot(page, 900);
  // The board is already in Kanban view on entry; leave its read-only filter unchanged.
  await pauseForShot(page, 1200);
  const firstTask = page.locator("[data-status] button[aria-label^='Reorder']").first();
  if (await firstTask.count()) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await pauseForShot(page, 500);
    await demoClick(page, firstTask, { hoverMs: 350 });
    await pauseForShot(page, 1000);
  }
  // Read-only scene: do not drag a production task or change its status/order.
  await pauseForShot(page, 900);
}
