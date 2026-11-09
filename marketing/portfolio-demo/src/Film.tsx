import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { AbsoluteFill, getStaticFiles, interpolate, staticFile, useVideoConfig } from "remotion";
import { BridgeScene, IntroScene, OutroScene, TourScene } from "./scenes/scenes";
import { C, hand, SITE } from "./theme";

export type Cut = "demo" | "linkedin" | "x";
export type FilmProps = { cut: Cut };

const T = 12; // transition length in frames
// Seconds each beat stays on screen, per cut.
export const BEATS: Record<Cut, { intro: number; hero: number; projects: number; skills: number; services: number; bridge: number; editor: number[]; outro: number }> = {
  demo: { intro: 6, hero: 6, projects: 5, skills: 4, services: 5, bridge: 3.5, editor: [4, 5, 4, 4.5], outro: 5 },
  linkedin: { intro: 5, hero: 5, projects: 4, skills: 3.5, services: 4, bridge: 3, editor: [3.5, 4.5, 3.5, 4], outro: 4.5 },
  x: { intro: 4, hero: 4, projects: 3.5, skills: 0, services: 3.5, bridge: 2.5, editor: [0, 4.5, 3.5, 3.5], outro: 4 },
};

export const filmDuration = (cut: Cut, fps: number) => {
  const b = BEATS[cut];
  const secs = [b.intro, b.hero, b.projects, b.skills, b.services, b.bridge, ...b.editor, b.outro].filter((s) => s > 0);
  return Math.round(secs.reduce((a, s) => a + s * fps, 0) - (secs.length - 1) * T);
};

const hasEditor = () => getStaticFiles().some((f) => f.name === "footage/editor.mp4");
// Source timestamps (seconds) in the captured editor footage; see capture/raw/editor.marks.json.
// Marks are logged ~2.3s before the video's matching frame (recording starts before the page), so these are read off the footage itself.
const ED = { overview: 8.6, hero: 13.0, services: 20.1, settings: 24.6 };

const EditorPending: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg, alignItems: "center", justifyContent: "center", color: C.muted, fontFamily: hand, fontSize: 64 }}>
    workspace editor footage pending — run capture/capture.mjs editor
  </AbsoluteFill>
);

export const Film: React.FC<FilmProps> = ({ cut }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const b = BEATS[cut];
  const s = (sec: number) => Math.round(sec * fps);
  const editorReady = hasEditor();
  const url = SITE;
  const fadeT = <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />;

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <TransitionSeries>
        <TransitionSeries.Sequence name="Meet the character" durationInFrames={s(b.intro)}>
          <IntroScene />
        </TransitionSeries.Sequence>
        {fadeT}
        <TransitionSeries.Sequence name="Portfolio hero" durationInFrames={s(b.hero)}>
          <TourScene src="footage/portfolio.mp4" trimBefore={s(4.6)} url={url} step="01 · the portfolio" title="Here’s my portfolio." bubble="That’s me up there — coding away in the hero." from={{ x: 0.5, y: 0.45, z: 1 }} to={{ x: 0.72, y: 0.32, z: 1.35 }} offset={6} />
        </TransitionSeries.Sequence>
        {fadeT}
        <TransitionSeries.Sequence name="Projects" durationInFrames={s(b.projects)}>
          <TourScene src="footage/portfolio.mp4" trimBefore={s(17.2)} url={`${url}/#projects`} step="02 · projects" title="Work that actually ships." bubble="Every project gets a real case study." from={{ x: 0.5, y: 0.3, z: 1.12 }} to={{ x: 0.5, y: 0.5, z: 1 }} offset={14} />
        </TransitionSeries.Sequence>
        {b.skills > 0 && fadeT}
        {b.skills > 0 && (
          <TransitionSeries.Sequence name="Skills & education" durationInFrames={s(b.skills)}>
            <TourScene src="footage/portfolio.mp4" trimBefore={s(26.6)} url={`${url}/#skills`} step="03 · the résumé part" title="Skills, experience, education." bubble="The whole résumé, minus the PDF." from={{ x: 0.3, y: 0.3, z: 1.2 }} to={{ x: 0.4, y: 0.4, z: 1.05 }} offset={28} />
          </TransitionSeries.Sequence>
        )}
        {fadeT}
        <TransitionSeries.Sequence name="Services" durationInFrames={s(b.services)}>
          <TourScene src="footage/portfolio.mp4" trimBefore={s(33.6)} url={`${url}/services`} step={b.skills > 0 ? "04 · services" : "03 · services"} title="Need something built?" bubble="Websites, shops, dashboards, AI agents…" from={{ x: 0.5, y: 0.2, z: 1.15 }} to={{ x: 0.5, y: 0.6, z: 1 }} offset={40} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={linearTiming({ durationInFrames: T + 6 })} />
        <TransitionSeries.Sequence name="Bridge to workspace" durationInFrames={s(b.bridge) + 6}>
          <BridgeScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={linearTiming({ durationInFrames: T + 6 })} />
        {!editorReady ? (
          <TransitionSeries.Sequence name="Editor (pending)" durationInFrames={b.editor.reduce((a, x) => a + s(x), 0) - (b.editor.filter((x) => x > 0).length - 1) * T + 6}>
            <EditorPending />
          </TransitionSeries.Sequence>
        ) : (
          <>
            {b.editor[0] > 0 && (
              <TransitionSeries.Sequence name="Editor overview" durationInFrames={s(b.editor[0]) + 6}>
                <TourScene src="footage/editor.mp4" trimBefore={s(ED.overview)} url={`${url}/app`} step="the workspace" title="My portfolio, as a form." bubble="Every section has its own editor tab." from={{ x: 0.5, y: 0.3, z: 1.1 }} to={{ x: 0.5, y: 0.35, z: 1 }} offset={10} />
              </TransitionSeries.Sequence>
            )}
            {b.editor[0] > 0 && fadeT}
            <TransitionSeries.Sequence name="Editor hero & bio" durationInFrames={s(b.editor[1]) + (b.editor[0] > 0 ? 0 : 6)}>
              <TourScene src="footage/editor.mp4" trimBefore={s(ED.hero)} url={`${url}/app`} step="edit · hero & bio" title="Change a line…" bubble="Type it here, it shows up there." from={{ x: 0.5, y: 0.4, z: 1 }} to={{ x: 0.45, y: 0.45, z: 1.3 }} offset={22} />
            </TransitionSeries.Sequence>
            {fadeT}
            <TransitionSeries.Sequence name="Editor services" durationInFrames={s(b.editor[2])}>
              <TourScene src="footage/editor.mp4" trimBefore={s(ED.services)} url={`${url}/app`} step="edit · services" title="…or a whole page." bubble="Services, experience, links — all editable." from={{ x: 0.5, y: 0.4, z: 1.05 }} to={{ x: 0.5, y: 0.5, z: 1.15 }} offset={33} />
            </TransitionSeries.Sequence>
            {fadeT}
            <TransitionSeries.Sequence name="Editor settings" durationInFrames={s(b.editor[3])}>
              <TourScene src="footage/editor.mp4" trimBefore={s(ED.settings)} url={`${url}/app`} step="edit · public settings" title="You decide what’s public." bubble="Nothing goes live until I hit Save." from={{ x: 0.5, y: 0.5, z: 1 }} to={{ x: 0.5, y: 0.6, z: 1.2 }} offset={45} />
            </TransitionSeries.Sequence>
          </>
        )}
        {fadeT}
        <TransitionSeries.Sequence name="Outro" durationInFrames={s(b.outro)}>
          <OutroScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Audio
        src={staticFile("audio/score.wav")}
        loop
        volume={(f) => interpolate(f, [0, 20, durationInFrames - 45, durationInFrames - 1], [0, 0.55, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
      />
    </AbsoluteFill>
  );
};

export { ED };
