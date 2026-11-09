import { Video } from "@remotion/media";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, hand, mono, sans, SITE } from "../theme";
import { AsciiCharacter } from "./AsciiCharacter";

export type Layout = "landscape" | "square" | "portrait";
export const useLayout = (): Layout => {
  const { width, height } = useVideoConfig();
  return width / height > 1.3 ? "landscape" : height / width > 1.1 ? "portrait" : "square";
};

const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const rise = (frame: number, start: number, len = 18) => ({
  opacity: interpolate(frame, [start, start + len], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  translate: interpolate(frame, [start, start + len], ["0px 28px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
});

/** Paper-grain chalkboard backdrop, matching the portfolio hero's dotted texture and amber desk glow. */
export const Backdrop: React.FC<{ glow?: [string, string] }> = ({ glow = ["70%", "55%"] }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill style={{ opacity: 0.08, backgroundImage: `radial-gradient(${C.ink} 0.9px, transparent 1.1px), repeating-linear-gradient(113deg, transparent 0 2px, rgba(243,235,221,.12) 2px 3px)`, backgroundSize: "26px 26px, 7px 9px" }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 55% 50% at ${glow[0]} ${glow[1]}, rgba(242,184,75,${0.1 + 0.025 * Math.sin(frame / 22)}), transparent 70%)` }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,.45))" }} />
    </AbsoluteFill>
  );
};

/** Hand-drawn amber underline, like the portfolio's signature headings. */
export const Underline: React.FC<{ width: number; start: number; color?: string; stroke?: number }> = ({ width, start, color = C.accent, stroke = 6 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const len = width * 1.08;
  return (
    <svg width={width} height={22} viewBox={`0 0 ${width} 22`} style={{ display: "block", overflow: "visible" }}>
      <path d={`M4 14 C ${width * 0.3} 6, ${width * 0.6} 18, ${width - 4} 8`} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - p)} />
    </svg>
  );
};

export const Kicker: React.FC<{ children: React.ReactNode; size: number; color?: string; style?: React.CSSProperties }> = ({ children, size, color = C.accent2, style }) => (
  <div style={{ fontFamily: mono, fontSize: size, letterSpacing: "0.08em", textTransform: "uppercase", color, ...style }}>{children}</div>
);

/** Browser window that plays a slice of the real recorded footage with a slow camera push. */
export const BrowserFrame: React.FC<{
  src: string;
  trimBefore: number;
  width: number;
  url: string;
  /** Camera focus (0..1 of the frame) and zoom at the start and end of the shot. */
  from?: { x: number; y: number; z: number };
  to?: { x: number; y: number; z: number };
  style?: React.CSSProperties;
}> = ({ src, trimBefore, width, url, from = { x: 0.5, y: 0.5, z: 1 }, to = from, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const bar = Math.round(width * 0.03);
  const h = Math.round((width * 9) / 16);
  const t = (k: "x" | "y" | "z") => interpolate(frame, [0, durationInFrames], [from[k], to[k]], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.45, 0, 0.25, 1) });
  const z = t("z");
  return (
    <div style={{ width, borderRadius: 14, overflow: "hidden", border: `1.5px solid rgba(243,235,221,.28)`, background: C.surface, boxShadow: "0 30px 80px rgba(0,0,0,.55), 6px 8px 0 rgba(180,168,148,.12)", ...style }}>
      <div style={{ height: bar, display: "flex", alignItems: "center", gap: bar * 0.28, padding: `0 ${bar * 0.5}px`, borderBottom: "1px solid rgba(243,235,221,.12)" }}>
        {["#e0705a", C.accent, C.accent2].map((c) => <div key={c} style={{ width: bar * 0.32, height: bar * 0.32, borderRadius: "50%", background: c, opacity: 0.85 }} />)}
        <div style={{ marginLeft: bar * 0.4, flex: 1, height: bar * 0.62, borderRadius: bar, background: C.inset, display: "flex", alignItems: "center", padding: `0 ${bar * 0.45}px`, fontFamily: mono, fontSize: bar * 0.38, color: C.muted }}>
          <span style={{ color: C.accent2 }}>https://</span>{url}
        </div>
      </div>
      <div style={{ position: "relative", width, height: h, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, transformOrigin: `${t("x") * 100}% ${t("y") * 100}%`, scale: String(z) }}>
          <Video src={staticFile(src)} trimBefore={trimBefore} muted style={{ width, height: h, objectFit: "cover" }} />
        </div>
      </div>
    </div>
  );
};

/** Sketch-edged speech bubble; the character "narrates" the tour through it. */
export const Bubble: React.FC<{ text: string; start?: number; size: number; width: number; tail?: "left" | "bottom"; style?: React.CSSProperties }> = ({ text, start = 6, size, width, tail = "bottom", style }) => {
  const frame = useCurrentFrame();
  const chars = Math.floor(interpolate(frame, [start, start + text.length * 0.9], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const pop = interpolate(frame, [start - 6, start + 4], [0.85, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.34, 1.56, 0.64, 1) });
  const op = interpolate(frame, [start - 6, start], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", width, opacity: op, scale: String(pop), transformOrigin: tail === "left" ? "0% 70%" : "20% 100%", ...style }}>
      <div style={{ position: "relative", padding: `${size * 0.45}px ${size * 0.6}px`, background: C.surface, border: `2.5px solid ${C.ink}`, borderRadius: "18px 6px 20px 8px / 8px 20px 6px 18px", boxShadow: "5px 6px 0 rgba(180,168,148,.22)", fontFamily: hand, fontWeight: 700, fontSize: size, lineHeight: 1.1, color: C.ink }}>
        <span>{text.slice(0, chars)}</span>
        <span style={{ opacity: 0 }}>{text.slice(chars)}</span>
        <div style={{ position: "absolute", width: size * 0.7, height: size * 0.7, background: C.surface, borderRight: `2.5px solid ${C.ink}`, borderBottom: `2.5px solid ${C.ink}`, ...(tail === "bottom" ? { left: size * 1.1, bottom: -size * 0.37, rotate: "45deg" } : { left: -size * 0.37, bottom: size * 0.6, rotate: "135deg" }) }} />
      </div>
    </div>
  );
};

/** Title + note header used above product footage. */
export const Header: React.FC<{ step: string; title: string; size: number; style?: React.CSSProperties }> = ({ step, title, size, style }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", ...style }}>
      <div style={rise(frame, 0, 14)}><Kicker size={size * 0.3}>{step}</Kicker></div>
      <div style={{ ...rise(frame, 4, 16), fontFamily: hand, fontWeight: 700, fontSize: size, lineHeight: 1, color: C.ink, marginTop: size * 0.12 }}>{title}</div>
    </div>
  );
};

/** The character standing in as tour guide, with a gentle bob. */
export const Guide: React.FC<{ width: number; offset?: number; style?: React.CSSProperties }> = ({ width, offset = 0, style }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", ...rise(frame, 0, 20), ...style }}>
      <div style={{ position: "absolute", inset: "20% 0 10% 0", background: "radial-gradient(ellipse, rgba(242,184,75,.16), transparent 68%)" }} />
      <AsciiCharacter width={width} offset={offset} />
    </div>
  );
};

export const UrlTag: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <div style={{ position: "absolute", fontFamily: mono, fontSize: size, color: C.muted, ...style }}>
    <span style={{ color: C.accent }}>↗ </span>{SITE}
  </div>
);

export { sans };
