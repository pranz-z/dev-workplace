import { loadFont as loadCaveat } from "@remotion/google-fonts/Caveat";
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

// Same dark "chalkboard" tokens the live portfolio uses (app/globals.css --nb-*).
export const C = {
  bg: "#1C1917",
  surface: "#272321",
  inset: "#302b28",
  ink: "#F3EBDD",
  muted: "#b4a894",
  accent: "#F2B84B",
  accent2: "#7FD1B9",
  edge: "#aa9b88",
} as const;

export const hand = loadCaveat("normal", { weights: ["500", "700"], subsets: ["latin"] }).fontFamily;
export const sans = loadGeist("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;
export const mono = loadGeistMono("normal", { weights: ["400", "700"], subsets: ["latin"] }).fontFamily;

export const SITE = "frami-devplace.vercel.app";
