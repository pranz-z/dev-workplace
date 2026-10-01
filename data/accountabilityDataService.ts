import { getWorkspaceContext, isUuid } from "@/data/context";
import type { AccountabilityGoalRow, AccountabilitySnapshotRow } from "@/data/database.types";
import { describeDatabaseError, SAVE_FAILED_MESSAGE, serviceFail, serviceOk, type ServiceResult } from "@/data/serviceResult";

const GOAL_COLUMNS = "id,user_id,project_id,title,description,metric,target,period_start,period_end,status,manual_progress,created_at,updated_at";
const SNAPSHOT_COLUMNS = "id,user_id,project_id,snapshot_date,captured_at,score,health,factors,github_status,model_version,created_at,updated_at";

function logGoalSaveError(operation: "insert_accountability_goal" | "update_accountability_goal", error: { code?: string; message?: string; details?: string | null; hint?: string | null }) {
  const sanitize = (value?: string | null) => value
    ?.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sb_(?:secret|publishable)_[A-Za-z0-9_]+)\b/g, "[redacted]")
    .replace(/\b(password|secret|token|private[_ -]?key|service[_ -]?role)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500) ?? null;

  console.error("[accountability] goal save failed", {
    operation,
    code: error.code ?? null,
    message: sanitize(error.message),
    details: sanitize(error.details),
    hint: sanitize(error.hint),
  });
}

export async function listAccountabilityData(): Promise<{ goals: AccountabilityGoalRow[]; snapshots: AccountabilitySnapshotRow[] }> {
  const context = await getWorkspaceContext();
  if (!context) throw new Error(SAVE_FAILED_MESSAGE);
  const [goals, snapshots] = await Promise.all([
    context.supabase.from("accountability_goals").select(GOAL_COLUMNS).eq("user_id", context.userId).order("period_start", { ascending: false }),
    context.supabase.from("accountability_snapshots").select(SNAPSHOT_COLUMNS).eq("user_id", context.userId).order("snapshot_date", { ascending: true }),
  ]);
  if (goals.error) throw new Error(describeDatabaseError(goals.error, "Goals could not be loaded."));
  if (snapshots.error) throw new Error(describeDatabaseError(snapshots.error, "Accountability history could not be loaded."));
  return { goals: (goals.data ?? []) as unknown as AccountabilityGoalRow[], snapshots: (snapshots.data ?? []) as unknown as AccountabilitySnapshotRow[] };
}

export type GoalDraft = Pick<AccountabilityGoalRow, "project_id" | "title" | "description" | "metric" | "target" | "period_start" | "period_end" | "manual_progress">;
export async function saveAccountabilityGoal(draft: GoalDraft, id?: string): Promise<ServiceResult<AccountabilityGoalRow>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);
  if (id && !isUuid(id)) return serviceFail("This goal could not be saved.");
  if (draft.project_id && !isUuid(draft.project_id)) return serviceFail("Choose a valid project.");
  const title = draft.title.trim();
  if (!title || title.length > 120 || !Number.isInteger(draft.target) || draft.target < 1 || draft.target > 10000 || draft.period_end < draft.period_start) return serviceFail("Enter a title, a positive target, and a valid date range.");
  if (draft.metric === "manual" && (!Number.isInteger(draft.manual_progress) || draft.manual_progress < 0 || draft.manual_progress > 10000)) return serviceFail("Enter a valid manual progress value.");
  const payload = { ...draft, title, description: draft.description?.trim() || null, user_id: context.userId };
  const query = id
    ? context.supabase.from("accountability_goals").update(payload).eq("id", id).eq("user_id", context.userId)
    : context.supabase.from("accountability_goals").insert(payload);
  const { data, error } = await query.select(GOAL_COLUMNS).single();
  if (error) {
    logGoalSaveError(id ? "update_accountability_goal" : "insert_accountability_goal", error);
    return serviceFail(describeDatabaseError(error, "Goal could not be saved."));
  }
  return serviceOk(data as unknown as AccountabilityGoalRow);
}

export async function setAccountabilityGoalStatus(id: string, status: AccountabilityGoalRow["status"]): Promise<ServiceResult<null>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);
  if (!isUuid(id)) return serviceFail("This goal could not be updated.");
  const { error } = await context.supabase.from("accountability_goals").update({ status }).eq("id", id).eq("user_id", context.userId);
  return error ? serviceFail(describeDatabaseError(error, "Goal could not be updated.")) : serviceOk(null);
}

export async function deleteAccountabilityGoal(id: string): Promise<ServiceResult<null>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);
  if (!isUuid(id)) return serviceFail("This goal could not be deleted.");
  const { error } = await context.supabase.from("accountability_goals").delete().eq("id", id).eq("user_id", context.userId);
  return error ? serviceFail(describeDatabaseError(error, "Goal could not be deleted.")) : serviceOk(null);
}

export async function captureDailyAccountabilitySnapshots(inputs: Array<Omit<AccountabilitySnapshotRow, "id" | "user_id" | "created_at" | "updated_at">>): Promise<void> {
  const context = await getWorkspaceContext();
  if (!context || inputs.some((input) => !isUuid(input.project_id))) throw new Error(SAVE_FAILED_MESSAGE);
  if (inputs.length === 0) return;
  const { error } = await context.supabase.from("accountability_snapshots").upsert(inputs.map((input) => ({ ...input, user_id: context.userId })), { onConflict: "user_id,project_id,snapshot_date", ignoreDuplicates: true });
  if (error) throw new Error(describeDatabaseError(error, "Accountability snapshot could not be saved."));
}

export async function getProfileTimeZone(): Promise<string | null> {
  const context = await getWorkspaceContext();
  if (!context) return null;
  const { data, error } = await context.supabase.from("profiles").select("time_zone").eq("id", context.userId).maybeSingle();
  if (error) throw error;
  return (data as { time_zone?: string | null } | null)?.time_zone ?? null;
}

export async function saveTimeZone(timeZone: string): Promise<boolean> {
  const context = await getWorkspaceContext();
  if (!context) return false;
  const { error } = await context.supabase.from("profiles").update({ time_zone: timeZone }).eq("id", context.userId);
  return !error;
}
