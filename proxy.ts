import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/lib/auth/redirects";
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";

const PRIVATE_PATH_PREFIX = "/app";

const isPrivatePath = (pathname: string) => pathname === PRIVATE_PATH_PREFIX || pathname.startsWith(`${PRIVATE_PATH_PREFIX}/`);

/** Redirects must carry the refreshed Supabase cookies, otherwise the session is dropped. */
const redirectWithSessionCookies = (target: URL, sessionResponse: NextResponse) => {
  const redirect = NextResponse.redirect(target);
  sessionResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
};

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPrivateRoute = isPrivatePath(pathname);
  const isRootRoute = pathname === "/";
  const isLoginRoute = pathname === "/login";

  // Refresh the Supabase session on every matched request so browser and server cookies
  // stay in sync. @supabase/ssr requires no other code between createServerClient and getUser.
  let response = NextResponse.next({ request });
  let user: User | null = null;

  if (isSupabaseConfigured()) {
    const { url, key } = getSupabaseEnv();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    try {
      const { data } = await supabase.auth.getUser();
      user = data.user ?? null;
    } catch (error) {
      // Fail closed: an unverifiable session never unlocks a private route.
      console.error("[proxy] Supabase session check failed; treating the request as signed out.", error);
      user = null;
    }
  }

  // Private workspace protection happens here, server-side, never through React state alone.
  if (isPrivateRoute && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectWithSessionCookies(loginUrl, response);
  }

  // `/` stays public: signed-in users continue to the workspace, visitors see the portfolio.
  if (isRootRoute) {
    return redirectWithSessionCookies(new URL(user ? "/app" : "/view", request.url), response);
  }

  // A signed-in user never needs the login screen again.
  if (isLoginRoute && user) {
    return redirectWithSessionCookies(new URL(sanitizeNextPath(request.nextUrl.searchParams.get("next")), request.url), response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
