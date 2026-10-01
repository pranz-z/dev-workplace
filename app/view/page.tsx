"use client";

import Link from "next/link";
import { ArrowUpRight, Flame, FolderGit2, Moon, Sparkles, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { calculateAccountabilityScore } from "@/data/githubAccountabilityService";
import { mockGithubActivity, mockProjects } from "@/data/mockData";
import { listPublicProjects, toProjectViewFromPublicProject } from "@/data/projectService";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "developer-workspace-theme";

const getResolvedTheme = (mode: ThemeMode) => {
  if (typeof window === "undefined") return "light";
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
};

export default function PublicViewerPage() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [visibility] = useState(() => {
    const defaults = { score: true, streak: true, commits: false, projects: true, heatmap: false, recent: false, username: false };
    if (typeof window === "undefined") return defaults;
    try {
      return { ...defaults, ...JSON.parse(window.localStorage.getItem("developer-workplace-public-visibility") ?? "{}") };
    } catch {
      return defaults;
    }
  });
  const [projects, setProjects] = useState(() => (isSupabaseConfigured() ? [] : mockProjects));
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
    if (!isSupabaseConfigured()) return;
    listPublicProjects().then((remoteProjects) => {
      setProjects(remoteProjects.map(toProjectViewFromPublicProject));
    }).catch(() => setLoadError(true));
  }, []);

  const publicProjects = useMemo(
    () =>
      [...projects]
        .filter((project) => project.visibility === "Public")
        .sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false)),
    [projects],
  );

  const featuredProjects = publicProjects.filter((project) => project.featured);
  const otherProjects = publicProjects.filter((project) => !project.featured);
  const publicActivity = isSupabaseConfigured() ? [] : mockGithubActivity.filter((event) => event.public);
  const accountability = calculateAccountabilityScore(publicProjects, publicActivity, new Date("2026-09-30T18:00:00.000Z"));

  return (
    <div className="public-shell">
      <header className="mx-auto max-w-6xl px-4 py-5">
        <div className="flex items-center justify-between gap-3 rounded-full border border-[var(--public-border)] bg-[var(--surface)]/80 px-4 py-3 backdrop-blur-sm">
          <Link href="/" className="text-sm font-semibold tracking-[0.18em] text-[var(--ink)] uppercase">
            Franz Cayanan
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-[var(--muted)] md:flex">
            <Link href="/view">Projects</Link>
            <Link href="/view#about">About</Link>
            <Link href="/view#resume">Resume</Link>
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setThemeMode((current) => (current === "light" ? "dark" : current === "dark" ? "system" : "light"))}
              className="rounded-full border border-[var(--public-border)] bg-white/40 p-2 text-[var(--ink)]"
              aria-label="Toggle public theme"
            >
              {themeMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <Link href="/app" className="public-link">
              Private workspace
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 pb-16">
        {loadError && <p role="alert" className="public-card p-4 text-sm text-[var(--muted)]">Public projects could not be loaded right now.</p>}
        <section className="public-hero p-6 md:p-10">
          <div className="grid items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Computer Science graduate</p>
              <h1 className="mt-4 text-4xl font-black tracking-tight text-[var(--ink)] md:text-6xl">
                Software developer building useful, thoughtful experiences.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted)] md:text-lg">
                I design and build products across AI, web apps, mobile experiments, and portfolio-grade prototypes — with a focus on clarity, craftsmanship, and human-centered problem solving.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="#featured" className="public-link">Featured work</Link>
                {publicProjects[0] && <Link href={`/view/project/${publicProjects[0].slug}`} className="public-link">View a project</Link>}
              </div>
            </div>

            <div className="rounded-[28px] border border-[var(--public-border)] bg-[var(--surface-strong)] p-5 shadow-[0_18px_48px_rgba(89,73,62,0.08)]">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Currently</p>
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink)]">
                  <Sparkles size={10} /> Building
                </span>
              </div>
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Focus</p>
                  <p className="mt-2 text-xl font-bold text-[var(--ink)]">Developer Workplace</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">Portfolio prototype + project operating system for personal product work.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Role</p>
                    <p className="mt-2 text-base font-semibold text-[var(--ink)]">Full-stack / product</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Stack</p>
                    <p className="mt-2 text-base font-semibold text-[var(--ink)]">Next.js + TypeScript</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="featured" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-3xl font-black tracking-tight text-[var(--ink)]">Featured work</h2>
            <span className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              Selected projects
            </span>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {featuredProjects.map((project) => (
              <Link key={project.id} href={`/view/project/${project.slug ?? project.id}`} className="public-card group p-4 transition hover:-translate-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ink)]">
                    {project.type}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{project.status}</span>
                </div>
                <h3 className="mt-4 text-2xl font-bold text-[var(--ink)]">{project.name}</h3>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{project.publicSummary ?? project.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {project.technologies.slice(0, 3).map((tech) => (
                    <span key={tech} className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] text-[var(--ink)]">{tech}</span>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  <span>View project</span>
                  <ArrowUpRight size={14} />
                </div>
              </Link>
            ))}
            {featuredProjects.length === 0 && <p className="public-card p-5 text-sm text-[var(--muted)]">No featured public projects are available.</p>}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-3xl font-black tracking-tight text-[var(--ink)]">Other projects</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {otherProjects.map((project) => (
              <Link key={project.id} href={`/view/project/${project.slug ?? project.id}`} className="public-card flex h-full flex-col justify-between p-5">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xl font-bold text-[var(--ink)]">{project.name}</h3>
                    <span className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ink)]">
                      {project.type}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{project.publicSummary ?? project.description}</p>
                </div>
                <div className="mt-5 flex items-center justify-between text-sm text-[var(--ink)]">
                  <span>{project.progress}% complete</span>
                  <span className="inline-flex items-center gap-2">Explore <ArrowUpRight size={15} /></span>
                </div>
              </Link>
            ))}
            {otherProjects.length === 0 && publicProjects.length > 0 && <p className="public-card p-5 text-sm text-[var(--muted)]">No other public projects are available.</p>}
          </div>
        </section>

        <section id="github-activity" className="public-card p-6 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">✦ Building consistently</p><h2 className="mt-3 text-3xl font-black text-[var(--ink)]">GitHub activity</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">A small public view of building rhythm. Activity counts are intentionally separate from software quality.</p></div>
            <span className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Demo data</span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {visibility.score && <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4"><p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Accountability score</p><p className="mt-2 text-4xl font-black text-[var(--ink)]">{accountability.total}<span className="text-lg font-semibold text-[var(--muted)]"> / 100</span></p></div>}
            {visibility.streak && <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4"><p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Current rhythm</p><p className="mt-2 flex items-center gap-2 text-xl font-bold text-[var(--ink)]"><Flame size={17} /> {accountability.currentStreak} day streak</p><p className="mt-1 text-xs text-[var(--muted)]">{accountability.activeDaysThisWeek} active days this week</p></div>}
            {visibility.projects && <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4"><p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Projects maintained</p><p className="mt-2 text-4xl font-black text-[var(--ink)]">{accountability.updatedProjects}</p><p className="mt-1 text-xs text-[var(--muted)]">public project updates this month</p></div>}
          </div>
          {visibility.heatmap && <div className="mt-5 rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4"><p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Last 30 days</p><div className="activity-heatmap mt-3">{Array.from({ length: 30 }, (_, index) => <span key={index} className="activity-cell level-1" />)}</div></div>}
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]"><span>{visibility.commits ? `${accountability.commits} meaningful commits` : "Meaningful activity"}</span><span>·</span><span>{accountability.state}</span>{visibility.username && <><span>·</span><span>@franzcayanan</span></>}</div>
        </section>

        <section id="about" className="grid gap-6 md:grid-cols-[1fr_0.8fr]">
          <div className="public-card p-6">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">About</p>
            <h2 className="mt-3 text-3xl font-black text-[var(--ink)]">I build software that clarifies complexity.</h2>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">
              My work sits at the intersection of product thinking, frontend craft, AI experimentation, and practical software systems. I enjoy turning messy real-world problems into clear, usable digital experiences — whether through a booking platform, a support assistant, or a portfolio concept that tells a stronger story.
            </p>
          </div>

          <div className="public-card p-6">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Tools</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {"Next.js TypeScript Tailwind Python React UX Design AI RAG Unity".split(" ").map((item) => (
                <span key={item} className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--ink)]">{item}</span>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-3 text-[var(--muted)]">
              <FolderGit2 size={18} />
              <span>Available for product and software roles.</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
