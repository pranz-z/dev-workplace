import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiError } from "@/lib/ai/errors";
import type { ActionResult, ProposalBatch, ProposalDraft } from "@/lib/ai/agent/contract";
import { MAX_PROPOSED_ACTIONS_PER_RUN } from "@/lib/ai/agent/contract";

export async function saveProposalBatch(admin: SupabaseClient, userId: string, drafts: ProposalDraft[]): Promise<ProposalBatch> {
  const { data, error } = await admin.rpc("save_agent_proposal_batch", { p_user_id: userId, p_actions: drafts });
  if (error || !data) throw new AiError("UPSTREAM_ERROR");
  return data as ProposalBatch;
}
export async function loadProposalBatch(admin: SupabaseClient, userId: string, runId: string): Promise<ProposalBatch> {
  const { data, error } = await admin.rpc("get_agent_proposal_batch", { p_user_id: userId, p_run_id: runId });
  if (error) throw new AiError("UPSTREAM_ERROR");
  if (!data) throw new AiError("FORBIDDEN");
  const batch = data as ProposalBatch;
  if (!Array.isArray(batch.actions) || batch.actions.length > MAX_PROPOSED_ACTIONS_PER_RUN) throw new AiError("UPSTREAM_ERROR");
  return batch;
}
export async function applySelectedActions(admin: SupabaseClient, userId: string, batch: ProposalBatch, actionIds: string[]): Promise<ActionResult[]> {
  if (actionIds.some(id => !batch.actions.some(action => action.id === id))) throw new AiError("FORBIDDEN");
  const results: ActionResult[] = [];
  for (const id of actionIds) {
    // SQL reloads and revalidates canonical payload, ownership and version under locks.
    const { data, error } = await admin.rpc("apply_agent_task_action", { p_user_id: userId, p_run_id: batch.runId, p_action_id: id });
    if (error || !data) results.push({ id, status: "pending", errorCode: "RETRY_STATUS" });
    else results.push(data as ActionResult);
  }
  return results;
}
export async function cancelSelectedActions(admin: SupabaseClient, userId: string, runId: string, actionIds: string[]): Promise<ProposalBatch> {
  const { data, error } = await admin.rpc("cancel_agent_task_actions", { p_user_id: userId, p_run_id: runId, p_action_ids: actionIds });
  if (error) throw new AiError("UPSTREAM_ERROR");
  if (!data) throw new AiError("FORBIDDEN");
  return data as ProposalBatch;
}
