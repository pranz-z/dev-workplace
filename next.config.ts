import type { NextConfig } from "next";
import { getMissingSupabaseEnvVars } from "./lib/supabase/env";
import { buildContentSecurityPolicy } from "./lib/security/content-security-policy";

const missingPublicEnvVars = getMissingSupabaseEnvVars();

if (missingPublicEnvVars.length > 0) {
  const guidance = [
    `Missing or malformed ${missingPublicEnvVars.join(", ")}.`,
    "Copy .env.example to .env.local and add the Supabase project values (never commit real values).",
    "Private workspace routes stay locked and Supabase-backed data stays disabled until the environment is configured.",
  ].join(" ");

  // Keep the app functional in prototype mode without a live Supabase project.
  console.warn(`\n[developer-workplace] ${guidance}\n`);
}

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: buildContentSecurityPolicy({ development: process.env.NODE_ENV !== "production", supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }) },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
      ],
    }, {
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    }];
  },
};

export default nextConfig;
