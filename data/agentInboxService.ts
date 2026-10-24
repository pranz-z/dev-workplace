import { isPulseProjectId, isPulseRevision, parsePulseSettingsInput, parsePulseMemoryClear, parseInboxFeedback, parseInboxAck,
  parseInboxQuery, parsePulseJournalQuery, PULSE_CONSENT_VERSIONS } from '@/data/agentInbox';
import type { AgentPulseJournalItem, InboxDetail, InboxFeedbackInput, InboxAckInput, InboxFilter, InboxItem, InboxPage,
  InboxReviewContext, PulseBriefDto, PulseJournalPage, PulseSettingsInput, PulseSettingsResponse } from '@/data/agentInbox';

type ErrorCode = 'ABORTED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'STATE_CHANGED' | 'RATE_LIMITED' | 'UNAVAILABLE';
const messages: Record<ErrorCode, string> = {
  ABORTED: 'This request was cancelled.', UNAUTHENTICATED: 'Sign in again to view Agent data.', FORBIDDEN: 'That Inbox item is unavailable.',
  INVALID_INPUT: 'Check the Agent request and try again.', STATE_CHANGED: 'This Agent item changed. Reload and try again.',
  RATE_LIMITED: 'Agent requests are limited right now. Try again later.', UNAVAILABLE: 'Agent data is temporarily unavailable. Try again.',
};
export class AgentInboxError extends Error {
  constructor(readonly code: ErrorCode) { super(messages[code]); this.name = 'AgentInboxError'; }
}
export function inboxErrorMessage(error: unknown): string { return error instanceof AgentInboxError ? error.message : messages.UNAVAILABLE; }
const invalid = (): never => { throw new AgentInboxError('UNAVAILABLE'); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
  return value as Record<string, unknown>;
}
const oneOf = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): boolean => isPulseRevision(value) && value >= min && value <= max;
const text = (value: unknown, max: number, allowHtml = false): boolean => typeof value === 'string' && Array.from(value).length <= max && (allowHtml || !/<\/?[a-z!][^>]*>/i.test(value));
function stamp(value: unknown, nullable = false): boolean {
  if (value === null) return nullable;
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function cursor(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 1400 && /^[A-Za-z0-9_-]+$/.test(value));
}
function signalCheck(signal?: AbortSignal) { if (signal?.aborted) throw new AgentInboxError('ABORTED'); }
function transport(error: unknown): never {
  throw new AgentInboxError(error instanceof DOMException && error.name === 'AbortError' ? 'ABORTED' : 'UNAVAILABLE');
}
async function responseJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  signalCheck(signal);
  if (!response.ok) throw new AgentInboxError(response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'FORBIDDEN' :
    response.status === 400 ? 'INVALID_INPUT' : response.status === 409 ? 'STATE_CHANGED' : response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE');
  try { const value: unknown = await response.json(); signalCheck(signal); return value; }
  catch (error) { if (error instanceof AgentInboxError) throw error; signalCheck(signal); return invalid(); }
}
function outgoing<T>(parse: () => T): T { try { return parse(); } catch { throw new AgentInboxError('INVALID_INPUT'); } }

// These checks mirror the accepted server projection; no internal evidence enters browser state.
function inboxItem(value: unknown): InboxItem {
  const row = object(value, ['id', 'kind', 'title', 'summary', 'explanation', 'state', 'target', 'rowRevision', 'contentRevision', 'seen', 'stale', 'unavailable', 'watching', 'reasonCodes', 'firstNoticedAt', 'lastCheckedAt', 'snoozeUntil', 'revisitAt']);
  const target = object(row.target, ['type', 'id']);
  if (!isPulseProjectId(row.id) || !oneOf(row.kind, ['signal', 'idea']) || !text(row.title, 120) || !text(row.summary, 400) || !text(row.explanation, 240) ||
    !oneOf(row.state, ['active', 'snoozed', 'dismissed', 'resolved']) || !oneOf(target.type, ['task', 'milestone', 'project', 'workspace_day']) || !isPulseProjectId(target.id) ||
    !integer(row.rowRevision, 1) || !integer(row.contentRevision, 1) || ['seen', 'stale', 'unavailable', 'watching'].some(key => typeof row[key] !== 'boolean') ||
    !Array.isArray(row.reasonCodes) || row.reasonCodes.length > 7 || row.reasonCodes.some(code => !oneOf(code, ['DEADLINE_OVERDUE', 'DEADLINE_TODAY', 'DEADLINE_SOON', 'IMPORTANT_NO_WORK', 'PROJECT_QUIET', 'TOMORROW_DEADLINES', 'TOMORROW_OCCUPANCY'])) ||
    !stamp(row.firstNoticedAt) || !stamp(row.lastCheckedAt) || !stamp(row.snoozeUntil, true) || !stamp(row.revisitAt, true)) invalid();
  return { ...row, target: { ...target }, reasonCodes: [...row.reasonCodes as string[]] } as unknown as InboxItem;
}
function reviewContext(value: unknown, item: InboxItem): InboxReviewContext | null {
  if (value === null) return null;
  if (item.stale || item.unavailable) invalid();
  const row = object(value, ['targetLabel', 'deterministicSummary', 'deterministicExplanation', 'advisoryIdea']);
  if (!text(row.targetLabel, 120) || !(row.targetLabel as string).trim() || !text(row.deterministicSummary, 400) || !(row.deterministicSummary as string).trim() ||
    (row.deterministicExplanation !== null && !text(row.deterministicExplanation, 240))) invalid();
  let advisoryIdea: InboxReviewContext['advisoryIdea'] = null;
  if (row.advisoryIdea !== null) {
    const advisory = object(row.advisoryIdea, ['title', 'summary']);
    if (item.kind !== 'idea' || !text(advisory.title, 120) || !text(advisory.summary, 400) || advisory.title !== item.title || advisory.summary !== item.summary) invalid();
    advisoryIdea = { title: advisory.title as string, summary: advisory.summary as string };
  } else if (item.kind === 'idea') invalid();
  return { targetLabel: row.targetLabel as string, deterministicSummary: row.deterministicSummary as string,
    deterministicExplanation: row.deterministicExplanation as string | null, advisoryIdea };
}
function settingsResponse(value: unknown): PulseSettingsResponse {
  const response = object(value, ['settings', 'disclosures', 'projectChoices', 'projectChoicesTruncated']);
  const row = object(response.settings, ['mode', 'cadence', 'settingsRevision', 'policyVersion', 'checksConsented', 'aiConsented', 'aiProjectIds', 'aiEligible', 'timezoneReadiness', 'checksEnabled', 'nextDueAt', 'lastSuccessAt', 'lastDeterministicAt', 'coverage', 'usage']);
  const coverage = object(row.coverage, ['complete', 'unknown']), usage = object(row.usage, ['ownerPulses', 'ownerRequests', 'installationRequests', 'ownerIdeas']);
  const disclosures = object(response.disclosures, ['checksConsentVersion', 'aiConsentVersion']);
  if (!oneOf(row.mode, ['off', 'workspace', 'workspace_ai']) || !oneOf(row.cadence, ['normal', 'quiet']) || !integer(row.settingsRevision) || row.policyVersion !== 'pulse-v1' ||
    ['checksConsented', 'aiConsented', 'aiEligible', 'checksEnabled'].some(key => typeof row[key] !== 'boolean') ||
    !oneOf(row.timezoneReadiness, ['configured', 'missing', 'invalid']) || !Array.isArray(row.aiProjectIds) || row.aiProjectIds.length > 20 || row.aiProjectIds.some(id => !isPulseProjectId(id)) || new Set(row.aiProjectIds).size !== row.aiProjectIds.length ||
    !stamp(row.nextDueAt, true) || !stamp(row.lastSuccessAt, true) || !stamp(row.lastDeterministicAt, true) || typeof coverage.complete !== 'boolean' || !integer(coverage.unknown) || Object.values(usage).some(count => !integer(count)) ||
    disclosures.checksConsentVersion !== PULSE_CONSENT_VERSIONS.checksConsentVersion || disclosures.aiConsentVersion !== PULSE_CONSENT_VERSIONS.aiConsentVersion ||
    !Array.isArray(response.projectChoices) || response.projectChoices.length > 20 || typeof response.projectChoicesTruncated !== 'boolean') invalid();
  const projectChoices = (response.projectChoices as unknown[]).map(value => {
    const choice = object(value, ['id', 'title']); if (!isPulseProjectId(choice.id) || !text(choice.title, 180, true)) invalid();
    return { id: choice.id as string, title: choice.title as string };
  });
  return { settings: { ...row, aiProjectIds: [...row.aiProjectIds as string[]], coverage: { ...coverage }, usage: { ...usage } } as unknown as PulseSettingsResponse['settings'],
    disclosures: { ...PULSE_CONSENT_VERSIONS }, projectChoices, projectChoicesTruncated: response.projectChoicesTruncated as boolean };
}
function journalItem(value: unknown): AgentPulseJournalItem {
  const row = object(value, ['id', 'status', 'startedAt', 'completedAt', 'summary', 'createdCount', 'updatedCount', 'resolvedCount', 'aiOutcome', 'errorCode', 'coverage', 'checkedCounts']);
  const coverage = object(row.coverage, ['complete', 'unknown']), counts = object(row.checkedCounts, ['projects', 'tasks', 'milestones', 'blocks']);
  if (!isPulseProjectId(row.id) || !oneOf(row.status, ['running', 'succeeded', 'partial', 'failed', 'abandoned']) || !stamp(row.startedAt) || !stamp(row.completedAt, true) || !text(row.summary, 400) ||
    !integer(row.createdCount, 0, 3) || !integer(row.updatedCount, 0, 20) || !integer(row.resolvedCount, 0, 20) ||
    !oneOf(row.aiOutcome, ['none', 'reserved', 'accepted', 'unavailable', 'malformed', 'timeout', 'unknown', 'skipped_budget', 'skipped_time_budget', 'skipped_scope']) ||
    (row.errorCode !== null && !oneOf(row.errorCode, ['UNKNOWN_COVERAGE', 'SOURCE_CHANGED', 'SOURCE_UNAVAILABLE', 'AUTHORITY_LOST', 'CAPACITY', 'BUDGET', 'AI_UNAVAILABLE', 'AI_MALFORMED', 'AI_TIMEOUT'])) ||
    typeof coverage.complete !== 'boolean' || !integer(coverage.unknown, 0, 1000) || Object.values(counts).some(count => !integer(count, 0, 1000))) invalid();
  return { ...row, coverage: { ...coverage }, checkedCounts: { ...counts } } as unknown as AgentPulseJournalItem;
}
function page<T>(value: unknown, parse: (value: unknown) => T, limit: number): { items: T[]; nextCursor: string | null } {
  const row = object(value, ['items', 'nextCursor']);
  if (!Array.isArray(row.items) || row.items.length > limit || !cursor(row.nextCursor)) invalid();
  return { items: (row.items as unknown[]).map(parse), nextCursor: row.nextCursor as string | null };
}
type PageParams = { limit?: number; cursor?: string | null };
function pageParams(params: PageParams & { state?: InboxFilter }, inbox: boolean): URLSearchParams {
  const keys = inbox ? ['state', 'limit', 'cursor'] : ['limit', 'cursor'];
  if (!params || Object.keys(params).some(key => !keys.includes(key)) || (params.cursor !== undefined && !cursor(params.cursor))) throw new Error();
  const query = new URLSearchParams(); if (inbox) query.set('state', params.state ?? 'active'); query.set('limit', String(params.limit ?? 20));
  if (params.cursor) query.set('cursor', params.cursor);
  if (inbox) parseInboxQuery(query); else parsePulseJournalQuery(query); return query;
}

export async function getPulseSettings(signal?: AbortSignal): Promise<PulseSettingsResponse> {
  signalCheck(signal); return settingsResponse(await responseJson(await fetch('/api/ai/agent/pulse-settings', { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal }).catch(transport), signal));
}
export async function updatePulseSettings(input: PulseSettingsInput, signal?: AbortSignal): Promise<PulseSettingsResponse> {
  const body = outgoing(() => parsePulseSettingsInput(input)); signalCheck(signal);
  return settingsResponse(await responseJson(await fetch('/api/ai/agent/pulse-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal }).catch(transport), signal));
}
export async function clearPulseMemory(input: { expectedRevision: number; confirmation: 'CLEAR_AGENT_MEMORY' }, signal?: AbortSignal): Promise<{ cleared: true; settingsRevision: number }> {
  const body = outgoing(() => parsePulseMemoryClear(input)); signalCheck(signal);
  const row = object(await responseJson(await fetch('/api/ai/agent/pulse-settings/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal }).catch(transport), signal), ['cleared', 'settingsRevision']);
  if (row.cleared !== true || !integer(row.settingsRevision) || row.settingsRevision !== input.expectedRevision + 1) invalid();
  return { cleared: true, settingsRevision: row.settingsRevision as number };
}
export async function getInboxPage(params: PageParams & { state?: InboxFilter } = {}, signal?: AbortSignal): Promise<InboxPage> {
  const query = outgoing(() => pageParams(params, true)); signalCheck(signal);
  return page(await responseJson(await fetch('/api/ai/agent/inbox?' + query, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal }).catch(transport), signal), inboxItem, params.limit ?? 20);
}
export async function getInboxDetail(id: string, signal?: AbortSignal): Promise<InboxDetail> {
  const query = outgoing(() => { const query = new URLSearchParams({ id }); parseInboxQuery(query); return query; }); signalCheck(signal);
  const row = object(await responseJson(await fetch('/api/ai/agent/inbox?' + query, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal }).catch(transport), signal), ['item', 'reviewContext']);
  if (row.item === null) { if (row.reviewContext !== null) invalid(); return { item: null, reviewContext: null }; }
  const item = inboxItem(row.item); if (item.id !== id) invalid(); return { item, reviewContext: reviewContext(row.reviewContext, item) };
}
export async function sendInboxFeedback(input: InboxFeedbackInput, signal?: AbortSignal): Promise<Pick<InboxItem, 'id' | 'state' | 'rowRevision' | 'contentRevision'>> {
  const body = outgoing(() => parseInboxFeedback(input)); signalCheck(signal);
  const row = object(await responseJson(await fetch('/api/ai/agent/inbox/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal }).catch(transport), signal), ['id', 'state', 'rowRevision', 'contentRevision']);
  const expected = input.action === 'snooze' ? 'snoozed' : input.action === 'dismiss' ? 'dismissed' : 'resolved';
  if (row.id !== input.id || row.state !== expected || !integer(row.rowRevision, 1) || row.rowRevision !== input.expectedRevision + 1 || !integer(row.contentRevision, 1)) invalid();
  return { id: row.id as string, state: row.state as InboxItem['state'], rowRevision: row.rowRevision as number, contentRevision: row.contentRevision as number };
}
export async function ackInbox(input: InboxAckInput, signal?: AbortSignal): Promise<{ acknowledged: number }> {
  const body = outgoing(() => parseInboxAck(input)); signalCheck(signal);
  const row = object(await responseJson(await fetch('/api/ai/agent/inbox/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal }).catch(transport), signal), ['acknowledged']);
  if (!integer(row.acknowledged, 0, input.items.length)) invalid(); return { acknowledged: row.acknowledged as number };
}
export async function getPulseBrief(signal?: AbortSignal): Promise<PulseBriefDto> {
  signalCheck(signal); const row = object(await responseJson(await fetch('/api/ai/agent/brief', { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal }).catch(transport), signal), ['items', 'lastCheckedAt']);
  if (!Array.isArray(row.items) || row.items.length > 5 || !stamp(row.lastCheckedAt, true)) invalid();
  return { items: (row.items as unknown[]).map(inboxItem), lastCheckedAt: row.lastCheckedAt as string | null };
}
export async function getPulseJournal(params: PageParams = {}, signal?: AbortSignal): Promise<PulseJournalPage> {
  const query = outgoing(() => pageParams(params, false)); signalCheck(signal);
  return page(await responseJson(await fetch('/api/ai/agent/journal?' + query, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal }).catch(transport), signal), journalItem, params.limit ?? 20);
}
export const agentInboxService = { getPulseSettings, updatePulseSettings, clearPulseMemory, getInboxPage, getInboxDetail, sendInboxFeedback, ackInbox, getPulseBrief, getPulseJournal };
