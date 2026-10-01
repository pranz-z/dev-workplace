import type { NextConfig } from "next";

const REQUIRED_PUBLIC_ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;

const missingPublicEnvVars = REQUIRED_PUBLIC_ENV_VARS.filter((name) => !process.env[name]?.trim());

if (missingPublicEnvVars.length > 0) {
  const guidance = [
    `Missing ${missingPublicEnvVars.join(", ")}.`,
    "Copy .env.example to .env.local and add the Supabase project values (never commit real values).",
    "Private workspace routes stay locked and Supabase-backed data stays disabled until the environment is configured.",
  ].join(" ");

  // Keep the app functional in prototype mode without a live Supabase project.
  console.warn(`\n[developer-workplace] ${guidance}\n`);
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
