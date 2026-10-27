"use client";

import { Menu, PanelLeftClose, PanelLeftOpen, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { formatFocusDuration } from "@/data/focusSession";
import { Logo } from "@/components/brand/Logo";

interface NavigationItem { key: string; label: string; icon: LucideIcon; group?: string }
interface Props {
  onToggleTheme?: () => void;
  items: NavigationItem[]; active: string; onNavigate: (key: string) => void;
  context: ReactNode; actions: ReactNode; tabs?: ReactNode; children: ReactNode; ai: ReactNode;
  aiOpen: boolean; onAiOpenChange: (open: boolean) => void; sessionKey: string;
  focusSessionStatus: "running" | "paused" | null; focusSessionRemainingSeconds: number;
  onFocusPause: () => void; onFocusResume: () => void; onFocusEnd: () => void;
}

export function WorkspaceShell({ onToggleTheme, items, active, onNavigate, context, actions, tabs, children, ai, aiOpen, onAiOpenChange, sessionKey, focusSessionStatus, focusSessionRemainingSeconds, onFocusPause, onFocusResume, onFocusEnd }: Props) {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [wide, setWide] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [width, setWidth] = useState(224);
  const [focusMode, setFocusMode] = useState(false);
  const priorPanels = useRef<{ collapsed: boolean; aiOpen: boolean; compact: boolean } | null>(null);
  const layout = useRef<HTMLDivElement>(null);
  const focusButton = useRef<HTMLButtonElement>(null);
  const previousAiOpen = useRef(aiOpen);
  const focusSessionOwnedMode = useRef(false);
  const previousFocusSessionActive = useRef(false);
  const previousSession = useRef(sessionKey);
  const title = items.find((item) => item.key === active)?.label ?? "Workspace";
  const groups = [...new Set(items.map(item => item.group ?? "Work"))];
  const modalAi = aiOpen && !wide && !focusMode;
  const navigate = (key: string) => { onNavigate(key); setDrawer(false); setContextOpen(false); };
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => {
      const contextHadFocus = document.activeElement?.closest('.workspace-context, .workspace-context-drawer');
      setWide(media.matches); setContextOpen(false);
      if (contextHadFocus) requestAnimationFrame(() => layout.current?.querySelector<HTMLButtonElement>(media.matches ? '[aria-label="Collapse sidebar"], [aria-label="Expand sidebar"]' : '[aria-label="Open context sidebar"]')?.focus());
    };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (previousAiOpen.current === aiOpen) return;
    previousAiOpen.current = aiOpen;
    const frame = requestAnimationFrame(() => {
      if (aiOpen && document.activeElement !== focusButton.current) layout.current?.querySelector<HTMLButtonElement>('[aria-label="Minimize chat"]')?.focus();
      else if (!focusMode) layout.current?.querySelector<HTMLButtonElement>('[aria-label="Open Workspace AI chat"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [aiOpen, focusMode]);
  useEffect(() => {
    if (!modalAi) return;
    // A docked assistant can become modal on resize without changing open state.
    layout.current?.querySelector<HTMLButtonElement>('[aria-label="Minimize chat"]')?.focus();
  }, [modalAi]);
  const exitFocusMode = useCallback(() => {
    if (!focusMode) return;
    const previous = priorPanels.current;
    setCollapsed(previous?.collapsed ?? false);
    setCompact(previous?.compact ?? false);
    onAiOpenChange(previous?.aiOpen ?? false);
    priorPanels.current = null;
    setFocusMode(false);
    requestAnimationFrame(() => focusButton.current?.focus());
  }, [focusMode, onAiOpenChange]);
  const toggleFocusMode = () => {
    focusSessionOwnedMode.current = false;
    if (focusMode) { exitFocusMode(); return; }
    priorPanels.current = { collapsed, aiOpen, compact };
    setCollapsed(true);
    setCompact(true);
    setContextOpen(false);
    if (aiOpen) onAiOpenChange(false);
    setDrawer(false);
    setFocusMode(true);
  };
  useEffect(() => {
    if (previousSession.current === sessionKey) return;
    previousSession.current = sessionKey;
    priorPanels.current = null;
    focusSessionOwnedMode.current = false;
    previousFocusSessionActive.current = false;
    setFocusMode(false);
    setCollapsed(false);
    setCompact(false);
    setContextOpen(false);
    onAiOpenChange(false);
  }, [onAiOpenChange, sessionKey]);
  useEffect(() => {
    const sessionActive = focusSessionStatus === "running" || focusSessionStatus === "paused";
    if (sessionActive && !previousFocusSessionActive.current) {
      previousFocusSessionActive.current = true;
      if (!focusMode) {
        priorPanels.current = { collapsed, aiOpen, compact };
        // This effect synchronizes existing workspace layout state with a newly active session.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
        setCompact(true);
        setContextOpen(false);
        if (aiOpen) onAiOpenChange(false);
        setDrawer(false);
        setFocusMode(true);
        focusSessionOwnedMode.current = true;
      }
      return;
    }
    if (!sessionActive && previousFocusSessionActive.current) {
      previousFocusSessionActive.current = false;
      if (focusSessionOwnedMode.current) {
        focusSessionOwnedMode.current = false;
        if (focusMode) exitFocusMode();
      }
    }
  }, [aiOpen, collapsed, compact, exitFocusMode, focusMode, focusSessionStatus, onAiOpenChange]);
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) exitFocusMode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitFocusMode, focusMode]);
  const sectionButton = ({ key, label, icon: Icon }: NavigationItem) => <button key={key} data-section={key} type="button" title={label} aria-label={label} aria-current={key === active ? "page" : undefined} onClick={() => navigate(key)} className={`workspace-rail-item ${key === active ? "active" : ""}`}><Icon size={20} aria-hidden="true" /><span>{label}</span></button>;
  return <div ref={layout} className={`workspace-layout ${compact ? "navigation-compact" : ""} ${collapsed ? "context-collapsed" : ""} ${focusMode ? "workspace-focus-mode" : ""}`} style={{ "--context-width": `${width}px` } as CSSProperties}>
    <a href="#workspace-content" className="workspace-skip" inert={modalAi}>Skip to workspace</a>
    <nav className="workspace-rail" aria-label="Workspace sections" inert={modalAi}>
      <button type="button" className="workspace-brand" title="Frami" aria-label="Toggle chalkboard or paper theme" onClick={onToggleTheme}><Logo variant="icon" size={30} /></button>
      <div className="workspace-navigation-groups">{groups.map(group => <section key={group} aria-label={group}><h2 className="workspace-navigation-label">{group}</h2>{items.filter(item => (item.group ?? "Work") === group).map(sectionButton)}</section>)}</div>
      <button type="button" aria-label={compact ? "Use labeled navigation" : "Use compact navigation"} aria-pressed={compact} onClick={() => setCompact(!compact)} className="workspace-navigation-toggle"><PanelLeftClose size={18} /><span>{compact ? "Labels" : "Compact"}</span></button>
      <button type="button" aria-label="More workspace sections" title="More workspace sections" onClick={() => setDrawer(true)} className="workspace-rail-more"><Menu size={20} /><span>More</span></button>
    </nav>
    {wide && !collapsed && <aside className="workspace-context" aria-label={`${title} navigation`}>
      <div className="flex items-center justify-between gap-2 pb-4"><h2 className="font-semibold">{title}</h2><button type="button" aria-label="Collapse sidebar" onClick={() => { setCollapsed(true); requestAnimationFrame(() => layout.current?.querySelector<HTMLButtonElement>('[aria-label="Expand sidebar"]')?.focus()); }} className="rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-green)]"><PanelLeftClose size={17} /></button></div>
      {context}
      <PanelResizeHandle label="Context sidebar width" value={width} min={192} max={300} onChange={setWidth} />
    </aside>}
    <div className="workspace-center" inert={modalAi}>
      <header className="workspace-header workspace-toolbar">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" aria-label="Open workspace navigation" aria-expanded={drawer} onClick={() => setDrawer(true)} className="workspace-menu-button rounded-xl p-2"><Menu size={19} /></button>
          {!focusMode && (!wide || collapsed) && <button type="button" aria-label={wide ? "Expand sidebar" : "Open context sidebar"} onClick={() => { if (wide) { setCollapsed(false); requestAnimationFrame(() => layout.current?.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')?.focus()); } else setContextOpen(true); }} className="workspace-expand-button rounded-xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-green)]"><PanelLeftOpen size={19} /></button>}
          <h1 data-workspace-page-title className="text-base font-semibold">{title}</h1>
        </div>
        <div className="workspace-toolbar-actions">
          {active !== "today" && focusSessionStatus && <div className="dark-chip inline-flex min-h-10 items-center gap-2 px-2" aria-label={`Focus ${focusSessionStatus}, ${formatFocusDuration(focusSessionRemainingSeconds)} remaining`}>
            <span className="font-mono text-xs">Focus · {formatFocusDuration(focusSessionRemainingSeconds)}</span>
            <button type="button" aria-label={focusSessionStatus === "running" ? "Pause focus session" : "Resume focus session"} onClick={focusSessionStatus === "running" ? onFocusPause : onFocusResume} className="rounded-md px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)]">{focusSessionStatus === "running" ? "Pause" : "Resume"}</button>
            <button type="button" aria-label="End focus session" onClick={onFocusEnd} className="rounded-md px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)]">End</button>
          </div>}
          <button ref={focusButton} type="button" onClick={focusMode ? exitFocusMode : toggleFocusMode} aria-label={focusMode ? "Exit Focus Mode" : "Enter Focus Mode"} aria-pressed={focusMode} className="dark-chip min-h-10 px-3 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-green)]">{focusMode ? "Focus · Exit" : "Focus"}</button>
          {actions}
        </div>
      </header>
      {tabs}
      <main id="workspace-content" tabIndex={-1} className="workspace-content">{children}</main>
    </div>
    <div className="workspace-assistant" role={modalAi ? "dialog" : undefined} aria-label={modalAi ? "Workspace assistant" : undefined} aria-modal={modalAi || undefined} onKeyDownCapture={event => {
      if (event.key === "Escape" && aiOpen && !document.querySelector("dialog[open]")) { event.preventDefault(); event.stopPropagation(); onAiOpenChange(false); }
      if (event.key === "Tab" && modalAi) {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(e => e.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>{ai}</div>
    <nav className="workspace-bottom-nav" aria-label="Primary workspace sections" inert={modalAi}>{items.filter(item => ["dashboard", "projects", "tasks", "calendar"].includes(item.key)).map(sectionButton)}<button type="button" aria-label="More workspace sections" onClick={() => setDrawer(true)}><Menu size={20} /><span>More</span></button></nav>
    {drawer && <WorkspaceDialog label="Workspace navigation" className="workspace-drawer" onClose={() => setDrawer(false)}>
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Logo variant="icon" size={28} /><h2 className="font-semibold">Frami</h2></div><button type="button" aria-label="Close navigation" onClick={() => setDrawer(false)} className="p-2"><X size={20} /></button></div>
        <nav className="workspace-drawer-groups" aria-label="All workspace sections">{groups.map(group => <section key={group}><h2 className="workspace-navigation-label">{group}</h2>{items.filter(item => (item.group ?? "Work") === group).map(sectionButton)}</section>)}</nav>
    </WorkspaceDialog>}
    {contextOpen && !wide && <WorkspaceDialog label={`${title} context`} className="workspace-drawer workspace-context-drawer" onClose={() => setContextOpen(false)}><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{title} context</h2><button type="button" aria-label="Close context sidebar" onClick={() => setContextOpen(false)} className="p-2"><X size={20} /></button></div><div className="mt-4">{context}</div></WorkspaceDialog>}
  </div>;
}
