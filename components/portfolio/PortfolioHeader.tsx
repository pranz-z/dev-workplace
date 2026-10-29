"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import styles from "./PortfolioHero.module.css";

/** Phone behavior is gated by the same breakpoint as the grouped mobile CSS. */
export function PortfolioHeader({ navigation, authenticated, toggleTheme }: {
  navigation: { href: string; label: string }[];
  authenticated: boolean;
  toggleTheme: () => void;
}) {
  const header = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };

  useEffect(() => {
    const host = header.current;
    if (!host) return;
    const phone = matchMedia("(max-width: 767px)");
    let previous = scrollY;
    const scroll = () => {
      const current = Math.max(0, scrollY);
      if (phone.matches && Math.abs(current - previous) > 4) {
        host.dataset.scrollHidden = String(!open && !host.querySelector(":focus-visible") && current > previous && current > 56);
        previous = current;
      }
    };
    const key = (event: KeyboardEvent) => {
      if (!phone.matches || !open) return;
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const controls = [...host.querySelectorAll<HTMLElement>("button, a[href]")].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const outside = (event: PointerEvent) => { if (open && phone.matches && !host.contains(event.target as Node)) close(); };
    const focus = (event: FocusEvent) => {
      host.dataset.scrollHidden = "false";
      if (open && phone.matches && !host.contains(event.target as Node)) trigger.current?.focus();
    };
    const resize = () => { host.dataset.scrollHidden = "false"; if (!phone.matches) setOpen(false); };
    let focusFrame = 0;
    if (open) {
      host.dataset.scrollHidden = "false";
      focusFrame = requestAnimationFrame(() => host.querySelector<HTMLElement>("nav a")?.focus());
    }
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focus);
    phone.addEventListener("change", resize);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("scroll", scroll); document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", focus);
      phone.removeEventListener("change", resize);
    };
  }, [open]);

  return <header ref={header} className={`notebook-portfolio-header ${styles.header}`} data-menu-open={open}>
    <div>
      <button type="button" className={`notebook-logo ${styles.brand}`} aria-label="Toggle chalkboard or paper theme" onClick={toggleTheme}><Logo variant="full" size={30} /></button>
      <button ref={trigger} type="button" className={styles.menuToggle} aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} aria-controls="portfolio-navigation" onClick={() => setOpen(!open)}>
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={open ? "M6 6l12 12M18 6L6 18" : "M4 6h16M4 12h16M4 18h16"} /></svg>
      </button>
      <nav id="portfolio-navigation" aria-label="Portfolio" onClick={event => { if ((event.target as HTMLElement).closest("a") && matchMedia("(max-width: 767px)").matches) close(); }}>
        {navigation.map(item => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        <Link href="/app" className={authenticated ? undefined : styles.phoneWorkspace}>Open Workspace</Link>
      </nav>
    </div>
  </header>;
}
