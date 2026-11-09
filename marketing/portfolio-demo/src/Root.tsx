import { Composition, Folder } from "remotion";
import { Film, filmDuration } from "./Film";

export const RemotionRoot: React.FC = () => {
  return (
    <Folder name="Frami">
      <Composition id="PortfolioDemo" component={Film} fps={30} width={1920} height={1080} durationInFrames={filmDuration("demo", 30)} defaultProps={{ cut: "demo" as const }} />
      <Composition id="LinkedIn" component={Film} fps={30} width={1080} height={1350} durationInFrames={filmDuration("linkedin", 30)} defaultProps={{ cut: "linkedin" as const }} />
      <Composition id="X" component={Film} fps={30} width={1080} height={1080} durationInFrames={filmDuration("x", 30)} defaultProps={{ cut: "x" as const }} />
    </Folder>
  );
};
