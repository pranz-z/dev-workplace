import { getSiteUrlOverride } from "@/lib/supabase/env";

export const DEFAULT_AUTH_REDIRECT = "/app";

/**
 * Only same-origin relative paths may flow through the `next` parameter.
 * Blocks absolute URLs and protocol-relative redirects such as `//evil.example`.
 */
export function sanitizeNextPath(value: string | null | undefined, fallback: string = DEFAULT_AUTH_REDIRECT): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;
  return trimmed;
}

/**
 * Builds the OAuth `redirectTo` URL for the current environment.
 * Uses the canonical NEXT_PUBLIC_SITE_URL when provided, otherwise the browser origin,
 * so development (localhost) and production both work without hardcoding a host.
 */
export function buildAuthCallbackUrl(nextPath: string): string {
  const baseUrl = getSiteUrlOverride() ?? window.location.origin;
  const callbackUrl = new URL("/auth/callback", baseUrl);
  callbackUrl.searchParams.set("next", sanitizeNextPath(nextPath));
  return callbackUrl.toString();
}
