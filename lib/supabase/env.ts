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

/** Names of the missing variables only — never their values. */
export function getMissingSupabaseEnvVars(): string[] {
  const missing: string[] = [];
  if (!readSupabaseUrl()) missing.push(SUPABASE_URL_VAR);
  if (!readSupabasePublishableKey()) missing.push(SUPABASE_PUBLISHABLE_KEY_VAR);
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
      `Missing ${missing.join(", ")}. Add the Supabase project values to .env.local (see .env.example). ` +
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
  return value ? value.replace(/\/+$/, "") : null;
}
