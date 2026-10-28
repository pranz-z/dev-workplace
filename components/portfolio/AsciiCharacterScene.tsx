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
    const host = container.current, pre = artwork.current, lightPre = lightArtwork.current;
    if (!host || !pre || !lightPre) return;
    let disposed = false, stop: (() => void) | undefined;
    void import("./ascii-scene-player").then(({ startScene }) => {
      if (!disposed) stop = startScene(host, pre, lightPre, paused, setAvailable);
    }).catch(() => { /* The original poster remains available if the optional player fails. */ });
    return () => { disposed = true; stop?.(); };
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
