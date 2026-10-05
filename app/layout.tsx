import type { Metadata } from "next";
import { Caveat, Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth/auth-provider";
import { getApplicationOrigin } from "@/lib/site-origin";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
});

const applicationOrigin = getApplicationOrigin();

export const metadata: Metadata = {
  ...(applicationOrigin ? { metadataBase: new URL(applicationOrigin) } : {}),
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
    { media: "(prefers-color-scheme: light)", color: "#F4EBDD" },
    { media: "(prefers-color-scheme: dark)", color: "#1C1917" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[var(--background)] text-[var(--ink)]">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
