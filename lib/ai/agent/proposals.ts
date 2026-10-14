import "server-only";
import { randomUUID } from "node:crypto";
import { AiError } from "@/lib/ai/errors";
import { taskCalendarDate } from "@/data/workspaceCalendar";
import { MAX_PROPOSED_ACTIONS_PER_RUN, type ProposalDraft, type LegacyProposalDraft, type TaskChanges, type MilestoneChanges } from "@/lib/ai/agent/contract";
import { parseProposalTool } from "@/lib/ai/agent/proposal-schema";
import type { ToolContext } from "@/lib/ai/agent/tools";
import {collectTimeProposal} from "@/lib/ai/agent/time-blocks";
import type {PlanChanges,PlanCreatePayload} from '@/lib/ai/agent/contract';

function excerpt(value: unknown, limit: number) { const text = String(value ?? ""); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text; }

export async function collectProposal(name: string, input: unknown, context: ToolContext, drafts: ProposalDraft[]) {
  const parsed = parseProposalTool(name, input);
  const planDraft=drafts.find(d=>d.type==='create_plan'||d.type==='update_plan');
  if('planAction' in parsed){
    if(drafts.length&&(parsed.planAction!=='update'||drafts.length!==1||planDraft?.type!=='update_plan'||planDraft.entityId!==parsed.planId))throw new AiError('INVALID_INPUT');
    if(parsed.planAction==='create'){
      const payload:PlanCreatePayload={title:parsed.title,description:parsed.description??'',timeframe:parsed.timeframe??null,status:parsed.status??'Planning',targetDate:parsed.targetDate??null};
      drafts.push({id:randomUUID(),type:'create_plan',entityId:null,taskId:null,projectId:null,title:payload.title,payload,before:{},expectedUpdatedAt:null,diff:Object.entries(payload).map(([field,after])=>({field:field as keyof PlanChanges,before:null,after})),status:'pending'});
    }else{
      const {data,error}=await context.supabase.from('plans').select('id,title,description,timeframe,status,target_date,updated_at').eq('id',parsed.planId).eq('user_id',context.userId).abortSignal(context.signal).maybeSingle();
      if(error)throw new AiError('UPSTREAM_ERROR');if(!data)throw new AiError('FORBIDDEN');
      const row=data as unknown as {id:string;title:string;description:string;timeframe:string|null;status:PlanChanges['status'];target_date:string|null;updated_at:string};
      if(planDraft&&planDraft.expectedUpdatedAt!==row.updated_at)throw new AiError('FORBIDDEN');
      const initial:PlanChanges={title:row.title,description:row.description,timeframe:row.timeframe,status:row.status,targetDate:row.target_date};
      const merged={...(planDraft?.payload??{}),...parsed.changes} as PlanChanges,payload:PlanChanges={},before:PlanChanges={},diff:ProposalDraft['diff']=[];
      for(const field of Object.keys(merged) as (keyof PlanChanges)[]){const old=initial[field],after=merged[field];if(old===after)continue;
        const checked=parseProposalTool('propose_update_plan',{planId:row.id,changes:{[field]:old}});
        if(!('planAction' in checked)||checked.planAction!=='update'||checked.changes[field]!==old)throw new AiError('INVALID_INPUT');
        Object.assign(payload,{[field]:after});Object.assign(before,{[field]:old});diff.push({field,before:old as string|null,after:after as string|null});
      }
      if(!diff.length)throw new AiError('INVALID_INPUT');
      if(planDraft?.type==='update_plan'){planDraft.payload=payload;planDraft.before=before;planDraft.diff=diff;}
      else drafts.push({id:randomUUID(),type:'update_plan',entityId:row.id,taskId:null,projectId:null,title:Array.from(row.title).slice(0,180).join(''),payload,before,expectedUpdatedAt:row.updated_at,diff,status:'pending'});
    }
    return {pendingApproval:true,summary:'Prepared a Plan proposal. Nothing has changed yet.',proposedActions:drafts.length};
  }
  if(planDraft)throw new AiError('INVALID_INPUT');
  const newDraft=drafts.find(d=>d.type==='create_milestone'||d.type==='update_milestone');
  if('milestoneAction' in parsed){
    if(drafts.length && (parsed.milestoneAction!=='update'||drafts.length!==1||newDraft?.type!=='update_milestone'||newDraft.entityId!==parsed.milestoneId))throw new AiError('INVALID_INPUT');
    if(parsed.milestoneAction==='create'){
      const {data,error}=await context.supabase.from('projects').select('id,title').eq('id',parsed.projectId).eq('user_id',context.userId).abortSignal(context.signal).maybeSingle();
      if(error)throw new AiError('UPSTREAM_ERROR');if(!data)throw new AiError('FORBIDDEN');
      const payload={title:parsed.title,description:parsed.description??'',status:'pending' as const,targetDate:parsed.targetDate??null};
      drafts.push({id:randomUUID(),type:'create_milestone',entityId:null,taskId:null,projectId:parsed.projectId,title:payload.title,payload,before:{},expectedUpdatedAt:null,diff:Object.entries(payload).map(([field,after])=>({field:field as keyof MilestoneChanges,before:null,after})),status:'pending'});
    }else{
      const {data,error}=await context.supabase.from('milestones').select('id,project_id,title,description,status,target_date,updated_at,projects!inner(id,user_id)').eq('id',parsed.milestoneId).eq('projects.user_id',context.userId).abortSignal(context.signal).maybeSingle();
      if(error)throw new AiError('UPSTREAM_ERROR');if(!data)throw new AiError('FORBIDDEN');
      const row=data as unknown as {id:string;project_id:string;title:string;description:string;status:MilestoneChanges['status'];target_date:string|null;updated_at:string};
      if(newDraft&&(newDraft.expectedUpdatedAt!==row.updated_at||newDraft.projectId!==row.project_id))throw new AiError('FORBIDDEN');
      const initial:MilestoneChanges={title:row.title,description:row.description,status:row.status,targetDate:row.target_date};
      const merged={...(newDraft?.payload??{}),...parsed.changes} as MilestoneChanges;
      const payload:MilestoneChanges={},before:MilestoneChanges & {projectId:string}={projectId:row.project_id};
      const diff:ProposalDraft['diff']=[];
      for(const field of Object.keys(merged) as (keyof MilestoneChanges)[]){
        const old=initial[field],after=merged[field];if(old===after)continue;
        // Exact affected history must be representable by the same field contract.
        const checked=parseProposalTool('propose_update_milestone',{milestoneId:row.id,changes:{[field]:old}});
        if(!('milestoneAction' in checked)||checked.milestoneAction!=='update'||checked.changes[field]!==old)throw new AiError('INVALID_INPUT');
        Object.assign(payload,{[field]:after});Object.assign(before,{[field]:old});diff.push({field,before:old as string|null,after:after as string|null});
      }
      if(Buffer.byteLength(JSON.stringify(before),'utf8')>40000||Buffer.byteLength(JSON.stringify(payload),'utf8')>40000||Buffer.byteLength(JSON.stringify(diff),'utf8')>80000)throw new AiError('INVALID_INPUT');
      if(!diff.length){if(newDraft)drafts.splice(drafts.indexOf(newDraft),1);return {pendingApproval:false,summary:'No milestone changes are needed.',proposedActions:drafts.length};}
      if(newDraft?.type==='update_milestone'){newDraft.payload=payload;newDraft.before=before;newDraft.diff=diff;}
      else drafts.push({id:randomUUID(),type:'update_milestone',entityId:row.id,taskId:null,projectId:row.project_id,title:excerpt(row.title,180),payload,before,expectedUpdatedAt:row.updated_at,diff,status:'pending'});
    }
    return {pendingApproval:true,summary:'Prepared a milestone proposal. Nothing has changed yet.',proposedActions:drafts.length};
  }
  if(newDraft)throw new AiError('INVALID_INPUT');
  if('blockAction' in parsed)return collectTimeProposal(parsed,context,drafts);
  if ("entityType" in parsed) {
    const milestone = parsed.entityType === "milestone";
    let query = context.supabase.from(milestone ? "milestones" : "projects").select(milestone ? "id,title,project_id,target_date,updated_at,projects!inner(id,user_id)" : "id,title,target_date,updated_at").eq("id", parsed.entityId);
    query = query.eq(milestone ? "projects.user_id" : "user_id", context.userId);
    const { data, error } = await query.abortSignal(context.signal).maybeSingle();
    if (error) throw new AiError("UPSTREAM_ERROR");
    if (!data) throw new AiError("FORBIDDEN");
    const row = data as unknown as { id: string; title: string; project_id: string; target_date: string | null; updated_at: string };
    const before = { targetDate: row.target_date ?? null };
    const type = milestone ? "reschedule_milestone" : "reschedule_project";
    const existing = drafts.find(draft => draft.type === type && draft.entityId === parsed.entityId);
    if (existing && existing.expectedUpdatedAt !== row.updated_at) throw new AiError("FORBIDDEN");
    if (before.targetDate === parsed.targetDate) throw new AiError("INVALID_INPUT");
    const payload = { targetDate: parsed.targetDate };
    const diff = [{ field: "targetDate" as const, before: before.targetDate, after: parsed.targetDate }];
    if (existing) { existing.payload = payload; existing.diff = diff; }
    else {
      if (drafts.length >= MAX_PROPOSED_ACTIONS_PER_RUN) throw new AiError("AGENT_LIMIT_REACHED");
      drafts.push({ id: randomUUID(), type, entityId: parsed.entityId, taskId: null, projectId: milestone ? row.project_id : row.id, title: excerpt(row.title, 180), payload, before, expectedUpdatedAt: row.updated_at, diff, status: "pending" });
    }
    return { pendingApproval: true, summary: "Prepared a date proposal. No workspace change has occurred.", proposedActions: drafts.length };
  }
  let projectId: string, title: string, before: TaskChanges = {}, version: string | null = null, taskId: string | null = null;
  let changes: TaskChanges;
  let newMilestoneTitle: string | null = null;
  if ("taskId" in parsed) {
    taskId = parsed.taskId; changes = parsed.changes;
    const { data, error } = await context.supabase.from("tasks").select("id,title,description,status,priority,due_date,milestone_id,updated_at,project_id,projects!inner(id,user_id,title)").eq("id", taskId).eq("user_id", context.userId).eq("projects.user_id", context.userId).abortSignal(context.signal).maybeSingle();
    if (error) throw new AiError("UPSTREAM_ERROR");
    if (!data) throw new AiError("FORBIDDEN");
    projectId = data.project_id; title = data.title; version = data.updated_at;
    before = { title: excerpt(data.title, 180), description: excerpt(data.description, 4000), status: data.status, priority: data.priority, dueDate: taskCalendarDate(data.due_date ?? undefined, context.timeZone), milestoneId: data.milestone_id };
  } else {
    const { projectId: id, ...fields } = parsed;
    projectId = id; title = parsed.title;
    const { data, error } = await context.supabase.from("projects").select("id").eq("id", id).eq("user_id", context.userId).abortSignal(context.signal).maybeSingle();
    if (error) throw new AiError("UPSTREAM_ERROR");
    if (!data) throw new AiError("FORBIDDEN");
    changes = { description: "", status: "Backlog", priority: "Medium", dueDate: null, milestoneId: null, ...fields };
  }
  if (changes.milestoneId) {
    const { data, error } = await context.supabase.from("milestones").select("id,title").eq("id", changes.milestoneId).eq("project_id", projectId).abortSignal(context.signal).maybeSingle();
    if (error) throw new AiError("UPSTREAM_ERROR");
    if (!data) throw new AiError("FORBIDDEN");
    newMilestoneTitle = String(data.title ?? "Milestone").slice(0, 180);
  }
  const existing = taskId ? drafts.find((draft):draft is LegacyProposalDraft => draft.type==='update_task'&&draft.taskId === taskId) : undefined;
  if (existing && existing.expectedUpdatedAt !== version) throw new AiError("FORBIDDEN");
  const payload = { ...existing?.payload, ...changes };
  const diff = (Object.keys(payload) as Array<keyof TaskChanges>).filter(field => taskId ? before[field] !== payload[field] : payload[field] !== null && payload[field] !== "").map(field => ({ field, before: before[field] ?? null, after: payload[field] ?? null }));
  const milestoneDiff = diff.find(item => item.field === "milestoneId");
  if (milestoneDiff) {
    if (before.milestoneId) {
      const { data, error } = await context.supabase.from("milestones").select("title").eq("id", before.milestoneId).eq("project_id", projectId).abortSignal(context.signal).maybeSingle();
      if (error) throw new AiError("UPSTREAM_ERROR");
      milestoneDiff.before = String(data?.title ?? "Unavailable milestone").slice(0, 180);
    }
    milestoneDiff.after = Object.hasOwn(changes, "milestoneId") ? newMilestoneTitle : existing?.diff.find(item => item.field === "milestoneId")?.after ?? null;
  }
  if (!diff.length) throw new AiError("INVALID_INPUT");
  if (existing) { existing.payload = payload; existing.diff = diff; }
  else {
    if (drafts.length >= MAX_PROPOSED_ACTIONS_PER_RUN) throw new AiError("AGENT_LIMIT_REACHED");
    drafts.push({ id: randomUUID(), type: taskId ? "update_task" : "create_task", taskId, projectId, title: excerpt(title, 180), payload, before, expectedUpdatedAt: version, diff, status: "pending" });
  }
  return { pendingApproval: true, summary: "Prepared a task proposal. No workspace change has occurred.", proposedActions: drafts.length };
}
