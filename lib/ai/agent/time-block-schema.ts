import "server-only";
import {AiError} from "@/lib/ai/errors";
import {validClock,type TimeBlockKind,type TimeBlockStatus} from "@/data/timeBlocks";
export interface TimeBlockChanges {title?:string;startAt?:string;endAt?:string;projectId?:string|null;taskId?:string|null;kind?:TimeBlockKind;status?:TimeBlockStatus}
export interface TimeBlockInput {blockAction:'create'|'update'|'cancel'|'plan'|'find';timeBlockId?:string;changes?:TimeBlockChanges;date?:string;durationMinutes?:number;earliestTime?:string;latestTime?:string;taskId?:string}
function invalid():never{throw new AiError('INVALID_INPUT');}
function record(v:unknown){if(!v||typeof v!=='object'||Array.isArray(v))invalid();return v as Record<string,unknown>;}
function keys(row:Record<string,unknown>,allowed:string[]){if(Object.keys(row).some(k=>!allowed.includes(k)))invalid();}
function id(v:unknown){if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))invalid();return v;}
function changes(v:unknown):TimeBlockChanges {
 const row=record(v);keys(row,['title','startAt','endAt','projectId','taskId','kind','status']);if(!Object.keys(row).length)invalid();const result:TimeBlockChanges={};
 for(const [key,value] of Object.entries(row)) {
  if(key==='title'){if(typeof value!=='string'||!value.trim()||value.trim().length>180)invalid();result.title=value.trim();}
  if(key==='startAt'||key==='endAt'){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))invalid();result[key]=value;}
  if(key==='projectId'||key==='taskId')result[key]=value===null?null:id(value);
  if(key==='kind'){if(!['focus','task','break','custom'].includes(String(value)))invalid();result.kind=value as TimeBlockKind;}
  if(key==='status'){if(!['scheduled','completed','cancelled'].includes(String(value)))invalid();result.status=value as TimeBlockStatus;}
 }return result;
}
export function parseTimeBlockTool(name:string,value:unknown):TimeBlockInput {
 const row=record(value);
 if(name==='propose_plan_day'||name==='propose_find_time') {
  keys(row,['date','durationMinutes','earliestTime','latestTime',...(name==='propose_find_time'?['taskId']:[])]);
  if(typeof row.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(Date.parse(row.date))||new Date(row.date).toISOString().slice(0,10)!==row.date)invalid();
  if(row.durationMinutes!==undefined&&(!Number.isInteger(row.durationMinutes)||Number(row.durationMinutes)<1||Number(row.durationMinutes)>720))invalid();
  for(const key of ['earliestTime','latestTime'])if(row[key]!==undefined&&(typeof row[key]!=='string'||!validClock(row[key] as string)))invalid();
  if(name==='propose_find_time'&&row.durationMinutes===undefined)invalid();
  return {blockAction:name==='propose_plan_day'?'plan':'find',date:row.date,durationMinutes:row.durationMinutes as number|undefined,earliestTime:row.earliestTime as string|undefined,latestTime:row.latestTime as string|undefined,...(name==='propose_find_time'?{taskId:id(row.taskId)}:{})};
 }
 if(name==='propose_cancel_time_block'){keys(row,['timeBlockId']);return {blockAction:'cancel',timeBlockId:id(row.timeBlockId),changes:{status:'cancelled'}};}
 if(name==='propose_update_time_block'){keys(row,['timeBlockId','changes']);return {blockAction:'update',timeBlockId:id(row.timeBlockId),changes:changes(row.changes)};}
 keys(row,['title','startAt','endAt','projectId','taskId','kind']);const patch=changes(row);if(!patch.title||!patch.startAt||!patch.endAt)invalid();return {blockAction:'create',changes:patch};
}
const field={type:'string'},nullable={type:['string','null']};
const blockFields={title:{type:'string',maxLength:180},startAt:{type:'string',description:'Local YYYY-MM-DDTHH:mm in workspace timezone. Explicit user times only; for duration requests use propose_find_time.'},endAt:{type:'string',description:'Local YYYY-MM-DDTHH:mm in workspace timezone.'},projectId:nullable,taskId:nullable,kind:{type:'string',enum:['focus','task','break','custom']}};
const planningFields={date:{type:'string',description:'YYYY-MM-DD'},durationMinutes:{type:'integer',minimum:1,maximum:720},earliestTime:{type:'string',description:'Explicit HH:mm'},latestTime:{type:'string',description:'Explicit HH:mm'}};
export const timeBlockProposalTools=[
 {name:'propose_create_time_block',description:'Propose an explicitly requested local time range. No mutation before Apply.',parametersJsonSchema:{type:'object',properties:blockFields,required:['title','startAt','endAt'],additionalProperties:false}},
 {name:'propose_update_time_block',description:'Propose changes to one unambiguously identified existing block.',parametersJsonSchema:{type:'object',properties:{timeBlockId:field,changes:{type:'object',properties:{...blockFields,status:{type:'string',enum:['scheduled','completed','cancelled']}},minProperties:1,additionalProperties:false}},required:['timeBlockId','changes'],additionalProperties:false}},
 {name:'propose_cancel_time_block',description:'Propose soft cancellation of a persisted block; requires approval.',parametersJsonSchema:{type:'object',properties:{timeBlockId:field},required:['timeBlockId'],additionalProperties:false}},
 {name:'propose_plan_day',description:'Server ranks incomplete tasks, computes verified slots and proposes a bounded plan. Use for Plan my day/tomorrow. Never invent times.',parametersJsonSchema:{type:'object',properties:planningFields,required:['date'],additionalProperties:false}},
 {name:'propose_find_time',description:'Server computes the first verified slot for one incomplete task and proposes it. No proposal if none fits.',parametersJsonSchema:{type:'object',properties:{...planningFields,taskId:field},required:['date','taskId','durationMinutes'],additionalProperties:false}},
];
