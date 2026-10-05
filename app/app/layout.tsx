import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Frami",
  robots: { index: false, follow: false },
};

export default function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  return children;
}
