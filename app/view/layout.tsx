import type { Metadata } from "next";

const origin = process.env.NEXT_PUBLIC_SITE_URL;
const siteUrl = (() => { try { return origin ? new URL(origin).origin : undefined; } catch { return undefined; } })();

export const metadata: Metadata = {
  title: "Developer Portfolio",
  description: "Selected software projects, technologies, and project case studies.",
  ...(siteUrl ? { metadataBase: new URL(siteUrl), alternates: { canonical: "/view" } } : {}),
  openGraph: {
    title: "Developer Portfolio",
    description: "Selected software projects, technologies, and project case studies.",
    type: "website",
    ...(siteUrl ? { url: `${siteUrl}/view` } : {}),
  },
  twitter: {
    card: "summary",
    title: "Developer Portfolio",
    description: "Selected software projects, technologies, and project case studies.",
  },
};

export default function PublicPortfolioLayout({ children }: LayoutProps<"/view">) {
  return children;
}
