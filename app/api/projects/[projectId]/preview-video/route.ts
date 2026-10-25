import { ownerPreviewRequest } from "@/lib/project-video/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ projectId: string }> }) {
  return ownerPreviewRequest(request, (await context.params).projectId);
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
