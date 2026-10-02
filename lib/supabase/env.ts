const SUPABASE_URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_PUBLISHABLE_KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

export interface SupabaseEnv {
  url: string;
  key: string;
}

/**
 * Reads the public Supabase environment variables.
 * The `process.env.NEXT_PUBLIC_*` member references stay literal so Next.js can
 * inline them into the browser bundle at build time.
 */
function readSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

function readSupabasePublishableKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
}

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (url.protocol === "https:" || isLocalHttp) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Names of the missing variables only — never their values. */
export function getMissingSupabaseEnvVars(): string[] {
  const missing: string[] = [];
  const url = readSupabaseUrl();
  const key = readSupabasePublishableKey();
  if (!url || !isValidSupabaseUrl(url)) missing.push(SUPABASE_URL_VAR);
  if (!key || /\s/.test(key) || key.length > 8192) missing.push(SUPABASE_PUBLISHABLE_KEY_VAR);
  return missing;
}

export function isSupabaseConfigured(): boolean {
  return getMissingSupabaseEnvVars().length === 0;
}

/**
 * Returns the validated Supabase environment or throws a developer-facing error.
 * Callers must never fall back to creating a client with empty credentials.
 */
export function getSupabaseEnv(): SupabaseEnv {
  const missing = getMissingSupabaseEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `Missing or invalid ${missing.join(", ")}. Add the Supabase project values to .env.local (see .env.example). ` +
        "Supabase auth and data access stay disabled until the environment is configured.",
    );
  }
  return { url: readSupabaseUrl(), key: readSupabasePublishableKey() };
}

/**
 * Optional canonical origin (for example `https://workplace.example.com`) used to build
 * OAuth redirect URLs. When unset, the current browser origin is used so development
 * and production both work without hardcoding localhost.
 */
export function getSiteUrlOverride(): string | null {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if ((url.protocol !== "https:" && !isLocalHttp) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}
