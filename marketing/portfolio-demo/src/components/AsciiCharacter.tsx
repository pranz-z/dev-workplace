import { useLayoutEffect, useMemo, useRef } from "react";
import { random, useCurrentFrame, useVideoConfig } from "remotion";
import data from "../data/character.json";
import { mono } from "../theme";

// The portfolio's own pre-rendered ASCII character (components/portfolio/ascii-data/animation.json),
// replayed frame-accurately on a canvas. 10 source fps, 56 frames, loops.
type Run = [string, string, string?];
const runs = data.runs as unknown as Run[];
const frames = data.frames as unknown as number[][];
const palette = data.palette as unknown as [string, string][];
const COLS = data.columns as number;
const ROWS = data.rows as number;
const GLYPHS = "@%#*+=-:.";

type Seg = { x: number; text: string; color: string };
const cache = new Map<number, Seg[][]>();
function decode(index: number): Seg[][] {
  const hit = cache.get(index);
  if (hit) return hit;
  const rows: Seg[][] = [[]];
  let x = 0;
  for (const r of frames[index]) {
    const [tone, text] = runs[r];
    const parts = text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) { rows.push([]); x = 0; }
      if (part.trim().length) rows[rows.length - 1].push({ x, text: part, color: palette[Number(tone)]?.[0] ?? "#F3EBDD" });
      x += part.length;
    });
  }
  cache.set(index, rows);
  return rows;
}

export const CHARACTER_ASPECT = 36 / 35; // the site's scene box: cell = width/216 × height/168

export const AsciiCharacter: React.FC<{
  width: number;
  /** 0..1 top-to-bottom "decode" reveal; 1 = fully drawn. */
  reveal?: number;
  /** Source-frame offset so different shots don't start on the same pose. */
  offset?: number;
  style?: React.CSSProperties;
}> = ({ width, reveal = 1, offset = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const height = Math.round(width / CHARACTER_ASPECT);
  const fontSize = height / ROWS; // one row per line, glyphs stretched horizontally to the cell width
  const cellW = width / COLS;
  const index = (Math.floor((frame / fps) * 10) + offset) % frames.length;
  const rows = useMemo(() => decode(index), [index]);
  const scale = 2;

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width * scale, height * scale);
    ctx.font = `400 ${fontSize}px ${mono}`;
    ctx.textBaseline = "top";
    const advance = ctx.measureText("M").width || fontSize * 0.6;
    ctx.setTransform((scale * cellW) / advance, 0, 0, scale, 0, 0);
    const cutRow = reveal * (ROWS + 12);
    rows.forEach((segs, y) => {
      if (y > cutRow) return;
      const edge = cutRow - y < 12; // rows near the reveal line are still "decoding"
      for (const s of segs) {
        ctx.fillStyle = edge ? "#F2B84B" : s.color;
        const text = edge
          ? s.text.replace(/\S/g, (_, i) => GLYPHS[Math.floor(random(`${y}-${s.x + i}-${frame}`) * GLYPHS.length)])
          : s.text;
        ctx.fillText(text, s.x * advance, y * fontSize);
      }
    });
  }, [rows, width, height, fontSize, cellW, reveal, frame]);

  return <canvas ref={ref} width={width * scale} height={height * scale} style={{ width, height, display: "block", ...style }} />;
};
