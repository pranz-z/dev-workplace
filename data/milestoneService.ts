import type { Milestone } from "@/types";
import { getWorkspaceContext, isUuid } from "@/data/context";
import { mapMilestoneRow } from "@/data/mappers";
import type { MilestoneRow } from "@/data/database.types";
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

const MILESTONE_COLUMNS = "id, project_id, title, description, status, target_date, sort_order, created_at, updated_at";

export async function listMilestones(): Promise<Milestone[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.from("milestones").select(MILESTONE_COLUMNS).order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => mapMilestoneRow(row as MilestoneRow));
}

export async function listProjectMilestones(projectId: string): Promise<Milestone[]> {
  if (!isUuid(projectId)) return [];
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("milestones")
    .select(MILESTONE_COLUMNS)
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => mapMilestoneRow(row as MilestoneRow));
}

export interface MilestoneInput {
  projectId: string;
  title: string;
  description?: string;
  targetDate?: string | null;
}

export async function createMilestone(input: MilestoneInput): Promise<ServiceResult<Milestone>> {
  const title = input.title.trim();
  if (title.length === 0) return serviceFail("Give the milestone a title first.");
  if (!isUuid(input.projectId)) return serviceFail("That project is no longer available. Refresh and try again.");

  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  // Append to the end of the project's milestone order.
  const { data: last, error: orderError } = await context.supabase
    .from("milestones")
    .select("sort_order")
    .eq("project_id", input.projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) return serviceFail(describeDatabaseError(orderError, SAVE_FAILED_MESSAGE));
  const nextOrder = ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 1;

  const { data, error } = await context.supabase
    .from("milestones")
    .insert({
      project_id: input.projectId,
      title,
      description: input.description ?? "",
      target_date: input.targetDate ?? null,
      sort_order: nextOrder,
      status: "pending",
    })
    .select(MILESTONE_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapMilestoneRow(data as MilestoneRow));
}

export interface MilestonePatch {
  title?: string;
  description?: string;
  targetDate?: string | null;
}

export async function updateMilestone(milestoneId: string, patch: MilestonePatch): Promise<ServiceResult<Milestone>> {
  if (!isUuid(milestoneId)) return serviceFail("That milestone is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0) return serviceFail("Give the milestone a title first.");
    payload.title = title;
  }
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.targetDate !== undefined) payload.target_date = patch.targetDate ?? null;
  if (Object.keys(payload).length === 0) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase
    .from("milestones")
    .update(payload)
    .eq("id", milestoneId)
    .select(MILESTONE_COLUMNS)
    .single();
  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapMilestoneRow(data as MilestoneRow));
}

export async function setMilestoneStatus(milestoneId: string, status: Milestone["status"]): Promise<ServiceResult<Milestone>> {
  if (!isUuid(milestoneId)) return serviceFail("That milestone is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase
    .from("milestones")
    .update({ status })
    .eq("id", milestoneId)
    .select(MILESTONE_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapMilestoneRow(data as MilestoneRow));
}

/**
 * Reordering swaps sort_order with the neighbouring milestone of the same
 * project, so the stored order is always the rendered order.
 */
export async function moveMilestone(milestoneId: string, direction: "up" | "down"): Promise<ServiceResult<Milestone[]>> {
  if (!isUuid(milestoneId)) return serviceFail("That milestone is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data: current, error: currentError } = await context.supabase
    .from("milestones")
    .select(MILESTONE_COLUMNS)
    .eq("id", milestoneId)
    .single();
  if (currentError) return serviceFail(describeDatabaseError(currentError, SAVE_FAILED_MESSAGE));

  const milestone = current as MilestoneRow;
  const { data: siblings, error: siblingsError } = await context.supabase
    .from("milestones")
    .select(MILESTONE_COLUMNS)
    .eq("project_id", milestone.project_id)
    .order("sort_order", { ascending: true });
  if (siblingsError) return serviceFail(describeDatabaseError(siblingsError, SAVE_FAILED_MESSAGE));

  const rows = (siblings ?? []) as MilestoneRow[];
  const index = rows.findIndex((row) => row.id === milestoneId);
  const neighbourIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || neighbourIndex < 0 || neighbourIndex >= rows.length) {
    return serviceOk(rows.map(mapMilestoneRow));
  }

  const neighbour = rows[neighbourIndex];
  const swap = await Promise.all([
    context.supabase.from("milestones").update({ sort_order: neighbour.sort_order }).eq("id", milestone.id),
    context.supabase.from("milestones").update({ sort_order: milestone.sort_order }).eq("id", neighbour.id),
  ]);
  const swapError = swap.find((result) => result.error)?.error;
  if (swapError) return serviceFail(describeDatabaseError(swapError, SAVE_FAILED_MESSAGE));

  const reordered = [...rows];
  reordered[index] = { ...milestone, sort_order: neighbour.sort_order };
  reordered[neighbourIndex] = { ...neighbour, sort_order: milestone.sort_order };
  reordered.sort((a, b) => a.sort_order - b.sort_order);
  return serviceOk(reordered.map(mapMilestoneRow));
}

export async function deleteMilestone(milestoneId: string): Promise<ServiceResult<{ id: string }>> {
  if (!isUuid(milestoneId)) return serviceFail("That milestone is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(DELETE_FAILED_MESSAGE);

  const { error } = await context.supabase.from("milestones").delete().eq("id", milestoneId);
  if (error) return serviceFail(describeDatabaseError(error, DELETE_FAILED_MESSAGE));
  return serviceOk({ id: milestoneId });
}

