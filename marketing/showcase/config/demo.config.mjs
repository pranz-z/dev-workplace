import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const integer = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export const config = Object.freeze({
  root,
  baseURL: (process.env.DEMO_BASE_URL || "https://frami-devplace.vercel.app").replace(/\/$/, ""),
  authFile: path.join(root, ".auth", "owner.json"),
  width: integer(process.env.VIEWPORT_WIDTH, 1920),
  height: integer(process.env.VIEWPORT_HEIGHT, 1080),
  fps: Math.max(30, integer(process.env.VIDEO_FPS, 30)),
  demoProject: process.env.DEMO_PROJECT?.trim() || "",
  demoTask: process.env.DEMO_TASK?.trim() || "",
  aiTimeoutMs: integer(process.env.AI_TIMEOUT, 45000),
  rawScenesDir: path.join(root, "output", "raw", "scenes"),
  rawFullDir: path.join(root, "output", "raw", "full"),
  finalDir: path.join(root, "output", "final"),
  reviewDir: path.join(root, "output", "review"),
  metadataDir: path.join(root, "metadata"),
});

export const sceneList = [
  { id: "portfolio", order: 1, title: "Portfolio", file: "01-portfolio", targetDuration: 8, requiresAuth: false, usesAI: false, mutatesData: false },
  { id: "workspace", order: 2, title: "Private Workspace", file: "02-workspace", targetDuration: 6, requiresAuth: true, usesAI: false, mutatesData: false },
  { id: "kanban", order: 3, title: "Task Kanban", file: "03-kanban", targetDuration: 7, requiresAuth: true, usesAI: false, mutatesData: false },
  { id: "calendar", order: 4, title: "Calendar", file: "04-calendar", targetDuration: 6, requiresAuth: true, usesAI: false, mutatesData: false },
  { id: "github", order: 5, title: "GitHub Integration", file: "05-github", targetDuration: 6, requiresAuth: true, usesAI: false, mutatesData: false },
  { id: "workspace-ai", order: 6, title: "Workspace AI", file: "06-workspace-ai", targetDuration: 10, requiresAuth: true, usesAI: true, mutatesData: false },
  { id: "focus", order: 7, title: "Focus Session", file: "07-focus", targetDuration: 6, requiresAuth: true, usesAI: false, mutatesData: true },
  { id: "public-ai", order: 8, title: "Public AI", file: "08-public-ai", targetDuration: 9, requiresAuth: false, usesAI: true, mutatesData: false },
  { id: "outro", order: 9, title: "Outro", file: "09-outro", targetDuration: 5, requiresAuth: false, usesAI: false, mutatesData: false },
];
