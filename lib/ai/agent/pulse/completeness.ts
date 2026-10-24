import type { SignalCoverage, Truth } from './types';

export function isComplete(coverage: SignalCoverage | undefined): boolean {
  return coverage?.complete === true;
}
export function absenceTruth(coverage: SignalCoverage | undefined): Truth {
  return isComplete(coverage) ? 'false' : 'unknown';
}
