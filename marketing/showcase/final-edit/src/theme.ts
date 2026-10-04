export const theme = {
  desk: '#f4ede3',
  deskLight: '#f8f2e9',
  paper: '#fffaf3',
  paperAlt: '#f8efe1',
  ink: '#2d261f',
  nearBlack: '#2a2624',
  nearBlackAlt: '#322d2a',
  edge: '#9c8975',
  shadow: '#d6c7b5',
  marker: '#e8ca7d',
  peach: '#f9ddd1',
  lavender: '#e3dcff',
  blue: '#dcebfa',
  green: '#ddf1dd',
};

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 900,
};

export const FRAME = {
  width: 1772,
  height: 998,
  left: 74,
  top: 41,
};

export const STANDARD_WINDOW = {
  width: 1720,
  height: 974,
  left: 100,
  top: 53,
};

export const ease = (t: number) => t * t * (3 - 2 * t);
