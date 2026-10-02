import type { Metadata } from "next";
import { getApplicationOrigin } from "@/lib/site-origin";

const siteUrl = getApplicationOrigin() ?? undefined;

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
