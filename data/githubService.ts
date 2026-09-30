export const GITHUB_CACHE = {
  repository: 60 * 60,
  recentActivity: 15 * 60,
  contributionActivity: 6 * 60 * 60,
} as const;

export interface GithubAuthenticatedUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
}

export interface GithubRepositorySummary {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  default_branch: string;
  updated_at: string;
  pushed_at: string | null;
}

export interface GithubRateLimit {
  remaining: number;
  resetAt: string;
}

export class GithubApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly rateLimit?: GithubRateLimit) {
    super(message);
    this.name = "GithubApiError";
  }
}

const getRateLimit = (response: Response): GithubRateLimit | undefined => {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  if (!remaining || !reset) return undefined;
  return { remaining: Number(remaining), resetAt: new Date(Number(reset) * 1000).toISOString() };
};

async function requestGithub<T>(path: string, token?: string, revalidate = GITHUB_CACHE.repository): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    next: { revalidate },
  });
  const rateLimit = getRateLimit(response);
  if (!response.ok) {
    throw new GithubApiError(`GitHub request failed: ${response.status}`, response.status, rateLimit);
  }
  return response.json() as Promise<T>;
}

export const githubService = {
  getAuthenticatedUser: (token: string) => requestGithub<GithubAuthenticatedUser>("/user", token),
  getRepositories: (token: string) => requestGithub<GithubRepositorySummary[]>("/user/repos?sort=pushed&per_page=100", token, GITHUB_CACHE.repository),
  getRepository: (owner: string, name: string, token?: string) => requestGithub<GithubRepositorySummary>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token),
  getRepositoryLanguages: (owner: string, name: string, token?: string) => requestGithub<Record<string, number>>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/languages`, token),
  getRecentActivity: (owner: string, name: string, token?: string) => requestGithub<unknown[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/events?per_page=30`, token, GITHUB_CACHE.recentActivity),
  getContributionActivity: (username: string) => requestGithub<unknown[]>(`/users/${encodeURIComponent(username)}/events/public?per_page=100`, undefined, GITHUB_CACHE.contributionActivity),
  getCommits: (owner: string, name: string, token?: string) => requestGithub<unknown[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=30`, token, GITHUB_CACHE.recentActivity),
  getPullRequests: (owner: string, name: string, token?: string) => requestGithub<unknown[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=all&per_page=30`, token, GITHUB_CACHE.recentActivity),
  getIssues: (owner: string, name: string, token?: string) => requestGithub<unknown[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=all&per_page=30`, token, GITHUB_CACHE.recentActivity),
  getReleases: (owner: string, name: string, token?: string) => requestGithub<unknown[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases?per_page=30`, token, GITHUB_CACHE.repository),
};
