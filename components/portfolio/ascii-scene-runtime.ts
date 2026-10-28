import { ACTIONS, EYES, PARTS, SCENE_CONFIG as C, actionPose, envelope, ease, type SceneAction, type ScenePart, type Pose } from "./ascii-scene-config";

export type Run = readonly string[];
export type SceneClip = { fps: number; columns?: number; rows?: number; runs: string[][]; frames: number[][] };
export type SceneState = { action: SceneAction | "idle"; progress: number; time: number; night: boolean; sleepy: boolean; sourceFrame: number };
type Grid = Uint32Array;
const SPACE = 32 | (32 << 8) | (32 << 16);
const pack = (tone: number, dark: string, light = dark) => tone | (dark.charCodeAt(0) << 8) | (light.charCodeAt(0) << 16);
/** One continuous inverse map across head, neck and shoulders: no erased pixels or cloned fills. */
export function sampleCharacterSource(x: number, y: number, pose: Pose, tracking = false) {
  const influence = (part: ScenePart) => {
    const { bounds: [left, top, right, bottom], feather } = PARTS[part];
    return ease((x - left) / feather) * ease((right - x) / feather) * ease((bottom - y) / feather) * (part === "head" ? 1 : ease((y - top) / feather));
  };
  const offset = (part: ScenePart) => {
    const p = pose[part], [px, py] = PARTS[part].pivot;
    const maxAngle = tracking && part === "head" ? C.pointer.maxDegrees : 4;
    const angle = Math.max(-maxAngle, Math.min(maxAngle, p.degrees)) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = (x - px) * .6, dy = y - py;
    return { x: (dx * cos - dy * sin) / .6 - (x - px) + p.x, y: dx * sin + dy * cos - (y - py) + p.y };
  };
  const headWeight = influence("head"), head = offset("head");
  let dx = 0, dy = 0, weight = 0;
  for (const part of ["torso", "nearArm", "farArm"] as const) {
    const w = influence(part), d = offset(part); dx += d.x * w; dy += d.y * w; weight += w;
  }
  dx = head.x * headWeight + dx / Math.max(1, weight) * (1 - headWeight);
  dy = head.y * headWeight + dy / Math.max(1, weight) * (1 - headWeight);
  const limit = tracking ? C.gazeDeformation : C.deformation;
  dx = Math.tanh(dx / limit.maxColumns) * limit.maxColumns;
  dy = Math.tanh(dy / limit.maxRows) * limit.maxRows * ease(y / C.deformation.topFadeRows);
  return { x: Math.max(0, Math.min(179, x - dx)), y: Math.max(0, Math.min(104, y - dy)) };
}

/** Prepare frame-invariant transforms once; never repeat trigonometry per cell. */
export function prepareCharacterSampler(pose: Pose, tracking = false) {
  const parts = (["head", "torso", "nearArm", "farArm"] as const).map(part => {
    const p = pose[part], [px, py] = PARTS[part].pivot;
    const angle = Math.max(-(tracking && part === "head" ? C.pointer.maxDegrees : 4), Math.min(tracking && part === "head" ? C.pointer.maxDegrees : 4, p.degrees)) * Math.PI / 180;
    return { part, px, py, cos: Math.cos(angle), sin: Math.sin(angle), x: p.x, y: p.y };
  });
  const limit = tracking ? C.gazeDeformation : C.deformation;
  return (x: number, y: number) => {
    let dx = 0, dy = 0, weight = 0, headX = 0, headY = 0, headWeight = 0;
    for (const p of parts) {
      const { bounds: [left, top, right, bottom], feather } = PARTS[p.part];
      const w = ease((x - left) / feather) * ease((right - x) / feather) * ease((bottom - y) / feather) * (p.part === "head" ? 1 : ease((y - top) / feather));
      const rx = (x - p.px) * .6, ry = y - p.py;
      const ox = (rx * p.cos - ry * p.sin) / .6 - (x - p.px) + p.x;
      const oy = rx * p.sin + ry * p.cos - (y - p.py) + p.y;
      if (p.part === "head") { headX = ox; headY = oy; headWeight = w; }
      else { dx += ox * w; dy += oy * w; weight += w; }
    }
    dx = headX * headWeight + dx / Math.max(1, weight) * (1 - headWeight);
    dy = headY * headWeight + dy / Math.max(1, weight) * (1 - headWeight);
    dx = Math.tanh(dx / limit.maxColumns) * limit.maxColumns;
    dy = Math.tanh(dy / limit.maxRows) * limit.maxRows * ease(y / C.deformation.topFadeRows);
    return { x: Math.max(0, Math.min(179, x - dx)), y: Math.max(0, Math.min(104, y - dy)) };
  };
}

/** Move the ORIGINAL eye texture within the lenses; never paint additional eyes over the brows. */
export function sampleGazeEye(x: number, y: number, gazeX: number, gazeY: number): { x: number; y: number } | undefined {
  for (const eye of EYES) {
    const dx = (x - eye.x) / eye.radiusX, dy = (y - eye.y) / eye.radiusY;
    const radius = Math.hypot(dx, dy);
    if (radius >= 1) continue;
    const weight = ease((1 - radius) / .7);
    return {
      x: x - Math.max(-1, Math.min(1, gazeX)) * 1.1 * weight,
      y: y - Math.max(-1, Math.min(1, gazeY)) * .8 * weight,
    };
  }
}
export const isNight = (hour: number | undefined) => Number.isFinite(hour) && hour! >= 0 && hour! < 24 && (hour! >= C.nightHours[0] || hour! < C.nightHours[1]);

/** Pointer activity uses wall time; the routine's active-time clock stays frozen while watching. */
export class SceneAttention {
  private movedAt = -Infinity;
  private position: { x: number; y: number } | undefined;
  move(x: number, y: number, now: number) {
    if (this.position?.x === x && this.position.y === y) return false;
    this.position = { x, y }; this.movedAt = now;
    return true;
  }
  release() { this.movedAt = -Infinity; }
  tracking(now: number) { return now - this.movedAt < C.pointer.idleMs; }
}

/** Pure active-time director: injectable RNG/hour make the two-minute routine reproducible in tests. */
export class SceneDirector {
  time = 0;
  action: SceneAction | "idle" = "idle";
  started = 0;
  last: SceneAction | undefined;
  nextAt: number;
  private stretchAt: number;
  private buildAt: number;
  private nextBuild: SceneAction = "frustrated";
  private clickAt = -Infinity;
  private queued: SceneAction | undefined;
  private sleepyUntil = 0;
  private greeted = false;
  constructor(private random = Math.random, private hour: () => number | undefined = () => undefined) {
    this.nextAt = this.range(C.idleGapMs); this.stretchAt = this.range(C.stretchEveryMs); this.buildAt = this.range(C.buildEveryMs);
  }
  private range(bounds: readonly [number, number]) { return bounds[0] + this.random() * (bounds[1] - bounds[0]); }
  private night() { try { return isNight(this.hour()); } catch { return false; } }
  private enabled(action: SceneAction) { return ACTIONS[action].weight > 0; }
  /** Decorative gestures never trigger application actions. Clicks share a five-second active-time cooldown. */
  request(kind: "hero-enter" | "scene-enter" | "click") {
    if (kind === "hero-enter") { if (this.greeted) return false; this.greeted = true; }
    if (kind === "click") {
      if (this.time - this.clickAt < C.clickCooldownMs || !this.enabled("celebrate")) return false;
      this.clickAt = this.time; this.queued = "celebrate"; return true;
    }
    if (!this.enabled("look") || this.queued || this.last === "look") return false;
    this.queued = "look"; return true;
  }
  recoverSleepy() { this.sleepyUntil = this.time + C.sleepyRecoveryMs; }
  advance(deltaMs: number): SceneState {
    this.time += Math.max(0, deltaMs);
    if (this.action !== "idle" && this.time - this.started >= ACTIONS[this.action].durationMs) {
      this.last = this.action; this.action = "idle"; this.nextAt = this.time + this.range(C.idleGapMs);
    }
    if (this.action === "idle" && this.time >= this.nextAt) {
      const night = this.night();
      if (!this.enabled(this.nextBuild)) this.nextBuild = this.nextBuild === "frustrated" ? "celebrate" : "frustrated";
      const choices = (Object.keys(ACTIONS) as SceneAction[]).filter(a => this.enabled(a) && a !== this.last &&
        (a !== "stretch" || this.time >= this.stretchAt) &&
        (!(a === "celebrate" || a === "frustrated") || (a === this.nextBuild && this.time >= this.buildAt)));
      let selected = this.queued && this.enabled(this.queued) ? this.queued : undefined;
      this.queued = undefined;
      if (!selected && this.time >= this.stretchAt && this.enabled("stretch") && this.last !== "stretch") selected = "stretch";
      if (!selected && this.time >= this.buildAt && this.enabled(this.nextBuild) && this.last !== this.nextBuild) selected = this.nextBuild;
      if (!selected) {
        const weight = (a: SceneAction) => ACTIONS[a].weight * (night && a === "yawn" ? C.nightYawnMultiplier : 1);
        let cursor = this.random() * choices.reduce((sum, a) => sum + weight(a), 0);
        selected = choices.find(a => (cursor -= weight(a)) <= 0);
      }
      if (selected) {
        this.action = selected; this.started = this.time;
        if (selected === "stretch") this.stretchAt = this.time + this.range(C.stretchEveryMs);
        if (selected === "celebrate" || selected === "frustrated") {
          this.nextBuild = selected === "celebrate" ? "frustrated" : "celebrate"; this.buildAt = this.time + this.range(C.buildEveryMs);
        }
      } else this.nextAt = this.time + C.idleGapMs[0];
    }
    const progress = this.action === "idle" ? 0 : Math.min(1, (this.time - this.started) / ACTIONS[this.action].durationMs);
    let sourceFrame = Math.floor(this.time / 100) % (C.frames.typingEnd + 1);
    if (this.action === "think") sourceFrame = progress < .15 || progress > .9 ? C.frames.rest : progress < .3 || progress > .75 ? C.frames.reach : C.frames.sip;
    if (this.action === "mug" || this.action === "sigh") sourceFrame = progress < .15 || progress > .85 ? C.frames.rest : progress < .35 || progress > .65 ? C.frames.reach : C.frames.sip;
    if (this.action !== "idle" && !["mug", "sigh", "think"].includes(this.action)) sourceFrame = C.frames.rest;
    return { action: this.action, progress, time: this.time, night: this.night(), sleepy: this.time < this.sleepyUntil, sourceFrame };
  }
}

/** Composite offsets from original cells; static furniture and the original frame pool are untouched. */
export class SceneCompositor {
  private decoded = new Map<number, Grid>();
  private previous: Grid | undefined;
  private pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  private noise: number[];
  constructor(private clip: SceneClip, private random = Math.random) { this.noise = Array.from({ length: 50 }, () => this.random()); }
  point(x: number, y: number) { const radius = Math.max(1, Math.hypot(x, y)); this.pointer.targetX = x / radius; this.pointer.targetY = y / radius; }
  private decode(frame: number) {
    const COLS = this.clip.columns ?? 180, ROWS = this.clip.rows ?? 105;
    const cached = this.decoded.get(frame); if (cached) return cached;
    const grid = new Uint32Array(COLS * ROWS).fill(SPACE); let at = 0;
    for (const index of this.clip.frames[frame]) {
      const [tone, dark, light = dark] = this.clip.runs[index];
      for (let i = 0; i < dark.length; i++) if (dark[i] !== "\n") grid[at++] = pack(Number(tone), dark[i], light[i]);
    }
    this.decoded.set(frame, grid); return grid;
  }
  render(state: SceneState, dt: number, width: number, mobile: boolean, tracking = false, overlay?: (grid: Uint32Array) => void): { rows: (Run[] | null)[]; glow: number } {
    const COLS = this.clip.columns ?? 180, ROWS = this.clip.rows ?? 105, sx = COLS / 180, sy = ROWS / 105;
    const source = this.decode(state.sourceFrame);
    const grid = source.slice(), pose = actionPose(state.action, state.progress);
    // Replace only the baked steam effect with the independent, cup-following steam layer.
    for (let i = 0; i < grid.length; i++) if ((grid[i] & 255) === 35) grid[i] = SPACE;
    const smoothing = 1 - Math.exp(-C.pointer.damping * dt / 1000);
    for (const axis of ["x", "y"] as const) this.pointer[axis] += ((mobile ? 0 : this.pointer[axis === "x" ? "targetX" : "targetY"]) - this.pointer[axis]) * smoothing;
    const cellPixels = Math.max(1, width) / 180;
    pose.head.x += this.pointer.x * C.pointer.maxPixels / cellPixels;
    pose.head.y += this.pointer.y * C.pointer.maxPixels / cellPixels * .6;
    pose.head.degrees += this.pointer.x * C.pointer.maxDegrees;
    pose.torso.x += this.pointer.x * C.pointer.maxPixels / cellPixels * C.pointer.torsoFollow;
    pose.torso.y += this.pointer.y * C.pointer.maxPixels / cellPixels * .6 * C.pointer.torsoFollow;
    if (state.sleepy && !tracking) { pose.head.y += .5; pose.head.degrees += 2; }
    // Sample every destination from the untouched source through the same smooth map.
    // Keep table, chair, laptop and the resting mug stationary; never invent occluded pixels.
    const sampleCharacter = prepareCharacterSampler(pose, tracking && !mobile);
    for (let y = 0; y < Math.ceil(54 * sy); y++) for (let x = Math.floor(42 * sx); x < Math.ceil(126 * sx); x++) {
      const rx = x / sx, ry = y / sy;
      const index = y * COLS + x, tone = source[index] & 255;
      if ((ry >= 44 && tone >= 8 && tone <= 13) || (rx >= 105 && ry >= 36) || (rx < 52 && ry >= 25) || (rx >= 61 && rx < 77 && ry >= 47)) continue;
      const point = sampleCharacter(rx, ry);
      // Draw through the same inverse head map so the eyes turn WITH the face, not over it.
      const eye = tracking && !mobile ? sampleGazeEye(point.x, point.y, this.pointer.x, this.pointer.y) : undefined;
      const sample = eye ?? point;
      const cell = source[Math.min(ROWS - 1, Math.round(sample.y * sy)) * COLS + Math.min(COLS - 1, Math.round(sample.x * sx))];
      grid[index] = (cell & 255) === 35 ? SPACE : cell;
    }
    overlay?.(grid);
    const put = (x: number, y: number, glyph: string, tone: number) => { x = Math.round(x * sx); y = Math.round(y * sy); if (x >= 0 && x < COLS && y >= 0 && y < ROWS) grid[y * COLS + x] = pack(tone, glyph); };
    const e = envelope(state.progress), time = state.time / 1000, scale = mobile ? C.particles.mobileScale : 1;
    // Laptop layer: scrolling decorative code, cursor, synthetic result; never application data.
    if (state.action !== "think") for (let line = 0; line < 6; line++) {
      const row = 40 + ((line + Math.floor(time * 2)) % 7);
      for (let x = 0; x < 11 - line % 3; x++) if ((x + line) % 4 !== 0) put(111 + x, row - x * .13, x % 3 ? "-" : ":", 34);
    }
    if (Math.floor(time * 2) % 2 === 0) put(113, 48, "_", 34);
    if (state.night) [..."still working"].forEach((glyph, i) => put(111 + i, 49, glyph, 34)); // Decorative night-time screen state.
    if (state.action === "celebrate" && e > .5) { put(116, 44, "+", 34); put(117, 45, "+", 34); put(118, 44, "+", 34); put(119, 43, "+", 34); }
    if (state.action === "frustrated" && state.progress < .6 && Math.floor(time * 5) % 2 === 0) put(117, 44, "!", 37);
    // Head layer: glint, yawn mouth and blink use a few cells; the face/beanie design is retained.
    if (["think", "look"].includes(state.action) && state.progress > .25 && state.progress < .45) put(89 + pose.head.x, 24 + pose.head.y, "+", 34);
    if (state.action === "yawn" && state.progress > .28 && state.progress < .62) { put(88 + pose.head.x, 29 + pose.head.y, ":", 24); put(88 + pose.head.x, 30 + pose.head.y, ":", 24); }
    if ((state.action === "yawn" && state.progress > .75 && state.progress < .83) || (state.sleepy && Math.sin(time * 3) > .95)) for (const x of [84, 91]) put(x + pose.head.x, 24 + pose.head.y, "-", 24);
    const ideaMs = (state.progress - .65) * ACTIONS.think.durationMs;
    if (state.action === "think" && ideaMs >= 0 && ideaMs < 600) put(108, 8, ideaMs < 360 ? "*" : ideaMs < 480 ? "+" : ".", 35);
    // Prop/steam layer follows the existing hand-held cup during reach/sip.
    const cup = state.sourceFrame === C.frames.sip ? [90, 24] : state.sourceFrame === C.frames.reach ? [87, 29] : [68, 47];
    const blow = state.action === "mug" && state.progress > .15 && state.progress < .35;
    const exhale = state.action === "sigh" && state.progress > .65;
    for (let i = 0; i < Math.ceil(C.particles.steam * scale); i++) {
      const rise = (time * 4 + this.noise[i] * 9) % 9;
      put(cup[0] + Math.sin(time + this.noise[i] * 8 + rise) * 1.2 + (blow ? rise : 0), cup[1] - 1 - rise, rise > 6 ? "." : ":", 35);
      if (exhale) put(94 + rise * .7, 30 - rise * .6, ".", 35);
    }
    if (state.action === "mug" && this.noise[15] > .5 && state.progress > .88) put(98 + Math.sin(time * 14), 49, "-", 4); // Occasional hand wipe at the original wrist.
    // Particles: only the build celebration emits confetti; sparse dust stays in the existing glow.
    if (state.action === "celebrate") for (let i = 0; i < Math.ceil(C.particles.confetti * scale); i++) {
      const t = state.progress, spread = (this.noise[20 + i] - .5) * 30;
      put(88 + spread * t, 22 - 24 * t + 30 * t * t, t > .8 ? "." : [".", "*", "+", "'"][i % 4], 35);
    }
    if (Math.sin(time * .4) > .92) for (let i = 0; i < Math.ceil(C.particles.dust * scale); i++) put(122 + this.noise[35 + i] * 17, 36 - (time + i * 2) % 12, ".", 33);
    // Dirty rows only: no string creation or DOM work for an unchanged row.
    const rows: (Run[] | null)[] = [];
    for (let y = 0; y < ROWS; y++) {
      const start = y * COLS;
      if (this.previous && grid.subarray(start, start + COLS).every((v, x) => v === this.previous![start + x])) { rows.push(null); continue; }
      const runs: string[][] = [];
      for (let x = 0; x < COLS; x++) {
        const cell = grid[start + x], tone = String(cell & 255), dark = String.fromCharCode((cell >>> 8) & 255), light = String.fromCharCode((cell >>> 16) & 255);
        const last = runs.at(-1); if (last?.[0] === tone) { last[1] += dark; last[2] += light; } else runs.push([tone, dark, light]);
      }
      rows.push(runs);
    }
    this.previous = grid;
    return { rows, glow: state.action === "think" ? 0 : .04 + Math.sin(time * .23) * C.lightPulse / 2 };
  }
  reset() { this.previous = undefined; this.point(0, 0); this.pointer.x = this.pointer.y = 0; }
}
