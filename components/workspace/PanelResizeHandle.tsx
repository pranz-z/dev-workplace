"use client";

import { useRef } from "react";

export function PanelResizeHandle({ label, value, min, max, reverse = false, onChange }: {
  label: string; value: number; min: number; max: number; reverse?: boolean; onChange: (value: number) => void;
}) {
  const start = useRef({ x: 0, value });
  const resize = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return <div role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0}
    className={`workspace-resize-handle ${reverse ? "left" : "right"}`}
    onPointerDown={(event) => { start.current = { x: event.clientX, value }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(start.current.value + (event.clientX - start.current.x) * (reverse ? -1 : 1)); }}
    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      resize(event.key === "Home" ? min : event.key === "End" ? max : value + (event.key === "ArrowRight" ? 20 : -20) * (reverse ? -1 : 1));
    }} />;
}
