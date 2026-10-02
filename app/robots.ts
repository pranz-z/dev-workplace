import type { MetadataRoute } from "next";
import { getApplicationOrigin } from "@/lib/site-origin";

export default function robots(): MetadataRoute.Robots {
  const origin = getApplicationOrigin();
  return {
    rules: [{ userAgent: "*", disallow: ["/app", "/api/", "/auth/", "/login"] }],
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
