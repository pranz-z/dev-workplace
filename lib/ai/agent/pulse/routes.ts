import 'server-only';
import { AiError } from '@/lib/ai/errors';
import { requireAuthenticatedAiUser } from '@/lib/ai/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { isValidTimeZone } from '@/data/accountabilityReports';
import { isPulseProjectId, isPulseRevision, parsePulseOwnerJson, parsePulseSettingsInput, parsePulseMemoryClear, PULSE_CONSENT_VERSIONS,
  parseInboxQuery, parsePulseJournalQuery, parseInboxFeedback, parseInboxAck } from '@/data/agentInbox';
import type { PulseSettingsDto, PulseSettingsResponse, InboxItem, InboxPage, InboxDetail, InboxReviewContext, PulseBriefDto, PulseJournalPage, AgentPulseJournalItem } from '@/data/agentInbox';

const headers = { 'Cache-Control': 'no-store' };
const unavailable: () => never = () => { throw new AiError('UPSTREAM_ERROR'); };
class StateChanged extends Error {}
export {ownerBoundary as pulseOwnerBoundary,body as pulseOwnerBody,failure as pulseOwnerFailure};
type OwnerClient = NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>;
type SettingsRpc = 'agent_pulse_get_settings' | 'agent_pulse_set_settings' | 'agent_pulse_clear_memory' |
  'agent_pulse_list_inbox' | 'agent_pulse_get_observation' | 'agent_pulse_get_brief' | 'agent_pulse_list_journal' | 'agent_pulse_feedback' | 'agent_pulse_ack';

/** Fixed RPC names only. SQL owns ownership, revision/fencing, rate limits and transaction atomicity. */
async function ownerRpc(name: SettingsRpc, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await getSupabaseAdminClient().rpc(name,args);
  if (error) {
    if (error.code === '40001') throw new StateChanged();
    if (error.code === '22023') throw new AiError('INVALID_INPUT');
    if (error.code === 'P0001' && error.message === 'RATE_LIMITED') throw new AiError('RATE_LIMITED');
    unavailable();
  }
  return data;
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value,key))) unavailable();
  return value as Record<string,unknown>;
}
function stamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value)));
}
async function ownerView(client: OwnerClient, owner: string) {
  const [{data:profile,error:profileError},{data:projects,error:projectsError}] = await Promise.all([
    client.from('profiles').select('time_zone').eq('id',owner).maybeSingle(),
    client.from('projects').select('id,title').eq('user_id',owner).order('id').limit(21),
  ]);
  if (profileError || projectsError || !Array.isArray(projects) || projects.length > 21) unavailable();
  const projectChoices = projects.slice(0,20).map(project => {
    if (!isPulseProjectId(project.id) || typeof project.title !== 'string') unavailable();
    return {id:project.id as string,title:Array.from(project.title as string).slice(0,180).join('')};
  });
  const zone: unknown = profile?.time_zone;
  const timezoneReadiness: PulseSettingsDto['timezoneReadiness'] = zone === null || zone === undefined || zone === '' ? 'missing' : typeof zone === 'string' && isValidTimeZone(zone) ? 'configured' : 'invalid';
  return {projectChoices,projectChoicesTruncated:projects.length > 20,timezoneReadiness};
}
function projectSettings(value: unknown, view: Awaited<ReturnType<typeof ownerView>>): PulseSettingsResponse {
  const row = record(value,['mode','cadence','settingsRevision','policyVersion','checksConsented','aiConsented','aiProjectIds','aiEligible','nextDueAt','lastSuccessAt','lastDeterministicAt','coverage','usage']);
  const coverage = record(row.coverage,['complete','unknown']), usage = record(row.usage,['ownerPulses','ownerRequests','installationRequests','ownerIdeas']);
  if (typeof row.mode !== 'string' || !['off','workspace','workspace_ai'].includes(row.mode) ||
    typeof row.cadence !== 'string' || !['normal','quiet'].includes(row.cadence) ||
    !isPulseRevision(row.settingsRevision) || row.policyVersion !== 'pulse-v1' ||
    ['checksConsented','aiConsented','aiEligible'].some(key => typeof row[key] !== 'boolean') ||
    !Array.isArray(row.aiProjectIds) || row.aiProjectIds.length > 20 || row.aiProjectIds.some(id => !isPulseProjectId(id)) || new Set(row.aiProjectIds).size !== row.aiProjectIds.length ||
    !stamp(row.nextDueAt) || !stamp(row.lastSuccessAt) || !stamp(row.lastDeterministicAt) ||
    typeof coverage.complete !== 'boolean' || !isPulseRevision(coverage.unknown) || Object.values(usage).some(count => !isPulseRevision(count))) unavailable();
  const settings: PulseSettingsDto = {
    mode:row.mode as PulseSettingsDto['mode'],cadence:row.cadence as PulseSettingsDto['cadence'],settingsRevision:row.settingsRevision as number,policyVersion:'pulse-v1',
    checksConsented:row.checksConsented as boolean,aiConsented:row.aiConsented as boolean,aiProjectIds:row.aiProjectIds as string[],aiEligible:row.aiEligible as boolean,
    timezoneReadiness:view.timezoneReadiness,
    // This is owner readiness only; it makes no claim that the installation scheduler is enabled.
    checksEnabled:row.mode !== 'off' && row.checksConsented === true && view.timezoneReadiness === 'configured',
    nextDueAt:row.nextDueAt as string | null,lastSuccessAt:row.lastSuccessAt as string | null,lastDeterministicAt:row.lastDeterministicAt as string | null,
    coverage:{complete:coverage.complete as boolean,unknown:coverage.unknown as number},
    usage:{ownerPulses:usage.ownerPulses as number,ownerRequests:usage.ownerRequests as number,installationRequests:usage.installationRequests as number,ownerIdeas:usage.ownerIdeas as number},
  };
  return {settings,disclosures:PULSE_CONSENT_VERSIONS,projectChoices:view.projectChoices,projectChoicesTruncated:view.projectChoicesTruncated};
}
async function ownerBoundary(request: Request, methods: string[], allowQuery = false) {
  const client = await getSupabaseServerClient(), owner = (await requireAuthenticatedAiUser(client)).id;
  const url = new URL(request.url), origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== url.origin)) throw new AiError('FORBIDDEN');
  if (!methods.includes(request.method) || (!allowQuery && url.search) || url.hash || (request.method === 'GET' && request.body !== null)) throw new AiError('INVALID_INPUT');
  return {client:client!,owner};
}
/** Same bounded stream pattern as manual APIs, with Task19's independent 4KB contract. */
async function body(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AiError('INVALID_INPUT');
  const reader = request.body?.getReader();
  if (!reader) throw new AiError('INVALID_INPUT');
  const signal = AbortSignal.any([request.signal,AbortSignal.timeout(15_000)]);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort',cancel,{once:true});
  try {
    const bytes = new Uint8Array(4096); let total = 0;
    for (;;) {
      signal.throwIfAborted(); const {done,value} = await reader.read(); if (done) break;
      if (value.byteLength > bytes.length-total) { cancel(); throw new AiError('INVALID_INPUT'); }
      bytes.set(value,total); total += value.byteLength;
    }
    signal.throwIfAborted();
    return parsePulseOwnerJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,total)));
  } catch { throw new AiError('INVALID_INPUT'); }
  finally { signal.removeEventListener('abort',cancel); reader.releaseLock(); }
}
function failure(error: unknown): Response {
  if (error instanceof StateChanged) return Response.json({error:{code:'STATE_CHANGED',message:'Agent settings changed. Reload and try again.'}},{status:409,headers});
  const safe = error instanceof AiError ? error : new AiError('UPSTREAM_ERROR');
  return Response.json({error:{code:safe.code,message:safe.message}},{status:safe.status,headers});
}
export async function handlePulseSettings(request: Request): Promise<Response> {
  try {
    const {client,owner} = await ownerBoundary(request,['GET','POST']);
    if (request.method === 'GET') {
      const view = await ownerView(client,owner);
      return Response.json(projectSettings(await ownerRpc('agent_pulse_get_settings',{p_user_id:owner}),view),{headers});
    }
    let input; try { input = parsePulseSettingsInput(await body(request)); } catch { throw new AiError('INVALID_INPUT'); }
    const view = await ownerView(client,owner);
    const result = await ownerRpc('agent_pulse_set_settings',{p_user_id:owner,p_expected_revision:input.expectedRevision,p_input:{
      mode:input.mode,cadence:input.cadence,aiProjectIds:input.aiProjectIds,
      checksConsent:input.checksConsentVersion === PULSE_CONSENT_VERSIONS.checksConsentVersion,
      aiConsent:input.aiConsentVersion === PULSE_CONSENT_VERSIONS.aiConsentVersion,
    }});
    return Response.json(projectSettings(result,view),{headers});
  } catch (error) { return failure(error); }
}
export async function handlePulseMemoryClear(request: Request): Promise<Response> {
  try {
    const {owner} = await ownerBoundary(request,['POST']);
    let input; try { input = parsePulseMemoryClear(await body(request)); } catch { throw new AiError('INVALID_INPUT'); }
    const result = record(await ownerRpc('agent_pulse_clear_memory',{p_user_id:owner,p_expected_revision:input.expectedRevision}),['cleared','settingsRevision']);
    if (!isPulseRevision(result.cleared) || !isPulseRevision(result.settingsRevision) || result.settingsRevision !== input.expectedRevision+1) unavailable();
    return Response.json({cleared:true,settingsRevision:result.settingsRevision},{headers});
  } catch (error) { return failure(error); }
}

function oneOf(value: unknown, values: readonly string[]): boolean { return typeof value === 'string' && values.includes(value); }
function boundedInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return isPulseRevision(value) && value >= min && value <= max;
}
function safeText(value: unknown, max: number): boolean {
  return typeof value === 'string' && Array.from(value).length <= max && !/<\/?[a-z!][^>]*>/i.test(value);
}
/** Match SQL's UTC projection, including microseconds, without accepting JS calendar normalization. */
function dtoStamp(value: unknown, nullable = false): boolean {
  if (value === null) return nullable;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,19) === value.slice(0,19);
}
function projectInbox(value: unknown): InboxItem {
  const row = record(value,['id','kind','title','summary','explanation','state','target','rowRevision','contentRevision','seen','stale','unavailable','watching','reasonCodes','firstNoticedAt','lastCheckedAt','snoozeUntil','revisitAt']);
  const target = record(row.target,['type','id']);
  if (!isPulseProjectId(row.id) || !oneOf(row.kind,['signal','idea']) || !safeText(row.title,120) || !safeText(row.summary,400) || !safeText(row.explanation,240) ||
    !oneOf(row.state,['active','snoozed','dismissed','resolved']) || !oneOf(target.type,['task','milestone','project','workspace_day']) || !isPulseProjectId(target.id) ||
    !boundedInteger(row.rowRevision,1) || !boundedInteger(row.contentRevision,1) || ['seen','stale','unavailable','watching'].some(key => typeof row[key] !== 'boolean') ||
    !Array.isArray(row.reasonCodes) || row.reasonCodes.length > 7 || row.reasonCodes.some(reason => !oneOf(reason,['DEADLINE_OVERDUE','DEADLINE_TODAY','DEADLINE_SOON','IMPORTANT_NO_WORK','PROJECT_QUIET','TOMORROW_DEADLINES','TOMORROW_OCCUPANCY'])) ||
    !dtoStamp(row.firstNoticedAt) || !dtoStamp(row.lastCheckedAt) || !dtoStamp(row.snoozeUntil,true) || !dtoStamp(row.revisitAt,true)) unavailable();
  return {
    id:row.id as string,kind:row.kind as InboxItem['kind'],title:row.title as string,summary:row.summary as string,explanation:row.explanation as string,
    state:row.state as InboxItem['state'],target:{type:target.type as InboxItem['target']['type'],id:target.id as string},
    rowRevision:row.rowRevision as number,contentRevision:row.contentRevision as number,seen:row.seen as boolean,stale:row.stale as boolean,
    unavailable:row.unavailable as boolean,watching:row.watching as boolean,reasonCodes:[...(row.reasonCodes as InboxItem['reasonCodes'])],
    firstNoticedAt:row.firstNoticedAt as string,lastCheckedAt:row.lastCheckedAt as string,snoozeUntil:row.snoozeUntil as string | null,revisitAt:row.revisitAt as string | null,
  };
}
function projectReviewContext(value: unknown, item: InboxItem): InboxReviewContext | null {
  if (value === null) return null;
  if (item.stale || item.unavailable) unavailable();
  const row = record(value,['targetLabel','deterministicSummary','deterministicExplanation','advisoryIdea']);
  if (!safeText(row.targetLabel,120) || !(row.targetLabel as string).trim() || !safeText(row.deterministicSummary,400) || !(row.deterministicSummary as string).trim() ||
    (row.deterministicExplanation !== null && !safeText(row.deterministicExplanation,240))) unavailable();
  let advisoryIdea: InboxReviewContext['advisoryIdea'] = null;
  if (row.advisoryIdea !== null) {
    const advisory = record(row.advisoryIdea,['title','summary']);
    if (item.kind !== 'idea' || !safeText(advisory.title,120) || !safeText(advisory.summary,400) || advisory.title !== item.title || advisory.summary !== item.summary) unavailable();
    advisoryIdea = {title:advisory.title as string,summary:advisory.summary as string};
  } else if (item.kind === 'idea') unavailable();
  return {targetLabel:row.targetLabel as string,deterministicSummary:row.deterministicSummary as string,
    deterministicExplanation:row.deterministicExplanation as string | null,advisoryIdea};
}
function projectJournal(value: unknown): AgentPulseJournalItem {
  const row = record(value,['id','status','startedAt','completedAt','summary','createdCount','updatedCount','resolvedCount','aiOutcome','errorCode','coverage','checkedCounts']);
  const coverage = record(row.coverage,['complete','unknown']), counts = record(row.checkedCounts,['projects','tasks','milestones','blocks']);
  if (!isPulseProjectId(row.id) || !oneOf(row.status,['running','succeeded','partial','failed','abandoned']) || !dtoStamp(row.startedAt) || !dtoStamp(row.completedAt,true) ||
    !safeText(row.summary,400) || !boundedInteger(row.createdCount,0,3) || !boundedInteger(row.updatedCount,0,20) || !boundedInteger(row.resolvedCount,0,20) ||
    !oneOf(row.aiOutcome,['none','reserved','accepted','unavailable','malformed','timeout','unknown','skipped_budget','skipped_time_budget','skipped_scope']) ||
    (row.errorCode !== null && !oneOf(row.errorCode,['UNKNOWN_COVERAGE','SOURCE_CHANGED','SOURCE_UNAVAILABLE','AUTHORITY_LOST','CAPACITY','BUDGET','AI_UNAVAILABLE','AI_MALFORMED','AI_TIMEOUT'])) ||
    typeof coverage.complete !== 'boolean' || !boundedInteger(coverage.unknown,0,1000) || Object.values(counts).some(count => !boundedInteger(count,0,1000))) unavailable();
  return {id:row.id as string,status:row.status as AgentPulseJournalItem['status'],startedAt:row.startedAt as string,completedAt:row.completedAt as string | null,
    summary:row.summary as string,createdCount:row.createdCount as number,updatedCount:row.updatedCount as number,resolvedCount:row.resolvedCount as number,
    aiOutcome:row.aiOutcome as AgentPulseJournalItem['aiOutcome'],errorCode:row.errorCode as AgentPulseJournalItem['errorCode'],
    coverage:{complete:coverage.complete as boolean,unknown:coverage.unknown as number},
    checkedCounts:{projects:counts.projects as number,tasks:counts.tasks as number,milestones:counts.milestones as number,blocks:counts.blocks as number}};
}
/** Structure is checked here; the fixed read RPC verifies the authenticated owner digest. */
function cursorShape(value: unknown, filter: string): void {
  const journal = filter === 'journal';
  const row = record(value,journal ? ['v','ownerDigest','filter','startedAt','id'] : ['v','ownerDigest','filter','rank','changedAt','id']);
  if (row.v !== 1 || typeof row.ownerDigest !== 'string' || !/^[0-9a-f]{64}$/.test(row.ownerDigest) || row.filter !== filter || !isPulseProjectId(row.id) ||
    (journal ? !dtoStamp(row.startedAt) : !boundedInteger(row.rank,0,5) || !dtoStamp(row.changedAt)) || Buffer.byteLength(JSON.stringify(row)) > 1024) unavailable();
}
function readCursor(value: string | null, filter: string): unknown {
  if (value === null) return null;
  try {
    if (value.length > 1400 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const bytes = Buffer.from(value,'base64url');
    if (bytes.length > 1024 || bytes.toString('base64url') !== value) throw new Error();
    const decoded = parsePulseOwnerJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
    cursorShape(decoded,filter); return decoded;
  } catch { throw new AiError('INVALID_INPUT'); }
}
function projectPage<T>(value: unknown, filter: string, parse: (value: unknown) => T, limit: number): {items:T[];nextCursor:string | null} {
  const row = record(value,['items','nextCursor']);
  if (!Array.isArray(row.items) || row.items.length > limit) unavailable();
  if (row.nextCursor !== null) cursorShape(row.nextCursor,filter);
  return {items:(row.items as unknown[]).map(parse),nextCursor:row.nextCursor === null ? null : Buffer.from(JSON.stringify(row.nextCursor)).toString('base64url')};
}
export async function handleInbox(request: Request): Promise<Response> {
  try {
    const {owner} = await ownerBoundary(request,['GET'],true);
    let input; try { input = parseInboxQuery(new URL(request.url).searchParams); } catch { throw new AiError('INVALID_INPUT'); }
    if ('id' in input) {
      const result = await ownerRpc('agent_pulse_get_observation',{p_user_id:owner,p_id:input.id});
      let detail: InboxDetail = {item:null,reviewContext:null};
      if (result !== null) {
        if (!result || typeof result !== 'object' || Array.isArray(result) || !Object.hasOwn(result,'reviewContext')) unavailable();
        const {reviewContext,...projection} = result as Record<string,unknown>;
        const item = projectInbox(projection);
        detail = {item,reviewContext:projectReviewContext(reviewContext,item)};
      }
      return Response.json(detail,{headers});
    }
    const cursor = readCursor(input.cursor,input.state);
    const page: InboxPage = projectPage(await ownerRpc('agent_pulse_list_inbox',{p_user_id:owner,p_state:input.state,p_cursor:cursor,p_limit:input.limit}),input.state,projectInbox,input.limit);
    return Response.json(page,{headers});
  } catch (error) { return failure(error); }
}
export async function handleInboxFeedback(request: Request): Promise<Response> {
  try {
    const {owner} = await ownerBoundary(request,['POST']);
    let input; try { input = parseInboxFeedback(await body(request)); } catch { throw new AiError('INVALID_INPUT'); }
    const row = record(await ownerRpc('agent_pulse_feedback',{p_user_id:owner,p_id:input.id,p_row_revision:input.expectedRevision,p_action:input.action,p_snooze_days:input.snoozeDays ?? null}),['id','state','rowRevision','contentRevision']);
    const state = input.action === 'snooze' ? 'snoozed' : input.action === 'dismiss' ? 'dismissed' : 'resolved';
    if (row.id !== input.id || row.state !== state || !boundedInteger(row.rowRevision,1) || row.rowRevision !== input.expectedRevision+1 || !boundedInteger(row.contentRevision,1)) unavailable();
    return Response.json({id:row.id,state:row.state,rowRevision:row.rowRevision,contentRevision:row.contentRevision},{headers});
  } catch (error) {
    if (error instanceof StateChanged) return Response.json({error:{code:'STATE_CHANGED',message:'Agent observation changed. Reload and try again.'}},{status:409,headers});
    return failure(error);
  }
}
export async function handleInboxAck(request: Request): Promise<Response> {
  try {
    const {owner} = await ownerBoundary(request,['POST']);
    let input; try { input = parseInboxAck(await body(request)); } catch { throw new AiError('INVALID_INPUT'); }
    const row = record(await ownerRpc('agent_pulse_ack',{p_user_id:owner,p_items:input.items,p_brief:input.brief}),['acknowledged']);
    if (!boundedInteger(row.acknowledged,0,input.items.length)) unavailable();
    return Response.json({acknowledged:row.acknowledged},{headers});
  } catch (error) { return failure(error); }
}
export async function handlePulseBrief(request: Request): Promise<Response> {
  try {
    const {owner} = await ownerBoundary(request,['GET']);
    const row = record(await ownerRpc('agent_pulse_get_brief',{p_user_id:owner}),['items','lastCheckedAt']);
    if (!Array.isArray(row.items) || row.items.length > 5 || !dtoStamp(row.lastCheckedAt,true)) unavailable();
    const brief: PulseBriefDto = {items:(row.items as unknown[]).map(projectInbox),lastCheckedAt:row.lastCheckedAt as string | null};
    return Response.json(brief,{headers});
  } catch (error) { return failure(error); }
}
export async function handlePulseJournal(request: Request): Promise<Response> {
  try {
    const {owner} = await ownerBoundary(request,['GET'],true);
    let input; try { input = parsePulseJournalQuery(new URL(request.url).searchParams); } catch { throw new AiError('INVALID_INPUT'); }
    const cursor = readCursor(input.cursor,'journal');
    const page: PulseJournalPage = projectPage(await ownerRpc('agent_pulse_list_journal',{p_user_id:owner,p_cursor:cursor,p_limit:input.limit}),'journal',projectJournal,input.limit);
    return Response.json(page,{headers});
  } catch (error) { return failure(error); }
}
