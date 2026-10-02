import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("./WorkspaceShell.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

test("collapsed state structurally removes the contextual sidebar and its focusable controls", () => {
  const asideStart = shell.indexOf("{!collapsed && <aside className=\"workspace-context\"");
  const asideEnd = shell.indexOf("</aside>}", asideStart);
  assert.notEqual(asideStart, -1);
  assert.notEqual(asideEnd, -1);
  const sidebar = shell.slice(asideStart, asideEnd);
  assert.match(sidebar, /\{context\}/);
  assert.match(sidebar, /<PanelResizeHandle/);
  assert.ok(asideEnd < shell.indexOf('<div className="workspace-center">'));
  assert.match(shell, /collapsed && <button type="button" aria-label="Expand sidebar"/);
});

test("sidebar width is retained and the resize handle exists only while expanded", () => {
  assert.match(shell, /const \[width, setWidth\] = useState\(224\)/);
  assert.match(shell, /<PanelResizeHandle label="Context sidebar width" value=\{width\} min=\{192\} max=\{300\} onChange=\{setWidth\} \/>/);
  assert.match(shell, /!collapsed && <aside/);
});

test("Focus Mode restores the exact prior sidebar and AI visibility state", () => {
  assert.match(shell, /priorPanels\.current = \{ collapsed, aiOpen \}/);
  assert.match(shell, /setCollapsed\(previous\?\.collapsed \?\? false\)/);
  assert.match(shell, /onAiOpenChange\(previous\?\.aiOpen \?\? false\)/);
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
  assert.match(styles, /\.context-collapsed \{ grid-template-columns: 58px minmax\(0, 1fr\); \}/);
  assert.match(styles, /\.workspace-layout, \.context-collapsed \{ grid-template-columns: 52px minmax\(0, 1fr\); \}/);
  assert.match(styles, /\.context-collapsed \.workspace-ai-panel\.is-open \{ grid-column: 3; \}/);
  assert.match(shell, /setDrawer\(true\)/);
  assert.match(styles, /\.workspace-menu-button \{ display: inline-grid; place-items: center; \}/);
});
