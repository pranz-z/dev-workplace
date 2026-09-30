export interface GithubWriteRequest {
  operation: "updateReadme" | "createCommit" | "createRelease";
  owner: string;
  repository: string;
  branch?: string;
  commitMessage?: string;
  content?: string;
}

// Writes intentionally cross a trusted API boundary; no GitHub token is accepted here.
export async function githubWriteService(request: GithubWriteRequest) {
  const response = await fetch("/api/github/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error("GitHub write operation failed");
  return response.json() as Promise<{ ok: true }>;
}
