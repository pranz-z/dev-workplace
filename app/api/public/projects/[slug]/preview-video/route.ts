import { publicPreviewRequest } from "@/lib/project-video/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  return publicPreviewRequest((await context.params).slug);
}
