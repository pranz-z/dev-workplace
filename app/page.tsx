import type { Metadata } from "next";
import { cache } from "react";
import PublicPortfolio from "@/components/portfolio/PublicPortfolio";
import type { PublicProfileRow, PublicProjectCardRow } from "@/data/database.types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getApplicationOrigin } from "@/lib/site-origin";
import { getPublicProfessionalContent, publicProfessionalIntroduction } from "@/lib/portfolio/resume-content";
import { publicPortfolioProject } from "@/lib/portfolio/project-card";
import type { PortfolioContent } from "@/lib/portfolio/content";

const loadPublicPortfolio = cache(async () => {
  try {
    const supabase = await getSupabaseServerClient();
    if (supabase) {
      const [profileResult, projectsResult, portfolioResult] = await Promise.all([
        supabase.rpc("public_profile"),
        supabase.rpc("public_project_list"),
        supabase.rpc("public_portfolio"),
      ]);
      return {
        profile: !profileResult.error ? ((profileResult.data ?? []) as PublicProfileRow[])[0] : undefined,
        projects: !projectsResult.error ? (projectsResult.data ?? []) as PublicProjectCardRow[] : [],
        portfolio: !portfolioResult.error ? portfolioResult.data as PortfolioContent | null : null,
        error: Boolean(profileResult.error || projectsResult.error || portfolioResult.error),
      };
    }
  } catch {
    // Keep useful site chrome and generic metadata when public data is unavailable.
  }
  return { profile: undefined, projects: [], portfolio: null, error: true };
});

export async function generateMetadata(): Promise<Metadata> {
  const { profile } = await loadPublicPortfolio();
  const origin = getApplicationOrigin();
  const introduction = publicProfessionalIntroduction(profile ? { displayName: profile.display_name ?? "", headline: profile.headline, bio: profile.bio } : null);
  const name = introduction.name;
  const headline = introduction.headline;
  const title = name ? `${name}${headline ? ` — ${headline}` : " — Portfolio"}` : "Developer Portfolio";
  const description = (introduction.bio || headline || "Selected software projects, technologies, and project case studies.").slice(0, 180);
  return {
    title,
    description,
    ...(origin ? { metadataBase: new URL(origin), alternates: { canonical: "/" } } : {}),
    openGraph: { title, description, type: "website", images: ["/opengraph-image.png"], ...(origin ? { url: `${origin}/` } : {}) },
    twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image.png"] },
  };
}

export default async function PortfolioHome() {
  const { profile, projects, portfolio, error } = await loadPublicPortfolio();
  const publicProfile = profile ? {
    displayName: profile.display_name ?? "",
    headline: profile.headline ?? undefined,
    bio: profile.bio ?? undefined,
    avatarUrl: profile.avatar_url ?? undefined,
    contactEmail: profile.public_contact_email ?? undefined,
    githubUrl: profile.github_url ?? undefined,
    linkedinUrl: profile.linkedin_url ?? undefined,
    websiteUrl: profile.website_url ?? undefined,
  } : null;
  const publicProjects = projects.flatMap((row) => {
    const project = publicPortfolioProject(row);
    return project ? [project] : [];
  });
  return <PublicPortfolio initialProjects={publicProjects} initialError={error} initialProfile={publicProfile}
    initialProfessionalContent={getPublicProfessionalContent({ portfolio })} introduction={publicProfessionalIntroduction(publicProfile)} />;
}
