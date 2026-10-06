import type { Metadata } from "next";
import { caveat, geistSans, geistMono, kalam } from "./fonts";
import { SketchFilter, PencilTrail } from "@/components/ui/notebook";
import { ThemeBootstrap } from "@/components/ui/ThemeBootstrap";
import { AuthProvider } from "@/components/auth/auth-provider";
import { getApplicationOrigin } from "@/lib/site-origin";
import "./globals.css";

const applicationOrigin = getApplicationOrigin();

export const metadata: Metadata = {
  metadataBase: new URL(applicationOrigin ?? "https://frami-devplace.vercel.app"),
  title: "Frami — Developer Workplace",
  applicationName: "Frami",
  description: "Frami is a personal software development workplace and public portfolio for projects, tasks, plans, and GitHub-inspired workflows.",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg", shortcut: "/favicon.ico", apple: "/apple-icon.png" },
  openGraph: {
    title: "Frami — Developer Workplace",
    description: "A personal software development workplace and public portfolio.",
    images: ["/opengraph-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Frami — Developer Workplace",
    description: "A personal software development workplace and public portfolio.",
    images: ["/opengraph-image.png"],
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F0E5" },
    { media: "(prefers-color-scheme: dark)", color: "#1C1917" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${kalam.variable} h-full antialiased`}
    >
      <head><ThemeBootstrap /></head>
      <body className="min-h-full bg-[var(--background)] text-[var(--ink)]">
        <SketchFilter />
        <PencilTrail />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
