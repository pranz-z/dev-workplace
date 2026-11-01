export type FollowGates = { fine: boolean; mobile: boolean; reduced: boolean; paused: boolean; visible: boolean; hidden: boolean; sip: boolean };
export type FollowPose = { headYaw: number; pitch: number; torsoYaw: number; headYawKey: number; pitchKey: number; side: number; bodyStep: number; active: boolean };

/** Active-time springs plus wall-time attention; every drawn pose is real source artwork. */
export class PoseFollower {
  private movedAt = -Infinity;
  private coordinates: { x: number; y: number } | undefined;
  private target = { yaw: 0, pitch: 0 };
  private angle = { yaw: 0, pitch: 0, torso: 0 };
  private velocity = { yaw: 0, pitch: 0, torso: 0 };
  private history: { at: number; yaw: number }[] = [];
  private side = 0;
  private bodyStep = 0;
  private headKey = 0;
  private pitchKey = 0;
  private swappedAt = -Infinity;
  private headSwappedAt = -Infinity;
  private current: FollowPose = { headYaw: 0, pitch: 0, torsoYaw: 0, headYawKey: 0, pitchKey: 0, side: 0, bodyStep: 0, active: false };

  point(x: number, y: number, now: number) {
    if (!Number.isFinite(x + y + now)) return;
    if (this.coordinates?.x === x && this.coordinates.y === y) return;
    this.coordinates = { x, y };
    const dead = (v: number) => Math.abs(v) <= .08 ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - .08) / .92);
    this.target = { yaw: dead(x) * 40, pitch: dead(y) * 15 };
    this.movedAt = now;
  }
  release() { this.movedAt = -Infinity; this.target = { yaw: 0, pitch: 0 }; this.coordinates = undefined; }
  private reset() {
    this.angle = { yaw: 0, pitch: 0, torso: 0 }; this.velocity = { yaw: 0, pitch: 0, torso: 0 };
    this.history = []; this.side = this.bodyStep = this.headKey = this.pitchKey = 0;
    this.current = { headYaw: 0, pitch: 0, torsoYaw: 0, headYawKey: 0, pitchKey: 0, side: 0, bodyStep: 0, active: false };
    return this.current;
  }
  advance(dt: number, now: number, gates: FollowGates): FollowPose {
    if (gates.paused) return this.current;
    if (!gates.fine || gates.mobile || gates.reduced || !gates.visible || gates.hidden || gates.sip) { this.release(); return this.reset(); }
    const watching = now - this.movedAt < 3000;
    const target = watching ? this.target : { yaw: 0, pitch: 0 };
    this.history.push({ at: now, yaw: target.yaw / 2 });
    while (this.history.length > 1 && this.history[1].at <= now - 200) this.history.shift();
    const delayed = this.history[0]?.at <= now - 200 ? this.history[0].yaw : 0;
    const seconds = Math.max(0, Math.min(50, dt)) / 1000;
    const spring = (axis: keyof typeof this.angle, destination: number, omega: number) => {
      const error = this.angle[axis] - destination, c = this.velocity[axis] + omega * error, decay = Math.exp(-omega * seconds);
      this.angle[axis] = destination + (error + c * seconds) * decay;
      this.velocity[axis] = (this.velocity[axis] - omega * c * seconds) * decay;
    };
    spring("yaw", target.yaw, 16); spring("pitch", target.pitch, 16); spring("torso", delayed, 12);
    const desiredSide = Math.abs(target.yaw) < 6 ? 0 : Math.sign(target.yaw);
    const amount = Math.abs(this.angle.torso);
    const desiredStep = !watching || !desiredSide ? 0 : amount < 3 ? 0 : amount < 5 ? 1 : amount < 7 ? 2 : amount < 15 ? 3 : 4;
    if (now - this.swappedAt >= 100) {
      const returning = this.bodyStep > 0 && desiredSide !== this.side;
      const next = returning ? this.bodyStep - 1 : this.bodyStep + Math.sign(desiredStep - this.bodyStep);
      if (next !== this.bodyStep) {
        this.bodyStep = next; this.swappedAt = now;
        if (!next) this.side = 0;
        else if (!this.side) this.side = desiredSide;
      }
    }
    const yaw = this.side && desiredSide && this.side !== desiredSide ? 0 : this.angle.yaw;
    const quantize = (v: number, key: number, step: number, limit: number, margin: number) => {
      const next = Math.max(-limit, Math.min(limit, Math.round(v / step) * step));
      return next !== key && Math.abs(v - key) >= step / 2 + margin ? next : key;
    };
    if (now - this.headSwappedAt >= 75) {
      const nextHead = quantize(yaw, this.headKey, 20, 40, 2), nextPitch = quantize(this.angle.pitch, this.pitchKey, 15, 15, 1.5);
      if (nextHead !== this.headKey || nextPitch !== this.pitchKey) this.headSwappedAt = now;
      this.headKey = nextHead; this.pitchKey = nextPitch;
    }
    const active = watching && (Math.abs(target.yaw) > 0 || Math.abs(target.pitch) > 0) || this.bodyStep > 0 || Math.abs(this.angle.yaw) > .5 || Math.abs(this.angle.pitch) > .5;
    if (!active) return this.reset();
    this.current = { headYaw: this.angle.yaw, pitch: this.angle.pitch, torsoYaw: this.angle.torso, headYawKey: this.headKey, pitchKey: this.pitchKey, side: this.side, bodyStep: this.bodyStep, active };
    return this.current;
  }
}
