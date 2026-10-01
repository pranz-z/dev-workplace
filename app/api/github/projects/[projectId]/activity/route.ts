import { NextResponse, type NextRequest } from "next/server";
import { createInstallationToken, getInstallationRepository, getRecentRepositoryActivity, GithubIntegrationError } from "@/data/githubAppService";
import type { GithubRepositoryActivity } from "@/data/githubActivityTypes";
import { requireGithubUser } from "@/lib/github/api";

const ACTIVITY_CACHE_TTL = 60_000;
const MAX_ACTIVITY_CACHE_ENTRIES = 100;
const activityCache = new Map<string, { expiresAt: number; activity: GithubRepositoryActivity }>();
const privateNoStore = { "Cache-Control": "private, no-store" };

function logDatabaseError(operation: string, error: unknown) {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const safe = (value: unknown) => typeof value === "string" ? value.slice(0, 300) : undefined;
  console.error("[github] activity database lookup failed", {
    operation,
    code: safe(record.code),
    message: safe(record.message),
    details: safe(record.details),
    hint: safe(record.hint),
  });
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: privateNoStore });
}

function cacheActivity(key: string, activity: GithubRepositoryActivity) {
  activityCache.delete(key);
  if (activityCache.size >= MAX_ACTIVITY_CACHE_ENTRIES) {
    const oldestKey = activityCache.keys().next().value;
    if (oldestKey) activityCache.delete(oldestKey);
  }
  activityCache.set(key, { expiresAt: Date.now() + ACTIVITY_CACHE_TTL, activity });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await requireGithubUser();
  if ("response" in auth) return auth.response;
  const { projectId } = await params;

  const { data: link, error: linkError } = await auth.supabase
    .from("github_repository_links")
    .select("installation_record_id, repository_id")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (linkError) {
    logDatabaseError("load_project_repository_link", linkError);
    return jsonError("Project repository activity could not be loaded.", 500);
  }
  if (!link) return jsonError("This project does not have an accessible GitHub repository link.", 404);

  const { data: installation, error: installationError } = await auth.supabase
    .from("github_installations")
    .select("installation_id")
    .eq("id", link.installation_record_id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (installationError) {
    logDatabaseError("load_owned_github_installation", installationError);
    return jsonError("GitHub installation access could not be checked.", 500);
  }
  if (!installation) return jsonError("Reconnect the GitHub App installation to view repository activity.", 409);

  const cacheKey = `${auth.user.id}:${link.installation_record_id}:${link.repository_id}`;
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const cached = activityCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.activity, { headers: privateNoStore });
  }
  if (cached && cached.expiresAt <= Date.now()) activityCache.delete(cacheKey);

  try {
    const token = await createInstallationToken(installation.installation_id);
    const repository = await getInstallationRepository(token, link.repository_id);
    const activity = await getRecentRepositoryActivity(token, repository);
    cacheActivity(cacheKey, activity);
    return NextResponse.json(activity, { headers: privateNoStore });
  } catch (error) {
    if (error instanceof GithubIntegrationError) return jsonError(error.message, error.status);
    console.error("[github] repository activity request failed", error instanceof Error ? error.message.slice(0, 300) : "Unknown error");
    return jsonError("GitHub activity is temporarily unavailable. Try again shortly.", 502);
  }
}
