import "server-only";
import {parseTimeBlockTool,timeBlockProposalTools,type TimeBlockInput} from "@/lib/ai/agent/time-block-schema";
import { AiError } from "@/lib/ai/errors";
import { TASK_STATUSES } from "@/data/taskList";
import { isValidCalendarDate } from "@/data/workspaceCalendar";
import { MAX_PROPOSED_ACTIONS_PER_RUN, type TaskChanges, type MilestoneChanges, type MilestoneProposalInput } from "@/lib/ai/agent/contract";
import type {PlanChanges,PlanProposalInput} from '@/lib/ai/agent/contract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function requireUuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) throw new AiError("INVALID_INPUT"); return value; }
function record(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiError("INVALID_INPUT"); return value as Record<string, unknown>; }
function keys(row: Record<string, unknown>, allowed: string[]) { if (Object.keys(row).some(key => !allowed.includes(key))) throw new AiError("INVALID_INPUT"); }
export function parseUndoSelection(value: unknown): {runId:string;actionId:string} {
 const row=record(value);keys(row,['runId','actionId']);
 return {runId:requireUuid(row.runId),actionId:requireUuid(row.actionId)};
}
export function parseTaskChanges(value: unknown): TaskChanges {
  const row = record(value);
  keys(row, ["title", "description", "status", "priority", "dueDate", "milestoneId"]);
  if (!Object.keys(row).length) throw new AiError("INVALID_INPUT");
  const result: TaskChanges = {};
  if (Object.hasOwn(row, "title")) {
    if (typeof row.title !== "string" || !row.title.trim() || row.title.trim().length > 180) throw new AiError("INVALID_INPUT");
    result.title = row.title.trim();
  }
  if (Object.hasOwn(row, "description")) { if (typeof row.description !== "string" || row.description.length > 4000) throw new AiError("INVALID_INPUT"); result.description = row.description; }
  if (Object.hasOwn(row, "status")) { if (!TASK_STATUSES.includes(row.status as never)) throw new AiError("INVALID_INPUT"); result.status = row.status as TaskChanges["status"]; }
  if (Object.hasOwn(row, "priority")) { if (!["Low", "Medium", "High", "Critical"].includes(String(row.priority))) throw new AiError("INVALID_INPUT"); result.priority = row.priority as TaskChanges["priority"]; }
  if (Object.hasOwn(row, "dueDate")) { if (row.dueDate !== null && (typeof row.dueDate !== "string" || !isValidCalendarDate(row.dueDate))) throw new AiError("INVALID_INPUT"); result.dueDate = row.dueDate as string | null; }
  if (Object.hasOwn(row, "milestoneId")) result.milestoneId = row.milestoneId === null ? null : requireUuid(row.milestoneId);
  return result;
}
export type ScheduleInput = { entityId: string; entityType: "milestone" | "project"; targetDate: string | null };
export type ProposalInput = PlanProposalInput | MilestoneProposalInput | TimeBlockInput | ScheduleInput | { taskId: string; changes: TaskChanges } | ({ projectId: string; title: string } & TaskChanges);
function planChanges(value:unknown):PlanChanges {
 const row=record(value);keys(row,['title','description','timeframe','status','targetDate']);if(!Object.keys(row).length)throw new AiError('INVALID_INPUT');
 const out:PlanChanges={};
 for(const field of ['title','description','timeframe'] as const)if(Object.hasOwn(row,field)){
  if(field==='timeframe'&&row[field]===null){out.timeframe=null;continue;}
  if(typeof row[field]!=='string')throw new AiError('INVALID_INPUT');
  const raw=row[field] as string,text=field==='description'?raw:raw.trim();
  if(text.includes('\0')||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)||Array.from(text).length>(field==='description'?4000:180)||(field==='title'&&!text))throw new AiError('INVALID_INPUT');
  out[field]=text;
 }
 if(Object.hasOwn(row,'status')){if(typeof row.status!=='string'||!['Planning','Active','Paused','Completed','Cancelled'].includes(row.status))throw new AiError('INVALID_INPUT');out.status=row.status as PlanChanges['status'];}
 if(Object.hasOwn(row,'targetDate')){
  if(row.targetDate!==null){const date=row.targetDate;if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date.startsWith('0000')||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new AiError('INVALID_INPUT');}
  out.targetDate=row.targetDate as string|null;
 }
 return out;
}
function milestoneChanges(value:unknown):MilestoneChanges {
 const row=record(value);keys(row,['title','description','status','targetDate']);
 if(!Object.keys(row).length)throw new AiError('INVALID_INPUT');
 const result:MilestoneChanges={};
 if(Object.hasOwn(row,'title')){if(typeof row.title!=='string'||!row.title.trim()||row.title.trim().length>180)throw new AiError('INVALID_INPUT');result.title=row.title.trim();}
 if(Object.hasOwn(row,'description')){if(typeof row.description!=='string'||row.description.length>4000)throw new AiError('INVALID_INPUT');result.description=row.description;}
 if(Object.hasOwn(row,'status')){if(typeof row.status!=='string'||!['pending','active','completed'].includes(row.status))throw new AiError('INVALID_INPUT');result.status=row.status as MilestoneChanges['status'];}
 if(Object.hasOwn(row,'targetDate')){if(row.targetDate!==null&&(typeof row.targetDate!=='string'||!isValidCalendarDate(row.targetDate)))throw new AiError('INVALID_INPUT');result.targetDate=row.targetDate as string|null;}
 return result;
}
export function parseProposalTool(name: string, value: unknown): ProposalInput {
  if(timeBlockProposalTools.some(tool=>tool.name===name))return parseTimeBlockTool(name,value);
  const row = record(value);
  if(name==='propose_create_plan'){keys(row,['title','description','timeframe','status','targetDate']);const changes=planChanges(row);if(!changes.title)throw new AiError('INVALID_INPUT');return {planAction:'create',...changes,title:changes.title};}
  if(name==='propose_update_plan'){keys(row,['planId','changes']);return {planAction:'update',planId:requireUuid(row.planId),changes:planChanges(row.changes)};}
  if(name==='propose_create_milestone'){
   keys(row,['projectId','title','description','targetDate']);const {projectId,...fields}=row;
   const changes=milestoneChanges(fields);if(!changes.title)throw new AiError('INVALID_INPUT');
   return {milestoneAction:'create',projectId:requireUuid(projectId),...changes,title:changes.title};
  }
  if(name==='propose_update_milestone'){keys(row,['milestoneId','changes']);return {milestoneAction:'update',milestoneId:requireUuid(row.milestoneId),changes:milestoneChanges(row.changes)};}
  if (name === "propose_reschedule_milestone" || name === "propose_reschedule_project") {
    const entityType = name === "propose_reschedule_milestone" ? "milestone" : "project";
    const key = `${entityType}Id`;
    keys(row, [key, "targetDate"]);
    if (row.targetDate !== null && (typeof row.targetDate !== "string" || !isValidCalendarDate(row.targetDate))) throw new AiError("INVALID_INPUT");
    return { entityId: requireUuid(row[key]), entityType, targetDate: row.targetDate as string | null };
  }
  if (name === "propose_update_task") {
    keys(row, ["taskId", "changes"]);
    return { taskId: requireUuid(row.taskId), changes: parseTaskChanges(row.changes) };
  }
  if (name !== "propose_create_task") throw new AiError("MALFORMED_OUTPUT");
  keys(row, ["projectId", "title", "description", "status", "priority", "dueDate", "milestoneId"]);
  const { projectId, ...fields } = row;
  const changes = parseTaskChanges(fields);
  if (!changes.title) throw new AiError("INVALID_INPUT");
  return { projectId: requireUuid(projectId), ...changes, title: changes.title };
}
export function parseActionSelection(value: unknown): { runId: string; actionIds: string[] } {
  const row = record(value); keys(row, ["runId", "actionIds"]);
  if (!Array.isArray(row.actionIds) || !row.actionIds.length || row.actionIds.length > MAX_PROPOSED_ACTIONS_PER_RUN || new Set(row.actionIds).size !== row.actionIds.length) throw new AiError("INVALID_INPUT");
  return { runId: requireUuid(row.runId), actionIds: row.actionIds.map(requireUuid) };
}
const fields = {
  title: { type: "string", maxLength: 180 }, description: { type: "string", maxLength: 4000 },
  status: { type: "string", enum: [...TASK_STATUSES] }, priority: { type: "string", enum: ["Low", "Medium", "High", "Critical"] },
  dueDate: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear" }, milestoneId: { type: ["string", "null"], description: "UUID of a milestone in the same project, or null" },
};
export const proposalTools = [
  {name:'propose_create_plan',description:'Prepare one user-owned Plan record for approval, without checklist items.',parametersJsonSchema:{type:'object',properties:{title:fields.title,description:fields.description,timeframe:{type:['string','null'],maxLength:180},status:{type:'string',enum:['Planning','Active','Paused','Completed','Cancelled']},targetDate:fields.dueDate},required:['title'],additionalProperties:false}},
  {name:'propose_update_plan',description:'Prepare one Plan record patch. Group fields in one call; do not mix mutations.',parametersJsonSchema:{type:'object',properties:{planId:{type:'string'},changes:{type:'object',properties:{title:fields.title,description:fields.description,timeframe:{type:['string','null'],maxLength:180},status:{type:'string',enum:['Planning','Active','Paused','Completed','Cancelled']},targetDate:fields.dueDate},minProperties:1,additionalProperties:false}},required:['planId','changes'],additionalProperties:false}},
  {name:'propose_create_milestone',description:'Prepare one milestone creation for approval. Nothing changes until Apply.',parametersJsonSchema:{type:'object',properties:{projectId:{type:'string'},title:fields.title,description:fields.description,targetDate:{type:['string','null'],description:'YYYY-MM-DD or null'}},required:['projectId','title'],additionalProperties:false}},
  {name:'propose_update_milestone',description:'Prepare one milestone patch for approval. Group all changes in one call; do not mix with another mutation.',parametersJsonSchema:{type:'object',properties:{milestoneId:{type:'string'},changes:{type:'object',properties:{title:fields.title,description:fields.description,status:{type:'string',enum:['pending','active','completed']},targetDate:{type:['string','null'],description:'YYYY-MM-DD or null to clear'}},minProperties:1,additionalProperties:false}},required:['milestoneId','changes'],additionalProperties:false}},
  ...timeBlockProposalTools,
  ...(["milestone", "project"] as const).map(entity => ({ name: `propose_reschedule_${entity}`, description: `Prepare ONLY a ${entity} target date change for approval. Does not mutate data.`, parametersJsonSchema: { type: "object", properties: { [`${entity}Id`]: { type: "string" }, targetDate: { type: ["string", "null"], description: "Valid YYYY-MM-DD or null to clear" } }, required: [`${entity}Id`, "targetDate"], additionalProperties: false } })),
  { name: "propose_create_task", description: "Prepare a task creation for user review. Does NOT create a task. Never claim it was applied.", parametersJsonSchema: { type: "object", properties: { projectId: { type: "string" }, ...fields }, required: ["projectId", "title"], additionalProperties: false } },
  { name: "propose_update_task", description: "Prepare a task patch for user review. Does NOT update a task. Group fields for each task in one call.", parametersJsonSchema: { type: "object", properties: { taskId: { type: "string" }, changes: { type: "object", properties: fields, minProperties: 1, additionalProperties: false } }, required: ["taskId", "changes"], additionalProperties: false } },
];
