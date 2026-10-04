import React, {CSSProperties} from 'react';
import {theme} from '../theme';

type PaperFrameProps = {
  children: React.ReactNode;
  style?: CSSProperties;
  dark?: boolean;
  inset?: number;
  radius?: number;
};

export const PaperFrame: React.FC<PaperFrameProps> = ({
  children,
  style,
  dark = false,
  inset = 14,
  radius = 24,
}) => {
  const paper = dark ? theme.nearBlack : theme.paper;
  const edge = dark ? '#82766b' : theme.edge;

  return (
    <div
      style={{
        position: 'absolute',
        boxSizing: 'border-box',
        padding: inset,
        borderRadius: radius,
        border: `1.5px solid ${edge}`,
        background: paper,
        boxShadow: dark
          ? '10px 13px 0 rgba(17, 15, 14, .35), 0 30px 60px rgba(30, 22, 18, .22)'
          : `8px 10px 0 ${theme.shadow}, 0 26px 55px rgba(93, 70, 54, .17)`,
        ...style,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          borderRadius: radius - 9,
          background: dark ? theme.nearBlackAlt : theme.deskLight,
        }}
      >
        {children}
      </div>
    </div>
  );
};

type ViewportWindowProps = {
  children: React.ReactNode;
  style?: CSSProperties;
  aspectRatio?: string;
};

export const ViewportWindow: React.FC<ViewportWindowProps> = ({
  children,
  style,
  aspectRatio,
}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
      background: theme.desk,
      aspectRatio,
      ...style,
    }}
  >
    {children}
  </div>
);
