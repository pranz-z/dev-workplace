/**
 * Result envelope for every write in the data layer.
 *
 * A write only reports success after Supabase confirms it, so the UI can show
 * "Couldn't save changes." instead of pretending the row exists. Reads keep
 * throwing, because every caller has a sensible empty/fallback state.
 */
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function serviceOk<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function serviceFail<T = never>(error: string): ServiceResult<T> {
  return { ok: false, error };
}

export const SAVE_FAILED_MESSAGE = "Couldn't save changes.";
export const DELETE_FAILED_MESSAGE = "Couldn't delete that yet.";
export const NOT_CONFIGURED_MESSAGE = "Supabase is not configured, so nothing was saved.";
export const NOT_AUTHENTICATED_MESSAGE = "Your session expired. Sign in again and retry.";

type PostgresError = { code?: string; message?: string; details?: string | null; hint?: string | null };

const CONSTRAINT_MESSAGES: Record<string, string> = {
  projects_slug_key: "That public address is already used by another project. Try a different name.",
  projects_slug_format_check: "Public addresses may only contain lowercase letters, numbers and hyphens.",
  projects_status_check: "That project status is not supported.",
  projects_workflow_stage_check: "That workflow stage is not supported.",
  projects_priority_check: "That priority is not supported.",
  projects_visibility_check: "That visibility is not supported.",
  projects_date_order_check: "The target date cannot be before the start date.",
  projects_title_not_blank_check: "Give the project a title first.",
  tasks_status_check: "That task status is not supported.",
  tasks_priority_check: "That priority is not supported.",
  tasks_title_not_blank_check: "Give the task a title first.",
  tasks_completed_at_check: "A completed task needs a completion time (and an open task cannot have one).",
  milestones_status_check: "That milestone status is not supported.",
  milestones_title_not_blank_check: "Give the milestone a title first.",
  plans_status_check: "That plan status is not supported.",
  plans_title_not_blank_check: "Give the plan a title first.",
  notes_title_not_blank_check: "Give the note a title first.",
  technologies_user_name_lower_key: "You already track that technology.",
  technologies_name_not_blank_check: "Give the technology a name first.",
};

function readConstraintName(error: PostgresError): string | null {
  const haystack = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  const match = haystack.match(/constraint "([^"]+)"/i);
  return match ? match[1] : null;
}

/**
 * Turns a Supabase/Postgres failure into a short, user-facing sentence.
 * The technical detail is logged for developers instead of being rendered.
 */
export function describeDatabaseError(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") {
    console.error("[data] unexpected failure", error);
    return fallback;
  }

  const postgresError = error as PostgresError;
  const code = postgresError.code;
  const constraint = readConstraintName(postgresError);
  const technical = `${code ?? "unknown"}: ${postgresError.message ?? "no message"}`;

  if (code === "42501") {
    console.error("[data] blocked by row level security", technical);
    return "This change is not allowed for your account.";
  }
  if (code === "23503") {
    console.error("[data] foreign key violation", technical);
    return "That item references something that no longer exists. Refresh and try again.";
  }
  if (code === "23505") {
    console.error("[data] unique violation", technical);
    return constraint && CONSTRAINT_MESSAGES[constraint]
      ? CONSTRAINT_MESSAGES[constraint]
      : "That value already exists. Try a different one.";
  }
  if (code === "23514") {
    console.error("[data] check constraint violation", technical);
    return constraint && CONSTRAINT_MESSAGES[constraint] ? CONSTRAINT_MESSAGES[constraint] : fallback;
  }

  console.error("[data] request failed", technical);
  return fallback;
}
