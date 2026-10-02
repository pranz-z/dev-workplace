export const DEFAULT_FOCUS_DURATION_MINUTES = 25;
export const MIN_FOCUS_DURATION_MINUTES = 1;
export const MAX_FOCUS_DURATION_MINUTES = 180;
export const FOCUS_DURATION_STEP_MINUTES = 5;
export const FOCUS_DURATION_PRESETS = [15, 25, 50, 90] as const;

export function getFocusTimestamp(): number {
  return Date.now();
}

export type FocusSession =
  | { status: "running"; taskId: string | null; startedAt: number; endsAt: number }
  | { status: "paused"; taskId: string | null; remainingSeconds: number }
  | { status: "completed"; taskId: string | null };

export interface FocusSessionSnapshot {
  durationMinutes: number;
  selectedTaskId: string | null;
  session: FocusSession | null;
}

export function getEligibleFocusTasks<T extends { status: string }>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => task.status !== "Completed").slice(0, 75);
}

export function parseFocusDuration(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < MIN_FOCUS_DURATION_MINUTES || parsed > MAX_FOCUS_DURATION_MINUTES) return null;
  return parsed;
}

export function adjustFocusDuration(minutes: number, delta: number): number {
  const current = parseFocusDuration(minutes) ?? DEFAULT_FOCUS_DURATION_MINUTES;
  return Math.min(MAX_FOCUS_DURATION_MINUTES, Math.max(MIN_FOCUS_DURATION_MINUTES, current + delta));
}

export function formatFocusDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function createFocusSession(taskId: string | null, durationMinutes: number, now: number): FocusSession | null {
  const validDuration = parseFocusDuration(durationMinutes);
  if (validDuration === null || !Number.isFinite(now)) return null;
  return { status: "running", taskId, startedAt: now, endsAt: now + validDuration * 60_000 };
}

export function getFocusRemainingSeconds(session: FocusSession, now: number): number {
  if (session.status === "completed") return 0;
  if (session.status === "paused") return session.remainingSeconds;
  return Math.max(0, Math.ceil((session.endsAt - now) / 1000));
}

export function pauseFocusSession(session: FocusSession, now: number): FocusSession {
  if (session.status !== "running") return session;
  const remainingSeconds = getFocusRemainingSeconds(session, now);
  return remainingSeconds === 0 ? { status: "completed", taskId: session.taskId } : { status: "paused", taskId: session.taskId, remainingSeconds };
}

export function adjustPausedFocusSession(session: FocusSession, deltaMinutes: number): FocusSession {
  if (session.status !== "paused") return session;
  const maxSeconds = MAX_FOCUS_DURATION_MINUTES * 60;
  const adjustment = Number.isFinite(deltaMinutes) ? Math.trunc(deltaMinutes * 60) : 0;
  return { ...session, remainingSeconds: Math.min(maxSeconds, Math.max(1, session.remainingSeconds + adjustment)) };
}

export function resumeFocusSession(session: FocusSession, now: number): FocusSession {
  if (session.status !== "paused" || !Number.isFinite(now)) return session;
  return { status: "running", taskId: session.taskId, startedAt: now, endsAt: now + session.remainingSeconds * 1000 };
}

export function readFocusSessionSnapshot(value: unknown): FocusSessionSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const durationMinutes = parseFocusDuration(typeof candidate.durationMinutes === "number" ? candidate.durationMinutes : Number.NaN);
  const selectedTaskId = candidate.selectedTaskId === null || typeof candidate.selectedTaskId === "string" ? candidate.selectedTaskId : null;
  const rawSession = candidate.session;
  if (durationMinutes === null) return null;
  let session: FocusSession | null = null;
  if (rawSession && typeof rawSession === "object") {
    const entry = rawSession as Record<string, unknown>;
    const taskId = entry.taskId === null || typeof entry.taskId === "string" ? entry.taskId : null;
    if (entry.status === "running" && Number.isFinite(entry.startedAt) && Number.isFinite(entry.endsAt) && Number(entry.endsAt) >= Number(entry.startedAt) && Number(entry.endsAt) - Number(entry.startedAt) <= MAX_FOCUS_DURATION_MINUTES * 60_000) {
      session = { status: "running", taskId, startedAt: Number(entry.startedAt), endsAt: Number(entry.endsAt) };
    } else if (entry.status === "paused" && Number.isSafeInteger(entry.remainingSeconds) && Number(entry.remainingSeconds) > 0 && Number(entry.remainingSeconds) <= MAX_FOCUS_DURATION_MINUTES * 60) {
      session = { status: "paused", taskId, remainingSeconds: Number(entry.remainingSeconds) };
    } else if (entry.status === "completed") {
      session = { status: "completed", taskId };
    }
  }
  return { durationMinutes, selectedTaskId, session };
}
