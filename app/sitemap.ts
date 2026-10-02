import { createClient } from "@supabase/supabase-js";
import type { MetadataRoute } from "next";
import type { PublicProjectCardRow } from "@/data/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getApplicationOrigin } from "@/lib/site-origin";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getApplicationOrigin();
  if (!origin) return [];

  const entries: MetadataRoute.Sitemap = [{ url: `${origin}/view` }];
  try {
    const { url, key } = getSupabaseEnv();
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const { data, error } = await supabase.rpc("public_project_list");
    if (error) {
      console.error("[seo] public sitemap project lookup failed", { operation: "list_public_sitemap_projects", code: error.code ?? "unknown" });
      return entries;
    }
    for (const project of (data ?? []) as PublicProjectCardRow[]) {
      if (project.visibility !== "Public") continue;
      entries.push({ url: `${origin}/view/project/${encodeURIComponent(project.slug)}`, lastModified: project.updated_at });
    }
  } catch {
    // A public index page remains available when optional project metadata cannot load.
    console.warn("[seo] public sitemap project lookup unavailable.");
  }
  return entries;
}
