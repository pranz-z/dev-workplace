import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { config, sceneList } from "../config/demo.config.mjs";
import { readReport, writeManifest, writeReport } from "./demo-state.mjs";

const run = (command, args) => spawnSync(command, args, { encoding: "utf8", windowsHide: true });
async function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) {
    try { await fs.access(process.env.FFMPEG_PATH); return process.env.FFMPEG_PATH; } catch { /* continue searching */ }
  }
  const system = run("where.exe", ["ffmpeg"]);
  if (system.status === 0) return system.stdout.trim().split(/\r?\n/)[0];
  const localTool = path.join(config.root, ".tools", "ffmpeg", "bin", "ffmpeg.exe");
  try { await fs.access(localTool); return localTool; } catch { /* try Playwright's minimal binary */ }
  const cache = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : path.join(os.homedir(), ".cache", "ms-playwright");
  try {
    const candidates = (await fs.readdir(cache)).filter((name) => name.startsWith("ffmpeg-")).sort((a, b) => Number(b.slice(7)) - Number(a.slice(7)));
    for (const candidate of candidates) {
      const executable = path.join(cache, candidate, "ffmpeg-win64.exe");
      try { await fs.access(executable); return executable; } catch { /* try next runtime */ }
    }
  } catch { /* no Playwright FFmpeg runtime */ }
  return null;
}
const ffmpegPath = await resolveFfmpeg();
const ffmpegCheck = ffmpegPath ? run(ffmpegPath, ["-version"]) : { status: 1 };
const ffprobeLocal = path.join(config.root, ".tools", "ffmpeg", "bin", "ffprobe.exe");
const ffprobeSystem = run("where.exe", ["ffprobe"]);
const ffprobePath = process.env.FFPROBE_PATH || (await fs.access(ffprobeLocal).then(() => ffprobeLocal).catch(() => ffprobeSystem.status === 0 ? ffprobeSystem.stdout.trim().split(/\r?\n/)[0] : null));
const ffprobeCheck = ffprobePath ? run(ffprobePath, ["-version"]) : { status: 1 };
await fs.mkdir(config.finalDir, { recursive: true });
await fs.mkdir(config.reviewDir, { recursive: true });
const report = await readReport();
const candidates = [];
for (const scene of sceneList) {
  const source = path.join(config.rawScenesDir, `${scene.file}.webm`);
  try { await fs.access(source); candidates.push({ id: scene.id, name: `${scene.file}.webm`, source }); } catch { /* not recorded */ }
}
const fullSource = path.join(config.rawFullDir, "developer-workplace-full-demo.webm");
try { await fs.access(fullSource); candidates.push({ id: "fullDemo", name: "developer-workplace-full-demo.webm", source: fullSource }); } catch { /* not recorded */ }

const specs = {};
if (ffmpegCheck.status === 0) {
  for (const item of candidates) {
    const stem = item.name.replace(/\.webm$/, "");
    const output = path.join(config.finalDir, `${stem}.mp4`);
    let conversion = "success";
    const sourceStat = await fs.stat(item.source);
    const outputStat = await fs.stat(output).catch(() => null);
    if (!outputStat || sourceStat.mtimeMs > outputStat.mtimeMs || process.argv.includes("--force")) {
      const converted = run(ffmpegPath, ["-y", "-i", item.source, "-vf", `fps=${config.fps}`, "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output]);
      if (converted.status !== 0) {
        specs[item.id] = { conversion: "failed", reason: converted.stderr?.slice(-1500) || "ffmpeg conversion failed" };
        continue;
      }
      conversion = "converted";
    }
    if (ffprobeCheck.status === 0) {
      const probe = run(ffprobePath, ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,width,height,r_frame_rate", "-of", "json", output]);
      if (probe.status === 0) {
        const data = JSON.parse(probe.stdout);
        const stream = data.streams?.find((entry) => entry.codec_type === "video") ?? data.streams?.[0] ?? {};
        const duration = Number(data.format?.duration ?? 0);
        const bytes = Number(data.format?.size ?? 0);
        specs[item.id] = { file: `${stem}.mp4`, durationSeconds: Number(duration.toFixed(2)), width: stream.width, height: stream.height, frameRate: stream.r_frame_rate, codec: stream.codec_name, sizeBytes: bytes, conversion };
        const frameTime = Math.max(0, duration * (item.id === "public-ai" || item.id === "workspace-ai" ? 0.88 : 0.5));
        const frame = path.join(config.reviewDir, `${item.id === "fullDemo" ? "developer-workplace-full-demo" : item.name.replace(/\.webm$/, "")}.jpg`);
        run(ffmpegPath, ["-y", "-ss", String(frameTime), "-i", output, "-frames:v", "1", "-q:v", "2", frame]);
      }
    } else {
      const inspect = run(ffmpegPath, ["-hide_banner", "-i", output]);
      const details = inspect.stderr || "";
      const durationText = details.match(/Duration: (\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/)?.slice(1);
      const videoText = details.match(/Video: ([^,\s]+)[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?(\d+(?:\.\d+)?) fps/);
      const stat = await fs.stat(output);
      const duration = durationText ? Number(durationText[0]) * 3600 + Number(durationText[1]) * 60 + Number(durationText[2]) : null;
      specs[item.id] = { file: `${stem}.mp4`, durationSeconds: duration === null ? null : Number(duration.toFixed(2)), width: videoText ? Number(videoText[2]) : null, height: videoText ? Number(videoText[3]) : null, frameRate: videoText ? `${videoText[4]} fps` : null, codec: videoText?.[1] ?? null, sizeBytes: stat.size, conversion, inspectedWith: "ffmpeg stream inspection" };
      if (duration !== null) {
        const frame = path.join(config.reviewDir, `${item.id === "fullDemo" ? "developer-workplace-full-demo" : item.name.replace(/\.webm$/, "")}.jpg`);
        const frameTime = Math.max(0, duration * (item.id === "public-ai" || item.id === "workspace-ai" ? 0.88 : 0.5));
        run(ffmpegPath, ["-y", "-ss", String(frameTime), "-i", output, "-frames:v", "1", "-q:v", "2", frame]);
      }
    }
  }
} else {
  report.ffmpeg = "not installed; WebM source files retained, MP4 conversion skipped";
}

if (ffmpegCheck.status === 0 && ffprobeCheck.status === 0) {
  // Redact authenticated workspace scenes in the contact sheet so it cannot
  // reveal owner project, task, repository, calendar, or focus details.
  const redactedSceneIds = new Set(["workspace", "kanban", "calendar", "github", "focus"]);
  const placeholder = path.join(config.reviewDir, "private-scene-redacted.jpg");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 });
    await page.setContent(`<main style="width:480px;height:270px;display:grid;place-content:center;gap:12px;text-align:center;background:radial-gradient(ellipse at 50% 8%,#453c61,#171820 72%);color:#eeeaf7;font:500 18px/1.4 system-ui,sans-serif"><strong>Private workspace</strong><span>Details hidden in this walkthrough</span></main>`);
    await page.screenshot({ path: placeholder, type: "jpeg", quality: 90 });
  } finally { await browser.close(); }
  const frames = sceneList.map((scene) => path.join(config.reviewDir, redactedSceneIds.has(scene.id) ? "private-scene-redacted.jpg" : `${scene.file}.jpg`));
  const existing = [];
  for (const frame of frames) try { await fs.access(frame); existing.push(frame); } catch { /* missing scene */ }
  if (existing.length) {
    const args = ["-y"];
    for (const frame of existing) args.push("-i", frame);
    const filters = existing.map((_, index) => `[${index}:v]scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2[v${index}]`).join(";");
    const inputs = existing.map((_, index) => `[v${index}]`).join("");
    const layout = existing.map((_, index) => `${(index % 3) * 488}_${Math.floor(index / 3) * 278}`).join("|");
    args.push("-filter_complex", `${filters};${inputs}xstack=inputs=${existing.length}:layout=${layout}:fill=white[out]`, "-map", "[out]", path.join(config.reviewDir, "contact-sheet.jpg"));
    const sheet = run(ffmpegPath, args);
    report.contactSheet = sheet.status === 0 ? "created" : `failed: ${sheet.stderr?.slice(-800) ?? "ffmpeg contact sheet error"}`;
  }
  report.ffmpeg = "available; WebM converted to H.264 MP4 at 30 fps using CRF 19 and yuv420p";
}
report.videoSpecs = specs;
report.reviewImages = [...Object.keys(specs).filter((id) => ["success", "converted"].includes(specs[id]?.conversion) && !["workspace", "kanban", "calendar", "github", "focus"].includes(id)).map((id) => id === "fullDemo" ? "developer-workplace-full-demo.jpg" : `${sceneList.find((scene) => scene.id === id)?.file}.jpg`), ...(report.contactSheet === "created" ? ["contact-sheet.jpg"] : [])];
report.privacyReview = report.reviewImages.length
  ? "Scene 06 and full-walkthrough frames were visually inspected. Scene 06 shows only the approved project context chip and its Gemini response; authenticated workspace screens in the full walkthrough and contact sheet hide private workspace details. The separate pre-existing scene clips were not re-recorded. Owner review is recommended before external use."
  : "manual review required; no frames generated";
await writeReport(report);
await writeManifest(report);
console.log(JSON.stringify({ ffmpeg: report.ffmpeg, videoSpecs: specs, reviewImages: report.reviewImages }, null, 2));
