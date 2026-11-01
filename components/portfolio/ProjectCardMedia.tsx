"use client";

import { useEffect, useRef, useState } from "react";
import type { PreviewVideoUrl } from "@/lib/project-video/policy";

export function ProjectCardMedia({ slug, name, type, coverUrl }: { slug: string; name: string; type: string; coverUrl?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = media.current;
    const card = frame.current?.closest("article");
    if (!video || !card) return;
    const pointer = matchMedia("(hover: hover) and (pointer: fine)");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const controller = new AbortController();
    let active = true, hovering = false, visible = true, unavailable = false, failures = 0, sequence = 0;
    let cached: PreviewVideoUrl | null = null;
    let pending: Promise<PreviewVideoUrl | null> | null = null;
    let failureRefreshUsed = false;
    const eligible = () => active && hovering && visible && !document.hidden && pointer.matches && !motion.matches;
    const stop = () => {
      sequence++;
      hovering = false;
      video.pause();
      try { video.currentTime = 0; } catch { /* Metadata may not yet be available. */ }
      if (active) setPlaying(false);
    };
    const resolve = async () => {
      if (cached && cached.expiresAt > Date.now() + 30_000) return cached;
      if (pending) return pending;
      pending = fetch(`/api/public/projects/${encodeURIComponent(slug)}/preview-video`, { cache: "no-store", signal: controller.signal })
        .then(async response => {
          if (response.status === 404) { unavailable = true; return null; }
          if (!response.ok) throw new Error("Preview unavailable");
          const result: PreviewVideoUrl = await response.json();
          if (!result.url || result.mimeType !== "video/mp4" || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error("Invalid preview");
          cached = result;
          return result;
        }).catch(() => { if (active) failures++; return null; }).finally(() => { pending = null; });
      return pending;
    };
    const enter = async (event: Event) => {
      if ((event as PointerEvent).pointerType === "touch") return;
      const bounds = card.getBoundingClientRect();
      visible = bounds.bottom > 0 && bounds.top < window.innerHeight && bounds.right > 0 && bounds.left < window.innerWidth;
      hovering = true;
      if (!eligible() || unavailable || failures >= 2) return;
      const ticket = ++sequence;
      const signed = await resolve();
      if (!signed || !eligible() || ticket !== sequence) return;
      if (video.getAttribute("src") !== signed.url) { video.src = signed.url; video.load(); }
      video.muted = true;
      try {
        await video.play();
        if (ticket !== sequence) return;
        if (!eligible()) { stop(); return; }
        failures = 0;
        setPlaying(true);
      } catch {
        if (eligible()) { failures++; setPlaying(false); }
      }
    };
    const failed = () => {
      if (active) {
        failures++;
        if (failureRefreshUsed) unavailable = true;
        else { failureRefreshUsed = true; cached = null; }
        stop();
      }
    };
    const capabilityChanged = () => {
      if (!pointer.matches || motion.matches) {
        stop(); video.removeAttribute("src"); video.load();
      }
    };
    const visibilityChanged = () => { if (document.hidden) stop(); };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (!visible) stop();
    });
    observer.observe(card);
    card.addEventListener("pointerenter", enter);
    card.addEventListener("pointerleave", stop);
    video.addEventListener("error", failed);
    pointer.addEventListener("change", capabilityChanged);
    motion.addEventListener("change", capabilityChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      active = false; controller.abort(); observer.disconnect(); stop();
      video.removeAttribute("src"); video.load();
      card.removeEventListener("pointerenter", enter); card.removeEventListener("pointerleave", stop);
      video.removeEventListener("error", failed);
      pointer.removeEventListener("change", capabilityChanged); motion.removeEventListener("change", capabilityChanged);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [slug]);

  return <div ref={frame} className="pointer-events-none relative mb-4 aspect-video w-full overflow-hidden rounded-2xl border border-[var(--public-border)]">
    {coverUrl ? <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={coverUrl} alt={`${name} project preview`} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
    </> : <div aria-hidden="true" className="absolute inset-0 flex items-end bg-[linear-gradient(135deg,var(--surface-strong),var(--surface))] p-4"><span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">{type}</span></div>}
    <video ref={media} muted playsInline loop preload="none" aria-hidden="true" tabIndex={-1} className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${playing ? "opacity-100" : "opacity-0"}`} />
  </div>;
}
