import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AsciiCharacter, CHARACTER_ASPECT } from "../components/AsciiCharacter";
import { Backdrop, BrowserFrame, Bubble, Guide, Header, Kicker, Layout, rise, Underline, UrlTag, useLayout } from "../components/ui";
import { C, hand, mono, sans, SITE } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const charH = (w: number) => w / CHARACTER_ASPECT;

/* ------------------------------------------------------------------ */
/* 1. Meet the character                                               */
/* ------------------------------------------------------------------ */
export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const reveal = interpolate(frame, [0, 1.6 * fps], [0, 1], { ...clamp, easing: Easing.bezier(0.33, 0, 0.2, 1) });
  const g = {
    landscape: { cw: 780, cl: 1060, ct: 40, tl: 120, tt: 250, ts: 132, sub: 40, maxW: 900 },
    square: { cw: 600, cl: 240, ct: 1080 - charH(600) + 30, tl: 80, tt: 80, ts: 104, sub: 34, maxW: 920 },
    portrait: { cw: 760, cl: 160, ct: 1350 - charH(760) + 30, tl: 80, tt: 100, ts: 118, sub: 38, maxW: 920 },
  }[L];
  const chips = ["drawn in ASCII", "codes · sips coffee · celebrates", "follows your cursor"];
  return (
    <AbsoluteFill>
      <Backdrop glow={L === "landscape" ? ["75%", "55%"] : ["50%", "78%"]} />
      <div style={{ position: "absolute", left: g.cl, top: g.ct }}>
        <div style={{ position: "absolute", inset: "15% 5% 20% 15%", background: `radial-gradient(ellipse, rgba(242,184,75,${0.22 * reveal}), transparent 65%)` }} />
        <AsciiCharacter width={g.cw} reveal={reveal} />
      </div>
      <div style={{ position: "absolute", left: g.tl, top: g.tt, width: g.maxW }}>
        <div style={rise(frame, 0.4 * fps)}><Kicker size={g.sub * 0.62}>frami · developer workplace</Kicker></div>
        <div style={{ ...rise(frame, 0.7 * fps), fontFamily: hand, fontWeight: 700, fontSize: g.ts, lineHeight: 0.92, color: C.ink, marginTop: 18 }}>
          Meet the dev<br />at the <span style={{ color: C.accent }}>desk.</span>
        </div>
        <div style={{ marginLeft: g.ts * 2.2, marginTop: 4 }}><Underline width={g.ts * 2.4} start={1.4 * fps} /></div>
        <div style={{ ...rise(frame, 1.6 * fps), fontFamily: sans, fontSize: g.sub, lineHeight: 1.35, color: C.muted, marginTop: 22, maxWidth: g.maxW * 0.86 }}>
          My ASCII alter-ego. He lives in the hero of my portfolio — and he’s your guide today.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28, maxWidth: L === "landscape" ? 860 : 940 }}>
          {chips.map((c, i) => (
            <div key={c} style={{ ...rise(frame, (2.3 + i * 0.25) * fps, 12), fontFamily: sans, fontWeight: 500, fontSize: g.sub * 0.66, color: C.ink, padding: "8px 16px", border: `1.5px solid rgba(243,235,221,.35)`, borderRadius: 8, background: "rgba(28,25,23,.75)" }}>{c}</div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 2. Footage beat with the character narrating                        */
/* ------------------------------------------------------------------ */
export type TourProps = {
  src: string;
  trimBefore: number;
  url: string;
  step: string;
  title: string;
  bubble: string;
  from?: { x: number; y: number; z: number };
  to?: { x: number; y: number; z: number };
  offset?: number;
};

const tourGeo: Record<Layout, { hl: number; ht: number; hs: number; fw: number; fl: number; ft: number; gw: number; gl: number; gt: number; bw: number; bl: number; bt: number; bs: number; tail: "left" | "bottom" }> = {
  landscape: { hl: 90, ht: 56, hs: 86, fw: 1290, fl: 90, ft: 222, gw: 440, gl: 1440, gt: 1080 - charH(440) + 20, bw: 420, bl: 1440, bt: 236, bs: 46, tail: "bottom" },
  square: { hl: 70, ht: 46, hs: 76, fw: 940, fl: 70, ft: 196, gw: 290, gl: 30, gt: 1080 - charH(290) + 16, bw: 680, bl: 340, bt: 800, bs: 42, tail: "left" },
  portrait: { hl: 70, ht: 80, hs: 86, fw: 940, fl: 70, ft: 270, gw: 480, gl: 0, gt: 1350 - charH(480) + 14, bw: 560, bl: 480, bt: 880, bs: 46, tail: "left" },
};

export const TourScene: React.FC<TourProps> = ({ src, trimBefore, url, step, title, bubble, from, to, offset = 0 }) => {
  const L = useLayout();
  const g = tourGeo[L];
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={L === "landscape" ? ["85%", "75%"] : ["20%", "90%"]} />
      <Header step={step} title={title} size={g.hs} style={{ left: g.hl, top: g.ht }} />
      <div style={{ position: "absolute", left: g.fl, top: g.ft, ...rise(frame, 2, 18) }}>
        <BrowserFrame src={src} trimBefore={trimBefore} width={g.fw} url={url} from={from} to={to} />
      </div>
      <Guide width={g.gw} offset={offset} style={{ left: g.gl, top: g.gt }} />
      <Bubble text={bubble} size={g.bs} width={g.bw} tail={g.tail} start={12} style={{ left: g.bl, top: g.bt }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 3. Bridge: portfolio → workspace                                     */
/* ------------------------------------------------------------------ */
export const BridgeScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const s = { landscape: 112, square: 92, portrait: 100 }[L];
  const cw = { landscape: 640, square: 520, portrait: 720 }[L];
  return (
    <AbsoluteFill>
      <Backdrop glow={["50%", "75%"]} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: L === "landscape" ? 120 : L === "square" ? 110 : 170, textAlign: "center" }}>
        <div style={{ ...rise(frame, 0), fontFamily: sans, fontSize: s * 0.36, color: C.muted }}>Every word you just saw…</div>
        <div style={{ ...rise(frame, 0.6 * fps), fontFamily: hand, fontWeight: 700, fontSize: s, lineHeight: 1, color: C.ink, marginTop: 18, maxWidth: L === "landscape" ? 1500 : 920 }}>
          …I edit from my own <span style={{ color: C.accent }}>workspace.</span>
        </div>
        <div style={{ ...rise(frame, 1.2 * fps), display: "flex", alignItems: "center", gap: 16, marginTop: 34, fontFamily: mono, fontSize: s * 0.26, color: C.accent2 }}>
          <Img src={staticFile("frami-icon.svg")} style={{ width: s * 0.5, height: s * 0.5, borderRadius: 10 }} />
          no redeploys · no code changes · just save
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: -20, display: "flex", justifyContent: "center", ...rise(frame, 0.3 * fps, 20) }}>
        <AsciiCharacter width={cw} offset={20} />
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* 4. Outro                                                             */
/* ------------------------------------------------------------------ */
export const OutroScene: React.FC<{ cta?: string }> = ({ cta = "Come say hi — he’s usually mid-coffee." }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const g = {
    landscape: { cw: 640, cl: 1140, ct: 1080 - charH(640) + 20, tl: 130, tt: 280, ts: 190, sub: 40 },
    square: { cw: 470, cl: 560, ct: 1080 - charH(470) + 20, tl: 80, tt: 110, ts: 160, sub: 34 },
    portrait: { cw: 600, cl: 440, ct: 1350 - charH(600) + 20, tl: 80, tt: 140, ts: 180, sub: 38 },
  }[L];
  const urlChars = Math.floor(interpolate(frame, [1.4 * fps, 1.4 * fps + SITE.length * 1.2], [0, SITE.length], clamp));
  return (
    <AbsoluteFill>
      <Backdrop glow={["70%", "70%"]} />
      <div style={{ position: "absolute", left: g.cl, top: g.ct, ...rise(frame, 0.2 * fps, 20) }}>
        <AsciiCharacter width={g.cw} offset={38} />
      </div>
      <div style={{ position: "absolute", left: g.tl, top: g.tt }}>
        <div style={{ display: "flex", alignItems: "center", gap: g.ts * 0.15, ...rise(frame, 0) }}>
          <Img src={staticFile("frami-icon.svg")} style={{ width: g.ts * 0.62, height: g.ts * 0.62, borderRadius: 16 }} />
          <div style={{ fontFamily: hand, fontWeight: 700, fontSize: g.ts, lineHeight: 0.9, color: C.ink }}>Frami</div>
        </div>
        <div style={{ marginLeft: g.ts * 0.8 }}><Underline width={g.ts * 2.1} start={0.5 * fps} stroke={8} /></div>
        <div style={{ ...rise(frame, 0.7 * fps), fontFamily: sans, fontSize: g.sub, color: C.muted, marginTop: 24, maxWidth: L === "landscape" ? 860 : 920, lineHeight: 1.35 }}>
          A portfolio and developer workplace in one.<br /><span style={{ color: C.ink }}>{cta}</span>
        </div>
        <div style={{ ...rise(frame, 1.2 * fps), display: "inline-block", marginTop: 34, padding: `${g.sub * 0.4}px ${g.sub * 0.7}px`, borderRadius: 10, background: C.accent, color: C.bg, fontFamily: mono, fontWeight: 700, fontSize: g.sub * 0.95 }}>
          {SITE.slice(0, urlChars)}<span style={{ opacity: frame % 30 < 15 ? 1 : 0 }}>▍</span><span style={{ opacity: 0 }}>{SITE.slice(urlChars)}</span>
        </div>
      </div>
      {L !== "landscape" && null}
    </AbsoluteFill>
  );
};

export { UrlTag };
