"use client";

import { useEffect, useState } from "react";
import type { PreviewVideoUrl } from "@/lib/project-video/policy";

type VideoState = { status: "loading" | "unavailable" | "error" } | { status: "ready"; video: PreviewVideoUrl };

export function PublicProjectVideo({ slug, name }: { slug: string; name: string }) {
  const [state, setState] = useState<VideoState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/public/projects/${encodeURIComponent(slug)}/preview-video`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Video unavailable");
        const video: PreviewVideoUrl = await response.json();
        if (!video.url || video.mimeType !== "video/mp4" || !Number.isFinite(video.expiresAt) || video.expiresAt <= Date.now()) throw new Error("Video unavailable");
        return video;
      })
      .then(video => {
        if (!controller.signal.aborted) setState(video ? { status: "ready", video } : { status: "unavailable" });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [slug, attempt]);

  if (state.status === "loading" || state.status === "unavailable") return null;

  return <section className="space-y-4" aria-label="Project video">
    <h2 className="text-3xl font-black text-[var(--ink)]">Project video</h2>
    {state.status === "ready" ? <video
      key={state.video.url}
      src={`${state.video.url}#t=0.1`}
      aria-label={`${name} video`}
      controls
      playsInline
      preload="metadata"
      className="aspect-video w-full rounded-2xl bg-black object-contain"
      onError={() => setState({ status: "error" })}
    /> : <div className="public-card space-y-3 p-4">
      <p role="status" className="text-sm text-[var(--muted)]">The video could not load or its link expired.</p>
      <button type="button" className="public-link" onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>Retry video</button>
    </div>}
  </section>;
}
