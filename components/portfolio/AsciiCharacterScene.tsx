"use client";

import { useEffect, useRef, useState } from "react";
import poster from "./ascii-data/poster.json";
import styles from "./AsciiCharacterScene.module.css";

type Run = string[];
type Clip = { fps: number; runs: Run[]; frames: number[][] };

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
    let disposed = false;
    let visible = false;
    let clip: Clip | undefined;
    let pending: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let next = 0;
    const layers = [pre, lightPre].map(element => Array.from(element.children).map(row => ({
      element: row,
      nodes: Array.from(row.children) as HTMLSpanElement[],
      signature: "",
    })));

    const paint = (runs: readonly (readonly string[])[]) => {
      const rows = splitRows(runs);
      for (const [layer, rowNodes] of layers.entries()) {
        for (let y = 0; y < rows.length; y++) {
          const row = rows[y];
          const target = rowNodes[y];
          const signature = row.map(run => `${run[0]}:${run[layer + 1]}`).join("|");
          if (target.signature === signature) continue;
          target.signature = signature;
          while (target.nodes.length < row.length) {
            const span = document.createElement("span");
            target.element.append(span);
            target.nodes.push(span);
          }
          for (let i = 0; i < target.nodes.length; i++) {
            const run = row[i];
            const text = run?.[layer + 1] ?? "";
            const tone = run?.[0] ?? "0";
            if (target.nodes[i].textContent !== text) target.nodes[i].textContent = text;
            if (target.nodes[i].dataset.tone !== tone) {
              target.nodes[i].dataset.tone = tone;
              target.nodes[i].style.color = poster.palette[Number(tone)]?.[layer] ?? "var(--nb-ink)";
            }
          }
        }
      }
    };
    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const allowed = () => !disposed && visible && !document.hidden && !reduced.matches && !compact.matches;
    const tick = () => {
      timer = undefined;
      if (!clip || !allowed() || paused.current) return;
      const interval = 1000 / clip.fps;
      const now = performance.now();
      // Skip missed frames after a busy interval instead of queuing catch-up work.
      const steps = Math.max(1, Math.floor((now - next) / interval) + 1);
      frame = (frame + steps) % clip.frames.length;
      const runs = clip.runs;
      paint(clip.frames[frame].map(index => runs[index]));
      host.dataset.frame = String(frame);
      next = Math.max(next + steps * interval, now + 1);
      timer = setTimeout(tick, Math.max(1, next - performance.now()));
    };
    const sync = () => {
      stop();
      const staticOnly = reduced.matches || compact.matches;
      setAvailable(!staticOnly && !!clip);
      if (staticOnly) {
        frame = 0;
        paint(poster.runs);
        host.dataset.frame = "0";
        host.dataset.playback = "static";
        return;
      }
      if (!allowed()) {
        host.dataset.playback = "suspended";
        return;
      }
      if (!clip) {
        host.dataset.playback = "poster";
        pending ??= import("./ascii-data/animation.json").then(module => {
          if (disposed) return;
          const data = module.default;
          if (data.frames.length && data.fps > 0) clip = data;
          sync();
        }).catch(() => {
          // The SSR poster remains usable if the optional animation cannot load.
          if (!disposed) host.dataset.playback = "poster";
        });
        return;
      }
      host.dataset.playback = paused.current ? "paused" : "playing";
      if (!paused.current) {
        next = performance.now() + 1000 / clip.fps;
        timer = setTimeout(tick, 1000 / clip.fps);
      }
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      sync();
    });
    observer.observe(host);
    reduced.addEventListener("change", sync);
    compact.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    host.addEventListener("scene-playback", sync);
    sync();
    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      reduced.removeEventListener("change", sync);
      compact.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      host.removeEventListener("scene-playback", sync);
    };
  }, []);

  return <div ref={container} className={styles.scene} data-playback="poster" data-frame="0">
    <pre ref={artwork} className={`${styles.artwork} ${styles.darkArtwork}`} aria-hidden="true">{posterRows.map((row, y) => <span key={y} className={styles.row}>{row.map(([tone, text], i) => <span key={i} data-tone={tone} style={{ color: poster.palette[Number(tone)]?.[0] }}>{text}</span>)}</span>)}</pre>
    <pre ref={lightArtwork} className={`${styles.artwork} ${styles.lightArtwork}`} aria-hidden="true">{posterRows.map((row, y) => <span key={y} className={styles.row}>{row.map(([tone, text, lightText], i) => <span key={i} data-tone={tone} style={{ color: poster.palette[Number(tone)]?.[1] }}>{lightText ?? text}</span>)}</span>)}</pre>
    {available && <button type="button" className={styles.playback} aria-label={playing ? "Pause decorative animation" : "Play decorative animation"} aria-pressed={!playing} onClick={() => {
      paused.current = !paused.current;
      setPlaying(!paused.current);
      container.current?.dispatchEvent(new Event("scene-playback"));
    }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      {playing ? <><rect x="4" y="3" width="3" height="10" rx=".75" /><rect x="9" y="3" width="3" height="10" rx=".75" /></> : <path d="M5 2.5v11L13 8z" />}
    </svg></button>}
  </div>;
}
