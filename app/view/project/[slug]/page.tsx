import { permanentRedirect } from "next/navigation";

export default async function LegacyProject({ params }: PageProps<"/view/project/[slug]">) {
  const { slug } = await params;
  permanentRedirect(`/projects/${encodeURIComponent(slug)}`);
}
