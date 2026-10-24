import 'server-only';
import type { PulseAuthority, PulseScan, PulseSourceSnapshot, PulseStatus } from './types';
import type { ProactiveSettings } from './privacy';
import type { AgentInboxItem, AgentPulseJournalItem } from '@/data/agentInbox';

export interface PulseRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
const AI_OUTCOMES = ['none','reserved','accepted','unavailable','malformed','timeout','unknown','skipped_budget','skipped_time_budget','skipped_scope'] as const;
export type PulseAiOutcome = typeof AI_OUTCOMES[number];
export interface PulseRecovery {
  id: string; status: PulseStatus; commitId: string | null; reserved: boolean; ideaAccepted: boolean;
  aiOutcome: PulseAiOutcome; createdCount: number; updatedCount: number; resolvedCount: number;
}
export interface PulseCommit { commitId: string; createdCount: number; updatedCount: number; resolvedCount: number; partial: boolean }
export interface PulseReservation { reserved: boolean; sendAllowed: boolean; recovered?: boolean; reason?: 'SOURCE_CHANGED' | 'AI_MALFORMED' | 'BUDGET' }
export interface PulseIdeaPublication { accepted: boolean; recovered?: boolean; id?: string; reason?: 'SOURCE_CHANGED' | 'AI_MALFORMED' | 'BUDGET' | 'CAPACITY' }
export interface PulseDispatchBatch { slot: string; replay: boolean; outcome: 'claimed' | 'empty' | 'disabled'; claimCount: number; claims: PulseAuthority[] }
/** The worker receives fixed Agent-owned RPC capabilities, never the underlying client. */
export type PulseRepository = Pick<ReturnType<typeof createPulseRepository>, 'getSettings' | 'readSource' | 'publishDeterministic' | 'reserveAi' | 'publishAi' | 'recover' | 'finish' | 'claimDispatch' | 'retain' | 'retainInstallation'>;
export function createPulseRepository(client: PulseRpcClient) {
  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error('SOURCE_UNAVAILABLE');
    return data;
  }
  return {
    async listInbox(owner: string, state: 'active' | 'snoozed' | 'dismissed' | 'resolved' | 'all', cursor: string | null = null, limit = 20) {
      const decoded = decodeCursor(cursor);
      const data = await call('agent_pulse_list_inbox', { p_user_id: owner, p_state: state, p_cursor: decoded, p_limit: limit });
      return page(data, inboxItem);
    },
    async getObservation(owner: string, id: string): Promise<AgentInboxItem | null> {
      const data = await call('agent_pulse_get_observation', { p_user_id: owner, p_id: id });
      if (data === null) return null;
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.hasOwn(data,'reviewContext')) unavailable();
      // This internal reader preserves its existing item-only contract; review authority belongs to HTTP detail.
      const {reviewContext,...item} = data as Record<string,unknown>;
      void reviewContext;
      return inboxItem(item);
    },
    async getBrief(owner: string): Promise<{ items: AgentInboxItem[]; lastCheckedAt: string | null }> {
      const data = object(await call('agent_pulse_get_brief', { p_user_id: owner }), ['items','lastCheckedAt']);
      if (!Array.isArray(data.items) || data.items.length>5 || !stamp(data.lastCheckedAt,true)) unavailable();
      return { items: data.items.map(inboxItem), lastCheckedAt: data.lastCheckedAt as string | null };
    },
    async listJournal(owner: string, cursor: string | null = null, limit = 20) {
      return page(await call('agent_pulse_list_journal', { p_user_id: owner, p_cursor: decodeCursor(cursor), p_limit: limit }), journalItem);
    },
    async acknowledge(owner: string, items: Array<{ id: string; contentRevision: number }>, brief: boolean) { return call('agent_pulse_ack', { p_user_id: owner, p_items: items, p_brief: brief }); },
    async clearMemory(owner: string, expectedRevision: number) { return call('agent_pulse_clear_memory', { p_user_id: owner, p_expected_revision: expectedRevision }); },
    async retain(owner: string, limit = 20) { return call('agent_pulse_retain', { p_user_id: owner, p_limit: limit }); },
    async retainInstallation(limit = 20) { return call('agent_pulse_retain_installation', { p_limit: limit }); },
    async getSettings(owner: string): Promise<ProactiveSettings> {
      const data = await call('agent_pulse_get_settings', { p_user_id: owner });
      if (!data || typeof data!=='object' || Array.isArray(data)) unavailable();
      const s = data as Record<string,unknown>;
      if (!oneOf(s.mode,['off','workspace','workspace_ai']) || !integer(s.settingsRevision,0) || s.policyVersion!=='pulse-v1' ||
        ['checksConsented','aiConsented','aiEligible'].some(key=>typeof s[key]!=='boolean') || !Array.isArray(s.aiProjectIds) ||
        s.aiProjectIds.length>20 || s.aiProjectIds.some(id=>!uuid(id)) || new Set(s.aiProjectIds).size!==s.aiProjectIds.length) unavailable();
      return data as ProactiveSettings;
    },
    async setSettings(owner: string, expectedRevision: number, input: {
      mode: 'off' | 'workspace' | 'workspace_ai'; cadence: 'normal' | 'quiet';
      checksConsent: boolean; aiConsent: boolean; aiProjectIds: string[];
    }) {
      return call('agent_pulse_set_settings', { p_user_id: owner, p_expected_revision: expectedRevision, p_input: input });
    },
    async reserveAi(authority: PulseAuthority, parentId: string, episode: number): Promise<PulseReservation> {
      const data = await call('agent_pulse_reserve_ai', { p_user_id: authority.userId, p_pulse_id: authority.pulseId,
        p_lease_token: authority.leaseToken, p_fence: authority.fence, p_settings_revision: authority.settingsRevision, p_parent_id: parentId, p_episode: episode });
      if (!data || typeof data!=='object' || Array.isArray(data)) unavailable();
      const r = data as PulseReservation;
      if (typeof r.reserved!=='boolean' || typeof r.sendAllowed!=='boolean' || (r.sendAllowed && (!r.reserved || r.recovered!==false)) ||
        (r.recovered!==undefined && typeof r.recovered!=='boolean') || (r.reason!==undefined && !oneOf(r.reason,['SOURCE_CHANGED','AI_MALFORMED','BUDGET']))) unavailable();
      return r;
    },
    async publishAi(authority: PulseAuthority, idea: { category: string; title: string; summary: string }): Promise<PulseIdeaPublication> {
      const data = await call('agent_pulse_publish_ai', { p_user_id: authority.userId, p_pulse_id: authority.pulseId,
        p_lease_token: authority.leaseToken, p_fence: authority.fence, p_settings_revision: authority.settingsRevision, p_idea: idea });
      if (!data || typeof data!=='object' || Array.isArray(data)) unavailable();
      const r = data as PulseIdeaPublication;
      if (typeof r.accepted!=='boolean' || (r.accepted && (!uuid(r.id) || typeof r.recovered!=='boolean')) ||
        (r.reason!==undefined && !oneOf(r.reason,['SOURCE_CHANGED','AI_MALFORMED','BUDGET','CAPACITY']))) unavailable();
      return r;
    },
    async publishDeterministic(authority: PulseAuthority, commitId: string, scan: PulseScan): Promise<PulseCommit> {
      const data = object(await call('agent_pulse_publish_deterministic', { p_user_id: authority.userId, p_pulse_id: authority.pulseId,
        p_lease_token: authority.leaseToken, p_fence: authority.fence, p_settings_revision: authority.settingsRevision,
        p_commit_id: commitId, p_scan: { decisions: scan.decisions, coverage: scan.coverage }, p_baseline: scan.baselinePatches }), ['commitId','createdCount','updatedCount','resolvedCount','partial']);
      if (!uuid(data.commitId) || !integer(data.createdCount,0,3) || !integer(data.updatedCount,0,20) || !integer(data.resolvedCount,0,20) || typeof data.partial!=='boolean') unavailable();
      return data as unknown as PulseCommit;
    },
    async feedback(owner: string, id: string, rowRevision: number, action: 'snooze' | 'dismiss' | 'resolve', snoozeDays: 1 | 3 | 7 | null = null) {
      return call('agent_pulse_feedback', { p_user_id: owner, p_id: id, p_row_revision: rowRevision, p_action: action, p_snooze_days: snoozeDays });
    },
    async claimDispatch(slot: string, nonce: string, issuedAt: string, processingEnabled: boolean): Promise<PulseDispatchBatch> {
      if (typeof processingEnabled!=='boolean') unavailable();
      const d = object(await call('agent_pulse_claim_dispatch', { p_slot: slot, p_nonce: nonce, p_issued_at: issuedAt, p_processing_enabled: processingEnabled }), ['slot','replay','outcome','claimCount','claims']);
      if (!stamp(d.slot) || typeof d.replay!=='boolean' || !oneOf(d.outcome,['claimed','empty','disabled']) || !integer(d.claimCount,0,2) ||
        !Array.isArray(d.claims) || d.claims.length>2 || d.claims.length>(d.claimCount as number)) unavailable();
      for (const value of d.claims) {
        const a = object(value,['userId','pulseId','slot','leaseToken','leaseExpiresAt','fence','settingsRevision','policyVersion']);
        if (!uuid(a.userId) || !uuid(a.pulseId) || !uuid(a.leaseToken) || !stamp(a.leaseExpiresAt) || a.slot!==d.slot || !integer(a.fence,1) || !integer(a.settingsRevision,1) || a.policyVersion!=='pulse-v1') unavailable();
      }
      if (new Set(d.claims.map(a=>a.userId)).size!==d.claims.length) unavailable();
      return d as unknown as PulseDispatchBatch;
    },
    async recover(authority: PulseAuthority): Promise<PulseRecovery | null> {
      return recovery(await call('agent_pulse_recover', { p_user_id: authority.userId, p_pulse_id: authority.pulseId }), authority);
    },
    async finish(authority: PulseAuthority, outcome: Exclude<PulseAiOutcome,'reserved'>): Promise<PulseRecovery | null> {
      return recovery(await call('agent_pulse_finish', { p_user_id: authority.userId, p_pulse_id: authority.pulseId,
        p_lease_token: authority.leaseToken, p_fence: authority.fence, p_ai_outcome: outcome }), authority);
    },
    async readSource(authority: PulseAuthority): Promise<PulseSourceSnapshot> {
      const { data, error } = await client.rpc('agent_pulse_read_source', {
        p_user_id: authority.userId, p_pulse_id: authority.pulseId,
        p_lease_token: authority.leaseToken, p_fence: authority.fence,
      });
      if (error) throw new Error('SOURCE_UNAVAILABLE');
      if (!data || typeof data !== 'object' || !('userId' in data) || data.userId !== authority.userId) throw new Error('AUTHORITY_LOST');
      const source = data as PulseSourceSnapshot;
      if (typeof source.evaluatedAt !== 'string' || !Array.isArray(source.tasks) || !Array.isArray(source.projects) ||
        !Array.isArray(source.milestones) || !Array.isArray(source.blocks) || !source.coverage || !source.taskBlocks || !source.projectActivity ||
        !Array.isArray(source.existing) || source.existing.length>20 || source.existing.some(o=>!o || !uuid(o.id) || !integer(o.episode,1) ||
          typeof o.seen!=='boolean' || !stamp(o.lastCheckedAt))) throw new Error('SOURCE_UNAVAILABLE');
      return source;
    },
  };
}

function recovery(value: unknown, authority: PulseAuthority): PulseRecovery | null {
  if (value===null) return null;
  const r = object(value,['id','status','commitId','reserved','ideaAccepted','aiOutcome','createdCount','updatedCount','resolvedCount']);
  if (r.id!==authority.pulseId || !oneOf(r.status,['running','succeeded','partial','failed','abandoned']) || (r.commitId!==null && !uuid(r.commitId)) ||
    typeof r.reserved!=='boolean' || typeof r.ideaAccepted!=='boolean' || !oneOf(r.aiOutcome,AI_OUTCOMES) ||
    !integer(r.createdCount,0,3) || !integer(r.updatedCount,0,20) || !integer(r.resolvedCount,0,20) || (r.ideaAccepted && !r.reserved)) unavailable();
  return r as unknown as PulseRecovery;
}

function decodeCursor(value: string | null): unknown {
  if (value === null) return null;
  if (value.length>1400 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_INPUT');
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw new Error('INVALID_INPUT'); }
}
function page<T>(value: unknown, parse: (item: unknown) => T): { items: T[]; nextCursor: string | null } {
  const data = object(value, ['items','nextCursor']);
  if (!Array.isArray(data.items) || data.items.length>20) unavailable();
  if (data.nextCursor !== null) {
    const cursor = object(data.nextCursor, parse === journalItem ? ['v','ownerDigest','filter','startedAt','id'] : ['v','ownerDigest','filter','rank','changedAt','id']);
    if (cursor.v!==1 || typeof cursor.ownerDigest!=='string' || !/^[0-9a-f]{64}$/.test(cursor.ownerDigest) || !uuid(cursor.id) ||
      (parse === journalItem ? cursor.filter!=='journal' || !stamp(cursor.startedAt) :
        !oneOf(cursor.filter,['active','snoozed','dismissed','resolved','all']) || !integer(cursor.rank,0,5) || !stamp(cursor.changedAt))) unavailable();
  }
  return { items: data.items.map(parse), nextCursor: data.nextCursor === null ? null : Buffer.from(JSON.stringify(data.nextCursor)).toString('base64url') };
}

function unavailable(): never { throw new Error('SOURCE_UNAVAILABLE'); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==keys.length || keys.some(key=>!Object.hasOwn(value,key))) unavailable();
  return value as Record<string, unknown>;
}
function oneOf(value: unknown, values: readonly string[]): boolean { return typeof value==='string' && values.includes(value); }
function uuid(value: unknown): boolean { return typeof value==='string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value); }
function integer(value: unknown, min: number, max=Number.MAX_SAFE_INTEGER): boolean { return typeof value==='number' && Number.isSafeInteger(value) && value>=min && value<=max; }
function text(value: unknown, max: number): boolean { return typeof value==='string' && Array.from(value).length<=max; }
function stamp(value: unknown, nullable=false): boolean { return nullable && value===null || typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
function inboxItem(value: unknown): AgentInboxItem {
  const o = object(value, ['id','kind','title','summary','explanation','state','target','rowRevision','contentRevision','seen','stale','unavailable','watching','reasonCodes','firstNoticedAt','lastCheckedAt','snoozeUntil','revisitAt']);
  const target = object(o.target,['type','id']);
  if (!uuid(o.id) || !oneOf(o.kind,['signal','idea']) || !text(o.title,120) || !text(o.summary,400) || !text(o.explanation,240) ||
    !oneOf(o.state,['active','snoozed','dismissed','resolved']) || !oneOf(target.type,['task','milestone','project','workspace_day']) || !uuid(target.id) ||
    !integer(o.rowRevision,1) || !integer(o.contentRevision,1) || ['seen','stale','unavailable','watching'].some(key=>typeof o[key]!=='boolean') ||
    !Array.isArray(o.reasonCodes) || o.reasonCodes.length>7 || o.reasonCodes.some(reason=>!oneOf(reason,['DEADLINE_OVERDUE','DEADLINE_TODAY','DEADLINE_SOON','IMPORTANT_NO_WORK','PROJECT_QUIET','TOMORROW_DEADLINES','TOMORROW_OCCUPANCY'])) ||
    !stamp(o.firstNoticedAt) || !stamp(o.lastCheckedAt) || !stamp(o.snoozeUntil,true) || !stamp(o.revisitAt,true)) unavailable();
  return o as unknown as AgentInboxItem;
}
function journalItem(value: unknown): AgentPulseJournalItem {
  const o = object(value,['id','status','startedAt','completedAt','summary','createdCount','updatedCount','resolvedCount','aiOutcome','errorCode','coverage','checkedCounts']);
  const coverage = object(o.coverage,['complete','unknown']), counts = object(o.checkedCounts,['projects','tasks','milestones','blocks']);
  if (!uuid(o.id) || !oneOf(o.status,['running','succeeded','partial','failed','abandoned']) || !stamp(o.startedAt) || !stamp(o.completedAt,true) ||
    !text(o.summary,400) || !integer(o.createdCount,0,3) || !integer(o.updatedCount,0,20) || !integer(o.resolvedCount,0,20) ||
    !oneOf(o.aiOutcome,['none','reserved','accepted','unavailable','malformed','timeout','unknown','skipped_budget','skipped_time_budget','skipped_scope']) ||
    o.errorCode!==null && !oneOf(o.errorCode,['UNKNOWN_COVERAGE','SOURCE_CHANGED','SOURCE_UNAVAILABLE','AUTHORITY_LOST','CAPACITY','BUDGET','AI_UNAVAILABLE','AI_MALFORMED','AI_TIMEOUT']) ||
    typeof coverage.complete!=='boolean' || !integer(coverage.unknown,0,1000) || Object.values(counts).some(count=>!integer(count,0,1000))) unavailable();
  return o as unknown as AgentPulseJournalItem;
}
