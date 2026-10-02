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
    console.error("[data] project GitHub link check failed", { operation: "check_project_github_link", code: error.code ?? "unknown" });
    throw new Error("Couldn't check this project's GitHub connection.");
  }
  return Boolean(data);
}

/** Lists owned repository associations for private report loading. */
export async function listLinkedGithubProjectIds(): Promise<string[]> {
  const context = await getWorkspaceContext();
  if (!context) throw new Error("GitHub report activity is unavailable.");
  const { data, error } = await context.supabase.from("github_repository_links").select("project_id").eq("user_id", context.userId);
  if (error) {
    console.error("[data] GitHub report link lookup failed", { operation: "list_accountability_github_links", code: error.code });
    throw new Error("GitHub report activity is unavailable.");
  }
  return (data ?? []).map((row) => (row as { project_id: string }).project_id);
}
