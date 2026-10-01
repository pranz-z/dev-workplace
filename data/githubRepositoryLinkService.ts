import { getWorkspaceContext, isUuid } from "@/data/context";

/** Reads the authoritative Phase 3A project/repository association through RLS. */
export async function hasLinkedGithubRepository(projectId: string): Promise<boolean> {
  if (!isUuid(projectId)) return false;
  const context = await getWorkspaceContext();
  if (!context) return false;

  const { data, error } = await context.supabase
    .from("github_repository_links")
    .select("project_id")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    console.error("[data] project GitHub link check failed", { operation: "check_project_github_link", code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw new Error("Couldn't check this project's GitHub connection.");
  }
  return Boolean(data);
}
