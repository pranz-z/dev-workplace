import {dayBoundaryInstant,localDateTime} from '@/data/timeBlocks';
import type {ActionStatus,ProposalDraft} from '@/lib/ai/agent/contract';

export type ActivityCounts=Record<ActionStatus,number>;
export type ActivityTarget={type:'task'|'project'|'milestone'|'time_block';id:string;projectId?:string;date?:string};
export interface AgentActivityAction {
 id:string;runId:string;actionType:string;entityId:string|null;title:string;status:ActionStatus;
 createdAt:string;approvedAt:string|null;executedAt:string|null;errorCode:string|null;
 diff:ProposalDraft['diff'];humanSummary:string;entityLabel:string;navigationTarget:ActivityTarget|null;
 entityState:'available'|'missing'|'uncreated'|'unsupported';reviewPrompt?:string;
}
export interface AgentActivityRun {
 id:string;createdAt:string;completedAt:string|null;actionCount:number;counts:ActivityCounts;
 primaryEntityLabel:string|null;status:string;summary:string;actions?:AgentActivityAction[];
}
export interface ActivityCursor {createdAt:string;id:string}
export interface ActivityPage {items:AgentActivityRun[];nextCursor:ActivityCursor|null}
export interface ActivityQuery {limit:number;cursor?:ActivityCursor;status?:ActionStatus;from?:string;to?:string}
export const ACTIVITY_STATUSES:ActionStatus[]=['pending','applied','cancelled','conflict','failed'];
export const STATUS_LABELS:Record<ActionStatus,string>={pending:'Pending approval',applied:'Applied',cancelled:'Cancelled',conflict:'Conflict',failed:'Failed'};
const ACTION_LABELS:Record<string,string>={create_task:'Create task',update_task:'Update task',reschedule_milestone:'Reschedule milestone',reschedule_project:'Reschedule project',create_time_block:'Create time block',update_time_block:'Update time block',cancel_time_block:'Cancel time block'};
export function actionLabel(type:string){return ACTION_LABELS[type]??'Historical action';}
export function runStatus(counts:ActivityCounts){const states=ACTIVITY_STATUSES.filter(s=>counts[s]>0);return counts.pending?'Pending approval':states.length===1?STATUS_LABELS[states[0]]:states.length?'Mixed outcomes':'No actions';}
export function activitySummary(counts:ActivityCounts){return ACTIVITY_STATUSES.filter(s=>counts[s]>0).map(s=>`${counts[s]} ${STATUS_LABELS[s].toLowerCase()}`).join(' · ')||'No proposed changes';}
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const instant=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(`${s.slice(0,10)}T00:00Z`).toISOString().slice(0,10)===s.slice(0,10);
export function parseActivityQuery(params:URLSearchParams):ActivityQuery {
 for(const key of params.keys())if(!['limit','cursor','status','from','to'].includes(key)||params.getAll(key).length!==1)throw new Error('Invalid history filter.');
 const limit=Number(params.get('limit')??20);if(!Number.isInteger(limit)||limit<1||limit>30)throw new Error('Invalid history page size.');
 const result:ActivityQuery={limit};const status=params.get('status');if(status){if(!ACTIVITY_STATUSES.includes(status as ActionStatus))throw new Error('Invalid history status.');result.status=status as ActionStatus;}
 for(const key of ['from','to'] as const){const value=params.get(key);if(value){if(!instant(value))throw new Error('Invalid history date.');result[key]=value;}}
 if(result.from&&result.to&&Date.parse(result.from)>=Date.parse(result.to))throw new Error('Invalid history range.');
 const cursor=params.get('cursor');if(cursor){if(cursor.length>256)throw new Error('Invalid history cursor.');let value;try{value=JSON.parse(cursor);}catch{throw new Error('Invalid history cursor.');}if(!value||Object.keys(value).sort().join(',')!=='createdAt,id'||!uuid(value.id)||!instant(value.createdAt))throw new Error('Invalid history cursor.');result.cursor=value;}
 return result;
}
export function activityQueryString(query:ActivityQuery){const params=new URLSearchParams({limit:String(query.limit)});if(query.cursor)params.set('cursor',JSON.stringify(query.cursor));for(const key of ['status','from','to'] as const)if(query[key])params.set(key,query[key]!);return params.toString();}
export function activityDateRange(period:string,timeZone:string,now=new Date()):Pick<ActivityQuery,'from'|'to'> {
 if(period==='all')return {};const date=localDateTime(now,timeZone).slice(0,10),end=new Date(`${date}T00:00Z`);end.setUTCDate(end.getUTCDate()+1);const start=new Date(`${date}T00:00Z`);start.setUTCDate(start.getUTCDate()-(period==='30'?29:period==='7'?6:0));return {from:dayBoundaryInstant(start.toISOString().slice(0,10),timeZone),to:dayBoundaryInstant(end.toISOString().slice(0,10),timeZone)};
}
