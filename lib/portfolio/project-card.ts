import type { PublicProjectCardRow } from "@/data/database.types";

/** Only the public fields needed by a homepage card cross into the client. */
export interface PublicPortfolioProject {
  slug: string;
  name: string;
  description: string;
  type: string;
  role: string;
  featured: boolean;
  visibility: "Public";
  status: string;
  technologies: string[];
  publicSummary?: string;
  links: { github?: string; live?: string };
}

export function publicPortfolioProject(row: PublicProjectCardRow): PublicPortfolioProject | null {
  if (row.visibility !== "Public") return null;
  return {
    slug: row.slug,
    name: row.title,
    description: row.description,
    type: row.project_type,
    role: row.role ?? "",
    featured: row.is_featured,
    visibility: "Public",
    status: row.status,
    technologies: row.technologies ?? [],
    publicSummary: row.public_summary ?? undefined,
    links: {
      github: row.show_repository ? row.repository_url ?? undefined : undefined,
      live: row.show_live_demo ? row.demo_url ?? undefined : undefined,
    },
  };
}
