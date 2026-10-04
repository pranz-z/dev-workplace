import React, {CSSProperties} from 'react';

type FocusCropProps = {
  children: React.ReactNode;
  source: {x: number; y: number; width: number; height: number};
  style?: CSSProperties;
  sourceWidth?: number;
  sourceHeight?: number;
};

/** Fills a viewport with one genuine, normalized crop of a 16:9 capture. */
export const FocusCrop: React.FC<FocusCropProps> = ({
  children,
  source,
  style,
  sourceWidth = 1920,
  sourceHeight = 1080,
}) => (
  <div style={{position: 'absolute', inset: 0, overflow: 'hidden', ...style}}>
    <div
      style={{
        position: 'absolute',
        left: `${(-source.x / source.width) * 100}%`,
        top: `${(-source.y / source.height) * 100}%`,
        width: `${(sourceWidth / source.width) * 100}%`,
        height: `${(sourceHeight / source.height) * 100}%`,
      }}
    >
      {children}
    </div>
  </div>
);
