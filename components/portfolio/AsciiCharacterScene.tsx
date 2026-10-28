"use client";

import { useEffect, useRef, useState } from "react";
import poster from "./ascii-data/poster.json";
import styles from "./AsciiCharacterScene.module.css";

type Run = string[];

function splitRows(runs: readonly (readonly string[])[]): Run[][] {
  const rows: Run[][] = [[]];
  for (const run of runs) {
    const dark = (run[1] ?? "").split("\n");
    const light = (run[2] ?? run[1] ?? "").split("\n");
    for (let i = 0; i < dark.length; i++) {
      if (i > 0) rows.push([]);
      if (dark[i].length) rows[rows.length - 1].push([run[0], dark[i], light[i] ?? dark[i]]);
    }
  }
  return rows;
}

const posterRows = splitRows(poster.runs);

/** A pre-rendered decorative scene. All modeling and conversion happens offline. */
export function AsciiCharacterScene() {
  const container = useRef<HTMLDivElement>(null);
  const artwork = useRef<HTMLPreElement>(null);
  const lightArtwork = useRef<HTMLPreElement>(null);
  const paused = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const host = container.current;
    const pre = artwork.current;
    const lightPre = lightArtwork.current;
    if (!host || !pre || !lightPre) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const compact = matchMedia("(max-width: 767px), (pointer: coarse)");
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    const hero = host.closest("section") ?? host;
    let disposed = false, visible = false, away = false;
    let runtime: { director: import("./ascii-scene-runtime").SceneDirector; compositor: import("./ascii-scene-runtime").SceneCompositor; attention: import("./ascii-scene-runtime").SceneAttention; restFrame: number; fps: number } | undefined;
    let pending: Promise<void> | undefined;
    let raf = 0, last = 0, elapsed = 0, frame = 0;
    let width = host.getBoundingClientRect().width;
    const glow = host.querySelector<HTMLElement>("[data-scene-light]");
    const cool = host.querySelector<HTMLElement>("[data-scene-cool]");
    const layers = [pre, lightPre].map(element => Array.from(element.children).map(row => ({
      element: row, nodes: Array.from(row.children) as HTMLSpanElement[], signature: "",
    })));
    const paint = (rows: readonly (readonly (readonly string[])[] | null)[]) => {
      for (const [layer, rowNodes] of layers.entries()) for (let y = 0; y < rows.length; y++) {
        const row = rows[y]; if (!row) continue;
        const target = rowNodes[y];
        const signature = row.map(run => `${run[0]}:${run[layer + 1]}`).join("|");
        if (target.signature === signature) continue;
        target.signature = signature;
        while (target.nodes.length < row.length) {
          const span = document.createElement("span"); target.element.append(span); target.nodes.push(span);
        }
        for (let i = 0; i < target.nodes.length; i++) {
          const run = row[i], text = run?.[layer + 1] ?? "", tone = run?.[0] ?? "0";
          if (target.nodes[i].textContent !== text) target.nodes[i].textContent = text;
          if (target.nodes[i].dataset.tone !== tone) {
            target.nodes[i].dataset.tone = tone;
            target.nodes[i].style.color = tone === "37"
              ? "color-mix(in srgb, var(--accent-coral) 65%, var(--nb-accent-text))"
              : poster.palette[Number(tone)]?.[layer] ?? "var(--nb-ink)";
          }
        }
      }
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; last = elapsed = 0; };
    const allowed = () => !disposed && visible && !document.hidden && !reduced.matches;
    const tick = (now: number) => {
      raf = 0;
      if (disposed || !runtime) return;
      // Also settle preference/visibility changes if the native change event is delayed.
      if (!allowed()) { sync(); return; }
      if (paused.current) return;
      if (last) elapsed += Math.min(100, now - last);
      last = now;
      if (elapsed >= 1000 / runtime.fps) {
        const dt = elapsed; elapsed = 0;
        const sleepy = host.dataset.sleepy === "true";
        const tracking = fine.matches && !compact.matches && runtime.attention.tracking(now);
        if (!tracking) runtime.compositor.point(0, 0);
        const routine = runtime.director.advance(tracking ? 0 : dt * (sleepy ? .5 : 1));
        // Watching uses a resting pose: no typing/sip, body gesture, steam or screen clock advances.
        const state = tracking ? { ...routine, action: "idle" as const, progress: 0, sourceFrame: runtime.restFrame } : routine;
        host.dataset.sleepy = String(state.sleepy);
        const output = runtime.compositor.render(state, dt, width, compact.matches, tracking);
        paint(output.rows);
        if (glow) glow.style.opacity = String(output.glow);
        if (cool) cool.style.opacity = String(state.action === "think" ? 0 : .08 - output.glow);
        host.dataset.action = state.action;
        host.dataset.attention = tracking ? "cursor" : "routine";
        host.dataset.routineTime = String(routine.time);
        host.dataset.progress = state.progress.toFixed(3);
        host.dataset.frame = String(++frame);
      }
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      stop();
      runtime?.attention.release(); runtime?.compositor.point(0, 0);
      setAvailable(!reduced.matches && !!runtime);
      if (reduced.matches) {
        runtime?.compositor.reset(); paint(splitRows(poster.runs));
        host.dataset.frame = "0"; host.dataset.action = "idle"; host.dataset.sleepy = "false"; host.dataset.attention = "routine";
        host.dataset.playback = "static"; if (glow) glow.style.opacity = "0";
        if (cool) cool.style.opacity = "0";
        return;
      }
      if (!allowed()) { if (runtime) away = true; host.dataset.playback = "suspended"; return; }
      if (!runtime) {
        host.dataset.playback = "poster";
        pending ??= Promise.all([import("./ascii-data/animation.json"), import("./ascii-scene-runtime"), import("./ascii-scene-config")]).then(([module, engine, config]) => {
          if (disposed) return;
          const data = module.default;
          if (data.frames.length && data.fps > 0) runtime = {
            director: new engine.SceneDirector(Math.random, () => { try { return new Date().getHours(); } catch { return undefined; } }),
            compositor: new engine.SceneCompositor(data), attention: new engine.SceneAttention(), restFrame: config.SCENE_CONFIG.frames.rest, fps: config.SCENE_CONFIG.fps,
          };
          sync();
        }).catch(() => { if (!disposed) host.dataset.playback = "poster"; });
        return;
      }
      if (away) { runtime.director.recoverSleepy(); away = false; }
      host.dataset.playback = paused.current ? "paused" : "playing";
      if (!paused.current) raf = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); sync(); });
    observer.observe(hero);
    const resize = new ResizeObserver(entries => { width = entries[0]?.contentRect.width ?? width; }); resize.observe(host);
    const pointer = (event: PointerEvent) => {
      if (!runtime || !allowed() || paused.current || !fine.matches || compact.matches || event.pointerType !== "mouse") return;
      if (!runtime.attention.move(event.clientX, event.clientY, performance.now())) return;
      const rect = host.getBoundingClientRect();
      // Aim relative to the character's eyes rather than the center of the whole hero.
      runtime.compositor.point((event.clientX - rect.left - rect.width * 85 / 180) / (rect.width * .6), (event.clientY - rect.top - rect.height * 22 / 105) / (rect.height * .6));
    };
    const leave = () => { runtime?.attention.release(); runtime?.compositor.point(0, 0); };
    window.addEventListener("pointermove", pointer); window.addEventListener("pointerout", pointerOut);
    function pointerOut(event: PointerEvent) { if (!event.relatedTarget) leave(); }
    window.addEventListener("scroll", leave, { passive: true, capture: true });
    reduced.addEventListener("change", sync); compact.addEventListener("change", sync); fine.addEventListener("change", leave);
    document.addEventListener("visibilitychange", sync); host.addEventListener("scene-playback", sync);
    sync();
    return () => {
      disposed = true; stop(); observer.disconnect(); resize.disconnect();
      window.removeEventListener("pointermove", pointer); window.removeEventListener("pointerout", pointerOut);
      window.removeEventListener("scroll", leave, true);
      reduced.removeEventListener("change", sync); compact.removeEventListener("change", sync); fine.removeEventListener("change", leave);
      document.removeEventListener("visibilitychange", sync); host.removeEventListener("scene-playback", sync);
    };
  }, []);

  return <div ref={container} className={styles.scene} data-playback="poster" data-frame="0">
    <div aria-hidden="true" className={styles.artLayers}>
    <div data-scene-light className={styles.ambientLight} />
    <div data-scene-cool className={`${styles.ambientLight} ${styles.coolLight}`} />
    <pre ref={artwork} className={`${styles.artwork} ${styles.darkArtwork}`} aria-hidden="true">{posterRows.map((row, y) => <span key={y} className={styles.row}>{row.map(([tone, text], i) => <span key={i} data-tone={tone} style={{ color: poster.palette[Number(tone)]?.[0] }}>{text}</span>)}</span>)}</pre>
    <pre ref={lightArtwork} className={`${styles.artwork} ${styles.lightArtwork}`} aria-hidden="true">{posterRows.map((row, y) => <span key={y} className={styles.row}>{row.map(([tone, text, lightText], i) => <span key={i} data-tone={tone} style={{ color: poster.palette[Number(tone)]?.[1] }}>{lightText ?? text}</span>)}</span>)}</pre>
    </div>
    {available && <button type="button" className={styles.playback} aria-label={playing ? "Pause decorative animation" : "Play decorative animation"} aria-pressed={!playing} onClick={() => {
      paused.current = !paused.current;
      setPlaying(!paused.current);
      container.current?.dispatchEvent(new Event("scene-playback"));
    }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      {playing ? <><rect x="4" y="3" width="3" height="10" rx=".75" /><rect x="9" y="3" width="3" height="10" rx=".75" /></> : <path d="M5 2.5v11L13 8z" />}
    </svg></button>}
  </div>;
}
