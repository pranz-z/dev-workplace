import { spawnSync } from "node:child_process";
import { sceneList } from "../config/demo.config.mjs";

let failed = false;
for (const scene of sceneList) {
  console.log(`\nRecording ${scene.id}...`);
  const result = spawnSync(process.execPath, ["marketing/showcase/scripts/record-scene.mjs", scene.id], { stdio: "inherit", env: process.env });
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
