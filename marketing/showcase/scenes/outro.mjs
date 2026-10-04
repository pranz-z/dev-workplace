import { pauseForShot, waitForAppReady } from "../scripts/demo-helpers.mjs";

export async function run({ page }) {
  await waitForAppReady(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pauseForShot(page, 3500);
}
