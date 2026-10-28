import poster from "./ascii-data/poster.json";
import type { HeadFrame } from "./ascii-pose-bank";

type Run = readonly string[];
function splitRows(runs: readonly Run[]) {
  const rows: string[][][] = [[]];
  for (const run of runs) {
    const dark = run[1].split("\n"), light = (run[2] ?? run[1]).split("\n");
    for (let i = 0; i < dark.length; i++) {
      if (i) rows.push([]);
      if (dark[i]) rows.at(-1)!.push([run[0], dark[i], light[i]]);
    }
  }
  return rows;
}

/** Deferred browser driver; the initial bundle contains only the untouched poster. */
export function startScene(host: HTMLDivElement, pre: HTMLPreElement, lightPre: HTMLPreElement, paused: { current: boolean }, available: (value: boolean) => void) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)"), compact = matchMedia("(max-width: 767px), (pointer: coarse)"), fine = matchMedia("(hover: hover) and (pointer: fine)");
  const hero = host.closest("section") ?? host, glow = host.querySelector<HTMLElement>("[data-scene-light]"), cool = host.querySelector<HTMLElement>("[data-scene-cool]");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  host.querySelector("[aria-hidden]")?.append(canvas);
  const context = canvas.getContext("2d")!;
  const bodyCanvas = document.createElement("canvas");
  bodyCanvas.setAttribute("aria-hidden", "true");
  Object.assign(bodyCanvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", display: "none" });
  canvas.before(bodyCanvas);
  const bodyContext = bodyCanvas.getContext("2d")!;
  const rowSprites = new Map<string, HTMLCanvasElement>();
  let colors: string[] = [];
  let latestRows: (readonly Run[])[] = splitRows(poster.runs);
  const paint = (rows: readonly (readonly Run[] | null)[]) => {
    if (rows.length !== latestRows.length) latestRows = Array.from({ length: rows.length }, () => []);
    for (let y = 0; y < rows.length; y++) if (rows[y]) latestRows[y] = rows[y]!;
    const animated = rows.length !== poster.rows;
    pre.style.visibility = lightPre.style.visibility = animated ? "hidden" : "";
    bodyCanvas.style.display = animated ? "block" : "none";
    if (!animated) return;
    const dpr = Math.min(2, devicePixelRatio || 1), padding = 2;
    const cellWidth = width / 216, cellHeight = rect.height / latestRows.length;
    bodyContext.clearRect(0, 0, width, rect.height);
    for (let y = 0; y < latestRows.length; y++) {
      const row = latestRows[y];
      const key = `${dark}/${width}/${dpr}/` + row.map(run => `${run[0]}:${run[dark ? 1 : 2]}`).join("|");
      let sprite = rowSprites.get(key);
      if (!sprite) {
        sprite = document.createElement("canvas");
        sprite.width = Math.ceil((width + padding * 2) * dpr);
        sprite.height = Math.ceil((cellHeight * 2 + padding * 2) * dpr);
        const ink = sprite.getContext("2d")!;
        ink.setTransform(dpr, 0, 0, dpr, 0, 0);
        ink.font = `${dark ? 400 : 700} ${cellWidth / .6}px ${family}`;
        ink.textBaseline = "top";
        ink.shadowColor = dark ? "transparent" : "rgba(48,35,22,.9)";
        ink.shadowBlur = dark ? 0 : .65;
        let x = 0;
        for (const run of row) {
          const text = run[dark ? 1 : 2];
          if (text.trim()) { ink.fillStyle = colors[Number(run[0])] ?? "transparent"; ink.fillText(text, padding + x * cellWidth, padding); }
          x += text.length;
        }
        const limit = Math.max(1, Math.floor(16 * 1024 * 1024 / (sprite.width * sprite.height * 4)));
        if (rowSprites.size >= limit) rowSprites.delete(rowSprites.keys().next().value!);
      } else rowSprites.delete(key);
      rowSprites.set(key, sprite); // LRU: static furniture rows remain hot during pose changes.
      bodyContext.drawImage(sprite, -padding, y * cellHeight - padding, sprite.width / dpr, sprite.height / dpr);
    }
  };
  let disposed = false, visible = false, raf = 0, last = 0, elapsed = 0, frame = 0, clock = 0, pending: Promise<void> | undefined;
  let rect = host.getBoundingClientRect(), width = rect.width, geometryReads = 1, headSignature = "", dark = true, family = "monospace";
  let currentHead: HeadFrame | undefined;
  const headSprites = new Map<string, HTMLCanvasElement>();
  let runtime: { director: import("./ascii-scene-runtime").SceneDirector; compositor: import("./ascii-scene-runtime").SceneCompositor; follower: import("./ascii-pose-follow").PoseFollower; bank: import("./ascii-pose-bank").PoseBank; routine: import("./ascii-scene-runtime").SceneState } | undefined;
  const blank = () => { context.clearRect(0, 0, width, rect.height); headSignature = ""; currentHead = undefined; };
  const geometry = () => {
    rect = host.getBoundingClientRect(); width = rect.width; geometryReads++;
    dark = getComputedStyle(pre).display !== "none";
    family = getComputedStyle(dark ? pre : lightPre).fontFamily;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = bodyCanvas.width = Math.round(width * dpr); canvas.height = bodyCanvas.height = Math.round(rect.height * dpr); context.setTransform(dpr, 0, 0, dpr, 0, 0); bodyContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    rowSprites.clear();
    const probe = document.createElement("span");
    host.append(probe);
    colors = poster.palette.map(pair => { probe.style.color = pair[dark ? 0 : 1]; return getComputedStyle(probe).color; });
    probe.style.color = "color-mix(in srgb, var(--accent-coral) 65%, var(--nb-accent-text))";
    colors[37] = getComputedStyle(probe).color; probe.remove();
    headSignature = "";
    paint(latestRows);
    if (currentHead) drawHead(currentHead);
  };
  const drawHead = (head: HeadFrame | undefined) => {
    if (!head) { if (headSignature) blank(); return; }
    currentHead = head;
    const signature = `${head.key}/${width}/${dark}`;
    if (headSignature === signature) return;
    headSignature = signature; context.clearRect(0, 0, width, rect.height);
    const scale = .8220408163265306 * width / 1080, cellWidth = 4.5 * scale, cellHeight = 450 / 80 * scale;
    const left = ((head.anchor[0] - 225) * .8220408163265306 + 90) * width / 1080;
    const top = (head.anchor[1] - 430 - 29) * scale;
    const dpr = Math.min(2, devicePixelRatio || 1), padding = 2;
    const spriteKey = `${head.key.slice(head.key.lastIndexOf("/") + 1)}/${width}/${dark}/${dpr}`;
    let sprite = headSprites.get(spriteKey);
    if (!sprite) {
      sprite = document.createElement("canvas");
      sprite.width = sprite.height = Math.ceil((450 * scale + padding * 2) * dpr);
      const ink = sprite.getContext("2d")!; ink.setTransform(dpr, 0, 0, dpr, 0, 0);
      ink.font = `${dark ? 400 : 700} ${cellWidth / .6}px ${family}`; ink.textBaseline = "top";
      ink.shadowColor = dark ? "transparent" : "rgba(48,35,22,.9)"; ink.shadowBlur = dark ? 0 : .65;
      for (let y = 0; y < head.rows.length; y++) {
        let x = 0;
        const position = y * cellHeight, band = position / (width / 108) % 1;
        ink.globalAlpha = band > .7 ? .85 : 1;
        for (const [tone, a, b] of head.rows[y]) {
          const text = dark ? a : b;
          if (text.trim()) { ink.fillStyle = poster.palette[tone]?.[dark ? 0 : 1] ?? "transparent"; ink.fillText(text, padding + x * cellWidth, padding + position); }
          x += text.length;
        }
      }
      if (headSprites.size >= 16) headSprites.delete(headSprites.keys().next().value!);
      headSprites.set(spriteKey, sprite);
    }
    context.drawImage(sprite, left - padding, top - padding, sprite.width / dpr, sprite.height / dpr);
    host.dataset.poseHead = head.key; host.dataset.poseBody = head.bodyKey;
  };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; last = elapsed = 0; };
  const eligible = () => !disposed && !reduced.matches && !compact.matches && fine.matches;
  const allowed = () => eligible() && visible && !document.hidden;
  const staticFrame = () => {
    runtime?.follower.release(); runtime?.compositor.reset();
    runtime?.follower.advance(0, performance.now(), { fine: false, mobile: compact.matches, reduced: reduced.matches, paused: false, visible, hidden: document.hidden, sip: false });
    paint(splitRows(poster.runs)); blank();
    host.dataset.frame = "0"; host.dataset.action = "idle"; host.dataset.attention = "routine"; host.dataset.playback = "static"; host.dataset.poseBody = "native"; host.dataset.poseHead = "native";
    if (glow) glow.style.opacity = "0"; if (cool) cool.style.opacity = "0";
  };
  const tick = (now: number) => {
    raf = 0;
    if (!allowed()) { sync(); return; }
    if (!runtime || paused.current) return;
    if (last) elapsed += Math.min(100, now - last); last = now;
    if (elapsed >= 1000 / 22) {
      const started = performance.now(), dt = elapsed; elapsed = 0; clock += dt;
      const sip = ["mug", "think", "sigh"].includes(runtime.routine.action);
      const follow = runtime.follower.advance(dt, now, { fine: fine.matches, mobile: compact.matches, reduced: reduced.matches, paused: false, visible, hidden: document.hidden, sip });
      runtime.routine = runtime.director.advance(follow.active ? 0 : dt);
      const state = follow.active
        ? { ...runtime.routine, action: "idle" as const, progress: 0, time: clock, sourceFrame: Math.floor(clock / 100) % 16 }
        : { ...runtime.routine, time: clock };
      let head: HeadFrame | undefined;
      const output = runtime.compositor.render(state, dt, width, false, false, follow.active ? grid => { head = runtime!.bank.apply(grid, follow); } : undefined);
      paint(output.rows); drawHead(head);
      if (!follow.active) { host.dataset.poseHead = "native"; host.dataset.poseBody = "native"; }
      if (glow) glow.style.opacity = String(output.glow); if (cool) cool.style.opacity = String(state.action === "think" ? 0 : .08 - output.glow);
      host.dataset.action = state.action; host.dataset.attention = follow.active ? "cursor" : "routine";
      host.dataset.routineTime = String(runtime.routine.time); host.dataset.progress = state.progress.toFixed(3); host.dataset.frame = String(++frame);
      host.dataset.headYaw = follow.headYaw.toFixed(2); host.dataset.torsoYaw = follow.torsoYaw.toFixed(2); host.dataset.bodyStep = String(follow.bodyStep);
      host.dataset.geometryReads = String(geometryReads); host.dataset.frameCost = (performance.now() - started).toFixed(3);
    }
    raf = requestAnimationFrame(tick);
  };
  function sync() {
    stop(); available(eligible() && !!runtime);
    if (!eligible()) { staticFrame(); return; }
    if (!allowed()) { host.dataset.playback = "suspended"; return; }
    if (!runtime) {
      host.dataset.playback = "poster";
      pending ??= Promise.all([import("./ascii-data/animation.json"), import("./ascii-scene-runtime"), import("./ascii-pose-follow"), import("./ascii-pose-bank"), import("./ascii-data/poses.json")]).then(([clip, engine, follow, bank, poses]) => {
        if (disposed) return;
        const director = new engine.SceneDirector(Math.random, () => { try { return new Date().getHours(); } catch { return undefined; } });
        runtime = { director, compositor: new engine.SceneCompositor(clip.default), follower: new follow.PoseFollower(), bank: new bank.PoseBank(poses.default as import("./ascii-pose-bank").PoseData), routine: director.advance(0) };
        sync();
      }).catch(() => { if (!disposed) { host.dataset.playback = "poster"; available(false); } });
      return;
    }
    host.dataset.playback = paused.current ? "paused" : "playing";
    if (!paused.current) raf = requestAnimationFrame(tick);
  }
  const pointer = (event: PointerEvent) => {
    if (!runtime || !allowed() || paused.current || event.pointerType !== "mouse") return;
    runtime.follower.point((event.clientX - rect.left - width * 85 / 180) / (width * .6), (event.clientY - rect.top - rect.height * 22 / 105) / (rect.height * .6), performance.now());
  };
  const leave = () => runtime?.follower.release();
  const pointerOut = (event: PointerEvent) => { if (!event.relatedTarget) leave(); };
  const scroll = () => { geometry(); leave(); };
  const resize = new ResizeObserver(geometry); resize.observe(host);
  const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); sync(); }); observer.observe(hero);
  const theme = new MutationObserver(geometry); theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  const scheme = matchMedia("(prefers-color-scheme: light)"); scheme.addEventListener("change", geometry);
  geometry(); void document.fonts.ready.then(() => { if (!disposed) { headSprites.clear(); geometry(); } });
  window.addEventListener("resize", geometry); window.addEventListener("pointermove", pointer); window.addEventListener("pointerout", pointerOut); window.addEventListener("scroll", scroll, { passive: true, capture: true });
  reduced.addEventListener("change", sync); compact.addEventListener("change", sync); fine.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync); host.addEventListener("scene-playback", sync); sync();
  return () => {
    disposed = true; stop(); resize.disconnect(); observer.disconnect(); theme.disconnect(); canvas.remove(); bodyCanvas.remove(); rowSprites.clear();
    window.removeEventListener("resize", geometry); window.removeEventListener("pointermove", pointer); window.removeEventListener("pointerout", pointerOut); window.removeEventListener("scroll", scroll, true);
    reduced.removeEventListener("change", sync); compact.removeEventListener("change", sync); fine.removeEventListener("change", sync); scheme.removeEventListener("change", geometry);
    document.removeEventListener("visibilitychange", sync); host.removeEventListener("scene-playback", sync);
  };
}
