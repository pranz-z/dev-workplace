"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, FolderGit2, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { PublicAccountabilityCard } from "@/components/accountability/public-accountability-card";
import { listPublicProjectScreenshots } from "@/data/projectScreenshotService";
import { getPublicProjectBySlug, toProjectViewFromPublicProject } from "@/data/projectService";
import { isValidSlug } from "@/lib/slug";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { PublicAccountabilityHealth } from "@/types";

type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "developer-workspace-theme";
const safeExternalUrl = (value?: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch { return undefined; }
};

const getResolvedTheme = (mode: ThemeMode) => {
  if (typeof window === "undefined") return "light";
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
};

export default function PublicProjectPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "autocare";
  const invalidSlug = isSupabaseConfigured() && !isValidSlug(slug);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [project, setProject] = useState<import("@/types").Project | null>(null);
  const [resolvedSlug, setResolvedSlug] = useState<string | null>(null);
  const [accountability, setAccountability] = useState<{ health: PublicAccountabilityHealth; score: number | null } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [screenshots, setScreenshots] = useState<Array<{ id: string; caption: string; signedUrl: string }>>([]);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const next = getResolvedTheme(themeMode);
      document.documentElement.setAttribute("data-theme", next);
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !isValidSlug(slug)) return;
    let current = true;
    getPublicProjectBySlug(slug).then((remoteProject) => {
      if (!current) return;
      setProject(remoteProject ? toProjectViewFromPublicProject(remoteProject) : null);
      setAccountability(remoteProject?.accountabilityHealth
        ? { health: remoteProject.accountabilityHealth, score: remoteProject.accountabilityScore }
        : null);
      setLoadError(false);
      setResolvedSlug(slug);
    }).catch((error: unknown) => {
      if (!current) return;
      console.error("[public-project] public_project_by_slug lookup failed", error);
      setProject(null);
      setAccountability(null);
      setLoadError(true);
      setResolvedSlug(slug);
    });
    return () => { current = false; };
  }, [slug]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !isValidSlug(slug)) return;
    let current = true;
    listPublicProjectScreenshots(slug).then((items) => { if (current) setScreenshots(items); }).catch(() => { if (current) setScreenshots([]); });
    return () => { current = false; };
  }, [slug]);

  const displayProject = resolvedSlug === slug ? project : null;

  if (isSupabaseConfigured() && !invalidSlug && resolvedSlug !== slug) {
    return <div className="public-shell min-h-screen"><main className="mx-auto max-w-3xl px-4 py-16"><section className="public-card p-6"><p className="text-sm text-[var(--muted)]">Loading project…</p></section></main></div>;
  }

  if (!displayProject || invalidSlug) {
    return (
      <div className="public-shell min-h-screen">
        <main className="mx-auto max-w-3xl px-4 py-16">
          <section className="public-card p-6">
            <h1 className="text-2xl font-black text-[var(--ink)]">{invalidSlug ? "Invalid project link" : loadError ? "Project unavailable" : "Project not found"}</h1>
            <p className="mt-3 text-sm text-[var(--muted)]">{invalidSlug ? "This project link is not valid." : loadError ? "The public project could not be loaded right now." : "This project is not available as a public view."}</p>
            <Link href="/view" className="public-link mt-5">Back to portfolio</Link>
          </section>
        </main>
      </div>
    );
  }

  const publicLiveUrl = safeExternalUrl(displayProject.links.live);
  const publicRepositoryUrl = safeExternalUrl(displayProject.links.github);
  const publicSummary = (displayProject.publicSummary || displayProject.description).trim();

  const featureCards = [
    displayProject.role ? { label: "Role", value: displayProject.role } : null,
    displayProject.teamSize ? { label: "Team", value: `Team of ${displayProject.teamSize}` } : null,
    { label: "Type", value: displayProject.type },
    { label: "Status", value: displayProject.status },
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1800);
    } catch { setLinkCopied(false); }
  };

  return (
    <div className="public-shell">
      <header className="mx-auto max-w-6xl px-4 py-5">
        <div className="flex items-center justify-between gap-3 rounded-full border border-[var(--public-border)] bg-[var(--surface)]/80 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Link href="/view" className="inline-flex items-center gap-2 text-[var(--ink)]">
              <ArrowLeft size={15} />
              <span className="text-sm font-semibold uppercase tracking-[0.16em]">Portfolio</span>
            </Link>
            <button type="button" onClick={() => void copyLink()} className="public-link" aria-live="polite">{linkCopied ? "Link copied" : "Copy link"}</button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setThemeMode((current) => (current === "light" ? "dark" : current === "dark" ? "system" : "light"))}
              className="rounded-full border border-[var(--public-border)] bg-white/40 p-2 text-[var(--ink)]"
              aria-label="Toggle public theme"
            >
              {themeMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <Link href="/app" className="public-link">Private workspace</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 pb-16">
        <section className="public-hero p-6 md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Project case study</p>
              <h1 className="mt-4 text-4xl font-black tracking-tight text-[var(--ink)] md:text-5xl">{displayProject.name}</h1>
              {publicSummary && <p className="mt-4 text-lg leading-8 text-[var(--muted)]">{publicSummary}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {publicLiveUrl && (
                <a href={publicLiveUrl} target="_blank" rel="noopener noreferrer" className="public-link">
                  Live demo <ArrowUpRight size={15} />
                </a>
              )}
              {publicRepositoryUrl && (
                <a href={publicRepositoryUrl} target="_blank" rel="noopener noreferrer" className="public-link">
                  GitHub <FolderGit2 size={15} />
                </a>
              )}
            </div>
          </div>
        </section>

        {featureCards.length > 0 && <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {featureCards.map((item) => (
            <div key={item.label} className="public-card p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{item.label}</p>
              <p className="mt-3 text-lg font-bold text-[var(--ink)]">{item.value}</p>
            </div>
          ))}
        </section>}

        {accountability && <PublicAccountabilityCard health={accountability.health} score={accountability.score} />}

        {displayProject.technologies.length > 0 && <section className="public-card p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Technologies used</p>
          <div className="mt-4 flex flex-wrap gap-2">{displayProject.technologies.map((tech) => <span key={tech} className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--ink)]">{tech}</span>)}</div>
        </section>}

        {screenshots.length > 0 && <section className="space-y-4" aria-labelledby="project-gallery-title">
          <div><p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Shared project images</p><h2 id="project-gallery-title" className="mt-2 text-3xl font-black text-[var(--ink)]">Gallery</h2></div>
          <div className="grid gap-4 md:grid-cols-2">{screenshots.map((screenshot) => <figure key={screenshot.id} className="public-card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screenshot.signedUrl} alt={screenshot.caption || `${displayProject.name} screenshot`} className="aspect-video w-full object-cover" />
            {screenshot.caption && <figcaption className="p-3 text-sm text-[var(--muted)]">{screenshot.caption}</figcaption>}
          </figure>)}</div>
        </section>}

        {[displayProject.publicProblem, displayProject.publicSolution, displayProject.publicResult].some(Boolean) && <section className="grid gap-4 md:grid-cols-3">
          {displayProject.publicProblem && <article className="public-card p-5"><h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Challenge</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--ink)]">{displayProject.publicProblem}</p></article>}
          {displayProject.publicSolution && <article className="public-card p-5"><h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Approach</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--ink)]">{displayProject.publicSolution}</p></article>}
          {displayProject.publicResult && <article className="public-card p-5"><h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Outcome</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--ink)]">{displayProject.publicResult}</p></article>}
        </section>}

        <section className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/view" className="public-link"><ArrowLeft size={14} /> Back to portfolio</Link>
          <button type="button" onClick={() => void copyLink()} className="public-link" aria-live="polite">{linkCopied ? "Link copied" : "Copy project link"}</button>
        </section>
      </main>
    </div>
  );
}
