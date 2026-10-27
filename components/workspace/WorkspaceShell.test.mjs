import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("./WorkspaceShell.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

test("collapsed state structurally removes the contextual sidebar and its focusable controls", () => {
  const asideStart = shell.indexOf("{wide && !collapsed && <aside className=\"workspace-context\"");
  const asideEnd = shell.indexOf("</aside>}", asideStart);
  assert.notEqual(asideStart, -1);
  assert.notEqual(asideEnd, -1);
  const sidebar = shell.slice(asideStart, asideEnd);
  assert.match(sidebar, /\{context\}/);
  assert.match(sidebar, /<PanelResizeHandle/);
  assert.ok(asideEnd < shell.indexOf('<div className="workspace-center"'));
  assert.match(shell, /!wide \|\| collapsed/);
  assert.match(shell, /wide \? "Expand sidebar" : "Open context sidebar"/);
});

test("sidebar width is retained and the resize handle exists only while expanded", () => {
  assert.match(shell, /const \[width, setWidth\] = useState\(224\)/);
  assert.match(shell, /<PanelResizeHandle label="Context sidebar width" value=\{width\} min=\{192\} max=\{300\} onChange=\{setWidth\} \/>/);
  assert.match(shell, /wide && !collapsed && <aside/);
});

test("Focus Mode restores the exact prior sidebar and AI visibility state", () => {
  assert.match(shell, /priorPanels\.current = \{ collapsed, aiOpen, compact \}/);
  assert.match(shell, /setCollapsed\(previous\?\.collapsed \?\? false\)/);
  assert.match(shell, /onAiOpenChange\(previous\?\.aiOpen \?\? false\)/);
  assert.match(shell, /setCompact\(previous\?\.compact \?\? false\)/);
  assert.match(shell, /workspace-focus-mode/);
});

test("sidebar collapse leaves the main workspace, active navigation, tabs, and AI component mounted", () => {
  assert.match(shell, /items: NavigationItem\[\]; active: string; onNavigate: \(key: string\) => void/);
  assert.match(shell, /tabs\?: ReactNode/);
  assert.match(shell, /<main id="workspace-content"/);
  assert.match(shell, /\{ai\}/);
  assert.match(shell, /aria-current=\{key === active \? "page" : undefined\}/);
});

test("mobile keeps drawer navigation and desktop collapse removes the sidebar grid track", () => {
  assert.match(styles, /\.workspace-layout\.context-collapsed \{ --context-track: 0px; \}/);
  assert.match(styles, /grid-template-columns: var\(--rail-width\) var\(--context-track\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.notebook-workspace \.workspace-ai-panel\.is-open \{ position: sticky; grid-column: 4/);
  assert.match(shell, /setDrawer\(true\)/);
  assert.match(styles, /workspace-bottom-nav/);
  assert.match(shell, /WorkspaceDialog label=\{`\$\{title\} context`\}/);
  assert.match(shell, /inert=\{modalAi\}/);
});
