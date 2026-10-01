export interface GithubCommitActivity {
  sha: string;
  shortSha: string;
  title: string;
  author: string | null;
  occurredAt: string | null;
  url: string;
}

export interface GithubPullRequestActivity {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  url: string;
}

export interface GithubIssueActivity {
  number: number;
  title: string;
  state: "open" | "closed";
  author: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  url: string;
}

export interface GithubReleaseActivity {
  tagName: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  publishedAt: string | null;
  url: string;
}

export interface GithubRepositoryActivity {
  repository: {
    id: number;
    fullName: string;
    private: boolean;
    archived: boolean;
    updatedAt: string;
    pushedAt: string | null;
  };
  summary: {
    lastActivityAt: string | null;
    recentCommitCount: number;
    recentPullRequestCount: number;
    recentIssueCount: number;
    latestReleaseAt: string | null;
  };
  commits: GithubCommitActivity[];
  pullRequests: GithubPullRequestActivity[];
  issues: GithubIssueActivity[];
  releases: GithubReleaseActivity[];
  fetchedAt: string;
}
