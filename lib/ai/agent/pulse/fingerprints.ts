import { createHash } from 'node:crypto';
import type { MaterialFacts, PulseTarget, SignalFamily } from './types';

/** Exclude presentation age and unrelated optimistic row versions. Callers supply semantic facts. */
const NONMATERIAL = new Set(['ageDays', 'evaluatedAt', 'updatedAt', 'urgency', 'wording']);
function canonical(value: unknown): string {
  if (value === undefined) return '["missing"]';
  if (value === null) return '["null"]';
  if (Array.isArray(value)) return `["array",${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    return `["object",${Object.entries(value).filter(([key]) => !NONMATERIAL.has(key))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `[${JSON.stringify(key)},${canonical(item)}]`).join(',')}]`;
  }
  return JSON.stringify([typeof value, value]);
}
export function materialFingerprint(facts: MaterialFacts): string {
  return createHash('sha256').update(canonical(facts)).digest('hex');
}
export function conditionKey(target: PulseTarget, family: SignalFamily, localDate?: string): string {
  const suffix = target.type === 'task' && (family === 'deadline' || family === 'important_work')
    ? 'attention' : family;
  return `${target.type}:${target.id}:${suffix}${localDate ? `:${localDate}` : ''}`;
}
