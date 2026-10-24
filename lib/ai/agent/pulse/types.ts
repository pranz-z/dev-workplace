import type { SchedulingPreferences } from '@/data/timeBlocks';

export type PulseMode = 'off' | 'workspace' | 'workspace_ai';
export type PulseCadence = 'normal' | 'quiet';
export type SignalFamily = 'deadline' | 'important_work' | 'quiet_project' | 'tomorrow';
export type ObservationState = 'active' | 'snoozed' | 'dismissed' | 'resolved';
export type PulseStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'abandoned';
export type IdeaCategory = 'review_deadline' | 'consider_scheduling' | 'review_quiet_project' | 'review_tomorrow';
export type PulseReason = 'DEADLINE_OVERDUE' | 'DEADLINE_TODAY' | 'DEADLINE_SOON' |
  'IMPORTANT_NO_WORK' | 'PROJECT_QUIET' | 'TOMORROW_DEADLINES' | 'TOMORROW_OCCUPANCY';
export type PulseError = 'UNKNOWN_COVERAGE' | 'SOURCE_CHANGED' | 'SOURCE_UNAVAILABLE' |
  'AUTHORITY_LOST' | 'CAPACITY' | 'BUDGET' | 'AI_UNAVAILABLE' | 'AI_MALFORMED' | 'AI_TIMEOUT';
export type CoverageReason = 'INCOMPLETE' | 'INVALID_DATE' | 'MISSING_DATE' | 'TIME_ZONE' |
  'INVALID_ACTIVITY' | 'INVALID_RANGE' | 'PREFERENCES_MISSING' | 'PREFERENCES_INVALID' |
  'NONWORKING_DAY' | 'SOURCE_TOKEN' | 'OWNER_LINK' | 'EXCLUDED';
export type Truth = 'true' | 'false' | 'unknown';
export interface SignalCoverage { complete: boolean; reason?: CoverageReason }
export interface PulseTarget { type: 'task' | 'milestone' | 'project' | 'workspace_day'; id: string }
interface EntityFact {
  id: string; userId: string; title: string; status: string; sourceToken?: string;
  createdAt?: string | null; updatedAt?: string | null;
  /** Canonical last semantic change, supplied by the projection; not an optimistic row version. */
  materialChangedAt?: string;
}
export interface ProjectFact extends EntityFact {
  targetDate?: string | null; workflowStage?: string | null; priority?: string | null;
}
export interface TaskFact extends EntityFact {
  projectId: string; priority?: string | null; dueDate?: string | null; completedAt?: string | null;
}
export interface MilestoneFact extends EntityFact { projectId: string; targetDate?: string | null }
export interface BlockFact {
  id: string; userId: string; taskId: string | null; projectId: string | null;
  kind: 'task' | 'focus' | 'break' | 'custom'; status: 'scheduled' | 'completed' | 'cancelled';
  startAt: string; endAt: string;
}
export interface TaskBlockFacts {
  coverage: SignalCoverage; sourceToken?: string; blocks: readonly BlockFact[];
}
export interface ProjectActivityFacts {
  coverage: SignalCoverage; sourceToken?: string;
  /** SQL aggregate over approved owned task/milestone timestamps only. */
  lastActivityAt?: string | null; invalidActivity: boolean;
}
export interface StoredObservation {
  /** Committed server-only observation authority, supplied by the guarded source read. */
  id: string; episode: number; seen: boolean; lastCheckedAt: string;
  key: string; target: PulseTarget; family: SignalFamily; state: ObservationState;
  materialFingerprint: string; sourceToken: string; evidenceValidUntil: string;
  rowRevision?: number;
}
export interface PulseSourceSnapshot {
  userId: string; evaluatedAt: string; timeZone: string | null;
  settingsRevision: number; policyVersion: string;
  projects: readonly ProjectFact[]; tasks: readonly TaskFact[];
  milestones: readonly MilestoneFact[]; blocks: readonly BlockFact[];
  preferences?: SchedulingPreferences | null;
  taskBlocks: Readonly<Record<string, TaskBlockFacts>>;
  projectActivity: Readonly<Record<string, ProjectActivityFacts>>;
  coverage: Record<'projects' | 'tasks' | 'milestones' | 'blocks', SignalCoverage>;
  /** Complete targeted existence/ownership checks, independent of capped discovery. */
  targetChecks: Readonly<Record<string, { complete: boolean; exists: boolean; sourceToken?: string }>>;
  tomorrowSourceToken?: string; existing: readonly StoredObservation[];
  baseline: Readonly<Record<string, string>>;
}
export interface MaterialFacts {
  [key: string]: unknown;
  date?: string | null; status?: string; priority?: string | null;
  lastActivityAt?: string | null;
}
export interface ConditionEvidence {
  title: string; summary: string; explanation: string; evaluatedAt: string;
  date?: string | null; status?: string; issue?: CoverageReason;
  checkedStart?: string; checkedEnd?: string;
  taskCount?: number | null; milestoneCount?: number | null; projectCount?: number | null;
  occupancyPercent?: number | null; occupancyIssue?: CoverageReason;
  lastActivityAt?: string; thresholdDays?: number;
}
export interface ConditionDecision {
  key: string; target: PulseTarget; family: SignalFamily; truth: Truth;
  reasonCodes: PulseReason[]; materialFingerprint: string; sourceToken: string | null;
  evidenceValidUntil: string | null; evidence: ConditionEvidence;
  importance: 'critical' | 'high' | 'normal'; rank: 0 | 1 | 2 | 3 | 4 | 5;
  deadline?: string; priority?: string | null; materialChangedAt?: string;
  complete: boolean;
  /** Only covered metrics may advance their corresponding baseline portion. */
  baselineParts?: Readonly<Record<string, string>>;
  expectedRowRevision?: number;
}
export interface PulsePolicy {
  version: string; maxNew: number; maxExisting: number;
  signals: { approachingDays: number; minimumBlockMs: number; quietDays: number;
    maintenanceQuietDays: number; tomorrowDeadlines: number; occupancyPercent: number };
  limits: { title: number; summary: number; explanation: number; conditionKey: number; evidenceBytes: number };
}
export interface PulseScan {
  decisions: ConditionDecision[]; newCandidates: ConditionDecision[];
  baselinePatches: Record<string, string>;
  coverage: {
    true: number; false: number; unknown: number; complete: boolean;
    collections: Record<'projects' | 'tasks' | 'milestones' | 'blocks', boolean>;
  };
}
export interface PulseAuthority {
  userId: string; pulseId: string; slot: string; leaseToken: string;
  leaseExpiresAt: string; fence: number; settingsRevision: number; policyVersion: string;
}
