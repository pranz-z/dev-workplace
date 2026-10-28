import type { FollowPose } from "./ascii-pose-follow";

type PoseRecord = { body: number[]; head: number[]; anchor: number[]; yaw: number; pitch: number };
export type PoseData = { dictionary: (null | [number, string, string])[]; rowPool: string[]; poses: Record<string, PoseRecord> };
export type HeadFrame = { key: string; rows: readonly (readonly [number, string, string])[][]; anchor: readonly number[]; bodyKey: string };
const id = (yaw: number, pitch: number) => `yaw-${yaw < 0 ? "-" : "+"}${String(Math.abs(yaw)).padStart(2, "0")}-pitch-${pitch < 0 ? "-" : "+"}${String(Math.abs(pitch)).padStart(2, "0")}`;

/** Offline drawn silhouettes and revealed pixels. No source-coordinate deformation. */
export class PoseBank {
  private packed: number[];
  private decoded = new Map<number, Uint32Array>();
  private heads = new Map<string, HeadFrame["rows"]>();
  constructor(private data: PoseData) {
    this.packed = data.dictionary.map(c => c ? c[0] | c[1].charCodeAt(0) << 8 | c[2].charCodeAt(0) << 16 : 0);
  }
  private row(index: number) {
    let row = this.decoded.get(index);
    if (!row) { row = Uint32Array.from(this.data.rowPool[index], c => this.packed[c.charCodeAt(0) - 256]); this.decoded.set(index, row); }
    return row;
  }
  private body(grid: Uint32Array, pose: PoseRecord) {
    for (let y = 0; y < pose.body.length; y++) {
      const row = this.row(pose.body[y]);
      for (let x = 0; x < row.length; x++) if (row[x]) grid[y * 180 + x] = row[x];
    }
  }
  apply(grid: Uint32Array, state: FollowPose): HeadFrame | undefined {
    if (!state.active) return undefined;
    let bodyKey = "native";
    if (state.bodyStep === 1 && state.side < 0) bodyKey = "left-release-1";
    if (state.bodyStep === 2) bodyKey = `${state.side < 0 ? "left" : "right"}-release-2`;
    if (state.bodyStep >= 3) bodyKey = id(state.side * (state.bodyStep === 4 ? 40 : 20), state.pitchKey);
    const body = this.data.poses[bodyKey] ?? this.data.poses.native;
    this.body(grid, this.data.poses.native); // Remove the ORIGINAL head, including pixels revealed by turns.
    if (bodyKey !== "native") this.body(grid, body);
    const key = id(state.headYawKey, state.pitchKey), head = this.data.poses[key];
    let rows = this.heads.get(key);
    if (!rows) {
      rows = head.head.map(index => {
        const groups: [number, string, string][] = [];
        for (const encoded of this.data.rowPool[index]) {
          const cell = this.data.dictionary[encoded.charCodeAt(0) - 256] ?? [32, " ", " "];
          const last = groups.at(-1);
          if (last?.[0] === cell[0]) { last[1] += cell[1]; last[2] += cell[2]; }
          else groups.push([...cell]);
        }
        return groups;
      });
      this.heads.set(key, rows);
    }
    return { key: `${bodyKey}/${key}`, rows, anchor: body.anchor, bodyKey };
  }
}
