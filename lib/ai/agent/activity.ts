import "server-only";
import type {SupabaseClient} from '@supabase/supabase-js';
import {AiError} from '@/lib/ai/errors';
import {actionLabel,activitySummary,runStatus,ACTIVITY_STATUSES,type ActivityQuery,type ActivityPage,type AgentActivityRun,type AgentActivityAction,type ActivityCounts,type ActivityTarget} from '@/data/agentActivity';
import {loadProposalBatch} from '@/lib/ai/agent/store';
import {buildAgentReviewPrompt} from '@/data/agentProposalReview';
import {localDateTime} from '@/data/timeBlocks';
import type {ProposalDraft} from '@/lib/ai/agent/contract';
import {projectUndoEligibility,projectUndoReference} from '@/lib/ai/agent/undo';
type Row=Record<string,unknown>;
const text=(v:unknown,max=180)=>typeof v==='string'?Array.from(v).slice(0,max).join(''):'';
function projectRun(row:Row):AgentActivityRun {
 const source=(row.counts??{}) as Row,counts={} as ActivityCounts;
 for(const status of ACTIVITY_STATUSES)counts[status]=Math.max(0,Number(source[status])||0);
 return {id:text(row.id),createdAt:text(row.createdAt),completedAt:row.completedAt?text(row.completedAt):null,counts,actionCount:Object.values(counts).reduce((a,b)=>a+b,0),primaryEntityLabel:text(row.primaryEntityLabel)||null,status:runStatus(counts),summary:activitySummary(counts)};
}
export async function listAgentRuns(admin:SupabaseClient,userId:string,query:ActivityQuery):Promise<ActivityPage> {
 const {data,error}=await admin.rpc('list_agent_activity',{p_user_id:userId,p_limit:query.limit,p_cursor_created:query.cursor?.createdAt??null,p_cursor_id:query.cursor?.id??null,p_status:query.status??null,p_from:query.from??null,p_to:query.to??null});
 if(error||!data||!Array.isArray(data.items)||data.items.length>query.limit)throw new AiError('UPSTREAM_ERROR');
 return {items:data.items.map(projectRun),nextCursor:data.nextCursor??null};
}
const reasons:Record<string,string>={PLAN_SAVE_FAILED:'The Plan could not be saved.',MILESTONE_SAVE_FAILED:'The milestone could not be saved.',STALE_ENTITY:'The item changed before approval.',TIME_BLOCK_OVERLAP:'That time is no longer available.',FORBIDDEN:'The item or its links are no longer available.',INVALID_INPUT:'The change could not be validated.',TIME_BLOCK_SAVE_FAILED:'The time block could not be saved.',TASK_SAVE_FAILED:'The task could not be saved.'};
const fields=new Set(['timeframe','title','description','priority','status','dueDate','milestoneId','targetDate','startAt','endAt','projectId','taskId','kind']);
async function resolveTarget(supabase:SupabaseClient,userId:string,row:Row,timeZone:string):Promise<{target:ActivityTarget|null;state:AgentActivityAction['entityState'];label:string}> {
 const label=text(row.title)||'Workspace item',id=text(row.entityId),type=text(row.actionType);
 if(!['create_plan','update_plan','create_milestone','update_milestone','create_task','update_task','reschedule_project','reschedule_milestone','create_time_block','update_time_block','cancel_time_block'].includes(type))return {target:null,state:'unsupported',label};
 if(!id)return {target:null,state:type.startsWith('create_')?'uncreated':'missing',label};
 const entityType=type==='create_plan'||type==='update_plan'?'plan':type.endsWith('_time_block')?'time_block':type==='reschedule_project'?'project':['reschedule_milestone','create_milestone','update_milestone'].includes(type)?'milestone':'task';
 const table={plan:'plans',time_block:'workspace_time_blocks',task:'tasks',project:'projects',milestone:'milestones'}[entityType];
 let query=supabase.from(table).select(entityType==='time_block'?'id,title,start_at,project_id':entityType==='milestone'?'id,title,project_id,projects!inner(user_id)':'id,title').eq('id',id);
 query=entityType==='milestone'?query.eq('projects.user_id',userId):query.eq('user_id',userId);
 const {data,error}=await query.maybeSingle();if(error)throw new AiError('UPSTREAM_ERROR');
 if(!data)return {target:null,state:'missing',label};
 const item=data as unknown as Row;
 return {target:{type:entityType,id,...(entityType==='milestone'?{projectId:String(item.project_id)}:{}),...(entityType==='time_block'?{date:localDateTime(String(item.start_at),timeZone).slice(0,10)}:{})},state:'available',label:text(item.title)||label};
}
export async function getAgentRun(admin:SupabaseClient,supabase:SupabaseClient,userId:string,runId:string,timeZone:string):Promise<AgentActivityRun> {
 const {data,error}=await admin.rpc('get_agent_activity_run',{p_user_id:userId,p_run_id:runId});
 if(error)throw new AiError('UPSTREAM_ERROR');if(!data)throw new AiError('FORBIDDEN');
 if(!Array.isArray(data.actions)||data.actions.length>10)throw new AiError('UPSTREAM_ERROR');
 let canonical:ProposalDraft[]=[];
 if(data.actions.some((a:Row)=>a.status==='conflict'||a.status==='failed'))canonical=(await loadProposalBatch(admin,userId,runId)).actions;
 const actions:AgentActivityAction[]=await Promise.all(data.actions.map(async(row:Row)=>{
  const resolved=await resolveTarget(supabase,userId,row,timeZone),status=ACTIVITY_STATUSES.includes(row.status as never)?row.status as AgentActivityAction['status']:'failed';
  const diff:ProposalDraft['diff']=(Array.isArray(row.diff)?row.diff:[]).filter((d:Row)=>fields.has(String(d.field))).slice(0,12).map((d:Row)=>({field:d.field as ProposalDraft['diff'][number]['field'],before:typeof d.before==='string'?text(d.before,4000):null,after:typeof d.after==='string'?text(d.after,4000):null}));
  const action:AgentActivityAction={id:text(row.id),runId,actionType:text(row.actionType),entityId:text(row.entityId)||null,title:text(row.title),status,createdAt:text(row.createdAt),approvedAt:text(row.approvedAt)||null,executedAt:text(row.executedAt)||null,errorCode:reasons[String(row.errorCode)]?String(row.errorCode):null,diff,humanSummary:actionLabel(text(row.actionType)),entityLabel:resolved.label,navigationTarget:resolved.target,entityState:resolved.state};
  const draft=canonical.find(a=>a.id===row.id);
  if(row.undo)action.undo=projectUndoEligibility(row.undo);
  if(row.undoOf)action.undoOf=projectUndoReference(row.undoOf);
  if(row.reversedBy)action.reversedBy=projectUndoReference(row.reversedBy);
  if(resolved.state!=='unsupported'&&(status==='conflict'||status==='failed')){
   const labels=new Map<string,string>();
   // Labels for review are resolved through the authenticated owner client.
   for(const [kind,id] of [['task',draft&&'taskId' in draft.payload?draft.payload.taskId:null],['project',draft&&'projectId' in draft.payload?draft.payload.projectId??draft.projectId:draft?.projectId]] as const)if(id){const {data:label,error:labelError}=await supabase.from(kind==='task'?'tasks':'projects').select('title').eq('id',id).eq('user_id',userId).maybeSingle();if(labelError)throw new AiError('UPSTREAM_ERROR');if(label)labels.set(`${kind}:${id}`,text(label.title));}
   try{action.reviewPrompt=draft?buildAgentReviewPrompt(draft,timeZone,labels):`Review the current ${action.entityLabel} and ask me which change to retry.`;}catch{action.reviewPrompt='Review the current workspace item and ask me which change to retry.';}
  }
  return action;
 }));
 return {...projectRun(data),actions};
}
