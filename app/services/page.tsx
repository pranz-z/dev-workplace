import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import PublicServices from "@/components/portfolio/PublicServices";
import type { PortfolioContent } from "@/lib/portfolio/content";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getApplicationOrigin } from "@/lib/site-origin";

const loadPublicServices = cache(async () => {
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("public_portfolio");
    const portfolio = !error ? data as PortfolioContent | null : null;
    // public_portfolio already removed hidden services and a disabled services section.
    return portfolio?.services?.length ? portfolio : null;
  } catch {
    return null;
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const portfolio = await loadPublicServices();
  if (!portfolio) return { title: "Services unavailable", robots: { index: false, follow: false } };
  const origin = getApplicationOrigin();
  const heading = portfolio.servicesPage.title || "Services";
  const title = portfolio.hero.name ? `${heading} — ${portfolio.hero.name}` : heading;
  const description = (portfolio.servicesPage.intro || portfolio.services.map((service) => service.title).join(", ")).slice(0, 180);
  return {
    title,
    description,
    ...(origin ? { metadataBase: new URL(origin), alternates: { canonical: "/services" } } : {}),
    openGraph: { title, description, type: "website", images: ["/opengraph-image.png"], ...(origin ? { url: `${origin}/services` } : {}) },
    twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image.png"] },
  };
}

export default async function ServicesPage() {
  const portfolio = await loadPublicServices();
  if (!portfolio) notFound();
  return <PublicServices content={portfolio} />;
}
