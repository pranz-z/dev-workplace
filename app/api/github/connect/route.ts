import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getGithubAppConfig, GithubIntegrationError } from "@/data/githubAppService";
import { requireGithubUser } from "@/lib/github/api";

export async function GET(request: NextRequest) {
  const auth = await requireGithubUser();
  if ("response" in auth) return auth.response;
  try {
    const { slug } = getGithubAppConfig();
    const state = randomBytes(32).toString("base64url");
    const installUrl = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
    installUrl.searchParams.set("state", state);
    const response = NextResponse.redirect(installUrl);
    response.cookies.set("github_app_setup_state", state, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/api/github/setup",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    const message = error instanceof GithubIntegrationError ? error.message : "GitHub repository access is not configured.";
    return NextResponse.redirect(new URL(`/app?github_error=${encodeURIComponent(message)}`, request.url));
  }
}
