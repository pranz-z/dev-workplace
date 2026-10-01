import type { PlanItem } from "@/types";
import { getWorkspaceContext, isUuid } from "@/data/context";
import { mapPlanItemRow } from "@/data/mappers";
import type { PlanItemRow } from "@/data/database.types";
import { DELETE_FAILED_MESSAGE, describeDatabaseError, SAVE_FAILED_MESSAGE, serviceFail, serviceOk, type ServiceResult } from "@/data/serviceResult";

const PLAN_ITEM_COLUMNS = "id, plan_id, project_id, task_id, label, done, sort_order, created_at, updated_at";

/** Adds a checklist step. `label` is free text; a project/task link is optional. */
export async function createPlanItem(planId: string, input: { label: string; projectId?: string | null; taskId?: string | null }): Promise<ServiceResult<PlanItem>> {
  const label = input.label.trim();
  if (label.length === 0) return serviceFail("Give the plan step a label first.");
  if (!isUuid(planId) || (input.projectId && !isUuid(input.projectId)) || (input.taskId && !isUuid(input.taskId))) {
    return serviceFail("That plan, project, or task is no longer available. Refresh and try again.");
  }

  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data: last, error: orderError } = await context.supabase
    .from("project_plan_items")
    .select("sort_order")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) return serviceFail(describeDatabaseError(orderError, SAVE_FAILED_MESSAGE));

  const { data, error } = await context.supabase
    .from("project_plan_items")
    .insert({
      plan_id: planId,
      project_id: input.projectId ?? null,
      task_id: input.taskId ?? null,
      label,
      sort_order: ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 1,
    })
    .select(PLAN_ITEM_COLUMNS)
    .single();
  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapPlanItemRow(data as PlanItemRow));
}

export async function setPlanItemDone(itemId: string, done: boolean): Promise<ServiceResult<PlanItem>> {
  if (!isUuid(itemId)) return serviceFail("That plan step is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase
    .from("project_plan_items")
    .update({ done })
    .eq("id", itemId)
    .select(PLAN_ITEM_COLUMNS)
    .single();
  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapPlanItemRow(data as PlanItemRow));
}

export async function deletePlanItem(itemId: string): Promise<ServiceResult<{ id: string }>> {
  if (!isUuid(itemId)) return serviceFail("That plan step is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(DELETE_FAILED_MESSAGE);

  const { error } = await context.supabase.from("project_plan_items").delete().eq("id", itemId);
  if (error) return serviceFail(describeDatabaseError(error, DELETE_FAILED_MESSAGE));
  return serviceOk({ id: itemId });
}
