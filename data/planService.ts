import type { Plan, PlanItem, PlanStatus } from "@/types";
import { getWorkspaceContext } from "@/data/context";
import { mapPlanItemRow, mapPlanRow } from "@/data/mappers";
import type { PlanItemRow, PlanRow } from "@/data/database.types";
import {
  DELETE_FAILED_MESSAGE,
  describeDatabaseError,
  SAVE_FAILED_MESSAGE,
  serviceFail,
  serviceOk,
  type ServiceResult,
} from "@/data/serviceResult";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const PLAN_COLUMNS = "id, user_id, title, description, timeframe, status, target_date, created_at, updated_at";
const PLAN_ITEM_COLUMNS = "id, plan_id, project_id, task_id, label, done, sort_order, created_at, updated_at";

export async function listPlans(): Promise<Plan[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();

  const [{ data: plans, error: planError }, { data: items, error: itemError }] = await Promise.all([
    supabase.from("plans").select(PLAN_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("project_plan_items").select(PLAN_ITEM_COLUMNS).order("sort_order", { ascending: true }),
  ]);
  if (planError) throw planError;
  if (itemError) throw itemError;

  const planItems = (items ?? []) as PlanItemRow[];
  return ((plans ?? []) as PlanRow[]).map((row) => mapPlanRow(row, planItems));
}

export interface PlanItemInput {
  label: string;
  projectId?: string | null;
  taskId?: string | null;
}

export interface PlanInput {
  title: string;
  goal?: string;
  timeframe?: string | null;
  status?: PlanStatus;
  targetDate?: string | null;
  items?: PlanItemInput[];
}

export async function createPlan(input: PlanInput): Promise<ServiceResult<Plan>> {
  const title = input.title.trim();
  if (title.length === 0) return serviceFail("Give the plan a title first.");

  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase
    .from("plans")
    .insert({
      user_id: context.userId,
      title,
      description: input.goal ?? "",
      timeframe: input.timeframe ?? null,
      status: input.status ?? "Planning",
      target_date: input.targetDate ?? null,
    })
    .select(PLAN_COLUMNS)
    .single();
  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));

  const planRow = data as PlanRow;
  const items = input.items ?? [];
  if (items.length === 0) return serviceOk(mapPlanRow(planRow, []));

  const { data: itemRows, error: itemError } = await context.supabase
    .from("project_plan_items")
    .insert(
      items.map((item, index) => ({
        plan_id: planRow.id,
        project_id: item.projectId ?? null,
        task_id: item.taskId ?? null,
        label: item.label,
        sort_order: index + 1,
      })),
    )
    .select(PLAN_ITEM_COLUMNS);
  if (itemError) return serviceFail(describeDatabaseError(itemError, SAVE_FAILED_MESSAGE));

  return serviceOk(mapPlanRow(planRow, (itemRows ?? []) as PlanItemRow[]));
}

export interface PlanPatch {
  title?: string;
  goal?: string;
  timeframe?: string | null;
  status?: PlanStatus;
  targetDate?: string | null;
}

export async function updatePlan(planId: string, patch: PlanPatch): Promise<ServiceResult<Plan>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0) return serviceFail("Give the plan a title first.");
    payload.title = title;
  }
  if (patch.goal !== undefined) payload.description = patch.goal;
  if (patch.timeframe !== undefined) payload.timeframe = patch.timeframe ?? null;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.targetDate !== undefined) payload.target_date = patch.targetDate ?? null;
  if (Object.keys(payload).length === 0) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase.from("plans").update(payload).eq("id", planId).select(PLAN_COLUMNS).single();
  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));

  const { data: items, error: itemError } = await context.supabase
    .from("project_plan_items")
    .select(PLAN_ITEM_COLUMNS)
    .eq("plan_id", planId)
    .order("sort_order", { ascending: true });
  if (itemError) return serviceFail(describeDatabaseError(itemError, SAVE_FAILED_MESSAGE));

  return serviceOk(mapPlanRow(data as PlanRow, (items ?? []) as PlanItemRow[]));
}

export async function setPlanStatus(planId: string, status: PlanStatus): Promise<ServiceResult<Plan>> {
  return updatePlan(planId, { status });
}

export async function deletePlan(planId: string): Promise<ServiceResult<{ id: string }>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(DELETE_FAILED_MESSAGE);

  const { error } = await context.supabase.from("plans").delete().eq("id", planId);
  if (error) return serviceFail(describeDatabaseError(error, DELETE_FAILED_MESSAGE));
  return serviceOk({ id: planId });
}

// @@APPEND@@
