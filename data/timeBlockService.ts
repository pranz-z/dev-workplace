import { getWorkspaceContext, isUuid } from "@/data/context";
import { serviceOk, serviceFail, type ServiceResult } from "@/data/serviceResult";
import { TIME_BLOCK_COLUMNS, PREFERENCE_COLUMNS, canonicalInstant, validateBlockRange, validatePreferences, type WorkspaceTimeBlock, type SchedulingPreferences } from "@/data/timeBlocks";

export function timeBlockFromRow(row: Record<string, unknown>): WorkspaceTimeBlock {
  return {id:String(row.id),userId:String(row.user_id),projectId:row.project_id as string|null,taskId:row.task_id as string|null,title:String(row.title),startAt:String(row.start_at),endAt:String(row.end_at),kind:row.kind as WorkspaceTimeBlock['kind'],status:row.status as WorkspaceTimeBlock['status'],notes:row.notes as string|null,createdAt:String(row.created_at),updatedAt:String(row.updated_at)};
}
export function preferencesFromRow(row: Record<string, unknown>): SchedulingPreferences {
  return {workdayStart:String(row.workday_start).slice(0,5),workdayEnd:String(row.workday_end).slice(0,5),weekdays:row.weekdays as number[],focusMinutes:Number(row.focus_minutes),bufferMinutes:Number(row.buffer_minutes)};
}
export async function listTimeBlocks(startAt:string,endAt:string): Promise<{items:WorkspaceTimeBlock[];truncated:boolean}> {
  const start=canonicalInstant(startAt),end=canonicalInstant(endAt);
  if(end<=start||Date.parse(end)-Date.parse(start)>50*86400000)throw new Error('Choose a range of at most 50 days.');
  const context=await getWorkspaceContext();if(!context)throw new Error('Sign in to load time blocks.');
  const {data,error}=await context.supabase.from('workspace_time_blocks').select(TIME_BLOCK_COLUMNS).eq('user_id',context.userId).lt('start_at',end).gt('end_at',start).order('start_at').limit(501);
  if(error)throw new Error('Time blocks could not be loaded.');
  return {items:(data??[]).slice(0,500).map(row=>timeBlockFromRow(row)),truncated:(data?.length??0)>500};
}
export type TimeBlockDraft=Pick<WorkspaceTimeBlock,'title'|'startAt'|'endAt'|'projectId'|'taskId'|'kind'|'status'|'notes'>;
export async function saveTimeBlock(draft:TimeBlockDraft,id?:string,expectedUpdatedAt?:string):Promise<ServiceResult<WorkspaceTimeBlock>> {
  try {
    const range=validateBlockRange(draft.startAt,draft.endAt),title=draft.title.trim();
    if(!title||title.length>180||draft.notes&&draft.notes.length>4000||id&&!isUuid(id)||draft.projectId&&!isUuid(draft.projectId)||draft.taskId&&!isUuid(draft.taskId)||draft.taskId&&!draft.projectId||!['focus','task','break','custom'].includes(draft.kind)||!['scheduled','completed','cancelled'].includes(draft.status))return serviceFail('Enter a valid title, time range and links.');
    const context=await getWorkspaceContext();if(!context)return serviceFail('Sign in to save time blocks.');
    const payload={user_id:context.userId,title,start_at:range.startAt,end_at:range.endAt,project_id:draft.projectId,task_id:draft.taskId,kind:draft.kind,status:draft.status,notes:draft.notes?.trim()||null};
    let query=id?context.supabase.from('workspace_time_blocks').update(payload).eq('id',id).eq('user_id',context.userId):context.supabase.from('workspace_time_blocks').insert(payload);
    if(id&&expectedUpdatedAt)query=query.eq('updated_at',expectedUpdatedAt);
    const {data,error}=await query.select(TIME_BLOCK_COLUMNS).maybeSingle();
    if(error)return serviceFail(error.code==='23P01'?'This time overlaps an existing block. Choose another time.':error.code==='23503'?'The task and project links are unavailable or inconsistent.':'Time block could not be saved.');
    if(!data)return serviceFail('This block changed. Refresh before editing again.');
    return serviceOk(timeBlockFromRow(data));
  }catch(error){return serviceFail(error instanceof Error?error.message:'Time block could not be saved.');}
}
export async function getSchedulingPreferences():Promise<SchedulingPreferences|null> {
  const context=await getWorkspaceContext();if(!context)return null;
  const {data,error}=await context.supabase.from('workspace_scheduling_preferences').select(PREFERENCE_COLUMNS).eq('user_id',context.userId).maybeSingle();
  if(error)throw new Error('Scheduling preferences could not be loaded.');return data?preferencesFromRow(data):null;
}
export async function saveSchedulingPreferences(preferences:SchedulingPreferences):Promise<ServiceResult<SchedulingPreferences>> {
  try {
    const p=validatePreferences(preferences),context=await getWorkspaceContext();if(!context)return serviceFail('Sign in to save scheduling preferences.');
    const {error}=await context.supabase.from('workspace_scheduling_preferences').upsert({user_id:context.userId,workday_start:p.workdayStart,workday_end:p.workdayEnd,weekdays:p.weekdays,focus_minutes:p.focusMinutes,buffer_minutes:p.bufferMinutes},{onConflict:'user_id'});
    return error?serviceFail('Scheduling preferences could not be saved.'):serviceOk(p);
  }catch(error){return serviceFail(error instanceof Error?error.message:'Scheduling preferences could not be saved.');}
}
