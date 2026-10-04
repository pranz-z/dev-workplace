import React, {CSSProperties} from 'react';
import {Video} from '@remotion/media';
import {Img, staticFile} from 'remotion';
import {theme, VIDEO} from '../theme';

export type PrivacyRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  fill?: string;
};

type RecordedMediaProps = {
  file?: string;
  still?: string;
  startSeconds?: number;
  endSeconds?: number;
  masks?: PrivacyRect[];
  imageStyle?: CSSProperties;
  opacity?: number;
};

export const RecordedMedia: React.FC<RecordedMediaProps> = ({
  file,
  still,
  startSeconds = 0,
  endSeconds,
  masks = [],
  imageStyle,
  opacity = 1,
}) => {
  const sourceFrames = Math.max(1, Math.round((endSeconds ?? startSeconds + 1) * VIDEO.fps));

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        opacity,
        ...imageStyle,
      }}
    >
      {file ? (
        <Video
          src={staticFile(file)}
          trimBefore={Math.round(startSeconds * VIDEO.fps)}
          trimAfter={sourceFrames}
          muted
          style={{
            position: 'absolute',
            inset: 0,
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'fill',
          }}
        />
      ) : still ? (
        <Img
          src={staticFile(still)}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'fill',
          }}
        />
      ) : null}
      {masks.map((mask, index) => (
        <div
          key={`${mask.left}-${mask.top}-${index}`}
          style={{
            position: 'absolute',
            left: `${mask.left}%`,
            top: `${mask.top}%`,
            width: `${mask.width}%`,
            height: `${mask.height}%`,
            background: mask.fill ?? theme.desk,
            pointerEvents: 'none',
          }}
        />
      ))}
    </div>
  );
};

export const PaperStrip: React.FC<{
  children: React.ReactNode;
  style?: CSSProperties;
  dark?: boolean;
}> = ({children, style, dark = false}) => (
  <div
    style={{
      position: 'absolute',
      overflow: 'hidden',
      background: dark ? theme.nearBlack : theme.paper,
      border: `1px solid ${dark ? '#82766b' : theme.edge}`,
      boxShadow: dark
        ? '8px 10px 0 rgba(17, 15, 14, .3), 0 25px 55px rgba(30, 22, 18, .2)'
        : `7px 9px 0 ${theme.shadow}, 0 24px 48px rgba(93, 70, 54, .14)`,
      ...style,
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        aspectRatio: '16 / 9',
        overflow: 'hidden',
        background: dark ? theme.nearBlackAlt : theme.desk,
      }}
    >
      {children}
    </div>
  </div>
);
