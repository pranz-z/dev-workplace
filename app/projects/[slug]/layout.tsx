import type { Metadata } from "next";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicProjectCardRow, PublicProjectScreenshotRow } from "@/data/database.types";
import { getApplicationOrigin } from "@/lib/site-origin";

const siteUrl = getApplicationOrigin() ?? undefined;

async function projectMetadata({ params }: LayoutProps<"/projects/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await getSupabaseServerClient();
  if (!supabase || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { title: "Project unavailable | Developer Portfolio", robots: { index: false, follow: false } };
  const { data, error } = await supabase.rpc("public_project_by_slug", { p_slug: slug });
  const project = !error ? ((data ?? []) as PublicProjectCardRow[])[0] : undefined;
  if (!project) return { title: "Project unavailable | Developer Portfolio", robots: { index: false, follow: false } };

  const description = (project.public_summary || project.description || "Project case study").slice(0, 180);
  const canonical = siteUrl ? `${siteUrl}/projects/${encodeURIComponent(project.slug)}` : undefined;
  const { data: screenshotRows, error: screenshotError } = await supabase.rpc("public_project_screenshots", { p_slug: slug });
  const screenshot = !screenshotError ? ((screenshotRows ?? []) as PublicProjectScreenshotRow[])[0] : undefined;
  const { data: signedPreview } = screenshot
    ? await supabase.storage.from("project-screenshots").createSignedUrl(screenshot.storage_path, 60 * 5)
    : { data: null };
  const previewImages = signedPreview?.signedUrl ? [{ url: signedPreview.signedUrl, alt: `${project.title} screenshot` }] : undefined;
  return {
    title: `${project.title} | Developer Portfolio`,
    description,
    ...(project.visibility === "Unlisted" ? { robots: { index: false, follow: false } } : {}),
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title: `${project.title} | Developer Portfolio`,
      description,
      type: "article",
      ...(canonical ? { url: canonical } : {}),
      images: previewImages ?? ["/opengraph-image.png"],
    },
    twitter: { card: "summary_large_image", title: `${project.title} | Developer Portfolio`, description, images: previewImages?.map((image) => image.url) ?? ["/opengraph-image.png"] },
  };
}

export async function generateMetadata(props: LayoutProps<"/projects/[slug]">): Promise<Metadata> {
  try {
    return await projectMetadata(props);
  } catch {
    return { title: "Project unavailable | Developer Portfolio", robots: { index: false, follow: false } };
  }
}

export default function PublicProjectLayout({ children }: LayoutProps<"/projects/[slug]">) {
  return children;
}
