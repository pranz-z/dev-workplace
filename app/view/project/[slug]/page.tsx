"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, FolderGit2, Moon, Sparkles, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { mockProjects } from "@/data/mockData";
import { getPublicProjectBySlug, toProjectViewFromPublicProject } from "@/data/projectService";

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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [project, setProject] = useState(() => mockProjects.find((item) => item.slug === slug) ?? mockProjects[0]);

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
    getPublicProjectBySlug(slug).then((remoteProject) => {
      if (remoteProject) setProject(toProjectViewFromPublicProject(remoteProject));
    }).catch(() => undefined);
  }, [slug]);

  const featureCards = [
    { label: "Role", value: project.role },
    { label: "Project type", value: project.type },
    { label: "Progress", value: `${project.progress}%` },
    { label: "Status", value: project.status },
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
              <h1 className="mt-4 text-4xl font-black tracking-tight text-[var(--ink)] md:text-5xl">{project.name}</h1>
              <p className="mt-4 text-lg leading-8 text-[var(--muted)]">{project.publicSummary ?? project.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {project.links.live && (
                <a href={project.links.live} target="_blank" rel="noreferrer" className="public-link">
                  Live demo <ArrowUpRight size={15} />
                </a>
              )}
              {project.links.github && (
                <a href={project.links.github} target="_blank" rel="noreferrer" className="public-link">
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

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="public-card p-6">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Overview</p>
            <h2 className="mt-3 text-3xl font-black text-[var(--ink)]">What this project is.</h2>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">{project.objective}</p>
          </div>

          <div className="public-card p-6">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Tech stack</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {project.technologies.map((tech) => (
                <span key={tech} className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--ink)]">{tech}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          <div className="public-card p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Problem</p>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">{project.publicProblem ?? project.description}</p>
          </div>
          <div className="public-card p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Solution</p>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">{project.publicSolution ?? project.objective}</p>
          </div>
          <div className="public-card p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Result</p>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">{project.publicResult ?? project.nextAction}</p>
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
            {project.links.github && (
              <a href={project.links.github} target="_blank" rel="noreferrer" className="public-link">
                GitHub <FolderGit2 size={15} />
              </a>
            )}
            {project.links.live && (
              <a href={project.links.live} target="_blank" rel="noreferrer" className="public-link">
                Live demo <ArrowUpRight size={15} />
              </a>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
