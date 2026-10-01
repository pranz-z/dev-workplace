import "server-only";
import { createHash, createPrivateKey, createSign, randomBytes } from "node:crypto";
import type { GithubCommitActivity, GithubIssueActivity, GithubPullRequestActivity, GithubReleaseActivity, GithubRepositoryActivity } from "@/data/githubActivityTypes";

export interface GithubAppInstallation {
  id: number;
  account: { login: string; type: string };
}

export interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  html_url: string;
  language: string | null;
  default_branch: string;
  updated_at: string;
  pushed_at: string | null;
  archived: boolean;
}

export class GithubIntegrationError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = "GithubIntegrationError";
  }
}

export function getGithubAppConfig() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const missing = [!appId && "GITHUB_APP_ID", !slug && "GITHUB_APP_SLUG", !clientId && "GITHUB_APP_CLIENT_ID", !clientSecret && "GITHUB_APP_CLIENT_SECRET", !privateKey && "GITHUB_APP_PRIVATE_KEY"].filter(Boolean);
  if (missing.length) throw new GithubIntegrationError(`GitHub repository access is not configured (${missing.join(", ")}).`, 503);
  if (!/^\d+$/.test(appId!)) throw new GithubIntegrationError("GITHUB_APP_ID must be the numeric GitHub App ID.", 503);
  if (!/^[a-z0-9-]+$/i.test(slug!)) throw new GithubIntegrationError("GITHUB_APP_SLUG must match the app slug in its GitHub URL.", 503);
  try {
    createPrivateKey(privateKey!);
  } catch {
    throw new GithubIntegrationError("GITHUB_APP_PRIVATE_KEY must contain a valid PEM private key.", 503);
  }
  return { appId: appId!, slug: slug!, clientId: clientId!, clientSecret: clientSecret!, privateKey: privateKey! };
}

export function createGithubPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function createAppJwt() {
  const { appId, privateKey } = getGithubAppConfig();
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 30, exp: now + 8 * 60, iss: appId })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

async function githubRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const rateLimited = response.status === 429 || (response.status === 403 && (
      response.headers.get("x-ratelimit-remaining") === "0" || Boolean(response.headers.get("retry-after"))
    ));
    if (rateLimited) {
      throw new GithubIntegrationError("GitHub rate limit reached. Try again later.", 429);
    }
    if (response.status === 404) throw new GithubIntegrationError("Repository access is no longer available. Update your GitHub App installation or unlink this repository.", 404);
    if (response.status === 403) throw new GithubIntegrationError("GitHub denied access. Confirm the GitHub App has the required read permissions and repository access.", 403);
    throw new GithubIntegrationError(response.status >= 500 ? "GitHub is temporarily unavailable. Try again shortly." : "GitHub rejected the repository request.", response.status);
  }
  return response.json() as Promise<T>;
}

export async function getInstallation(installationId: number): Promise<GithubAppInstallation> {
  return githubRequest(`/app/installations/${installationId}`, createAppJwt());
}

export async function exchangeGithubUserCode(code: string, redirectUri: string, codeVerifier: string): Promise<string> {
  const { clientId, clientSecret } = getGithubAppConfig();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
  });
  if (!response.ok) throw new GithubIntegrationError("GitHub user authorization could not be completed. Please reconnect.", 502);
  const result = await response.json() as { access_token?: string; error?: string };
  if (!result.access_token || result.error) throw new GithubIntegrationError("GitHub user authorization could not be completed. Please reconnect.", 401);
  return result.access_token;
}

export async function findUserAccessibleInstallation(userToken: string, installationId: number) {
  const { appId } = getGithubAppConfig();
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubRequest<{ installations: Array<GithubAppInstallation & { app_id: number }> }>(`/user/installations?per_page=100&page=${page}`, userToken);
    const installation = result.installations.find((item) => item.id === installationId);
    if (installation) {
      if (String(installation.app_id) !== appId || !installation.account?.login) throw new GithubIntegrationError("This installation is not accessible through the configured GitHub App.", 403);
      return installation;
    }
    if (result.installations.length < 100) break;
  }
  throw new GithubIntegrationError("The GitHub account authorizing this connection cannot access that installation. Please connect again with an account that can access it.", 403);
}

export async function createInstallationToken(installationId: number) {
  const result = await githubRequest<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    createAppJwt(),
    { method: "POST", body: JSON.stringify({}) },
  );
  return result.token;
}

export async function listInstallationRepositories(token: string): Promise<GithubRepository[]> {
  const repositories: GithubRepository[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubRequest<{ repositories: GithubRepository[]; total_count: number }>(
      `/installation/repositories?per_page=100&page=${page}`, token,
    );
    repositories.push(...result.repositories);
    if (repositories.length >= result.total_count || result.repositories.length < 100) break;
  }
  return repositories;
}

export async function getInstallationRepository(token: string, repositoryId: number): Promise<GithubRepository> {
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubRequest<{ repositories: GithubRepository[]; total_count: number }>(
      `/installation/repositories?per_page=100&page=${page}`, token,
    );
    const repository = result.repositories.find((item) => item.id === repositoryId);
    if (repository) return repository;
    if (result.repositories.length < 100 || page * 100 >= result.total_count) break;
  }
  throw new GithubIntegrationError("Repository access is no longer available. Update your GitHub App installation or unlink this repository.", 404);
}

interface GithubCommitResponse {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } | null; committer: { date: string } | null };
  author: { login: string } | null;
}

interface GithubPullRequestResponse {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  html_url: string;
  user: { login: string } | null;
}

interface GithubIssueResponse {
  number: number;
  title: string;
  state: "open" | "closed";
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  user: { login: string } | null;
  pull_request?: { url: string };
}

interface GithubReleaseResponse {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
}

export async function getRecentRepositoryActivity(token: string, repository: GithubRepository): Promise<GithubRepositoryActivity> {
  const owner = encodeURIComponent(repository.owner.login);
  const name = encodeURIComponent(repository.name);
  const base = `/repos/${owner}/${name}`;
  const [rawCommits, rawPullRequests, rawIssues, rawReleases] = await Promise.all([
    githubRequest<GithubCommitResponse[]>(`${base}/commits?per_page=10`, token),
    githubRequest<GithubPullRequestResponse[]>(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=10`, token),
    githubRequest<GithubIssueResponse[]>(`${base}/issues?state=all&sort=updated&direction=desc&per_page=10`, token),
    githubRequest<GithubReleaseResponse[]>(`${base}/releases?per_page=5`, token),
  ]);
  const commits: GithubCommitActivity[] = rawCommits.map((commit) => ({
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    title: commit.commit.message.split(/\r?\n/, 1)[0] || "Commit",
    author: commit.author?.login ?? commit.commit.author?.name ?? null,
    occurredAt: commit.commit.author?.date ?? commit.commit.committer?.date ?? null,
    url: commit.html_url,
  }));
  const pullRequests: GithubPullRequestActivity[] = rawPullRequests.map((pull) => ({
    number: pull.number,
    title: pull.title,
    state: pull.merged_at ? "merged" : pull.state,
    draft: pull.draft,
    author: pull.user?.login ?? null,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    mergedAt: pull.merged_at,
    url: pull.html_url,
  }));
  const issues: GithubIssueActivity[] = rawIssues.filter((issue) => !issue.pull_request).map((issue) => ({
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user?.login ?? null,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    url: issue.html_url,
  }));
  const releases: GithubReleaseActivity[] = rawReleases.map((release) => ({
    tagName: release.tag_name,
    name: release.name,
    draft: release.draft,
    prerelease: release.prerelease,
    publishedAt: release.published_at,
    url: release.html_url,
  }));
  const timestamps = [
    repository.pushed_at,
    ...commits.map((item) => item.occurredAt),
    ...pullRequests.map((item) => item.updatedAt),
    ...issues.map((item) => item.updatedAt),
    ...releases.map((item) => item.publishedAt),
  ].filter((value): value is string => Boolean(value));
  const lastActivityAt = timestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const latestReleaseAt = releases.find((release) => release.publishedAt)?.publishedAt ?? null;

  return {
    repository: {
      id: repository.id,
      fullName: repository.full_name,
      private: repository.private,
      archived: repository.archived,
      updatedAt: repository.updated_at,
      pushedAt: repository.pushed_at,
    },
    summary: {
      lastActivityAt,
      recentCommitCount: commits.length,
      recentPullRequestCount: pullRequests.length,
      recentIssueCount: issues.length,
      latestReleaseAt,
    },
    commits,
    pullRequests,
    issues,
    releases,
    fetchedAt: new Date().toISOString(),
  };
}

export function toSafeRepository(repository: GithubRepository) {
  return {
    id: repository.id,
    name: repository.name,
    fullName: repository.full_name,
    owner: repository.owner.login,
    description: repository.description,
    private: repository.private,
    url: repository.html_url,
    language: repository.language,
    defaultBranch: repository.default_branch,
    updatedAt: repository.updated_at,
  };
}
