import "server-only";
import {randomUUID} from "node:crypto";
import {AiError} from "@/lib/ai/errors";
import {TIME_BLOCK_COLUMNS,PREFERENCE_COLUMNS,dayBoundaryInstant,canonicalInstant,resolveBlockTime,validateBlockRange,blocksOverlap,findFreeSlots,planDay,type SchedulingPreferences,type PlanningTask,type TimeSlot} from "@/data/timeBlocks";
import {taskCalendarDate} from "@/data/workspaceCalendar";
import type {ToolContext} from "@/lib/ai/agent/tools";
import type {ProposalDraft,ProposalChanges,LegacyProposalDraft} from "@/lib/ai/agent/contract";
import type {TimeBlockInput,TimeBlockChanges} from "@/lib/ai/agent/time-block-schema";
import {resolveTimeBlockCandidates,hasRequestedMoveTime,moveEndFromCanonical} from "@/lib/ai/agent/block-resolution";
type Row=Record<string,unknown>;
function fail():never{throw new AiError('INVALID_INPUT');}
async function one(context:ToolContext,table:string,columns:string,id:string) {
 const {data,error}=await context.supabase.from(table).select(columns).eq(table==='workspace_scheduling_preferences'?'user_id':'id',id).eq('user_id',context.userId).abortSignal(context.signal).maybeSingle();
 if(error)throw new AiError('UPSTREAM_ERROR');return data as Row|null;
}
function summary(row:Row) {return {id:String(row.id),title:String(row.title),projectId:row.project_id as string|null,taskId:row.task_id as string|null,startAt:canonicalInstant(String(row.start_at)),endAt:canonicalInstant(String(row.end_at)),kind:String(row.kind),status:String(row.status),updatedAt:String(row.updated_at)};}
export async function readTimeBlocks(context:ToolContext,startAt:string,endAt:string,filters:{projectId?:string;taskId?:string;includeCompleted?:boolean}={}) {
 const start=canonicalInstant(startAt),end=canonicalInstant(endAt);
 if(end<=start||Date.parse(end)-Date.parse(start)>32*86400000)fail();
 let query=context.supabase.from('workspace_time_blocks').select(TIME_BLOCK_COLUMNS).eq('user_id',context.userId).lt('start_at',end).gt('end_at',start).neq('status','cancelled').order('start_at').limit(501).abortSignal(context.signal);
 if(filters.projectId)query=query.eq('project_id',filters.projectId);if(filters.taskId)query=query.eq('task_id',filters.taskId);if(!filters.includeCompleted)query=query.neq('status','completed');
 const {data,error}=await query;if(error)throw new AiError('UPSTREAM_ERROR');return {items:((data??[]) as Row[]).slice(0,500).map(summary),truncated:(data?.length??0)>500};
}
function localDateOverlap(block:TimeSlot,date:string,timeZone:string){const next=new Date(`${date}T00:00Z`);next.setUTCDate(next.getUTCDate()+1);return blocksOverlap(block,{startAt:dayBoundaryInstant(date,timeZone),endAt:dayBoundaryInstant(next.toISOString().slice(0,10),timeZone)});}
async function dayContext(context:ToolContext,date:string,withTasks:boolean) {
 const next=new Date(`${date}T00:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
 const startAt=dayBoundaryInstant(date,context.timeZone),endAt=dayBoundaryInstant(next.toISOString().slice(0,10),context.timeZone);
 const row=await one(context,'workspace_scheduling_preferences',PREFERENCE_COLUMNS,context.userId);
 const preferences:SchedulingPreferences|null=row?{workdayStart:String(row.workday_start).slice(0,5),workdayEnd:String(row.workday_end).slice(0,5),weekdays:row.weekdays as number[],focusMinutes:Number(row.focus_minutes),bufferMinutes:Number(row.buffer_minutes)}:null;
 const buffer=(preferences?.bufferMinutes??0)*60000;
 const blocks=await readTimeBlocks(context,new Date(Date.parse(startAt)-buffer).toISOString(),new Date(Date.parse(endAt)+buffer).toISOString(),{includeCompleted:true});
 if(!withTasks)return {blocks,preferences,tasks:[] as PlanningTask[],deadlines:[] as Row[],truncated:blocks.truncated};
 const [tasks,projects,milestones]=await Promise.all([
  context.supabase.from('tasks').select('id,title,project_id,status,priority,due_date,milestone_id,projects!inner(user_id)').eq('user_id',context.userId).eq('projects.user_id',context.userId).neq('status','Completed').order('id').limit(1001).abortSignal(context.signal),
  context.supabase.from('projects').select('id,title,target_date,status,priority').eq('user_id',context.userId).order('id').limit(1001).abortSignal(context.signal),
  context.supabase.from('milestones').select('id,title,project_id,target_date,status,projects!inner(user_id)').eq('projects.user_id',context.userId).order('id').limit(1001).abortSignal(context.signal),
 ]);
 if(tasks.error||projects.error||milestones.error)throw new AiError('UPSTREAM_ERROR');
 const projectRows=(projects.data??[]) as Row[],milestoneRows=(milestones.data??[]) as Row[];
 const projectMap=new Map(projectRows.map(p=>[p.id,p.target_date as string|null])),milestoneMap=new Map(milestoneRows.map(m=>[m.id,m.target_date as string|null]));
 const eligible:PlanningTask[]=((tasks.data??[]) as Row[]).slice(0,1000).map(t=>({id:String(t.id),title:String(t.title),projectId:String(t.project_id),status:String(t.status),priority:String(t.priority),projectPriority:String(projectRows.find(p=>p.id===t.project_id)?.priority??'Medium'),dueDate:taskCalendarDate(typeof t.due_date==='string'?t.due_date:undefined,context.timeZone),projectDate:projectMap.get(t.project_id),milestoneDate:milestoneMap.get(t.milestone_id)}));
 const deadlines=[...eligible.filter(t=>t.dueDate===date).map(t=>({id:t.id,title:t.title,type:'task',date:t.dueDate})),...projectRows.filter(p=>p.target_date===date).map(p=>({id:p.id,title:p.title,type:'project',date:p.target_date})),...milestoneRows.filter(m=>m.target_date===date).map(m=>({id:m.id,title:m.title,type:'milestone',date:m.target_date}))];
 return {blocks,preferences,tasks:eligible,deadlines:deadlines.slice(0,100),truncated:deadlines.length>100||blocks.truncated||[tasks,projects,milestones].some(result=>(result.data?.length??0)>1000)};
}
export async function executeTimeRead(name:string,args:Record<string,unknown>,context:ToolContext):Promise<Record<string,unknown>> {
 if(name==='list_time_blocks')return {...await readTimeBlocks(context,String(args.startAt),String(args.endAt),args),timeZone:context.timeZone};
 const day=await dayContext(context,String(args.date),name==='get_day_schedule');
 if(name==='get_day_schedule')return {items:day.blocks.items.filter(b=>localDateOverlap(b,String(args.date),context.timeZone)),deadlines:day.deadlines,preferences:day.preferences,timeZone:context.timeZone,date:args.date,truncated:day.truncated};
 if(day.blocks.truncated) return {items:[],truncated:true,reason:'Availability cannot be verified: too many existing blocks.'};
 if(!day.preferences&&!(args.earliestTime&&args.latestTime))return {items:[],truncated:false,requiresPreferences:true,reason:'Save working hours or provide an explicit range.'};
 const slots=findFreeSlots({date:String(args.date),timeZone:context.timeZone,preferences:day.preferences,blocks:day.blocks.items,durationMinutes:Number(args.durationMinutes),earliestTime:args.earliestTime as string|undefined,latestTime:args.latestTime as string|undefined,now:context.now});
 return {items:slots.slice(0,10),timeZone:context.timeZone,truncated:slots.length>10};
}
async function canonicalProposal(input:TimeBlockInput,context:ToolContext,drafts:ProposalDraft[]) {
 const row=input.timeBlockId?await one(context,'workspace_time_blocks',TIME_BLOCK_COLUMNS,input.timeBlockId):null;
 if(input.timeBlockId&&!row)throw new AiError('FORBIDDEN');
 if(row&&context.requestMessage){
  const resolved=await resolveTimeBlockCandidates(context.requestMessage,context);
  if(resolved.selectedId!==input.timeBlockId)fail();
  if(input.changes?.startAt&&!hasRequestedMoveTime(context.requestMessage))fail();
  if(input.changes?.endAt&&!input.changes.startAt&&!/\b(for\s+\d+\s*(?:minutes?|mins?|hours?)|until|end(?:ing)?)\b/i.test(context.requestMessage))fail();
 }
 const previous=drafts.find(d=>d.entityId===input.timeBlockId&&d.type.endsWith('_time_block'));
 if(previous&&previous.expectedUpdatedAt!==row?.updated_at)throw new AiError('FORBIDDEN');
 const before:TimeBlockChanges=row?{title:String(row.title),startAt:canonicalInstant(String(row.start_at)),endAt:canonicalInstant(String(row.end_at)),projectId:row.project_id as string|null,taskId:row.task_id as string|null,kind:row.kind as TimeBlockChanges['kind'],status:row.status as TimeBlockChanges['status']}:{};
 const patch:TimeBlockChanges={...(previous?.payload as TimeBlockChanges??{}),...input.changes};
 for(const key of ['startAt','endAt'] as const)if(patch[key]&&!(key==='endAt'&&row&&context.requestMessage&&patch.startAt))patch[key]=resolveBlockTime(patch[key]!,context.timeZone);
 if(row&&context.requestMessage&&(patch.startAt||patch.endAt))patch.endAt=moveEndFromCanonical(context.requestMessage,patch.startAt??canonicalInstant(String(row.start_at)),String(row.start_at),String(row.end_at),context.timeZone);
 const after:TimeBlockChanges=row?{...before,...patch}:{projectId:null,taskId:null,kind:'focus',status:'scheduled',...patch};
 if(after.taskId) {
  const task=await one(context,'tasks','id,project_id,status',after.taskId);if(!task)throw new AiError('FORBIDDEN');
  if(input.blockAction==='create'&&task.status==='Completed')fail();
  if(after.projectId&&after.projectId!==task.project_id)fail();after.projectId=String(task.project_id);
  if(after.projectId!==before.projectId)patch.projectId=after.projectId;
 }
 if(after.projectId&&!await one(context,'projects','id',after.projectId))throw new AiError('FORBIDDEN');
 const range=validateBlockRange(after.startAt!,after.endAt!);
 if(after.status!=='cancelled') {
  const persisted=await readTimeBlocks(context,range.startAt,range.endAt,{includeCompleted:true});if(persisted.truncated)fail();
  if(persisted.items.some(b=>b.id!==input.timeBlockId&&blocksOverlap(range,b)))fail();
  for(const draft of drafts)if(draft!==previous&&(draft.type==='create_time_block'||draft.type==='update_time_block')){
   const candidate={...draft.before,...draft.payload};if(candidate.startAt&&candidate.endAt&&candidate.status!=='cancelled'&&blocksOverlap(range,candidate as TimeSlot))fail();
  }
 }
 const payload:ProposalChanges=row?patch:after;
 if(input.blockAction==='cancel'){for(const key of Object.keys(payload))delete (payload as Record<string,unknown>)[key];payload.status='cancelled';}
 const fields=Object.keys(payload) as Array<keyof TimeBlockChanges>;
 const diff=fields.filter(key=>(before[key]??null)!==(payload[key]??null)).map(key=>({field:key,before:before[key]??null,after:payload[key]??null}));
 if(!diff.length)fail();if(!previous&&drafts.length>=10)throw new AiError('AGENT_LIMIT_REACHED');
 const draft:ProposalDraft={id:previous?.id??randomUUID(),type:input.blockAction==='cancel'?'cancel_time_block':row?'update_time_block':'create_time_block',entityId:input.timeBlockId??null,taskId:null,projectId:after.projectId??null,title:after.title!,payload,before,expectedUpdatedAt:row?String(row.updated_at):null,diff,status:'pending'};
 if(previous)drafts[drafts.indexOf(previous)]=draft;else drafts.push(draft);
}
export async function collectTimeProposal(input:TimeBlockInput,context:ToolContext,drafts:ProposalDraft[]):Promise<Record<string,unknown>> {
 if(input.blockAction==='plan'||input.blockAction==='find') {
  const day=await dayContext(context,input.date!,true);
  if(day.blocks.truncated)fail();if(!day.preferences&&!(input.earliestTime&&input.latestTime))return {pendingApproval:false,count:0,requiresPreferences:true,reason:'Ask the user to save scheduling preferences or specify an explicit start/end range and duration. No proposal created.'};
  const reserved=drafts.filter((d):d is LegacyProposalDraft=>['create_time_block','update_time_block','cancel_time_block'].includes(d.type)).map(d=>({...d.before,...d.payload})).filter((p):p is typeof p & TimeSlot=>Boolean(p.startAt&&p.endAt));
  let tasks=day.tasks;
  if(input.blockAction==='find') {const task=await one(context,'tasks','id,title,project_id,status,priority,due_date',input.taskId!);if(!task||task.status==='Completed')fail();tasks=[{id:String(task.id),title:String(task.title),projectId:String(task.project_id),status:String(task.status),priority:String(task.priority)}];}
  const plan=planDay({date:input.date!,timeZone:context.timeZone,preferences:day.preferences,blocks:[...day.blocks.items,...reserved],tasks,durationMinutes:input.durationMinutes,earliestTime:input.earliestTime,latestTime:input.latestTime,now:context.now});
  const candidates=plan.items.slice(0,10-drafts.length);
  const savedLength=drafts.length;
  try {for(const candidate of candidates)await canonicalProposal({blockAction:'create',changes:candidate},context,drafts);}catch(e){drafts.splice(savedLength);throw e;}
  return {pendingApproval:candidates.length>0,count:candidates.length,proposedActions:drafts.length,truncated:day.truncated||plan.truncated||candidates.length<plan.items.length,reason:candidates.length?'Only listed candidate blocks are proposed.':'No verified slot fits; no proposal created.'};
 }
 await canonicalProposal(input,context,drafts);return {pendingApproval:true,count:1,proposedActions:drafts.length,summary:'Prepared a time block proposal. Nothing has been changed.'};
}
