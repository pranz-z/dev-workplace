import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createGithubPkcePair, getGithubAppConfig, getInstallation, GithubIntegrationError } from "@/data/githubAppService";
import { requireGithubUser } from "@/lib/github/api";
import { getApplicationOrigin } from "@/lib/site-origin";

export async function GET(request: NextRequest) {
  const origin = getApplicationOrigin();
  if (!origin) return NextResponse.json({ error: "GitHub setup is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const { searchParams } = request.nextUrl;
  const state = searchParams.get("state");
  const installationId = Number(searchParams.get("installation_id"));
  const setupAction = searchParams.get("setup_action");
  const cookieState = request.cookies.get("github_app_setup_state")?.value;
  const finish = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.cookies.set("github_app_setup_state", "", { path: "/api/github/setup", maxAge: 0 });
    return response;
  };

  if (!state || !cookieState || state !== cookieState || !Number.isSafeInteger(installationId) || installationId <= 0 || !["install", "update"].includes(setupAction ?? "")) {
    return finish(new URL("/app?github_error=The%20GitHub%20setup%20could%20not%20be%20verified.%20Please%20connect%20again.", origin));
  }
  const auth = await requireGithubUser();
  if ("response" in auth) return finish(new URL("/login?next=%2Fapp", origin));

  try {
    const installation = await getInstallation(installationId);
    if (installation.id !== installationId) throw new GithubIntegrationError("GitHub returned an invalid installation.", 400);
    const { clientId } = getGithubAppConfig();
    const state = randomBytes(32).toString("base64url");
    const { verifier, challenge } = createGithubPkcePair();
    const callbackUrl = new URL("/api/github/oauth-callback", origin);
    const oauthUrl = new URL("https://github.com/login/oauth/authorize");
    oauthUrl.searchParams.set("client_id", clientId);
    oauthUrl.searchParams.set("redirect_uri", callbackUrl.toString());
    oauthUrl.searchParams.set("state", state);
    oauthUrl.searchParams.set("code_challenge", challenge);
    oauthUrl.searchParams.set("code_challenge_method", "S256");
    const response = NextResponse.redirect(oauthUrl);
    const cookieOptions = { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax" as const, path: "/api/github/oauth-callback", maxAge: 10 * 60 };
    response.cookies.set("github_app_oauth_state", state, cookieOptions);
    response.cookies.set("github_app_oauth_verifier", verifier, cookieOptions);
    response.cookies.set("github_app_pending_installation", String(installationId), cookieOptions);
    response.cookies.set("github_app_setup_state", "", { path: "/api/github/setup", maxAge: 0 });
    return response;
  } catch (error) {
    const message = error instanceof GithubIntegrationError ? error.message : "GitHub installation could not be saved. Please try connecting again.";
    return finish(new URL(`/app?github_error=${encodeURIComponent(message)}`, origin));
  }
}
