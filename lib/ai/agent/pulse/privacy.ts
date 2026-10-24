import { boundText, PULSE_POLICY, SIGNAL_FAMILIES, validateReasonCodes } from './policy';
import { rankDecisions } from './scanner';
import { evaluateImportantTasks, evaluateQuietProjects, evaluateTomorrow } from './signals';
import { isValidCalendarDate, taskCalendarDate } from '@/data/workspaceCalendar';
import type { ConditionDecision, IdeaCategory, PulseMode, PulseReason, PulseSourceSnapshot, PulseTarget } from './types';

/** Current-version consent booleans come from the canonical server settings RPC. */
export interface ProactiveSettings {
  mode: PulseMode; checksConsented: boolean; aiConsented: boolean; aiEligible: boolean;
  aiProjectIds: readonly string[]; settingsRevision: number; policyVersion: string;
  /** If enriched with a version, it must agree with the current server disclosure. */
  aiConsentVersion?: string | null;
}
/** The caller joins committed parent metadata; a scanner decision alone is not authority. */
export interface ProactiveCandidate extends ConditionDecision {
  parentId: string; parentEpisode: number; state: 'active' | 'snoozed' | 'dismissed' | 'resolved';
  seen: boolean; lastCheckedAt: string;
}
export interface ProactiveContext {
  contents: string; aliases: Readonly<Record<string, PulseTarget>>; primaryAlias: string;
  allowedCategories: readonly IdeaCategory[]; allowedFacts: ReadonlySet<string>;
  parentId: string; parentEpisode: number; sourceToken: string; evidenceValidUntil: string;
}
export type ProactiveContextResult = { ok: true; context: ProactiveContext } |
  { ok: false; reason: 'CONSENT_REQUIRED' | 'INVALID_SOURCE' | 'INVALID_SCOPE' | 'SCOPE_EMPTY' | 'NO_ELIGIBLE_SIGNAL' | 'CONTEXT_TOO_LARGE' };
type Facts = Record<string, string | number | boolean>;
interface Signal {
  alias: string; type: PulseTarget['type']; title: string; reasonCodes: PulseReason[]; facts: Facts;
  projectAlias?: string; projectLabel?: string; status?: string; priority?: string; date?: string;
  scope?: 'selected_projects';
}
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const SECRET = /bearer\s+\S+|authorization\s*:\s*basic\s+\S+|-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|(?:api[ _-]?key|access[ _-]?token|token|secret|password|service[ _-]?role[ _-]?key)\s*[:=]\s*\S+|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|:\/\/[^\s/:@]+:[^\s/@]+@|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|\b[0-9a-f]{64}\b/i;
const STATUSES = new Set(['Backlog','Planned','Todo','In Progress','Review','Testing','Blocked','Completed',
  'pending','in_progress','completed','Planning','Research','In Development','Deployment','On Hold','Cancelled','Maintenance']);

function stamp(value: unknown): number | null {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !isValidCalendarDate(value.slice(0,10))) return null;
  const time=Date.parse(value);return Number.isFinite(time)?time:null;
}
function title(value: unknown): string | null {
  if (typeof value!=='string' || !value.trim()) return null;
  // Inspect the full original string before code-point truncation, including normalized obfuscation.
  const inspection=value.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g,'');
  if (SECRET.test(inspection) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return null;
  return boundText(value.trim(),PULSE_POLICY.limits.title);
}
function categories(family: ConditionDecision['family'], target: PulseTarget, reasons: readonly PulseReason[]): IdeaCategory[] {
  const deadline=reasons.some(reason=>['DEADLINE_OVERDUE','DEADLINE_TODAY','DEADLINE_SOON'].includes(reason));
  if ((family==='deadline' && ['task','project','milestone'].includes(target.type)) || (family==='important_work' && target.type==='task')) {
    if (reasons.some(reason=>!['DEADLINE_OVERDUE','DEADLINE_TODAY','DEADLINE_SOON','IMPORTANT_NO_WORK'].includes(reason)) ||
      (reasons.includes('IMPORTANT_NO_WORK') && target.type!=='task') || (family==='important_work' && deadline)) return [];
    return [...(deadline?['review_deadline' as const]:[]),...(reasons.includes('IMPORTANT_NO_WORK')?['consider_scheduling' as const]:[])];
  }
  if (family==='quiet_project' && target.type==='project' && reasons.length===1 && reasons[0]==='PROJECT_QUIET') return ['review_quiet_project'];
  if (family==='tomorrow' && target.type==='workspace_day' && reasons.length>0 && reasons.every(reason=>['TOMORROW_DEADLINES','TOMORROW_OCCUPANCY'].includes(reason))) return ['review_tomorrow'];
  return [];
}

/** Task16 must measure its actual fixed instructions/schema and final wire body before sending. */
export function proactiveInputBudget(contents: string, instructions: string, schema: unknown): { bytes: number; allowed: boolean } {
  if(typeof contents!=='string' || typeof instructions!=='string' || !schema || typeof schema!=='object' || Array.isArray(schema)) return {bytes:Infinity,allowed:false};
  try {
    const bytes=Buffer.byteLength(JSON.stringify({instructions,schema,contents}),'utf8');
    return {bytes,allowed:bytes<=12*1024};
  } catch {return {bytes:Infinity,allowed:false};}
}
/** Selection predicate only: response parsing/length/factual validation belongs to Task16. */
export function isProactiveSelection(context: ProactiveContext, alias: string, category: string): boolean {
  return alias===context.primaryAlias && context.allowedCategories.includes(category as IdeaCategory);
}

function scopedTomorrow(source: PulseSourceSnapshot, scope: ReadonlySet<string>): ConditionDecision | null {
  if (['projects','tasks','milestones','blocks'].some(key=>source.coverage[key as keyof PulseSourceSnapshot['coverage']]?.complete!==true)) return null;
  const projects=source.projects.filter(p=>p.userId===source.userId && scope.has(p.id));
  const tasks=source.tasks.filter(t=>t.userId===source.userId && scope.has(t.projectId));
  const milestones=source.milestones.filter(m=>m.userId===source.userId && scope.has(m.projectId));
  const blocks=source.blocks.filter(b=>b.userId===source.userId && b.projectId!==null && scope.has(b.projectId));
  if (blocks.some(b=>b.taskId!==null && !tasks.some(t=>t.id===b.taskId && t.projectId===b.projectId))) return null;
  // A new explicit snapshot, never a broad object spread carrying source extras.
  const scoped: PulseSourceSnapshot={userId:source.userId,evaluatedAt:source.evaluatedAt,timeZone:source.timeZone,
    settingsRevision:source.settingsRevision,policyVersion:source.policyVersion,projects,tasks,milestones,blocks,
    preferences:source.preferences,coverage:source.coverage,taskBlocks:{},projectActivity:{},targetChecks:{},baseline:{},existing:[],tomorrowSourceToken:source.tomorrowSourceToken};
  const decision=evaluateTomorrow(scoped)[0];
  return decision.truth==='true' && decision.complete?decision:null;
}

export function buildProactiveContext(source: PulseSourceSnapshot, candidates: readonly ProactiveCandidate[], settings: ProactiveSettings): ProactiveContextResult {
  if (settings.mode!=='workspace_ai' || settings.checksConsented!==true || settings.aiConsented!==true || settings.aiEligible!==true ||
    (settings.aiConsentVersion!==undefined && settings.aiConsentVersion!=='ai-v1') || settings.policyVersion!==PULSE_POLICY.version) return {ok:false,reason:'CONSENT_REQUIRED'};
  const now=stamp(source.evaluatedAt);
  if (!UUID.test(source.userId) || now===null || source.policyVersion!==settings.policyVersion || source.settingsRevision!==settings.settingsRevision) return {ok:false,reason:'INVALID_SOURCE'};
  if (!Array.isArray(settings.aiProjectIds) || settings.aiProjectIds.length>20 || new Set(settings.aiProjectIds).size!==settings.aiProjectIds.length || settings.aiProjectIds.some(id=>!UUID.test(id))) return {ok:false,reason:'INVALID_SCOPE'};
  if (settings.aiProjectIds.length===0) return {ok:false,reason:'SCOPE_EMPTY'};
  const scope=new Set(settings.aiProjectIds.filter(id=>source.projects.filter(p=>p.id===id).length===1 && source.projects.some(p=>p.id===id && p.userId===source.userId)));
  if (scope.size===0) return {ok:false,reason:'SCOPE_EMPTY'};
  const aliases: Record<string,PulseTarget>={}, assigned=new Map<string,string>(), counters={task:0,project:0,milestone:0,workspace_day:0};
  const alias=(target: PulseTarget) => {
    const key=target.type+':'+target.id,prior=assigned.get(key);if(prior)return prior;
    const value=({task:'T',project:'P',milestone:'M',workspace_day:'W'}[target.type])+(++counters[target.type]);
    assigned.set(key,value);aliases[value]={type:target.type,id:target.id};return value;
  };
  const chosen: Array<{signal:Signal;candidate:ProactiveCandidate;allowed:IdeaCategory[]}>=[],targets=new Set<string>();
  for (const d of rankDecisions(candidates) as ProactiveCandidate[]) {
    if (chosen.length===3) break;
    const checked=stamp(d.lastCheckedAt),until=stamp(d.evidenceValidUntil);
    if (!SIGNAL_FAMILIES.includes(d.family) || d.truth!=='true' || d.complete!==true || d.state!=='active' || d.seen!==false ||
      !UUID.test(d.parentId) || !Number.isSafeInteger(d.parentEpisode) || d.parentEpisode<1 || checked===null || checked>now || checked<=now-86400000 || until===null || until<=now ||
      typeof d.sourceToken!=='string' || !HASH.test(d.sourceToken) || !UUID.test(d.target.id) || !Number.isInteger(d.rank) || d.rank<0 || d.rank>5 || targets.has(d.target.type+':'+d.target.id)) continue;
    let reasons: PulseReason[];
    try {reasons=validateReasonCodes(d.reasonCodes);} catch {continue;}
    let allowed=categories(d.family,d.target,reasons);if(!allowed.length)continue;
    if(d.family!=='quiet_project') {
      if(!source.timeZone)continue;
      try {new Intl.DateTimeFormat('en-CA',{timeZone:source.timeZone});} catch {continue;}
    }
    const facts:Facts={};let name:string|null=null,projectLabel:string|null=null,projectId:string|undefined,status:string|undefined,priority:string|undefined,date:string|undefined;
    if (d.target.type==='workspace_day') {
      if (d.target.id!==source.userId || d.sourceToken!==source.tomorrowSourceToken)continue;
      const scoped=scopedTomorrow(source,scope);if(!scoped)continue;
      reasons=scoped.reasonCodes;allowed=categories(d.family,d.target,reasons);name='Tomorrow workload review';date=scoped.evidence.date??undefined;
      for(const key of ['taskCount','milestoneCount','projectCount','occupancyPercent'] as const){const v=scoped.evidence[key];if(v!==null && v!==undefined)facts[key]=v;}
      if(scoped.evidence.checkedStart && scoped.evidence.checkedEnd){facts.windowStart=scoped.evidence.checkedStart;facts.windowEnd=scoped.evidence.checkedEnd;}
    } else {
      const rows=d.target.type==='task'?source.tasks:d.target.type==='milestone'?source.milestones:source.projects;
      const matches=rows.filter(row=>row.id===d.target.id && row.userId===source.userId);if(matches.length!==1)continue;
      const entity=matches[0];projectId='projectId' in entity?entity.projectId:entity.id;
      if(!scope.has(projectId))continue;
      const project=source.projects.find(p=>p.id===projectId && p.userId===source.userId);if(!project)continue;
      name=title(entity.title);projectLabel=d.target.type==='project'?null:title(project.title);
      if(!name || (d.target.type!=='project' && !projectLabel) || !STATUSES.has(entity.status) || ['Completed','completed','Cancelled','On Hold'].includes(entity.status) || ['Completed','Cancelled','On Hold'].includes(project.status))continue;
      status=entity.status;
      if('priority' in entity && entity.priority!=null){if(!['Critical','High','Medium','Low'].includes(entity.priority))continue;priority=entity.priority;}
      const canonical=d.family==='quiet_project'?source.projectActivity[entity.id]?.sourceToken:entity.sourceToken;
      if(canonical!==d.sourceToken)continue;
      if(d.family==='quiet_project') {
        const verified=evaluateQuietProjects(source).find(item=>item.target.id===entity.id);
        if(!verified?.complete || verified.truth!=='true' || !verified.evidence.lastActivityAt || !verified.evidence.thresholdDays)continue;
        facts.lastActivityAt=verified.evidence.lastActivityAt;facts.thresholdDays=verified.evidence.thresholdDays;
      } else {
        const raw='dueDate' in entity?entity.dueDate:'targetDate' in entity?entity.targetDate:undefined;
        if(typeof raw!=='string' || !source.timeZone)continue;
        date=d.target.type==='task'?taskCalendarDate(raw,source.timeZone)??undefined:raw;
        if(!date || !isValidCalendarDate(date))continue;
        if(reasons.includes('IMPORTANT_NO_WORK')) {
          const relationship=source.taskBlocks[entity.id];
          if(relationship?.coverage.complete!==true || relationship.sourceToken!==d.sourceToken)continue;
          const verified=evaluateImportantTasks(source).find(item=>item.target.id===entity.id);
          if(!verified?.complete || verified.truth!=='true')continue;
          facts.qualifyingScheduledWork=false;
        }
      }
    }
    if(!name || !allowed.length)continue;
    const signal:Signal={alias:alias(d.target),type:d.target.type,title:name,reasonCodes:reasons,facts};
    if(d.target.type==='workspace_day')signal.scope='selected_projects';
    if(projectLabel && projectId){signal.projectAlias=alias({type:'project',id:projectId});signal.projectLabel=projectLabel;}
    if(status!==undefined)signal.status=status;if(priority!==undefined)signal.priority=priority;if(date!==undefined)signal.date=date;
    chosen.push({signal,candidate:d,allowed});targets.add(d.target.type+':'+d.target.id);
  }
  if(!chosen.length)return {ok:false,reason:'NO_ELIGIBLE_SIGNAL'};
  const primary=chosen[0],contents=JSON.stringify({primaryAlias:primary.signal.alias,signals:chosen.map(item=>item.signal)});
  if(!proactiveInputBudget(contents,'',{}).allowed)return {ok:false,reason:'CONTEXT_TOO_LARGE'};
  const allowedFacts=new Set<string>();
  for(const {signal} of chosen)for(const value of [signal.status,signal.priority,signal.date,...Object.values(signal.facts)])if(value!==undefined)allowedFacts.add(String(value));
  const micros=(value:string) => BigInt(stamp(value)!)*BigInt(1000)+BigInt((/\.(\d{1,6})(?:Z|[+-])/.exec(value)?.[1]??'').slice(3).padEnd(3,'0'));
  const evidenceValidUntil=chosen.map(item=>item.candidate.evidenceValidUntil!).reduce((a,b)=>micros(a)<=micros(b)?a:b);
  return {ok:true,context:{contents,aliases,primaryAlias:primary.signal.alias,allowedCategories:primary.allowed,allowedFacts,
    parentId:primary.candidate.parentId,parentEpisode:primary.candidate.parentEpisode,sourceToken:primary.candidate.sourceToken!,evidenceValidUntil}};
}
