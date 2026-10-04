import { demoClick, pauseForShot, waitForWorkspace } from "../scripts/demo-helpers.mjs";

export async function run({ page, report }) {
  await waitForWorkspace(page);
  await demoClick(page, page.getByRole("button", { name: "Today", exact: true }));
  await page.getByRole("region", { name: "Focus session" }).waitFor({ state: "visible", timeout: 20000 });
  const initial = await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).filter((key) => key.startsWith("developer-workspace-focus-session-v1:")).map((key) => [key, sessionStorage.getItem(key)])));
  if (Object.values(initial).some((raw) => { try { const value = JSON.parse(raw); return value.session?.status === "running" || value.session?.status === "paused"; } catch { return false; } })) {
    throw new Error("An existing focus session is active; skipping to avoid interrupting it.");
  }
  await pauseForShot(page, 600);
  const start = page.getByRole("button", { name: "Start Focus Session" });
  await demoClick(page, start);
  await page.getByRole("button", { name: "End Session" }).waitFor({ state: "visible", timeout: 10000 });
  await pauseForShot(page, 1200);
  const exitFocusMode = page.getByRole("button", { name: "Exit Focus Mode" });
  if (!(await exitFocusMode.count())) await demoClick(page, page.getByRole("button", { name: "Enter Focus Mode" }));
  await pauseForShot(page, 1500);
  if (await exitFocusMode.count()) await demoClick(page, exitFocusMode);
  await pauseForShot(page, 500);
  await demoClick(page, page.getByRole("button", { name: "End Session" }));
  await page.getByRole("button", { name: "Start Focus Session" }).waitFor({ state: "visible", timeout: 10000 });
  // Focus session state is browser sessionStorage; restore its exact pre-record snapshot.
  await page.evaluate((snapshot) => {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("developer-workspace-focus-session-v1:")) sessionStorage.removeItem(key);
    for (const [key, value] of Object.entries(snapshot)) if (value !== null) sessionStorage.setItem(key, value);
  }, initial);
  report.mutations.push({ resource: "browser focus-session snapshot", originalState: "captured from authenticated tab sessionStorage", temporaryState: "one temporary focus session, then ended", restorationResult: "restored exact prior sessionStorage values" });
  await pauseForShot(page, 900);
}
