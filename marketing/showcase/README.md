# Developer Workplace showcase recorder

This folder contains Playwright tooling for independently recording clean product-demo scenes and a separate full walkthrough. It does not change production application behavior.

## Setup

Install the repo dependencies, then install Chromium once:

```powershell
npx playwright install chromium
```

Choose a base URL with `DEMO_BASE_URL`; the default is `https://frami-devplace.vercel.app`. The recorder captures a 1920×1080 viewport and converts the final MP4 files to 30 fps. Override the viewport/FPS with `VIEWPORT_WIDTH`, `VIEWPORT_HEIGHT`, and `VIDEO_FPS` if needed.

Owner authentication is manual. Run `npm run demo:auth`, sign in in the opened Chromium window, and let the script save storage state under `.auth/owner.json`. On Windows, the script uses the installed Edge Chromium runtime when the downloaded Playwright Chromium cannot open a headed window. The state is gitignored and is never printed by the recorder. Never copy or upload it.

## Commands

```powershell
npm run demo:auth
npm run demo:scene -- portfolio
npm run demo:scene -- kanban
npm run demo:scenes
npm run demo:full
npm run demo:videos
```

Each scene command creates a fresh browser context. Re-record one scene by rerunning its command, for example `npm run demo:scene -- kanban`. The full walkthrough is recorded in its own context and file.

## Safe demo data

Kanban and Calendar recordings are read-only, so no production task state is changed. The Focus scene snapshots and restores this browser tab's Focus session state. It refuses to record if an existing focus session is active. Workspace AI requires an explicitly approved project display name in `DEMO_PROJECT`; it attaches that context only in the chat and does not alter the project. Do not use a private or sensitive project. GitHub browsing is read-only. The report records demo entity names only and excludes database IDs, auth state, and tokens.

If a mutating scene cannot prove restoration, it should be skipped and reported; the pipeline must not create persistent demo records automatically.

## Outputs

Raw WebM, converted MP4, and review frames are written beneath `output/`, which is gitignored. `metadata/scene-manifest.json` describes the scenes and `metadata/recording-report.json` stores recording status, validation specs, scene failures, and the mutation journal. The converter uses FFmpeg from `FFMPEG_PATH`, PATH, the ignored local `.tools/ffmpeg/bin`, or Playwright's bundled runtime when capable. Inspect every representative frame before external use.

Generated recordings and authentication data must not be committed. This phase does not create cinematic assets, overlays, music, or a deploy.
