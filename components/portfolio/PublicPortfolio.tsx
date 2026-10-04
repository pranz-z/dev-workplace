"use client";

import Link from "next/link";
import { SketchDoodle } from "@/components/ui/SketchDoodle";
import { ArrowUpRight, FolderGit2, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PublicPortfolioProject } from "@/lib/portfolio/project-card";
import { listPublicProjectScreenshots } from "@/data/projectScreenshotService";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { PublicAiConcierge } from "@/components/public-ai/public-ai-concierge";
import type { PublicProfile } from "@/types";
import { useAuth } from "@/components/auth/auth-provider";
import type { PublicProfessionalContent } from "@/lib/portfolio/resume-content";
import { ProfessionalEducation, ProfessionalExperience, ProfessionalFocus, ProfessionalSkills } from "@/components/portfolio/ProfessionalSections";

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

export default function PublicViewerPage({ initialProjects, initialProfile, initialError, initialProfessionalContent, introduction: legacyIntroduction }: {
  initialProjects: PublicPortfolioProject[];
  initialProfile: PublicProfile | null;
  initialError: boolean;
  initialProfessionalContent: PublicProfessionalContent | null;
  introduction: { name: string; headline: string; bio: string };
}) {
  const { status } = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const projects = initialProjects;
  const profile = initialProfile;
  const professional = initialProfessionalContent;
  const introduction = professional ? { name: professional.hero.name, headline: professional.hero.headline, bio: professional.bio } : legacyIntroduction;
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [selectedType, setSelectedType] = useState("All");
  const loadError = initialError;
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
    // Optional image failures must not discard the profile and project list.
    listPublicProjectScreenshots(null).then((screenshots) => {
      if (active) setCovers(Object.fromEntries(screenshots.map((image) => [image.projectSlug, image.signedUrl])));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const publicProjects = useMemo(() => projects.filter((project) => project.visibility === "Public"), [projects]);
  const featuredProjects = publicProjects.filter((project) => project.featured);
  const types = [...new Set(publicProjects.map((project) => project.type).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const visibleProjects = selectedType === "All" ? publicProjects : publicProjects.filter((project) => project.type === selectedType);
  const technologyCount = new Set(publicProjects.flatMap((project) => project.technologies)).size;
  const technologies = [...new Set(publicProjects.flatMap((project) => project.technologies))].sort((a, b) => a.localeCompare(b));
  const socialLinks = professional ? professional.links.flatMap((link) => {
    const href = safeExternalUrl(link.url); return href ? [{ label: link.label, href }] : [];
  }) : [
    { label: "GitHub", href: safeExternalUrl(profile?.githubUrl) },
    { label: "LinkedIn", href: safeExternalUrl(profile?.linkedinUrl) },
    { label: "Website", href: safeExternalUrl(profile?.websiteUrl) },
  ].filter((item): item is { label: string; href: string } => Boolean(item.href));
  const displayName = introduction.name?.trim();
  const contactEmail = safeEmail(professional ? professional.contact.email : profile?.contactEmail);
  const avatar = professional ? professional.hero.avatar : profile?.avatarUrl;
  const navigation = [
    { href: "#projects", label: "Projects", enabled: professional?.sections.projects.enabled ?? true },
    { href: "#about", label: "About", enabled: professional ? professional.sections.about.enabled && Boolean(professional.about.body || professional.about.secondary) : Boolean(profile?.bio) },
    { href: "#experience", label: "Experience", enabled: Boolean(professional?.experience.length) },
    { href: "#skills", label: "Skills", enabled: professional ? Boolean(professional.toolkit.length) : technologies.length > 0 },
    { href: "#education", label: "Education", enabled: Boolean(professional?.education.length) },
    { href: "#contact", label: "Contact", enabled: Boolean(contactEmail || socialLinks.length > 0 || professional?.contact.phone || professional?.contact.location) },
  ].filter((item) => item.enabled);

  return (
    <div className="public-shell min-h-screen">
      <header className="relative z-30 mx-auto max-w-6xl px-4 py-5">
        <div className="relative flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[var(--public-border)] bg-[var(--surface)]/80 px-4 py-3 backdrop-blur-sm">
          <Link href="/" className="handwritten portfolio-signature min-w-0 text-[var(--ink)]">{displayName || "Developer portfolio"}</Link>
          <nav aria-label="Portfolio" className="hidden flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-[var(--muted)] sm:flex">
            {navigation.map((item) => <Link key={item.href} href={item.href} className="inline-flex min-h-11 items-center">{item.label}</Link>)}
          </nav>
          <details className="sm:hidden">
            <summary aria-label="Open portfolio navigation" className="public-link min-h-11 cursor-pointer">Menu</summary>
            <nav aria-label="Mobile portfolio" className="absolute left-0 right-0 top-full z-20 mt-2 rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-3 shadow-lg">
              {navigation.map((item) => <Link key={item.href} href={item.href} onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")} className="flex min-h-11 items-center px-2 text-sm text-[var(--ink)]">{item.label}</Link>)}
            </nav>
          </details>
          <button type="button" onClick={() => setThemeMode((current) => current === "light" ? "dark" : current === "dark" ? "system" : "light")} className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--public-border)] bg-white/40 p-2 text-[var(--ink)]" aria-label="Toggle public theme">
            {themeMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 pb-16">
        {(loadError || supabaseMissing) && <p role="alert" className="public-card p-4 text-sm text-[var(--muted)]">The public portfolio could not be loaded right now.</p>}
        {(professional?.sections.hero.enabled ?? true) && <section className="public-hero p-6 md:p-10">
          <div className="hero-note"><span className="handwritten">A notebook of things I build</span><SketchDoodle kind="arrow" /></div>
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            {avatar && <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatar} alt="" className="h-16 w-16 rounded-2xl border border-[var(--public-border)] object-cover md:h-24 md:w-24 md:rounded-3xl" />
            </>}
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-black tracking-tight text-[var(--ink)] sm:text-4xl md:text-6xl">{displayName || "Selected work"}</h1>
              {introduction.headline && <p className="mt-4 text-xl font-bold leading-snug text-[var(--ink)] md:text-2xl"><span className="marker-highlight">{introduction.headline}</span></p>}
              <SketchDoodle className="hero-underline" />
              {professional?.hero.description && <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--muted)]">{professional.hero.description}</p>}
              {introduction.bio && <p className="mt-4 max-w-3xl whitespace-pre-line text-base leading-7 text-[var(--muted)]">{introduction.bio}</p>}
              {professional?.hero.tagline && <p className="mt-4 text-sm text-[var(--muted)]">{professional.hero.tagline}</p>}
              <div className="mt-6 flex flex-wrap gap-3">
                {(professional?.sections.projects.enabled ?? true) && <Link href="#projects" className="public-link primary">View Projects <ArrowUpRight size={16} /></Link>}
                <a href="/resume/Franz_Michael_Cayanan_Resume.pdf" download className="public-link">Download Resume</a>
                {(contactEmail || socialLinks.length > 0) && <Link href="#contact" className="public-link">Contact me</Link>}
                {status === "authenticated" && <Link href="/app" className="inline-flex items-center px-2 text-sm text-[var(--muted)] underline underline-offset-4">Open Workspace</Link>}
              </div>
            </div>
          </div>
          {professional ? professional.stack.length > 0 && <div className="mt-7 border-t border-[var(--public-border)] pt-4"><p className="public-eyebrow">Core application stack</p><p className="mt-2 text-sm leading-7 text-[var(--muted)]">{professional.stack.map((item) => item.name).join(" · ")}</p></div> : publicProjects.length > 0 && <div className="mt-8 flex flex-wrap gap-3 border-t border-[var(--public-border)] pt-5 text-sm text-[var(--muted)]" aria-label="Public portfolio facts">
            <span>{publicProjects.length} public {publicProjects.length === 1 ? "project" : "projects"}</span>
            <span aria-hidden="true">·</span><span>{publicProjects.filter((project) => project.status === "Completed").length} completed</span>
            <span aria-hidden="true">·</span><span>{technologyCount} project technologies</span>
          </div>}
        </section>}

        {(professional?.sections.projects.enabled ?? true) && <section id="projects" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Selected work</p><h2 className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)]">{professional?.projects.title || "Projects"}</h2>{professional?.projects.intro && <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--muted)]">{professional.projects.intro}</p>}</div>
            {types.length > 1 && <div className="flex max-w-full flex-wrap gap-2" aria-label="Filter projects by type">
              {["All", ...types].map((type) => <button key={type} type="button" aria-pressed={selectedType === type} onClick={() => setSelectedType(type)} className={`rounded-full border px-3 py-2 text-xs ${selectedType === type ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]" : "border-[var(--public-border)] bg-[var(--surface)] text-[var(--muted)]"}`}>{type}</button>)}
            </div>}
          </div>
          {featuredProjects.length > 0 && selectedType === "All" && <div className="space-y-4"><h3 className="text-xl font-bold text-[var(--ink)]">Featured work</h3><div className="grid gap-5 md:grid-cols-2">
            {featuredProjects.map((project) => <ProjectCard key={project.slug} project={project} featured coverUrl={covers[project.slug]} />)}
          </div></div>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleProjects.filter((project) => selectedType !== "All" || !project.featured).map((project) => <ProjectCard key={project.slug} project={project} coverUrl={covers[project.slug]} />)}
          </div>
          {publicProjects.length === 0 && <p className="public-card p-5 text-sm text-[var(--muted)]">No public projects are available yet.</p>}
          {publicProjects.length > 0 && visibleProjects.length === 0 && <p className="public-card p-5 text-sm text-[var(--muted)]">No projects match this type.</p>}
        </section>}

        {(professional ? professional.sections.about.enabled && Boolean(professional.about.body || professional.about.secondary) : profile?.bio) && <section id="about" className="public-card p-6 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">About</p>
          <h2 className="mt-2 text-3xl font-black text-[var(--ink)]">{professional?.about.title || "About my work"}</h2>
          {(professional ? [professional.about.body, professional.about.secondary].filter(Boolean) : profile?.bio?.split(/\n\s*\n/) ?? []).map((paragraph, index) => <p key={index} className="mt-4 max-w-3xl whitespace-pre-line text-base leading-7 text-[var(--muted)]">{paragraph}</p>)}
        </section>}
        {professional && <ProfessionalExperience content={professional} />}
        {professional ? <ProfessionalSkills content={professional} projectTechnologies={technologies} /> : technologies.length > 0 && <section id="skills" className="public-card p-6 md:p-8">
          <h2 className="text-3xl font-black text-[var(--ink)]">Technologies</h2>
          <p className="mt-3 text-sm text-[var(--muted)]">Tools used in my public projects. Explore a case study to see them in context.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{technologies.map((technology) => <div key={technology} className="min-w-0 rounded-2xl border border-[var(--public-border)] p-3">
            <h3 className="break-words font-semibold text-[var(--ink)]">{technology}</h3>
            <div className="mt-2 flex flex-wrap gap-2">{publicProjects.filter((project) => project.technologies.includes(technology)).map((project) => <Link key={project.slug} href={`/projects/${encodeURIComponent(project.slug)}`} className="text-xs text-[var(--muted)] underline underline-offset-4">{project.name}</Link>)}</div>
          </div>)}</div>
        </section>}
        {professional && <ProfessionalEducation content={professional} />}
        {professional ? <ProfessionalFocus content={professional} /> : profile?.headline && <section className="public-card p-6 md:p-8">
          <h2 className="text-2xl font-bold text-[var(--ink)]">Professional focus</h2>
          <p className="mt-3 text-[var(--muted)]">{profile.headline}</p>
        </section>}
        <PublicAiConcierge />
        {(contactEmail || socialLinks.length > 0 || professional?.contact.phone || professional?.contact.location) && <section id="contact" className="public-card flex flex-wrap items-center justify-between gap-4 p-6">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Contact</p><h2 className="mt-2 text-2xl font-bold text-[var(--ink)]">{professional?.contact.cta || "Let's connect"}</h2>{professional?.contact.note && <p className="mt-3 whitespace-pre-line text-sm text-[var(--muted)]">{professional.contact.note}</p>}{professional?.contact.location && <p className="mt-3 text-sm text-[var(--muted)]">{professional.contact.location}</p>}</div>
          <div className="flex max-w-full flex-wrap gap-2">{contactEmail && <a className="public-link break-all" href={`mailto:${contactEmail}`}>Email</a>}{professional?.contact.phone && <a className="public-link" href={`tel:${professional.contact.phone.replace(/[^+0-9]/g, "")}`}>{professional.contact.phone}</a>}{socialLinks.map((item, index) => <a key={`${index}-${item.label}`} className="public-link break-all" href={item.href} target="_blank" rel="noopener noreferrer">{item.label} <ArrowUpRight size={14} /></a>)}</div>
        </section>}
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 pb-8 text-sm text-[var(--muted)]">
        <p>{displayName || "Developer portfolio"} · {new Date().getFullYear()}</p>
        {professional && !professional.sections.hero.enabled && <a href="/resume/Franz_Michael_Cayanan_Resume.pdf" download className="public-link">Download Resume</a>}
        {status === "authenticated" ? <Link href="/app" className="underline underline-offset-4">Open Workspace</Link> : <Link href="/login" className="underline underline-offset-4">Sign in</Link>}
      </footer>
    </div>
  );
}

function ProjectCard({ project, featured = false, coverUrl }: { project: PublicPortfolioProject; featured?: boolean; coverUrl?: string }) {
  const repoUrl = safeExternalUrl(project.links.github);
  const demoUrl = safeExternalUrl(project.links.live);
  const summary = (project.publicSummary || project.description).trim();
  return <article className={`public-card portfolio-project flex min-w-0 flex-col ${featured ? "p-6" : "p-5"}`}>
    {coverUrl ? <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={coverUrl} alt={`${project.name} project preview`} loading="lazy" decoding="async" className="mb-4 aspect-video w-full rounded-2xl border border-[var(--public-border)] object-cover" />
    </> : <div aria-hidden="true" className="mb-4 flex aspect-video items-end rounded-2xl border border-[var(--public-border)] bg-[linear-gradient(135deg,var(--surface-strong),var(--surface))] p-4"><span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">{project.type}</span></div>}
    <p className="public-eyebrow">{project.type}{project.role ? ` · ${project.role}` : ""}</p>
    <h3 className="mt-4 text-2xl font-bold text-[var(--ink)]">{project.name}</h3>
    {summary && <p className="mt-3 line-clamp-3 text-sm leading-6 text-[var(--muted)]">{summary}</p>}
    {project.technologies.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{project.technologies.slice(0, 5).map((tech) => <span key={tech} className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] text-[var(--ink)]">{tech}</span>)}</div>}
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
      <Link href={`/projects/${encodeURIComponent(project.slug)}`} className="public-link" aria-label={`View case study: ${project.name}`}>View Case Study <ArrowUpRight size={14} /></Link>
      {demoUrl && <a href={demoUrl} target="_blank" rel="noopener noreferrer" className="public-link">Live demo <ArrowUpRight size={14} /></a>}
      {repoUrl && <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="public-link">Repository <FolderGit2 size={14} /></a>}
    </div>
  </article>;
}
