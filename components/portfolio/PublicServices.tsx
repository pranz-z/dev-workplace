"use client";

import Link from "next/link";
import { ArrowUpRight, Bot, Check, Code, Database, Globe, LayoutDashboard, Palette, Plug, Server, ShoppingCart, Smartphone, Workflow, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Logo } from "@/components/brand/Logo";
import { PublicAiConcierge } from "@/components/public-ai/public-ai-concierge";
import { Card, UnderlineHeading } from "@/components/ui/notebook";
import type { PortfolioContent } from "@/lib/portfolio/content";
import { isServiceIconKey, type ServiceIconKey } from "@/lib/portfolio/service-icons";
import { PortfolioHeader } from "./PortfolioHeader";

type ThemeMode = "light" | "dark" | "system";
const THEME_STORAGE_KEY = "developer-workspace-theme";
const getResolvedTheme = (mode: ThemeMode) => mode === "system"
  ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  : mode;
const icons: Record<ServiceIconKey, LucideIcon> = {
  web: Globe, system: Server, dashboard: LayoutDashboard, ai: Bot, automation: Workflow, database: Database,
  mobile: Smartphone, store: ShoppingCart, integration: Plug, design: Palette, code: Code, maintenance: Wrench,
};

/** Renders only the public_portfolio projection; it never reads private workspace data. */
export default function PublicServices({ content }: { content: PortfolioContent }) {
  const { status } = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [themeInitialized, setThemeInitialized] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    // Browser-only preference must be loaded after hydration to keep the first render deterministic.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "light" || saved === "dark" || saved === "system") setThemeMode(saved);
    setThemeInitialized(true);
  }, []);

  useEffect(() => {
    if (!themeInitialized) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.setAttribute("data-theme", getResolvedTheme(themeMode));
      if (themeMode === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode, themeInitialized]);

  const contactEnabled = content.sections.contact.enabled && Boolean(content.contact.email || content.links.length || content.contact.phone || content.contact.location);
  const navigation = [
    { href: "/", label: "Home", enabled: true },
    { href: "/#projects", label: "Projects", enabled: content.sections.projects.enabled },
    { href: "/services", label: "Services", enabled: true },
    { href: "/#contact", label: "Contact", enabled: contactEnabled },
  ].filter((item) => item.enabled);

  return (
    <div className="public-shell notebook-portfolio min-h-screen">
      <PortfolioHeader navigation={navigation} authenticated={status === "authenticated"} toggleTheme={() => setThemeMode(getResolvedTheme(themeMode) === "dark" ? "light" : "dark")} />
      <main className="mx-auto max-w-6xl space-y-10 px-4 pb-16">
        <section aria-labelledby="services-title" className="space-y-5 pt-6">
          <h1 id="services-title" className="mt-2 text-4xl font-black tracking-tight text-[var(--ink)]"><UnderlineHeading>{content.servicesPage.title || "Services"}</UnderlineHeading></h1>
          {content.servicesPage.intro && <p className="max-w-3xl whitespace-pre-line text-base leading-7 text-[var(--muted)]">{content.servicesPage.intro}</p>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {content.services.map((service) => {
              const key = service.icon.trim().toLowerCase();
              const Icon = isServiceIconKey(key) ? icons[key] : null;
              return <Card key={service.id} className="flex min-w-0 flex-col p-5">
                {Icon && <Icon aria-hidden="true" size={28} className="text-[var(--ink)]" />}
                <h2 className="mt-3 break-words text-xl font-bold text-[var(--ink)]">{service.title}</h2>
                {service.summary && <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--muted)]">{service.summary}</p>}
                {service.highlights.length > 0 && <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">{service.highlights.map((highlight, index) => <li key={index} className="flex gap-2"><Check aria-hidden="true" size={16} className="mt-1 shrink-0 text-[var(--ink)]" /><span className="min-w-0 break-words">{highlight}</span></li>)}</ul>}
              </Card>;
            })}
          </div>
        </section>
        {contactEnabled && <section aria-labelledby="services-contact-title" className="public-card p-6 md:p-8">
          <h2 id="services-contact-title" className="text-2xl font-bold text-[var(--ink)]"><UnderlineHeading>{content.contact.cta || "Let's connect"}</UnderlineHeading></h2>
          {content.contact.note && <p className="mt-3 whitespace-pre-line text-sm text-[var(--muted)]">{content.contact.note}</p>}
          <Link href="/#contact" className="public-link mt-4">Contact me <ArrowUpRight size={14} /></Link>
        </section>}
        <PublicAiConcierge />
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 pb-8 text-sm text-[var(--muted)]">
        <Logo variant="full" size={24} />
        <p>{new Date().getFullYear()}</p>
        {status === "authenticated" ? <Link href="/app" className="underline underline-offset-4">Open Workspace</Link> : <Link href="/login" className="underline underline-offset-4">Sign in</Link>}
      </footer>
    </div>
  );
}
