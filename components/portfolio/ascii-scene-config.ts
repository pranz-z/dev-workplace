export type SceneAction = "stretch" | "neck" | "think" | "yawn" | "lean" | "look" | "celebrate" | "frustrated" | "mug" | "sigh";
type ActionConfig = { weight: number; durationMs: number };

/** Set an action's weight to 0 to disable it, including interaction/periodic triggers. */
export const ACTIONS: Record<SceneAction, ActionConfig> = {
  stretch: { weight: 1, durationMs: 3600 }, // Rare: its separate 40–60s cooldown also applies.
  neck: { weight: 3, durationMs: 2800 }, // Left, right, center; shoulder release.
  think: { weight: 4, durationMs: 3400 }, // Existing raised-hand pose; a brief idea spark.
  yawn: { weight: 2, durationMs: 3000 }, // Night-time weight is multiplied below.
  lean: { weight: 5, durationMs: 2400 }, // Small screenward lean, then neutral.
  look: { weight: 1, durationMs: 1800 }, // First hero entry / scene greeting.
  celebrate: { weight: 1, durationMs: 2200 }, // Alternate synthetic build results.
  frustrated: { weight: 1, durationMs: 2800 }, // Error, head drop, breath, recovery.
  mug: { weight: 5, durationMs: 3800 }, // Reach, blow, sip, return; occasional wipe.
  sigh: { weight: 3, durationMs: 3600 }, // Sip followed by an exhale.
};

export const SCENE_CONFIG = {
  fps: 22, // rAF driver ceiling; original source frames remain 10fps.
  idleGapMs: [3000, 8000] as const, // Active time only; never less than three seconds.
  stretchEveryMs: [40000, 60000] as const,
  buildEveryMs: [20000, 25000] as const, // Alternate bug/ship beats: celebration about every 45s; never a real build.
  clickCooldownMs: 5000,
  nightYawnMultiplier: 3,
  nightHours: [22, 5] as const,
  pointer: { maxPixels: 12, maxDegrees: 14, torsoFollow: 0, damping: 12, idleMs: 650 },
  particles: { steam: 9, confetti: 10, dust: 3, mobileScale: .5 },
  lightPulse: .08, // Dark-only overlay opacity modulation; source colors never change.
  sleepyRate: .5, // Brief sleepy recovery on re-entry; no hidden frame work.
  sleepyRecoveryMs: 1800,
  deformation: { maxColumns: 2.4, maxRows: 1.5, topFadeRows: 6 }, // Continuous, bounded sampling; never cut/clone body parts.
  gazeDeformation: { maxColumns: 7, maxRows: 4.5 }, // Larger head-only turn; the neck still feathers into the stationary torso.
  frames: { rest: 0, typingEnd: 15, reach: 18, sip: 24, return: 38 },
};

/** Original lower lens interiors, registered to the supplied eye crop and rest frame's cream eye highlights. */
export const EYES = [
  { x: 81.5, y: 22, radiusX: 2.5, radiusY: 1.9 },
  { x: 88.7, y: 22, radiusX: 2.5, radiusY: 1.9 },
] as const;

export type ScenePart = "torso" | "farArm" | "nearArm" | "head";
/** Soft influence regions in the original grid. They blend; they are NOT cutout masks. */
export const PARTS: Record<ScenePart, { pivot: readonly [number, number]; bounds: readonly [number, number, number, number]; feather: number }> = {
  torso: { pivot: [79, 48], bounds: [44, 22, 114, 54], feather: 12 },
  farArm: { pivot: [99, 33], bounds: [94, 28, 124, 43], feather: 8 },
  nearArm: { pivot: [62, 42], bounds: [50, 32, 105, 53], feather: 10 },
  head: { pivot: [82, 28], bounds: [48, 0, 116, 36], feather: 12 },
};

export type PartOffset = { x: number; y: number; degrees: number };
export type Pose = Record<ScenePart, PartOffset>;
const neutral = (): Pose => Object.fromEntries(Object.keys(PARTS).map(p => [p, { x: 0, y: 0, degrees: 0 }])) as Pose;
export const ease = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
export const envelope = (p: number) => ease(p / .24) * ease((1 - p) / .25);

/** Each action's eased offsets, in character cells and degrees. Zero at both ends. */
export function actionPose(action: SceneAction | "idle", p: number): Pose {
  const pose = neutral(), e = envelope(p);
  switch (action) {
    case "stretch": // A connected shoulder/sleeve lift; flat art cannot support detached overhead limbs.
      pose.nearArm.degrees = -7 * e; pose.nearArm.y = -.8 * e;
      pose.farArm.degrees = -6 * e; pose.farArm.y = -.8 * e;
      pose.torso.degrees = -1.5 * e; pose.head.degrees = -2 * e; break;
    case "neck": // One deliberate left/right roll, not a continuous wobble.
      pose.head.degrees = Math.sin(p * Math.PI * 2) * 3 * e; pose.torso.y = -.6 * e; break;
    case "think": pose.head.degrees = -2 * e; pose.head.y = -.4 * e; break;
    case "yawn": pose.head.degrees = -3.5 * e; pose.head.y = -.7 * e; pose.torso.y = -.4 * e; break;
    case "lean": pose.torso.x = 1.2 * e; pose.torso.degrees = 2 * e; pose.head.x = 1.8 * e; pose.head.y = .6 * e; break;
    case "look": pose.head.degrees = -3 * e; pose.head.x = -.7 * e; pose.head.y = Math.sin(p * Math.PI * 2) * .4 * e; break;
    case "celebrate": pose.nearArm.degrees = -12 * e; pose.nearArm.y = -1.2 * e; pose.torso.y = -.5 * e; break;
    case "frustrated": pose.head.degrees = 5 * e; pose.head.y = .8 * e; pose.torso.y = -Math.sin(p * Math.PI) * .7; break;
    case "mug": pose.head.degrees = -2 * e; break;
    case "sigh": pose.torso.y = -.5 * Math.sin(p * Math.PI * 2) * e; break;
  }
  return pose;
}
