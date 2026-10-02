import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Developer Workplace",
  robots: { index: false, follow: false },
};

export default function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  return children;
}
