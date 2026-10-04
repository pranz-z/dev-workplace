# Developer Workplace showcase

## 45-second brief exports

The additional `BriefShowcase` composition follows the supplied 45-second sketchbook brief. It adds an original instrumental/paper-sound score, on-screen story text, labeled workflow illustrations for missing recorded actions, the explicit publication diagram, security stickers, and the final tagline. The earlier 30-second composition remains available.

Composition IDs: `Showcase45Landscape` (1920×1080), `Showcase45Portrait` (1080×1920), and `Showcase45Square` (1080×1080). Each is 1,350 frames at 30 fps. Render with `npx remotion render src/index.tsx COMPOSITION OUTPUT.mp4 --codec=h264 --pixel-format=yuv420p --video-bitrate=12M --audio-bitrate=192k --concurrency=2`.

The 45-second cut uses timestamp-normalized local copies in `public/render-media`, preserving the supplied originals, and the existing `@remotion/media` video component. `public/audio/sketchbook-score.wav` is original synthesized music with light percussion and paper/pencil sounds. Text uses the bundled Caveat font. Portrait and square are composed separately rather than cropped from the landscape master. Private card/event details and most of the workspace AI answer are veiled; GitHub is cropped to the public Developer Workplace card. Final H.264 exports are converted to limited-range yuv420p for playback compatibility and retain AAC audio.

The delivered shot list documents exact trims, unused media, and footage limitations. The reference X page was blocked, so pacing uses the existing reference analysis.

The active cut is a silent, 30-second Remotion composition built from the real Developer Workplace recordings and screenshots. The motion direction uses short product beats, eased camera pushes and pans, layered windows, and spatial transitions, translated into the app's warm paper palette and sketch accents.

## Run locally

From this directory:

1. Install the pinned local dependencies with npm ci.
2. Preview the composition with npm run studio.
3. Render the master with npm run render.
4. Run npx tsc --noEmit to check the composition types.

The render writes renders/developer-workplace-reference-style-handdrawn.mp4. Contact-sheet creation is documented in renders/create-contact-sheet.ps1.

## Source media and privacy

The public/recordings entries are same-volume hard links to the source recordings in ../output/final. They do not duplicate the video data. The public/stills entries link to real application screenshots already present in this showcase folder.

The dashboard is limited to its greeting and summary metrics. Kanban task cards are veiled while its board and lane structure stay visible. The GitHub shot is a source-space crop of only the public Developer Workplace repository card. Workspace AI keeps the real project context chip, prompt, and a short opening excerpt of the real answer; the rest of the answer is covered to protect project details. Calendar and Focus footage are omitted.

No narration, captions, music, synthetic voice, generated video, or fabricated interface is used. Recorded video streams are muted. The master has no audio stream.

Rendered media and local source-video links are ignored by Git. No production application files are part of this Remotion project.
