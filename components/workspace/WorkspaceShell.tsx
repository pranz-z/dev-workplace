"use client";

import { Code2, Menu, PanelLeftClose, PanelLeftOpen, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { formatFocusDuration } from "@/data/focusSession";

interface NavigationItem { key: string; label: string; icon: LucideIcon }
interface Props {
  items: NavigationItem[]; active: string; onNavigate: (key: string) => void;
  context: ReactNode; actions: ReactNode; tabs?: ReactNode; children: ReactNode; ai: ReactNode;
  aiOpen: boolean; onAiOpenChange: (open: boolean) => void; sessionKey: string;
  focusSessionStatus: "running" | "paused" | null; focusSessionRemainingSeconds: number;
  onFocusPause: () => void; onFocusResume: () => void; onFocusEnd: () => void;
}

export function WorkspaceShell({ items, active, onNavigate, context, actions, tabs, children, ai, aiOpen, onAiOpenChange, sessionKey, focusSessionStatus, focusSessionRemainingSeconds, onFocusPause, onFocusResume, onFocusEnd }: Props) {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(224);
  const [focusMode, setFocusMode] = useState(false);
  const priorPanels = useRef<{ collapsed: boolean; aiOpen: boolean } | null>(null);
  const focusSessionOwnedMode = useRef(false);
  const previousFocusSessionActive = useRef(false);
  const previousSession = useRef(sessionKey);
  const title = items.find((item) => item.key === active)?.label ?? "Workspace";
  const navigate = (key: string) => { onNavigate(key); setDrawer(false); };
  const exitFocusMode = useCallback(() => {
    if (!focusMode) return;
    const previous = priorPanels.current;
    setCollapsed(previous?.collapsed ?? false);
    onAiOpenChange(previous?.aiOpen ?? false);
    priorPanels.current = null;
    setFocusMode(false);
  }, [focusMode, onAiOpenChange]);
  const toggleFocusMode = () => {
    focusSessionOwnedMode.current = false;
    if (focusMode) { exitFocusMode(); return; }
    priorPanels.current = { collapsed, aiOpen };
    setCollapsed(true);
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
    onAiOpenChange(false);
  }, [onAiOpenChange, sessionKey]);
  useEffect(() => {
    const sessionActive = focusSessionStatus === "running" || focusSessionStatus === "paused";
    if (sessionActive && !previousFocusSessionActive.current) {
      previousFocusSessionActive.current = true;
      if (!focusMode) {
        priorPanels.current = { collapsed, aiOpen };
        // This effect synchronizes existing workspace layout state with a newly active session.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
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
  }, [aiOpen, collapsed, exitFocusMode, focusMode, focusSessionStatus, onAiOpenChange]);
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) exitFocusMode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitFocusMode, focusMode]);
  return <div className={`workspace-layout ${collapsed ? "context-collapsed" : ""} ${focusMode ? "workspace-focus-mode" : ""}`} style={{ "--context-width": `${width}px` } as CSSProperties}>
    <a href="#workspace-content" className="workspace-skip">Skip to workspace</a>
    <nav className="workspace-rail" aria-label="Workspace sections">
      <div className="workspace-brand" title="Developer Workplace"><Code2 size={22} /></div>
      {items.map(({ key, label, icon: Icon }) => <button key={key} data-section={key} type="button" title={label} aria-label={label} aria-current={key === active ? "page" : undefined} onClick={() => navigate(key)} className={`workspace-rail-item ${key === active ? "active" : ""}`}><Icon size={20} /></button>)}
      <button type="button" aria-label="More workspace sections" title="More workspace sections" onClick={() => setDrawer(true)} className="workspace-rail-more"><Menu size={20} /><span>More</span></button>
    </nav>
    {!collapsed && <aside className="workspace-context" aria-label={`${title} navigation`}>
      <div className="flex items-center justify-between gap-2 pb-4"><h2 className="font-semibold">{title}</h2><button type="button" aria-label="Collapse sidebar" onClick={() => setCollapsed(true)} className="rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-green)]"><PanelLeftClose size={17} /></button></div>
      {context}
      <PanelResizeHandle label="Context sidebar width" value={width} min={192} max={300} onChange={setWidth} />
    </aside>}
    <div className="workspace-center">
      <header className="workspace-header workspace-toolbar">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" aria-label="Open workspace navigation" aria-expanded={drawer} onClick={() => setDrawer(true)} className="workspace-menu-button rounded-xl p-2"><Menu size={19} /></button>
          {collapsed && <button type="button" aria-label="Expand sidebar" onClick={() => setCollapsed(false)} className="workspace-expand-button rounded-xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-green)]"><PanelLeftOpen size={19} /></button>}
          <h1 className="truncate text-base font-semibold">{title}</h1>
        </div>
        <div className="workspace-toolbar-actions">
          {active !== "today" && focusSessionStatus && <div className="dark-chip inline-flex min-h-10 items-center gap-2 px-2" aria-label={`Focus ${focusSessionStatus}, ${formatFocusDuration(focusSessionRemainingSeconds)} remaining`}>
            <span className="font-mono text-xs">Focus · {formatFocusDuration(focusSessionRemainingSeconds)}</span>
            <button type="button" aria-label={focusSessionStatus === "running" ? "Pause focus session" : "Resume focus session"} onClick={focusSessionStatus === "running" ? onFocusPause : onFocusResume} className="rounded-md px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)]">{focusSessionStatus === "running" ? "Pause" : "Resume"}</button>
            <button type="button" aria-label="End focus session" onClick={onFocusEnd} className="rounded-md px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)]">End</button>
          </div>}
          <button type="button" onClick={focusMode ? exitFocusMode : toggleFocusMode} aria-label={focusMode ? "Exit Focus Mode" : "Enter Focus Mode"} aria-pressed={focusMode} className="dark-chip min-h-10 px-3 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-green)]">{focusMode ? "Focus · Exit" : "Focus"}</button>
          {actions}
        </div>
      </header>
      {tabs}
      <main id="workspace-content" tabIndex={-1} className="workspace-content">{children}</main>
    </div>
    {ai}
    {drawer && <WorkspaceDialog label="Workspace navigation" className="workspace-drawer" onClose={() => setDrawer(false)}>
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Developer Workplace</h2><button type="button" aria-label="Close navigation" onClick={() => setDrawer(false)} className="p-2"><X size={20} /></button></div>
        <nav className="my-4 grid grid-cols-2 gap-2" aria-label="Workspace sections">{items.map(({ key, label, icon: Icon }) => <button key={key} type="button" aria-current={key === active ? "page" : undefined} onClick={() => navigate(key)} className={`nav-item min-w-0 px-2 py-3 text-left text-xs ${key === active ? "active" : ""}`}><Icon size={16} /><span>{label}</span></button>)}</nav>
        <div onClick={(event) => { if ((event.target as HTMLElement).closest("button")) setDrawer(false); }}>{context}</div>
    </WorkspaceDialog>}
  </div>;
}
