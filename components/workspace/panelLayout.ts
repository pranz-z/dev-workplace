const STORAGE_KEY = "frami.workspace.panels";

export interface PanelLayout {
  contextWidth?: number;
  collapsed?: boolean;
  compact?: boolean;
  aiWidth?: number;
}

/** Per-browser panel preferences. Storage can be unavailable, so callers keep their defaults. */
export function readPanelLayout(): PanelLayout {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return stored && typeof stored === "object" ? stored as PanelLayout : {};
  } catch {
    return {};
  }
}

export function writePanelLayout(patch: PanelLayout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPanelLayout(), ...patch }));
  } catch { /* The layout still works for this visit. */ }
}

export function storedWidth(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
