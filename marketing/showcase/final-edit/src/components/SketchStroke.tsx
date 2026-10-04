import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from '../theme';

type SketchStrokeProps = {
  path: string;
  left?: number | string;
  top?: number | string;
  width?: number | string;
  height?: number | string;
  color?: string;
  strokeWidth?: number;
  startFrame?: number;
  duration?: number;
  opacity?: number;
  viewBox?: string;
};

export const SketchStroke: React.FC<SketchStrokeProps> = ({
  path,
  left = 0,
  top = 0,
  width = '100%',
  height = '100%',
  color = theme.edge,
  strokeWidth = 5,
  startFrame = 0,
  duration = 24,
  opacity = 0.9,
  viewBox = '0 0 1000 1000',
}) => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [startFrame, startFrame + duration], [1000, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        overflow: 'visible',
        pointerEvents: 'none',
        opacity,
      }}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1000}
        strokeDasharray={1000}
        strokeDashoffset={draw}
      />
    </svg>
  );
};

export const MarkerSweep: React.FC<{startFrame?: number; left?: string; top?: string}> = ({
  startFrame = 0,
  left = '25%',
  top = '78%',
}) => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [startFrame, startFrame + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: '19%',
        height: 11,
        borderRadius: '50%',
        background: theme.marker,
        opacity: 0.64 * reveal,
        transform: 'rotate(-1.2deg)',
        transformOrigin: 'left center',
        pointerEvents: 'none',
      }}
    />
  );
};
