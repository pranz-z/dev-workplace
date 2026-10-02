import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInstallationToken, getInstallationRepository, getRecentRepositoryActivity } from "@/data/githubAppService";
import { AiError } from "@/lib/ai/errors";
import { sanitizeGithubActivity } from "@/lib/ai/schemas";

export async function loadProjectGithubActivity(supabase: SupabaseClient, userId: string, projectId: string) {
  const { data: link, error: linkError } = await supabase.from("github_repository_links")
    .select("installation_record_id, repository_id").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  if (linkError) {
    console.error("[ai] GitHub context lookup failed", { operation: "load_owned_repository_link", code: linkError.code ?? "unknown" });
    throw new AiError("UPSTREAM_ERROR");
  }
  if (!link) return [];
  const linkRow = link as unknown as { installation_record_id: string; repository_id: number };
  const { data: installation, error: installationError } = await supabase.from("github_installations")
    .select("installation_id").eq("id", linkRow.installation_record_id).eq("user_id", userId).maybeSingle();
  if (installationError) {
    console.error("[ai] GitHub context lookup failed", { operation: "load_owned_installation", code: installationError.code ?? "unknown" });
    throw new AiError("UPSTREAM_ERROR");
  }
  if (!installation) return [];
  try {
    const { installation_id: installationId } = installation as unknown as { installation_id: number };
    const token = await createInstallationToken(installationId);
    const repository = await getInstallationRepository(token, linkRow.repository_id);
    const activity = await getRecentRepositoryActivity(token, repository);
    return sanitizeGithubActivity(activity);
  } catch {
    // GitHub service messages may include provider detail; return only the normalized category.
    throw new AiError("UPSTREAM_ERROR");
  }
}
