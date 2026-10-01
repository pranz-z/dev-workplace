"use client";

import Link from "next/link";
import { ArrowUpRight, FolderGit2, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listPublicProjects, toProjectViewFromPublicProject } from "@/data/projectService";
import { getPublicProfile } from "@/data/profileService";
import { listPublicProjectScreenshots } from "@/data/projectScreenshotService";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { PublicProfile } from "@/types";

type ThemeMode = "light" | "dark" | "system";
const THEME_STORAGE_KEY = "developer-workspace-theme";
const getResolvedTheme = (mode: ThemeMode) => mode === "system"
  ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  : mode;

function safeExternalUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch { return undefined; }
}
function safeEmail(value?: string) {
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
}

export default function PublicViewerPage() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [projects, setProjects] = useState<ReturnType<typeof toProjectViewFromPublicProject>[]>([]);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [selectedType, setSelectedType] = useState("All");
  const [loadError, setLoadError] = useState(false);
  const supabaseMissing = !isSupabaseConfigured();

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.setAttribute("data-theme", getResolvedTheme(themeMode));
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    Promise.all([listPublicProjects(), getPublicProfile(), listPublicProjectScreenshots(null)]).then(([remoteProjects, publicProfile, screenshots]) => {
      if (!active) return;
      setProjects(remoteProjects.map(toProjectViewFromPublicProject));
      setProfile(publicProfile);
      setCovers(Object.fromEntries(screenshots.map((image) => [image.projectSlug, image.signedUrl])));
    }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, []);

  const publicProjects = useMemo(() => projects.filter((project) => project.visibility === "Public"), [projects]);
  const featuredProjects = publicProjects.filter((project) => project.featured);
  const types = [...new Set(publicProjects.map((project) => project.type).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const visibleProjects = selectedType === "All" ? publicProjects : publicProjects.filter((project) => project.type === selectedType);
  const technologyCount = new Set(publicProjects.flatMap((project) => project.technologies)).size;
  const socialLinks = [
    { label: "GitHub", href: safeExternalUrl(profile?.githubUrl) },
    { label: "LinkedIn", href: safeExternalUrl(profile?.linkedinUrl) },
    { label: "Website", href: safeExternalUrl(profile?.websiteUrl) },
  ].filter((item): item is { label: string; href: string } => Boolean(item.href));
  const displayName = profile?.displayName?.trim();
  const contactEmail = safeEmail(profile?.contactEmail);

  return (
    <div className="public-shell min-h-screen">
      <header className="mx-auto max-w-6xl px-4 py-5">
        <div className="flex items-center justify-between gap-3 rounded-full border border-[var(--public-border)] bg-[var(--surface)]/80 px-4 py-3 backdrop-blur-sm">
          <Link href="/view" className="min-w-0 truncate text-sm font-semibold tracking-[0.12em] text-[var(--ink)] uppercase">{displayName || "Developer portfolio"}</Link>
          <nav aria-label="Portfolio" className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-[var(--muted)] sm:text-sm">
            <Link href="#projects">Projects</Link>
            {profile?.bio && <Link href="#about">About</Link>}
            {(contactEmail || socialLinks.length > 0) && <Link href="#contact">Contact</Link>}
          </nav>
          <button type="button" onClick={() => setThemeMode((current) => current === "light" ? "dark" : current === "dark" ? "system" : "light")} className="rounded-full border border-[var(--public-border)] bg-white/40 p-2 text-[var(--ink)]" aria-label="Toggle public theme">
            {themeMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 pb-16">
        {(loadError || supabaseMissing) && <p role="alert" className="public-card p-4 text-sm text-[var(--muted)]">The public portfolio could not be loaded right now.</p>}
        <section className="public-hero p-6 md:p-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            {profile?.avatarUrl && <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={profile.avatarUrl} alt="" className="h-24 w-24 rounded-3xl border border-[var(--public-border)] object-cover" />
            </>}
            <div className="min-w-0">
              {profile?.headline && <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">{profile.headline}</p>}
              <h1 className="mt-3 text-4xl font-black tracking-tight text-[var(--ink)] md:text-6xl">{displayName || "Selected work"}</h1>
              {profile?.bio && <p className="mt-5 max-w-3xl whitespace-pre-line text-base leading-7 text-[var(--muted)] md:text-lg">{profile.bio}</p>}
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="#projects" className="public-link">Explore projects</Link>
                {contactEmail && <a href={`mailto:${contactEmail}`} className="public-link">Contact</a>}
                {socialLinks.map((item) => <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" className="public-link">{item.label} <ArrowUpRight size={14} /></a>)}
              </div>
            </div>
          </div>
          {publicProjects.length > 0 && <div className="mt-8 flex flex-wrap gap-3 border-t border-[var(--public-border)] pt-5 text-sm text-[var(--muted)]" aria-label="Public portfolio facts">
            <span>{publicProjects.length} public {publicProjects.length === 1 ? "project" : "projects"}</span>
            <span aria-hidden="true">·</span><span>{publicProjects.filter((project) => project.status === "Completed").length} completed</span>
            <span aria-hidden="true">·</span><span>{technologyCount} project technologies</span>
          </div>}
        </section>

        <section id="projects" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Selected work</p><h2 className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)]">Projects</h2></div>
            {types.length > 1 && <div className="flex max-w-full flex-wrap gap-2" aria-label="Filter projects by type">
              {["All", ...types].map((type) => <button key={type} type="button" aria-pressed={selectedType === type} onClick={() => setSelectedType(type)} className={`rounded-full border px-3 py-2 text-xs ${selectedType === type ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]" : "border-[var(--public-border)] bg-[var(--surface)] text-[var(--muted)]"}`}>{type}</button>)}
            </div>}
          </div>
          {featuredProjects.length > 0 && selectedType === "All" && <div className="space-y-4"><h3 className="text-xl font-bold text-[var(--ink)]">Featured work</h3><div className="grid gap-5 md:grid-cols-2">
            {featuredProjects.map((project) => <ProjectCard key={project.id} project={project} featured coverUrl={covers[project.slug]} />)}
          </div></div>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleProjects.filter((project) => selectedType !== "All" || !project.featured).map((project) => <ProjectCard key={project.id} project={project} coverUrl={covers[project.slug]} />)}
          </div>
          {publicProjects.length === 0 && <p className="public-card p-5 text-sm text-[var(--muted)]">No public projects are available yet.</p>}
          {publicProjects.length > 0 && visibleProjects.length === 0 && <p className="public-card p-5 text-sm text-[var(--muted)]">No projects match this type.</p>}
        </section>

        {profile?.bio && <section id="about" className="public-card p-6 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">About</p>
          <h2 className="mt-2 text-3xl font-black text-[var(--ink)]">{profile.headline || "A little about my work"}</h2>
          <p className="mt-4 max-w-3xl whitespace-pre-line text-base leading-7 text-[var(--muted)]">{profile.bio}</p>
        </section>}
        {(contactEmail || socialLinks.length > 0) && <footer id="contact" className="public-card flex flex-wrap items-center justify-between gap-4 p-6">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Contact</p><h2 className="mt-2 text-2xl font-bold text-[var(--ink)]">Let&apos;s connect</h2></div>
          <div className="flex flex-wrap gap-2">{contactEmail && <a className="public-link" href={`mailto:${contactEmail}`}>Email</a>}{socialLinks.map((item) => <a key={item.label} className="public-link" href={item.href} target="_blank" rel="noopener noreferrer">{item.label} <ArrowUpRight size={14} /></a>)}</div>
        </footer>}
      </main>
    </div>
  );
}

function ProjectCard({ project, featured = false, coverUrl }: { project: ReturnType<typeof toProjectViewFromPublicProject>; featured?: boolean; coverUrl?: string }) {
  const repoUrl = safeExternalUrl(project.links.github);
  const demoUrl = safeExternalUrl(project.links.live);
  const summary = (project.publicSummary || project.description).trim();
  return <article className="public-card flex min-w-0 flex-col p-5">
    {coverUrl ? <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={coverUrl} alt={`${project.name} project preview`} className="mb-4 aspect-video w-full rounded-2xl border border-[var(--public-border)] object-cover" />
    </> : <div aria-hidden="true" className="mb-4 flex aspect-video items-end rounded-2xl border border-[var(--public-border)] bg-[linear-gradient(135deg,var(--surface-strong),var(--surface))] p-4"><span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">{project.type}</span></div>}
    <div className="flex items-center justify-between gap-3"><span className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ink)]">{project.type}</span><span className="text-xs text-[var(--muted)]">{project.status}</span></div>
    <h3 className="mt-4 text-2xl font-bold text-[var(--ink)]">{project.name}</h3>
    {summary && <p className="mt-3 line-clamp-3 text-sm leading-6 text-[var(--muted)]">{summary}</p>}
    {(project.role || project.teamSize) && <p className="mt-3 text-xs text-[var(--muted)]">{project.role}{project.role && project.teamSize ? " · " : ""}{project.teamSize ? `Team of ${project.teamSize}` : ""}</p>}
    {project.technologies.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{project.technologies.slice(0, 5).map((tech) => <span key={tech} className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] text-[var(--ink)]">{tech}</span>)}</div>}
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
      <Link href={`/view/project/${project.slug}`} className="public-link">{featured ? "Read case study" : "View project"} <ArrowUpRight size={14} /></Link>
      {demoUrl && <a href={demoUrl} target="_blank" rel="noopener noreferrer" className="public-link">Live demo <ArrowUpRight size={14} /></a>}
      {repoUrl && <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="public-link">Source <FolderGit2 size={14} /></a>}
    </div>
  </article>;
}
