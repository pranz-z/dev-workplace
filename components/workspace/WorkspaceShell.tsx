"use client";

import { Code2, Menu, PanelLeftClose, PanelLeftOpen, X, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { WorkspaceDialog } from "./WorkspaceDialog";

interface NavigationItem { key: string; label: string; icon: LucideIcon }
interface Props {
  items: NavigationItem[]; active: string; onNavigate: (key: string) => void;
  context: ReactNode; actions: ReactNode; tabs?: ReactNode; children: ReactNode; ai: ReactNode;
}

export function WorkspaceShell({ items, active, onNavigate, context, actions, tabs, children, ai }: Props) {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(224);
  const title = items.find((item) => item.key === active)?.label ?? "Workspace";
  const navigate = (key: string) => { onNavigate(key); setDrawer(false); };
  return <div className={`workspace-layout ${collapsed ? "context-collapsed" : ""}`} style={{ "--context-width": `${width}px` } as CSSProperties}>
    <a href="#workspace-content" className="workspace-skip">Skip to workspace</a>
    <nav className="workspace-rail" aria-label="Workspace sections">
      <div className="workspace-brand" title="Developer Workplace"><Code2 size={22} /></div>
      {items.map(({ key, label, icon: Icon }) => <button key={key} data-section={key} type="button" title={label} aria-label={label} aria-current={key === active ? "page" : undefined} onClick={() => navigate(key)} className={`workspace-rail-item ${key === active ? "active" : ""}`}><Icon size={20} /></button>)}
      <button type="button" aria-label="More workspace sections" title="More workspace sections" onClick={() => setDrawer(true)} className="workspace-rail-more"><Menu size={20} /><span>More</span></button>
    </nav>
    <aside className="workspace-context" aria-label={`${title} navigation`}>
      <div className="flex items-center justify-between gap-2 pb-4"><h2 className="font-semibold">{title}</h2><button type="button" aria-label="Collapse context sidebar" onClick={() => setCollapsed(true)} className="rounded-lg p-2"><PanelLeftClose size={17} /></button></div>
      {context}
      <PanelResizeHandle label="Context sidebar width" value={width} min={192} max={300} onChange={setWidth} />
    </aside>
    <div className="workspace-center">
      <header className="workspace-header workspace-toolbar">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" aria-label="Open workspace navigation" aria-expanded={drawer} onClick={() => setDrawer(true)} className="workspace-menu-button rounded-xl p-2"><Menu size={19} /></button>
          {collapsed && <button type="button" aria-label="Expand context sidebar" onClick={() => setCollapsed(false)} className="workspace-expand-button rounded-xl p-2"><PanelLeftOpen size={19} /></button>}
          <h1 className="truncate text-base font-semibold">{title}</h1>
        </div>
        <div className="workspace-toolbar-actions">{actions}</div>
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
