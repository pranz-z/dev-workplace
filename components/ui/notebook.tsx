"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type CSSProperties } from "react";

const motionQuery = "(prefers-reduced-motion: reduce)";

/** One observer budgets visible border layers; one timer animates the shared filter. */
export function SketchFilter() {
  const turbulence = useRef<SVGFETurbulenceElement>(null);
  useEffect(() => {
    const media = matchMedia(motionQuery);
    const visible = new Set<Element>();
    let timer: ReturnType<typeof setInterval> | undefined;
    let seed = 1;
    const budget = () => {
      let count = 0;
      visible.forEach((element) => element.toggleAttribute("data-boiling", !media.matches && !document.hidden && count++ < 40));
      if (timer) clearInterval(timer);
      timer = undefined;
      if (!media.matches && !document.hidden && visible.size) timer = setInterval(() => {
        seed = seed % 6 + 1;
        turbulence.current?.setAttribute("seed", String(seed));
      }, 170);
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => { if (isIntersecting) visible.add(target); else { visible.delete(target); target.removeAttribute("data-boiling"); } });
      budget();
    });
    const tracked = new Set<Element>();
    const discover = () => {
      document.querySelectorAll(".notebook-border[data-animate]").forEach((element) => {
        if (!tracked.has(element)) { tracked.add(element); observer.observe(element); }
      });
      tracked.forEach((element) => { if (!element.isConnected) { observer.unobserve(element); tracked.delete(element); visible.delete(element); } });
      budget();
    };
    const mutations = new MutationObserver(discover);
    mutations.observe(document.body, { childList: true, subtree: true });
    discover();
    media.addEventListener("change", budget);
    document.addEventListener("visibilitychange", budget);
    return () => { if (timer) clearInterval(timer); observer.disconnect(); mutations.disconnect(); media.removeEventListener("change", budget); document.removeEventListener("visibilitychange", budget); tracked.forEach((element) => element.removeAttribute("data-boiling")); };
  }, []);
  return <svg className="notebook-filter" aria-hidden="true" focusable="false"><defs><filter id="boil" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence ref={turbulence} type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="1" /><feDisplacementMap in="SourceGraphic" scale="3.2" /></filter></defs></svg>;
}

export function SketchBorder({ animated = false }: { animated?: boolean }) {
  return <span aria-hidden="true" className="notebook-border" data-animate={animated || undefined} />;
}

export function Button({ variant = "secondary", className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return <button type="button" {...props} className={`notebook-button notebook-button-${variant} ${className}`}><SketchBorder />{children}</button>;
}

export function Card({ tilt = false, animated = false, className = "", children, ...props }: HTMLAttributes<HTMLElement> & { tilt?: boolean; animated?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !tilt) return;
    const media = matchMedia(motionQuery);
    const reset = () => { element.style.removeProperty("--rx"); element.style.removeProperty("--ry"); };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || media.matches || !matchMedia("(pointer: fine)").matches) return;
      const rect = element.getBoundingClientRect();
      element.style.setProperty("--rx", `${(.5 - (event.clientY - rect.top) / rect.height) * 8}deg`);
      element.style.setProperty("--ry", `${((event.clientX - rect.left) / rect.width - .5) * 8}deg`);
    };
    element.addEventListener("pointermove", move); element.addEventListener("pointerleave", reset); media.addEventListener("change", reset);
    return () => { element.removeEventListener("pointermove", move); element.removeEventListener("pointerleave", reset); media.removeEventListener("change", reset); reset(); };
  }, [tilt]);
  return <article {...props} ref={ref} className={`notebook-card ${className}`}><SketchBorder animated={animated} />{children}</article>;
}

function useReveal() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const media = matchMedia(motionQuery);
    const show = () => { element.setAttribute("data-visible", ""); element.removeAttribute("data-pending"); };
    if (media.matches) { show(); return; }
    element.setAttribute("data-pending", "");
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { show(); observer.disconnect(); } }, { threshold: .25 });
    observer.observe(element);
    const change = () => { if (media.matches) { show(); observer.disconnect(); } };
    media.addEventListener("change", change);
    return () => { observer.disconnect(); media.removeEventListener("change", change); };
  }, []);
  return ref;
}

/** Inline span preserves the caller's heading level and accessible name. */
export function UnderlineHeading({ children, className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  const ref = useReveal();
  return <span {...props} ref={ref} className={`notebook-underline ${className}`}>{children}<svg aria-hidden="true" focusable="false" viewBox="0 0 300 12" preserveAspectRatio="none"><path pathLength="1" d="M2 8C60 2 120 11 180 5S270 8 298 4" /></svg></span>;
}

export function Reveal({ children, className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  const ref = useReveal();
  return <span {...props} ref={ref} className={`notebook-reveal ${className}`}>{children}</span>;
}

export function Chip({ children, dimmed = false, highlighted = false, rotation = 0, className = "", style, ...props }: HTMLAttributes<HTMLSpanElement> & { dimmed?: boolean; highlighted?: boolean; rotation?: number }) {
  return <span {...props} className={`notebook-chip ${className}`} data-dimmed={dimmed || undefined} data-highlighted={highlighted || undefined} style={{ ...style, "--rotation": `${Math.max(-2, Math.min(2, rotation))}deg` } as CSSProperties}><SketchBorder />{children}</span>;
}

export function PencilTrail() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduce = matchMedia(motionQuery), fine = matchMedia("(pointer: fine)");
    let points: Array<{ x: number; y: number; time: number }> = [];
    let frame = 0;
    let color = "";
    const allowed = () => !reduce.matches && fine.matches && !document.hidden;
    const fit = () => { const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; context.setTransform(dpr, 0, 0, dpr, 0, 0); points = []; };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; points = []; context.clearRect(0, 0, innerWidth, innerHeight); };
    const draw = () => {
      frame = 0;
      if (!allowed()) { stop(); return; }
      const now = performance.now();
      points = points.filter((point) => now - point.time < 700);
      context.clearRect(0, 0, innerWidth, innerHeight); context.lineCap = "round"; context.strokeStyle = color;
      for (let i = 1; i < points.length; i++) { const alpha = 1 - (now - points[i].time) / 700; context.globalAlpha = alpha * .7; context.lineWidth = 1 + alpha * 2.5; context.beginPath(); context.moveTo(points[i - 1].x, points[i - 1].y); context.lineTo(points[i].x, points[i].y); context.stroke(); }
      if (points.length) frame = requestAnimationFrame(draw);
    };
    const move = (event: PointerEvent) => { if (event.pointerType !== "mouse" || !allowed()) return; color = getComputedStyle(canvas).color; points.push({ x: event.clientX, y: event.clientY, time: performance.now() }); if (points.length > 200) points.shift(); if (!frame) frame = requestAnimationFrame(draw); };
    fit(); window.addEventListener("resize", fit); window.addEventListener("pointermove", move); document.addEventListener("visibilitychange", stop); reduce.addEventListener("change", stop); fine.addEventListener("change", stop);
    return () => { stop(); window.removeEventListener("resize", fit); window.removeEventListener("pointermove", move); document.removeEventListener("visibilitychange", stop); reduce.removeEventListener("change", stop); fine.removeEventListener("change", stop); };
  }, []);
  return <canvas ref={ref} className="notebook-trail" aria-hidden="true" />;
}
