import 'server-only';
import {AiError} from '@/lib/ai/errors';
import {getGeminiConfiguration} from '@/lib/ai/config';
import {getSupabaseAdminClient} from '@/lib/supabase/admin';
import {isPulseProjectId,isPulseRevision} from '@/data/agentInbox';
import type {OneShotPreviewDto,OneShotStatusDto} from '@/data/agentOneShot';
import {buildOneShotContext,oneShotParents,oneShotFingerprint,ONE_SHOT_REASONS,type OneShotBinding,type OneShotAccounting,type OneShotStatus} from './one-shot';
import type {PulseSourceSnapshot} from './types';
import {pulseOwnerBoundary,pulseOwnerBody,pulseOwnerFailure} from './routes';
const headers={'Cache-Control':'no-store'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
class PreviewChanged extends Error{}
function failure(error:unknown):Response{return error instanceof PreviewChanged?json({error:{code:'STATE_CHANGED',message:'Authorization facts changed. Refresh and review again.'}},409):pulseOwnerFailure(error);}
async function pulseOwnerRpc(name:'agent_pulse_one_shot_list'|'agent_pulse_one_shot_preview'|'agent_pulse_one_shot_create'|'agent_pulse_one_shot_cancel',args:Record<string,unknown>):Promise<unknown>{
 const {data,error}=await getSupabaseAdminClient().rpc(name,args);
 if(error){if(error.code==='40001')throw new PreviewChanged();if(error.code==='22023')throw new AiError('INVALID_INPUT');throw new AiError('UPSTREAM_ERROR');}
 return data;
}
const invalid=():never=>{throw new AiError('INVALID_INPUT');};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new AiError('UPSTREAM_ERROR');return value as Record<string,unknown>;}
function input(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();const r=value as Record<string,unknown>;if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))invalid();return r;}
function label(value:unknown,max=120):string {if(typeof value!=='string'||Array.from(value).length>max)throw new AiError('UPSTREAM_ERROR');return value;}
function stamp(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value)||!Number.isFinite(Date.parse(value)))throw new AiError('UPSTREAM_ERROR');return value;}
function statusDto(value:unknown):OneShotStatusDto {
 const r=object(value),b=object(r.binding),a=object(r.accounting);
 if(!isPulseProjectId(b.id)||!['pending','consumed','completed','blocked','expired','cancelled','failed'].includes(String(r.status))||
  (r.reason!==null&&!ONE_SHOT_REASONS.includes(r.reason as never))||['allowanceConsumed','sendAttempted','responseReceived','publicationCompleted'].some(k=>typeof a[k]!=='boolean')||
  !['not_started','unknown','confirmed'].includes(String(a.transport))||!['none','accepted','rejected'].includes(String(a.output))||b.provider!=='gemini')throw new AiError('UPSTREAM_ERROR');
 return {id:b.id,projectTitle:r.projectTitle==null?'Unavailable project':label(r.projectTitle),signalTitle:r.signalTitle==null?'Unavailable signal':label(r.signalTitle),
  status:r.status as OneShotStatus,reason:r.reason as OneShotStatusDto['reason'],slot:stamp(b.slot),expiresAt:stamp(b.expiresAt),provider:'gemini',model:label(b.model),
  accounting:{allowanceConsumed:a.allowanceConsumed as boolean,sendAttempted:a.sendAttempted as boolean,transport:a.transport as OneShotAccounting['transport'],
   responseReceived:a.responseReceived as boolean,output:a.output as OneShotAccounting['output'],publicationCompleted:a.publicationCompleted as boolean}};
}
async function preview(owner:string,parentId:string):Promise<{dto:OneShotPreviewDto;binding:OneShotBinding}|null>{
 const configuration=getGeminiConfiguration();if(!configuration.configured||!configuration.model)throw new AiError('AI_NOT_CONFIGURED');
 const raw=await pulseOwnerRpc('agent_pulse_one_shot_preview',{p_user_id:owner,p_parent_id:parentId});if(raw===null)return null;
 const r=object(raw),b=object(r.binding),source=r.source as PulseSourceSnapshot;
 if(b.ownerId!==owner||b.parentId!==parentId||!isPulseProjectId(b.projectId)||!isPulseRevision(b.contentRevision)||!source)throw new AiError('UPSTREAM_ERROR');
 const binding={...b,model:configuration.model,contextFingerprint:''} as unknown as OneShotBinding;
 const result=buildOneShotContext(source,oneShotParents(source,binding),binding,{configured:configuration.configured,provider:'gemini',model:configuration.model},'preview');
 if(!result.ok)return null;
 binding.contextFingerprint=oneShotFingerprint(result.context.contents);
 const previewIdentity=oneShotFingerprint(JSON.stringify([owner,binding.projectId,parentId,binding.contentRevision,binding.episode,binding.family,binding.sourceToken,
  binding.slot,binding.expiresAt,binding.settingsRevision,binding.provider,binding.model,binding.authorizationVersion,binding.contextPolicyVersion,binding.contextFingerprint]));
 const payload=JSON.parse(result.context.contents) as {signals:Array<{reasonCodes:string[]}>};
 return {binding,dto:{parentId,previewIdentity,projectTitle:label(r.projectTitle),signalTitle:label(r.signalTitle),family:binding.family,
  reasonCodes:payload.signals[0].reasonCodes,contentRevision:binding.contentRevision,slot:stamp(binding.slot),expiresAt:stamp(binding.expiresAt),
  evidenceValidUntil:stamp(r.evidenceValidUntil),provider:'gemini',model:label(configuration.model),context:result.context.contents,maxProviderRequests:1,billingTreatment:'unknown_free'}};
}
export async function handleOneShotPreview(request:Request):Promise<Response>{
 try{const {owner}=await pulseOwnerBoundary(request,['GET'],true);const query=new URL(request.url).searchParams;
  if([...query].length!==1||!query.has('parentId')||!isPulseProjectId(query.get('parentId')))invalid();
  return json((await preview(owner,query.get('parentId')!))?.dto??null);
 }catch(error){return failure(error);}
}
export async function handleOneShot(request:Request):Promise<Response>{
 try{const {owner}=await pulseOwnerBoundary(request,['GET','POST']);
  if(request.method==='GET'){
   const raw=object(await pulseOwnerRpc('agent_pulse_one_shot_list',{p_user_id:owner}));
   if(!Array.isArray(raw.items)||raw.items.length>20||!Array.isArray(raw.candidateIds)||raw.candidateIds.length>20)throw new AiError('UPSTREAM_ERROR');
   const candidates:OneShotPreviewDto[]=[];
   const configured=getGeminiConfiguration();
   if(configured.configured&&configured.model)for(const id of raw.candidateIds){if(!isPulseProjectId(id))throw new AiError('UPSTREAM_ERROR');const p=await preview(owner,id);if(p)candidates.push(p.dto);}
   return json({items:raw.items.map(statusDto),candidates});
  }
  const body=input(await pulseOwnerBody(request),['parentId','previewIdentity']);
  if(!isPulseProjectId(body.parentId)||typeof body.previewIdentity!=='string'||!/^[0-9a-f]{64}$/.test(body.previewIdentity))invalid();
  const p=await preview(owner,body.parentId as string);if(!p||p.dto.previewIdentity!==body.previewIdentity)return json({error:{code:'STATE_CHANGED',message:'Authorization facts changed. Refresh and review again.'}},409);
  const b=p.binding;
  const value=await pulseOwnerRpc('agent_pulse_one_shot_create',{p_user_id:owner,p_parent_id:b.parentId,p_revision:b.contentRevision,p_slot:b.slot,p_model:b.model,
   p_source_token:b.sourceToken,p_context_fingerprint:b.contextFingerprint,p_expected_binding:b});
  return json(statusDto({...object(value),projectTitle:p.dto.projectTitle,signalTitle:p.dto.signalTitle}));
 }catch(error){return failure(error);}
}
export async function handleOneShotCancel(request:Request):Promise<Response>{
 try{const {owner}=await pulseOwnerBoundary(request,['POST']);const body=input(await pulseOwnerBody(request),['authorizationId']);
  if(!isPulseProjectId(body.authorizationId))invalid();
  const value=await pulseOwnerRpc('agent_pulse_one_shot_cancel',{p_user_id:owner,p_id:body.authorizationId});
  if(value===null)throw new AiError('FORBIDDEN');return json(statusDto(value));
 }catch(error){return failure(error);}
}
