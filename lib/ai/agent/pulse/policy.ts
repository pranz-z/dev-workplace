import type { PulsePolicy, PulseReason, SignalFamily } from './types';

export const SIGNAL_FAMILIES: readonly SignalFamily[] = ['deadline', 'important_work', 'quiet_project', 'tomorrow'];
const REASONS: readonly PulseReason[] = ['DEADLINE_OVERDUE', 'DEADLINE_TODAY', 'DEADLINE_SOON',
  'IMPORTANT_NO_WORK', 'PROJECT_QUIET', 'TOMORROW_DEADLINES', 'TOMORROW_OCCUPANCY'];
export const PULSE_POLICY: PulsePolicy = {
  version: 'pulse-v1', maxNew: 3, maxExisting: 20,
  signals: { approachingDays: 3, minimumBlockMs: 60000, quietDays: 14,
    maintenanceQuietDays: 60, tomorrowDeadlines: 5, occupancyPercent: 85 },
  limits: { title: 120, summary: 400, explanation: 240, conditionKey: 160, evidenceBytes: 2048 },
};
export function boundText(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('');
}
export function validateReasonCodes(values: readonly string[]): PulseReason[] {
  if (values.length > REASONS.length || values.some(value => !REASONS.includes(value as PulseReason))) {
    throw new Error('Invalid Pulse reason codes.');
  }
  return REASONS.filter(value => values.includes(value));
}
