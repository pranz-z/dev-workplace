import { moveCursorTo, pauseForShot, smoothScrollTo, waitForAppReady } from "../scripts/demo-helpers.mjs";

export async function run({ page }) {
  await waitForAppReady(page);
  await pauseForShot(page, 900);
  for (const section of ["#projects", "#experience", "#skills"]) await smoothScrollTo(page, section, { durationMs: 520 });
  const resume = page.getByRole("link", { name: "Download Resume" }).first();
  if (await resume.count()) await moveCursorTo(page, resume, { hoverMs: 900 });
  await pauseForShot(page, 400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pauseForShot(page, 900);
}
