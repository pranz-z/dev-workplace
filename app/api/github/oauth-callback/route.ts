import { NextResponse, type NextRequest } from "next/server";
import { exchangeGithubUserCode, findUserAccessibleInstallation, GithubIntegrationError } from "@/data/githubAppService";
import { requireGithubUser } from "@/lib/github/api";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSiteUrlOverride } from "@/lib/supabase/env";

const cookieNames = ["github_app_oauth_state", "github_app_oauth_verifier", "github_app_pending_installation"];

function safeDiagnosticText(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/(?:eyJ[A-Za-z0-9_-]{10,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]+)/g, "[redacted]")
    .slice(0, 500);
}

function logAssociationFailure(operation: string, error: unknown) {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  console.error("[github] installation association failed", {
    operation,
    code: safeDiagnosticText(record.code),
    message: safeDiagnosticText(record.message ?? (error instanceof Error ? error.message : "Unknown error")),
    details: safeDiagnosticText(record.details),
    hint: safeDiagnosticText(record.hint),
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.cookies.get(cookieNames[0])?.value;
  const verifier = request.cookies.get(cookieNames[1])?.value;
  const installationId = Number(request.cookies.get(cookieNames[2])?.value);
  const finish = (destination: string) => {
    const response = NextResponse.redirect(new URL(destination, request.url));
    for (const name of cookieNames) response.cookies.set(name, "", { path: "/api/github/oauth-callback", maxAge: 0 });
    return response;
  };

  if (!code || !state || !expectedState || state !== expectedState || !verifier || !Number.isSafeInteger(installationId) || installationId <= 0 || searchParams.has("error")) {
    return finish("/app?github_error=GitHub%20authorization%20could%20not%20be%20verified.%20Please%20connect%20again.");
  }
  const auth = await requireGithubUser();
  if ("response" in auth) return finish("/login?next=%2Fapp");

  let operation = "exchange_github_user_code";
  try {
    const redirectUri = new URL("/api/github/oauth-callback", getSiteUrlOverride() ?? request.nextUrl.origin).toString();
    const userToken = await exchangeGithubUserCode(code, redirectUri, verifier);
    operation = "verify_user_access_to_installation";
    const installation = await findUserAccessibleInstallation(userToken, installationId);
    operation = "create_supabase_admin_client";
    const admin = getSupabaseAdminClient();
    operation = "upsert_github_installations";
    const { error } = await admin.from("github_installations").upsert({
      user_id: auth.user.id,
      installation_id: installation.id,
      account_login: installation.account.login,
      account_type: installation.account.type,
    }, { onConflict: "user_id,installation_id" });
    if (error) throw error;
    return finish("/app?github_connected=1");
  } catch (error) {
    logAssociationFailure(operation, error);
    const message = error instanceof GithubIntegrationError ? error.message : "GitHub installation could not be saved. Please try connecting again.";
    return finish(`/app?github_error=${encodeURIComponent(message)}`);
  }
}
