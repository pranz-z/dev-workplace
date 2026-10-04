import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from '../theme';

export const NotebookWipe: React.FC<{
  startFrame: number;
  duration?: number;
  reverse?: boolean;
  bounds: {left: number; top: number; width: number; height: number};
}> = ({
  startFrame,
  duration = 22,
  reverse = false,
  bounds,
}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [startFrame, startFrame + duration], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const x = reverse ? 100 - progress : progress;
  const opacity = interpolate(
    frame,
    [startFrame - 1, startFrame, startFrame + duration, startFrame + duration + 1],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 20,
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        opacity,
        pointerEvents: 'none',
        clipPath: `polygon(${x}% 0, 100% 0, 100% 100%, ${Math.min(100, x + 12)}% 100%)`,
        background: `linear-gradient(105deg, ${theme.deskLight} 0%, ${theme.paper} 46%, ${theme.desk} 100%)`,
        boxShadow: '-18px 0 30px rgba(93, 70, 54, .16)',
      }}
    >
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}
      >
        <path
          d={`M ${x * 10} 0 C ${x * 10 - 32} 280, ${x * 10 + 36} 720, ${(Math.min(100, x + 12)) * 10} 1000`}
          fill="none"
          stroke={theme.edge}
          strokeWidth={3}
          opacity={0.62}
        />
      </svg>
    </div>
  );
};
