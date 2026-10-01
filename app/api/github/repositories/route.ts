import { NextResponse } from "next/server";
import { createInstallationToken, GithubIntegrationError, listInstallationRepositories, toSafeRepository } from "@/data/githubAppService";
import { githubErrorResponse, requireGithubUser } from "@/lib/github/api";

export async function GET() {
  const auth = await requireGithubUser();
  if ("response" in auth) return auth.response;
  let hasInstallation = false;
  try {
    const { data: installations, error } = await auth.supabase
      .from("github_installations")
      .select("id, installation_id, account_login, account_type")
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!installations?.length) return NextResponse.json({ connected: false, repositories: [] });
    hasInstallation = true;

    const linkedResult = await auth.supabase.from("github_repository_links").select("repository_id, project_id");
    if (linkedResult.error) throw linkedResult.error;
    const linked = new Map((linkedResult.data ?? []).map((link) => [link.repository_id, link.project_id]));
    const repositories = [];
    for (const installation of installations) {
      const token = await createInstallationToken(installation.installation_id);
      const repos = await listInstallationRepositories(token);
      repositories.push(...repos.map((repository) => ({
        ...toSafeRepository(repository),
        installationRecordId: installation.id,
        accountLogin: installation.account_login,
        linkedProjectId: linked.get(repository.id) ?? null,
      })));
    }
    return NextResponse.json({ connected: true, repositories });
  } catch (error) {
    if (error instanceof GithubIntegrationError) {
      return NextResponse.json({ connected: hasInstallation, error: error.message }, { status: error.status });
    }
    return githubErrorResponse(error);
  }
}
