import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
} from 'remotion';
import {PaperFrame, ViewportWindow} from '../components/PaperFrame';
import {PaperStrip, RecordedMedia} from '../components/RecordedMedia';
import {FocusCrop} from '../components/FocusCrop';
import {SketchStroke} from '../components/SketchStroke';
import {NotebookWipe} from '../components/NotebookWipe';
import {FRAME, ease, theme, VIDEO} from '../theme';

const clip = (name: string) => `recordings/${name}.mp4`;

const Desk: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at 17% 24%, rgba(249, 221, 209, .75), transparent 30%), radial-gradient(ellipse at 82% 68%, rgba(227, 220, 255, .35), transparent 35%), linear-gradient(135deg, ${theme.deskLight}, ${theme.desk} 62%, #eee3d5)`,
    }}
  >
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: 0.3,
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(156,137,117,.06) 0 1px, transparent 1px 72px), repeating-linear-gradient(90deg, rgba(156,137,117,.04) 0 1px, transparent 1px 72px)',
      }}
    />
  </AbsoluteFill>
);

const DeskPaper: React.FC<{frame: number; x?: number; y?: number}> = ({frame, x = 0, y = 0}) => {
  const drift = interpolate(frame, [0, VIDEO.durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: x + interpolate(drift, [0, 1], [24, -12]),
        top: y + interpolate(drift, [0, 1], [8, -8]),
        width: 1850,
        height: 1010,
        borderRadius: 28,
        border: `1px solid rgba(156, 137, 117, .36)`,
        background: 'rgba(255, 250, 243, .35)',
        boxShadow: '4px 6px 0 rgba(214, 199, 181, .5)',
        transform: `rotate(${interpolate(drift, [0, 1], [-0.2, 0.2])}deg)`,
      }}
    />
  );
};

const Camera: React.FC<{
  children: React.ReactNode;
  scale: number;
  x?: number;
  y?: number;
}> = ({children, scale, x = 0, y = 0}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
      transformOrigin: '50% 50%',
    }}
  >
    {children}
  </div>
);

const PortfolioImage: React.FC<{opacity?: number}> = ({opacity = 1}) => (
  <RecordedMedia still="stills/portfolio-hero.jpg" opacity={opacity} />
);

const Privacy = {
  workspace: [{left: 0, top: 36.5, width: 100, height: 63.5, fill: theme.desk}],
  kanban: [{left: 0, top: 33.2, width: 100, height: 66.8, fill: theme.paper}],
  ai: [
    {left: 44.9, top: 19.8, width: 28.6, height: 2.2, fill: theme.nearBlackAlt},
    {left: 26.7, top: 22.0, width: 46.8, height: 30.4, fill: theme.nearBlackAlt},
  ],
};

const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const easeIn = (value: number) => ease(Math.min(1, Math.max(0, value)));
  const scale = interpolate(frame, [0, 112], [0.91, 1.035], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (value) => easeIn(value),
  });
  const footageOpacity = interpolate(frame, [16, 38], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <>
      <DeskPaper frame={frame} x={22} y={26} />
      <PaperFrame style={{left: FRAME.left, top: FRAME.top, width: FRAME.width, height: FRAME.height, zIndex: 2, transform: `rotate(-0.25deg)`}}>
        <ViewportWindow>
          <Camera scale={scale} y={interpolate(frame, [0, 112], [12, -2], {extrapolateRight: 'clamp'})}>
            <PortfolioImage opacity={1 - footageOpacity} />
            <RecordedMedia
              file={clip('01-portfolio')}
              startSeconds={0.9}
              endSeconds={4.7}
              opacity={footageOpacity}
            />
          </Camera>
        </ViewportWindow>
      </PaperFrame>
      <SketchStroke
        left={1180}
        top={28}
        width={520}
        height={85}
        color="#bd896f"
        strokeWidth={4}
        duration={31}
        path="M 12 62 C 102 14, 173 24, 231 46 S 353 65, 417 30 M 388 31 L 417 30 L 405 53"
        viewBox="0 0 440 90"
      />
    </>
  );
};

const Projects: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 90], [1.045, 1.115], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const panY = interpolate(frame, [0, 90], [12, -48], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <>
      <DeskPaper frame={frame} x={-4} y={30} />
      <PaperFrame style={{left: 73, top: 43, width: 1770, height: 997, zIndex: 2, transform: 'rotate(.12deg)'}}>
        <ViewportWindow>
          <Camera scale={scale} y={panY}>
            <RecordedMedia file={clip('01-portfolio')} startSeconds={3.7} endSeconds={6.7} />
          </Camera>
        </ViewportWindow>
      </PaperFrame>
      <SketchStroke
        left={1700}
        top={800}
        width={164}
        height={180}
        color="#b58e74"
        strokeWidth={3.5}
        duration={28}
        path="M 8 157 C 32 81, 71 30, 143 18 M 115 15 L 143 18 L 130 41"
        viewBox="0 0 160 180"
      />
    </>
  );
};

const PublicAi: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 90], [1.025, 1.105], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const x = interpolate(frame, [0, 90], [-10, -62], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <>
      <DeskPaper frame={frame} x={0} y={17} />
      <PaperFrame style={{left: 103, top: 55, width: 1710, height: 967, zIndex: 2, transform: 'rotate(-.08deg)'}}>
        <ViewportWindow>
          <Camera scale={scale} x={x}>
            <RecordedMedia file={clip('08-public-ai')} startSeconds={9.1} endSeconds={12.1} />
          </Camera>
        </ViewportWindow>
      </PaperFrame>
      <SketchStroke
        left={1430}
        top={865}
        width={300}
        height={90}
        color="#c28e73"
        strokeWidth={3.5}
        duration={26}
        path="M 12 63 C 83 20, 156 28, 221 48 S 270 54, 289 26"
        viewBox="0 0 300 95"
      />
    </>
  );
};

const RevealWorkspace: React.FC = () => {
  const frame = useCurrentFrame();
  const dashboardStillOpacity = interpolate(frame, [55, 66], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const workspaceScale = interpolate(frame, [0, 90], [0.88, 1.03], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cardX = interpolate(frame, [0, 12, 36, 58, 72, 90], [50, 34, 700, 1040, 1100, 1110], {
    extrapolateRight: 'clamp',
  });
  const cardY = interpolate(frame, [0, 12, 36, 58, 72, 90], [38, 32, 500, 680, 730, 750], {
    extrapolateRight: 'clamp',
  });
  const cardW = interpolate(frame, [0, 12, 36, 58, 72, 90], [1820, 1840, 850, 620, 520, 500], {
    extrapolateRight: 'clamp',
  });
  const cardH = interpolate(frame, [0, 12, 36, 58, 72, 90], [1020, 1030, 480, 350, 295, 284], {
    extrapolateRight: 'clamp',
  });
  const cardOpacity = interpolate(frame, [0, 12, 36, 54, 69, 82, 90], [1, 0.98, 0.56, 0.16, 0.04, 0, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <>
      <DeskPaper frame={frame} x={5} y={28} />
      <PaperStrip
        dark
        style={{left: 94, top: 332, width: 1732, height: 420, zIndex: 1, borderRadius: 22, transform: `scale(${workspaceScale})`}}
      >
        <Camera scale={1.015} y={7}>
          <RecordedMedia
            file={clip('02-workspace')}
            startSeconds={1.5}
            endSeconds={3.15}
            masks={Privacy.workspace}
            opacity={1 - dashboardStillOpacity}
          />
          <RecordedMedia
            still="stills/workspace-dashboard.jpg"
            masks={Privacy.workspace}
            opacity={dashboardStillOpacity}
          />
        </Camera>
      </PaperStrip>
      <PaperFrame
        style={{
          left: cardX,
          top: cardY,
          width: cardW,
          height: cardH,
          zIndex: 4,
          opacity: cardOpacity,
          transform: `rotate(${interpolate(frame, [0, 65, 90], [-0.2, -2.1, -3.1], {extrapolateRight: 'clamp'})}deg)`,
        }}
        inset={11}
        radius={21}
      >
        <ViewportWindow>
          <RecordedMedia file={clip('08-public-ai')} startSeconds={11.4} endSeconds={14.4} />
        </ViewportWindow>
      </PaperFrame>
      <SketchStroke
        left={140}
        top={730}
        width={390}
        height={145}
        color="#a8957f"
        strokeWidth={4}
        duration={42}
        path="M 18 122 C 120 50, 239 33, 348 48 M 319 29 L 348 48 L 321 61"
        viewBox="0 0 380 145"
      />
    </>
  );
};

const WorkspaceKanban: React.FC = () => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [52, 77], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <>
      <DeskPaper frame={frame} x={-16} y={24} />
      <PaperStrip
        dark
        style={{left: 95, top: 330, width: 1730, height: 420, zIndex: 2, borderRadius: 22}}
      >
        <Camera
          scale={interpolate(frame, [0, 56], [1.015, 1.05], {extrapolateRight: 'clamp'})}
          y={interpolate(frame, [0, 56], [0, 8], {extrapolateRight: 'clamp'})}
        >
          <RecordedMedia
            file={clip('02-workspace')}
            startSeconds={1.5}
            endSeconds={3.15}
            masks={Privacy.workspace}
            opacity={1 - interpolate(frame, [55, 65], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
          />
          <RecordedMedia
            still="stills/workspace-dashboard.jpg"
            masks={Privacy.workspace}
            opacity={interpolate(frame, [55, 65], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
          />
        </Camera>
      </PaperStrip>
      <PaperStrip
        style={{
          left: 95,
          top: 330,
          width: 1730,
          height: 420,
          zIndex: 3,
          borderRadius: 22,
          clipPath: `polygon(0 0, ${reveal}% 0, ${Math.max(0, reveal - 3)}% 100%, 0 100%)`,
        }}
      >
        <Camera
          scale={interpolate(frame, [54, 120], [1.035, 1.09], {extrapolateRight: 'clamp'})}
          x={interpolate(frame, [54, 120], [14, -26], {extrapolateRight: 'clamp'})}
        >
          <RecordedMedia
            file={clip('03-kanban')}
            startSeconds={2.65}
            endSeconds={6.65}
            masks={Privacy.kanban}
          />
        </Camera>
      </PaperStrip>
      <NotebookWipe startFrame={50} duration={26} bounds={{left: 95, top: 330, width: 1730, height: 420}} />
      <SketchStroke
        left={1470}
        top={190}
        width={260}
        height={130}
        color="#a8957f"
        strokeWidth={3.5}
        startFrame={12}
        duration={35}
        path="M 15 105 C 74 44, 145 34, 232 24 M 206 11 L 232 24 L 210 43"
        viewBox="0 0 245 125"
      />
    </>
  );
};

const Github: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 90], [1, 1.025], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <>
      <DeskPaper frame={frame} x={12} y={23} />
      <PaperFrame
        dark
        inset={14}
        style={{left: 83, top: 340, width: 1754, height: 400, zIndex: 2, borderRadius: 22}}
      >
        <ViewportWindow>
          <Camera scale={scale}>
            <FocusCrop source={{x: 1098, y: 922, width: 730, height: 157}}>
              <RecordedMedia file={clip('05-github')} startSeconds={6} endSeconds={9} />
            </FocusCrop>
          </Camera>
        </ViewportWindow>
      </PaperFrame>
      <SketchStroke
        left={164}
        top={672}
        width={440}
        height={170}
        color="#b38e72"
        strokeWidth={4}
        duration={30}
        path="M 12 146 C 90 53, 223 26, 393 44 M 363 25 L 393 44 L 366 58"
        viewBox="0 0 420 165"
      />
    </>
  );
};

const WorkspaceAi: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 180], [1.08, 1.15], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const stillOpacity = interpolate(frame, [92, 104], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <>
      <DeskPaper frame={frame} x={18} y={16} />
      <PaperFrame style={{left: 148, top: 77, width: 1624, height: 916, zIndex: 2, transform: 'rotate(-.1deg)'}} dark>
        <ViewportWindow>
          <Camera scale={scale}>
            <RecordedMedia
              file={clip('06-workspace-ai')}
              startSeconds={12.12}
              endSeconds={15.25}
              masks={Privacy.ai}
              opacity={1 - stillOpacity}
            />
            <RecordedMedia
              still="stills/workspace-ai-response.jpg"
              masks={Privacy.ai}
              opacity={stillOpacity}
            />
          </Camera>
        </ViewportWindow>
      </PaperFrame>
    </>
  );
};

const ReturnPortfolio: React.FC = () => {
  const frame = useCurrentFrame();
  const heroScale = interpolate(frame, [0, 102], [0.86, 1.015], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const aiScale = interpolate(frame, [0, 46], [1.06, 0.43], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (value) => ease(Math.min(1, Math.max(0, value))),
  });
  const aiLeft = interpolate(frame, [0, 46], [148, 1050], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const aiTop = interpolate(frame, [0, 46], [77, 562], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const aiOpacity = interpolate(frame, [0, 37, 55], [1, 0.9, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const outroOpacity = interpolate(frame, [18, 36, 76, 91], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <>
      <DeskPaper frame={frame} x={10} y={20} />
      <PaperFrame style={{left: 74, top: 41, width: 1772, height: 998, zIndex: 1}}>
        <ViewportWindow>
          <Camera scale={heroScale}>
            <PortfolioImage opacity={1 - outroOpacity} />
            <RecordedMedia
              file={clip('09-outro')}
              startSeconds={2}
              endSeconds={5}
              opacity={outroOpacity}
            />
          </Camera>
        </ViewportWindow>
      </PaperFrame>
      <PaperFrame
        dark
        style={{
          left: aiLeft,
          top: aiTop,
          width: 1624,
          height: 916,
          zIndex: 4,
          opacity: aiOpacity,
          transform: `scale(${aiScale}) rotate(${interpolate(frame, [0, 46], [-.1, -2.3], {extrapolateRight: 'clamp'})}deg)`,
          transformOrigin: 'top left',
        }}
      >
        <ViewportWindow>
          <Camera scale={1.05}>
            <RecordedMedia still="stills/workspace-ai-response.jpg" masks={Privacy.ai} />
          </Camera>
        </ViewportWindow>
      </PaperFrame>
    </>
  );
};

export const Showcase: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Desk />
      <Sequence from={0} durationInFrames={120} name="01 Portfolio opening">
        <Opening />
      </Sequence>
      <Sequence from={120} durationInFrames={90} name="02 Project discovery">
        <Projects />
      </Sequence>
      <Sequence from={210} durationInFrames={90} name="03 Public AI">
        <PublicAi />
      </Sequence>
      <Sequence from={300} durationInFrames={90} name="04 Public to private reveal">
        <RevealWorkspace />
      </Sequence>
      <Sequence from={390} durationInFrames={120} name="05 Workspace and Kanban">
        <WorkspaceKanban />
      </Sequence>
      <Sequence from={510} durationInFrames={90} name="06 GitHub integration">
        <Github />
      </Sequence>
      <Sequence from={600} durationInFrames={180} name="07 Workspace AI">
        <WorkspaceAi />
      </Sequence>
      <Sequence from={780} durationInFrames={120} name="08 Portfolio return">
        <ReturnPortfolio />
      </Sequence>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: interpolate(frame, [0, 30, 870, 900], [0.14, 0, 0, 0.1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          background: 'rgba(248, 242, 233, .08)',
        }}
      />
    </AbsoluteFill>
  );
};
