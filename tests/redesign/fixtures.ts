import type { InboxAckInput, InboxItem, InboxPage, PulseSettingsResponse } from '@/data/agentInbox';

const owner = '11111111-1111-4111-8111-111111111111';
const itemId = '44444444-4444-4444-8444-444444444444';
const targetId = '55555555-5555-4555-8555-555555555555';
const stamp = '2026-10-26T02:00:00.000Z';
type Scenario = 'unseen' | 'seen' | 'loading' | 'empty' | 'error' | 'stale' | 'unavailable' | 'revision-race';
type Event = { kind: string; [key: string]: unknown };
let scenario: Scenario = 'unseen', revision = 2;
let events: Event[] = [];
let pendingRead: (() => void) | null = null;
let holdRead = false;
let pendingAcks: Array<() => void> = [];

export const authFixture = { status: 'authenticated' as const, user: { id: owner }, configured: true };
export const useAuth = () => authFixture;
export class AgentInboxError extends Error { constructor(readonly code: string) { super('Synthetic Inbox data unavailable.'); } }
export const inboxErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Synthetic fixture error.';
const item = (): InboxItem => ({ id: itemId, kind: 'signal', title: `Synthetic deadline revision ${revision}`,
  summary: 'Fixture task is due today. No real observations or workspace records are loaded.',
  explanation: 'Recorded synthetic facts for isolation verification only.', state: 'active',
  target: { type: 'task', id: targetId }, rowRevision: revision + 1, contentRevision: revision,
  seen: scenario === 'seen', stale: scenario === 'stale', unavailable: scenario === 'unavailable',
  watching: false, reasonCodes: ['DEADLINE_TODAY'], firstNoticedAt: stamp, lastCheckedAt: stamp,
  snoozeUntil: null, revisitAt: null });
const settings: PulseSettingsResponse = { settings: {
  mode: 'workspace', cadence: 'normal', settingsRevision: 1, policyVersion: 'pulse-v1', checksConsented: true,
  aiConsented: false, aiProjectIds: [], aiEligible: false, timezoneReadiness: 'configured', checksEnabled: true,
  nextDueAt: null, lastSuccessAt: null, lastDeterministicAt: null, coverage: { complete: true, unknown: 0 },
  usage: { ownerPulses: 0, ownerRequests: 0, installationRequests: 0, ownerIdeas: 0 },
}, disclosures: { checksConsentVersion: 'checks-v1', aiConsentVersion: 'ai-v1' }, projectChoices: [], projectChoicesTruncated: false };

export const fixture = {
  reset(name: Scenario) {
    if (!['unseen','seen','loading','empty','error','stale','unavailable','revision-race'].includes(name)) throw new Error('Unknown fixture');
    if (pendingRead || pendingAcks.length) throw new Error('Release pending fixture operations before resetting');
    scenario = name; revision = 2; events = []; holdRead = false;
  },
  snapshot: () => structuredClone({ scenario, revision, item: item(), pendingAckCount: pendingAcks.length, events }),
  advanceRevision: () => { revision = 3; },
  holdNextRead: () => { holdRead = true; },
  releaseRead: () => { pendingRead?.(); pendingRead = null; },
  releaseAcks: () => { const releases = pendingAcks; pendingAcks = []; releases.forEach(release => release()); },
};

export const agentInboxService = {
  async getPulseSettings() { events.push({ kind: 'settings-read-in-memory' }); return structuredClone(settings); },
  async getInboxPage(): Promise<InboxPage> {
    events.push({ kind: 'inbox-read-in-memory', revision });
    if (scenario === 'loading' || holdRead) { holdRead = false; await new Promise<void>(resolve => { pendingRead = resolve; }); }
    if (scenario === 'error') throw new AgentInboxError('UNAVAILABLE');
    return { items: scenario === 'empty' ? [] : [item()], nextCursor: null };
  },
  async ackInbox(input: InboxAckInput, signal?: AbortSignal) {
    if (input.brief !== false || input.items.some(value => value.id !== itemId || ![2,3].includes(value.contentRevision))) throw new Error('Unexpected synthetic ACK payload');
    events.push({ kind: 'ack-in-memory', input: structuredClone(input),
      renderedTitle: document.querySelector('section[aria-label="Agent Inbox"] article h3')?.textContent ?? null });
    if (scenario === 'revision-race') await new Promise<void>(resolve => { pendingAcks.push(resolve); });
    events.push({ kind: signal?.aborted ? 'ack-aborted' : 'ack-resolved', revisions: input.items.map(value => value.contentRevision) });
    return { acknowledged: input.items.length };
  },
  async getInboxDetail() { events.push({ kind: 'detail-read-in-memory' }); return { item: item(), reviewContext: {
    targetLabel: 'Synthetic task', deterministicSummary: 'Synthetic deadline only.', deterministicExplanation: null, advisoryIdea: null,
  } }; },
  async getPulseJournal() { events.push({ kind: 'journal-read-in-memory' }); return { items: [], nextCursor: null }; },
  async getPulseBrief() { events.push({ kind: 'brief-read-in-memory' }); return { items: [], lastCheckedAt: null }; },
  async sendInboxFeedback() { throw new Error('Feedback writes are outside Phase 0a'); },
  async updatePulseSettings() { throw new Error('Settings writes are outside Phase 0a'); },
  async clearPulseMemory() { throw new Error('Memory clear is outside Phase 0a'); },
};
