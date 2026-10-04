import React from 'react';
import {Composition} from 'remotion';
import {Showcase} from './scenes/Showcase';
import {VIDEO} from './theme';
import {BriefShowcase} from './scenes/BriefShowcase';

export const RemotionRoot: React.FC = () => (
  <>
  <Composition
    id="DeveloperWorkplaceShowcase"
    component={Showcase}
    width={VIDEO.width}
    height={VIDEO.height}
    fps={VIDEO.fps}
    durationInFrames={VIDEO.durationInFrames}
  />
  <Composition id="Showcase45Landscape" component={BriefShowcase} width={1920} height={1080} fps={30} durationInFrames={1350}/>
  <Composition id="Showcase45Portrait" component={BriefShowcase} width={1080} height={1920} fps={30} durationInFrames={1350}/>
  <Composition id="Showcase45Square" component={BriefShowcase} width={1080} height={1080} fps={30} durationInFrames={1350}/>
  </>
);
