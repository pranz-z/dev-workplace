import "server-only";
import type {SupabaseClient} from '@supabase/supabase-js';
import {AiError} from '@/lib/ai/errors';
import {UNDO_REASONS,type UndoEligibility,type AgentActionReference,type ProposalBatch} from '@/lib/ai/agent/contract';
type Row=Record<string,unknown>;
function row(value:unknown):Row {if(!value||typeof value!=='object'||Array.isArray(value))throw new AiError('UPSTREAM_ERROR');return value as Row;}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function projectUndoReference(value:unknown):AgentActionReference|null {
 if(value==null)return null;const r=row(value);
 if(!uuid(r.runId)||!uuid(r.actionId)||typeof r.createdAt!=='string'||r.createdAt.length>40||!Number.isFinite(Date.parse(r.createdAt)))throw new AiError('UPSTREAM_ERROR');
 return {runId:r.runId,actionId:r.actionId,createdAt:r.createdAt};
}
/** Projection only. Eligibility and inverse derivation belong exclusively to SQL. */
export function projectUndoEligibility(value:unknown):UndoEligibility {
 const r=row(value);
 if(!UNDO_REASONS.includes(r.reason as never)||!['available','unsafe','already_reversed','entity_missing','state_changed','unsupported'].includes(String(r.state))||typeof r.explanation!=='string')throw new AiError('UPSTREAM_ERROR');
 const projected:UndoEligibility={state:r.state as UndoEligibility['state'],reason:r.reason as UndoEligibility['reason'],explanation:r.explanation.slice(0,240)};
 if(typeof r.inverseSummary==='string')projected.inverseSummary=r.inverseSummary.slice(0,180);
 if(r.existingInverse){const linked=row(r.existingInverse),ref=projectUndoReference(linked);if(!ref||!['pending','applied'].includes(String(linked.status)))throw new AiError('UPSTREAM_ERROR');projected.existingInverse={...ref,status:linked.status as 'pending'|'applied'};}
 return projected;
}
export interface PrepareUndoResult {eligibility:UndoEligibility;proposalBatch?:ProposalBatch}
export async function prepareAgentUndo(admin:SupabaseClient,userId:string,selection:{runId:string;actionId:string}):Promise<PrepareUndoResult> {
 const {data,error}=await admin.rpc('prepare_agent_undo',{p_user_id:userId,p_run_id:selection.runId,p_action_id:selection.actionId});
 if(error)throw new AiError('UPSTREAM_ERROR');if(!data)throw new AiError('FORBIDDEN');
 const result=row(data),eligibility=projectUndoEligibility(result.eligibility);
 if(result.proposalBatch){const batch=row(result.proposalBatch);if(!uuid(batch.runId)||!Array.isArray(batch.actions)||batch.actions.length>10)throw new AiError('UPSTREAM_ERROR');return {eligibility,proposalBatch:batch as unknown as ProposalBatch};}
 return {eligibility};
}
