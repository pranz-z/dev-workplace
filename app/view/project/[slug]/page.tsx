"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, FolderGit2, Moon, Sparkles, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { mockProjects } from "@/data/mockData";
import { PublicAccountabilityCard } from "@/components/accountability/public-accountability-card";
import { getPublicProjectBySlug, toProjectViewFromPublicProject } from "@/data/projectService";
import { isValidSlug } from "@/lib/slug";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { PublicAccountabilityHealth } from "@/types";

type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "developer-workspace-theme";

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
  const [project, setProject] = useState(() => (isSupabaseConfigured() ? null : mockProjects.find((item) => item.slug === slug) ?? null));
  const [resolvedSlug, setResolvedSlug] = useState<string | null>(() => (isSupabaseConfigured() ? null : slug));
  const [accountability, setAccountability] = useState<{ health: PublicAccountabilityHealth; score: number | null } | null>(null);
  const [loadError, setLoadError] = useState(false);

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

  const displayProject = isSupabaseConfigured()
    ? (resolvedSlug === slug ? project : null)
    : mockProjects.find((item) => item.slug === slug) ?? null;

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

  const featureCards = [
    { label: "Role", value: displayProject.role },
    { label: "Project type", value: displayProject.type },
    { label: "Progress", value: `${displayProject.progress}%` },
    { label: "Status", value: displayProject.status },
  ];

  return (
    <div className="public-shell">
      <header className="mx-auto max-w-6xl px-4 py-5">
        <div className="flex items-center justify-between gap-3 rounded-full border border-[var(--public-border)] bg-[var(--surface)]/80 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Link href="/view" className="inline-flex items-center gap-2 text-[var(--ink)]">
              <ArrowLeft size={15} />
              <span className="text-sm font-semibold uppercase tracking-[0.16em]">Portfolio</span>
            </Link>
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
              <p className="mt-4 text-lg leading-8 text-[var(--muted)]">{displayProject.publicSummary ?? displayProject.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {displayProject.links.live && (
                <a href={displayProject.links.live} target="_blank" rel="noreferrer" className="public-link">
                  Live demo <ArrowUpRight size={15} />
                </a>
              )}
              {displayProject.links.github && (
                <a href={displayProject.links.github} target="_blank" rel="noreferrer" className="public-link">
                  GitHub <FolderGit2 size={15} />
                </a>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {featureCards.map((item) => (
            <div key={item.label} className="public-card p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{item.label}</p>
              <p className="mt-3 text-lg font-bold text-[var(--ink)]">{item.value}</p>
            </div>
          ))}
        </section>

        {accountability && <PublicAccountabilityCard health={accountability.health} score={accountability.score} />}

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="public-card p-6">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Overview</p>
            <h2 className="mt-3 text-3xl font-black text-[var(--ink)]">What this project is.</h2>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">{displayProject.objective}</p>
          </div>

          <div className="public-card p-6">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Tech stack</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {displayProject.technologies.map((tech) => (
                <span key={tech} className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--ink)]">{tech}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          <div className="public-card p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Problem</p>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">{displayProject.publicProblem ?? displayProject.description}</p>
          </div>
          <div className="public-card p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Solution</p>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">{displayProject.publicSolution ?? displayProject.objective}</p>
          </div>
          <div className="public-card p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Result</p>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">{displayProject.publicResult ?? displayProject.nextAction}</p>
          </div>
        </section>

        <section className="public-card p-6">
          <div className="flex items-center gap-3">
            <Sparkles size={18} className="text-[var(--ink)]" />
            <h2 className="text-3xl font-black text-[var(--ink)]">Features</h2>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {["Service flow", "Admin tooling", "Responsive UI", "AI-assisted support"].map((feature, index) => (
              <div key={feature} className="rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">0{index + 1}</p>
                <p className="mt-3 text-xl font-bold text-[var(--ink)]">{feature}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="public-card p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Project links</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {displayProject.links.github && (
              <a href={displayProject.links.github} target="_blank" rel="noreferrer" className="public-link">
                GitHub <FolderGit2 size={15} />
              </a>
            )}
            {displayProject.links.live && (
              <a href={displayProject.links.live} target="_blank" rel="noreferrer" className="public-link">
                Live demo <ArrowUpRight size={15} />
              </a>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
