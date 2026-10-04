import fs from "node:fs/promises";
import path from "node:path";
import { config, sceneList } from "../config/demo.config.mjs";

export async function readReport() {
  let report;
  try { report = JSON.parse(await fs.readFile(path.join(config.metadataDir, "recording-report.json"), "utf8")); }
  catch { report = { authentication: "not checked", demoEntities: {}, mutations: [], scenes: {}, fullDemo: null, ffmpeg: "not checked", privacyReview: "manual review required" }; }
  return { ...report, baseURL: config.baseURL, viewport: { width: config.width, height: config.height }, targetFps: config.fps };
}

export async function writeReport(report) {
  await fs.mkdir(config.metadataDir, { recursive: true });
  await fs.writeFile(path.join(config.metadataDir, "recording-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function writeManifest(report) {
  const scenes = sceneList.map((scene) => ({
    id: scene.id, order: scene.order, title: scene.title,
    file: `${scene.file}.mp4`, rawFile: `${scene.file}.webm`,
    targetDuration: scene.targetDuration,
    generated: report.scenes?.[scene.id]?.status === "recorded",
    requiresAuth: scene.requiresAuth, usesAI: scene.usesAI, mutatesData: scene.mutatesData,
    restored: report.scenes?.[scene.id]?.restored ?? !scene.mutatesData,
  }));
  await fs.mkdir(config.metadataDir, { recursive: true });
  await fs.writeFile(path.join(config.metadataDir, "scene-manifest.json"), `${JSON.stringify(scenes, null, 2)}\n`, "utf8");
}
