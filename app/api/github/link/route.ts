import { NextResponse, type NextRequest } from "next/server";
import { createInstallationToken, getInstallationRepository, toSafeRepository } from "@/data/githubAppService";
import { githubErrorResponse, requireGithubUser } from "@/lib/github/api";
import { buildSlugCandidate, isUniqueViolation } from "@/lib/slug";

interface LinkRequest {
  repositoryId?: number;
  installationRecordId?: string;
  projectId?: string;
  mode?: "import" | "attach";
}

export async function GET(request: NextRequest) {
  const auth = await requireGithubUser();
  if ("response" in auth) return auth.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Choose a project to inspect." }, { status: 400 });
  const { data, error } = await auth.supabase
    .from("github_repository_links")
    .select("project_id, installation_record_id, repository_id, owner, name, full_name, default_branch, html_url, is_private, primary_language, updated_at_github")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) return githubErrorResponse(error);
  if (!data) return NextResponse.json({ repository: null });
  if (request.nextUrl.searchParams.get("refresh") === "1") {
    const { data: installation, error: installationError } = await auth.supabase.from("github_installations")
      .select("installation_id").eq("id", data.installation_record_id).eq("user_id", auth.user.id).maybeSingle();
    if (installationError || !installation) return NextResponse.json({ error: "Reconnect GitHub to refresh this repository." }, { status: 403 });
    try {
      const token = await createInstallationToken(installation.installation_id);
      const metadata = toSafeRepository(await getInstallationRepository(token, data.repository_id));
      const { error: updateError } = await auth.supabase.from("github_repository_links").update({
        owner: metadata.owner,
        name: metadata.name,
        full_name: metadata.fullName,
        default_branch: metadata.defaultBranch,
        html_url: metadata.url,
        is_private: metadata.private,
        primary_language: metadata.language,
        updated_at_github: metadata.updatedAt,
        last_synced_at: new Date().toISOString(),
      }).eq("project_id", projectId);
      if (updateError) throw updateError;
      return NextResponse.json({ repository: { ...metadata, projectId } });
    } catch (refreshError) {
      return githubErrorResponse(refreshError);
    }
  }
  return NextResponse.json({ repository: {
    id: data.repository_id,
    projectId: data.project_id,
    owner: data.owner,
    name: data.name,
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    url: data.html_url,
    private: data.is_private,
    language: data.primary_language,
    updatedAt: data.updated_at_github,
  } });
}

export async function POST(request: NextRequest) {
  const auth = await requireGithubUser();
  if ("response" in auth) return auth.response;
  try {
    const body = await request.json() as LinkRequest;
    const repositoryId = Number(body.repositoryId);
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0 || !body.installationRecordId || (body.mode !== "import" && body.mode !== "attach")) {
      return NextResponse.json({ error: "Choose a valid GitHub repository." }, { status: 400 });
    }
    if ((body.mode === "attach") !== Boolean(body.projectId)) return NextResponse.json({ error: "Choose a workspace project to attach." }, { status: 400 });

    const { data: installation, error: installationError } = await auth.supabase
      .from("github_installations")
      .select("id, installation_id")
      .eq("id", body.installationRecordId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (installationError || !installation) return NextResponse.json({ error: "Reconnect GitHub and try again." }, { status: 403 });

    const token = await createInstallationToken(installation.installation_id);
    const repository = await getInstallationRepository(token, repositoryId);
    const metadata = toSafeRepository(repository);
    const { data: duplicate, error: duplicateError } = await auth.supabase
      .from("github_repository_links")
      .select("project_id")
      .eq("repository_id", repositoryId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return NextResponse.json({ error: "This repository is already linked to a workspace project.", existingProjectId: duplicate.project_id }, { status: 409 });

    let projectId = body.projectId;
    let createdProject = false;
    if (body.mode === "attach") {
      const { data: project, error } = await auth.supabase.from("projects").select("id").eq("id", projectId!).eq("user_id", auth.user.id).maybeSingle();
      if (error || !project) return NextResponse.json({ error: "That workspace project is not available." }, { status: 404 });
    } else {
      const baseSlug = buildSlugCandidate(metadata.name, 1);
      let created = null;
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const { data, error } = await auth.supabase.from("projects").insert({
          user_id: auth.user.id,
          slug: buildSlugCandidate(baseSlug, attempt),
          title: metadata.name,
          description: metadata.description ?? "",
          project_type: "Personal",
          status: "Planning",
          workflow_stage: "planning",
          priority: "Medium",
          visibility: "Private",
          is_featured: false,
          role: "Developer",
        }).select("id, slug, title").single();
        if (!error) { created = data; break; }
        if (!isUniqueViolation(error)) throw error;
      }
      if (!created) return NextResponse.json({ error: "A project address could not be created. Try importing again." }, { status: 409 });
      projectId = created.id;
      createdProject = true;
    }

    const { error: linkError } = await auth.supabase.from("github_repository_links").insert({
      project_id: projectId!,
      user_id: auth.user.id,
      installation_record_id: installation.id,
      repository_id: metadata.id,
      owner: metadata.owner,
      name: metadata.name,
      full_name: metadata.fullName,
      default_branch: metadata.defaultBranch,
      html_url: metadata.url,
      is_private: metadata.private,
      primary_language: metadata.language,
      updated_at_github: metadata.updatedAt,
    });
    if (linkError) {
      if (createdProject) await auth.supabase.from("projects").delete().eq("id", projectId!).eq("user_id", auth.user.id);
      if (isUniqueViolation(linkError)) return NextResponse.json({ error: "This repository or project already has a repository link." }, { status: 409 });
      throw linkError;
    }
    return NextResponse.json({ projectId, createdProject, repository: metadata });
  } catch (error) {
    return githubErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireGithubUser();
  if ("response" in auth) return auth.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Choose a project to unlink." }, { status: 400 });
  const { data: currentLink, error: readError } = await auth.supabase.from("github_repository_links")
    .select("html_url, is_private").eq("project_id", projectId).maybeSingle();
  if (readError) return githubErrorResponse(readError);
  if (currentLink?.is_private) {
    const { error: projectError } = await auth.supabase.from("projects").update({ repository_url: null })
      .eq("id", projectId).eq("user_id", auth.user.id).eq("repository_url", currentLink.html_url);
    if (projectError) return githubErrorResponse(projectError);
  }
  const { error } = await auth.supabase.from("github_repository_links").delete().eq("project_id", projectId);
  if (error) return githubErrorResponse(error);
  return NextResponse.json({ unlinked: true });
}
