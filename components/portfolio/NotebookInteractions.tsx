"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, SketchBorder } from "@/components/ui/notebook";

export function MarginTimeline({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const update = () => { frame = 0; const rect = element.getBoundingClientRect(); const progress = media.matches ? 1 : Math.max(0, Math.min(1, (innerHeight * .65 - rect.top) / Math.max(1, rect.height))); element.style.setProperty("--timeline-progress", `${progress * 100}%`); };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule); resize.observe(element);
    window.addEventListener("scroll", schedule, { passive: true }); window.addEventListener("resize", schedule); media.addEventListener("change", schedule); update();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); media.removeEventListener("change", schedule); };
  }, []);
  return <div ref={ref} className="notebook-timeline"><span className="notebook-timeline-fill" aria-hidden="true" /><span className="notebook-timeline-pen" aria-hidden="true" />{children}</div>;
}

export function DoodlePad() {
  const ref = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const [color, setColor] = useState("--nb-ink");
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
      if (canvas.width === width && canvas.height === height) return;
      const snapshot = document.createElement("canvas"); snapshot.width = canvas.width; snapshot.height = canvas.height; snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(snapshot, 0, 0, width, height); context.setTransform(dpr, 0, 0, dpr, 0, 0); context.lineCap = "round"; context.lineJoin = "round"; context.lineWidth = 3.5;
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); window.addEventListener("resize", resize); resize();
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, []);
  const position = (event: ReactPointerEvent<HTMLCanvasElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const stroke = (event: ReactPointerEvent<HTMLCanvasElement>, dot = false) => {
    const context = event.currentTarget.getContext("2d"); if (!context) return;
    const point = position(event); context.strokeStyle = getComputedStyle(event.currentTarget).color;
    context.beginPath(); context.moveTo(last.current.x, last.current.y); context.lineTo(point.x + (dot ? .1 : 0), point.y); context.stroke(); last.current = point;
  };
  const end = (event: ReactPointerEvent<HTMLCanvasElement>) => { if (pointer.current !== event.pointerId) return; pointer.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  return <div className="notebook-doodle-pad">
    <div className="notebook-pad"><SketchBorder /><canvas ref={ref} aria-label="Drawing area" style={{ color: `var(${color})` }} onPointerDown={(event) => { if (pointer.current !== null || event.button !== 0) return; pointer.current = event.pointerId; last.current = position(event); event.currentTarget.setPointerCapture(event.pointerId); stroke(event, true); }} onPointerMove={(event) => { if (pointer.current === event.pointerId) stroke(event); }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { pointer.current = null; }} /></div>
    <div className="notebook-pad-tools" role="group" aria-label="Drawing tools">
      {[{ token: "--nb-ink", label: "Ink" }, { token: "--nb-accent", label: "Accent" }, { token: "--nb-accent2", label: "Mint" }].map((swatch) => <button key={swatch.token} type="button" className="notebook-swatch" aria-label={swatch.label} aria-pressed={color === swatch.token} onClick={() => setColor(swatch.token)}><span style={{ background: `var(${swatch.token})` }} /></button>)}
      <Button onClick={() => { const canvas = ref.current, context = canvas?.getContext("2d"); if (canvas && context) { context.save(); context.resetTransform(); context.clearRect(0, 0, canvas.width, canvas.height); context.restore(); } }}>Erase all</Button>
    </div>
  </div>;
}
