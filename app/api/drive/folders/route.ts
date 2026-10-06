import { NextResponse, type NextRequest } from "next/server";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import { driveServiceErrorResponseStatus, ensureGoogleDriveAppFolder, getGoogleDriveAccess } from "@/lib/google-drive/files";
import { createCustomDriveFolder, DRIVE_UUID, ensureGoogleDriveProjectFolder, ownedDriveProject } from "@/lib/google-drive/folders";
import { validateDriveFilename } from "@/lib/google-drive/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const auth = await requireGoogleDriveUser();
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid folder request." }, { status: 400, headers });
  const projectId = body.projectId ?? null;
  const parentId = body.parentId ?? null;
  if ((projectId !== null && (typeof projectId !== "string" || !DRIVE_UUID.test(projectId)))
    || (parentId !== null && (typeof parentId !== "string" || !DRIVE_UUID.test(parentId)))
    || !["ensure-project", "create"].includes(body.action)) return NextResponse.json({ error: "Invalid folder destination." }, { status: 400, headers });
  const name = body.action === "create" ? validateDriveFilename(body.name) : null;
  if (body.action === "create" && (!name || typeof body.requestId !== "string" || !DRIVE_UUID.test(body.requestId))) return NextResponse.json({ error: "Provide a valid folder name and request ID." }, { status: 400, headers });
  try {
    // Authenticate ownership before requesting any Google side effects.
    if (projectId) await ownedDriveProject({ supabase: auth.supabase, ownerId: auth.user.id }, projectId);
    if (body.action === "ensure-project" && (!projectId || parentId)) return NextResponse.json({ error: "Select a project." }, { status: 400, headers });
    const access = await getGoogleDriveAccess(auth.user.id);
    const context = { supabase: auth.supabase, ownerId: auth.user.id, ...access };
    if (body.action === "ensure-project") {
      const project = await ownedDriveProject(context, projectId);
      const root = await ensureGoogleDriveAppFolder(access.accessToken, auth.user.id, access.identity.subject);
      const folder = await ensureGoogleDriveProjectFolder(context, root, project.id, project.name);
      return NextResponse.json({ folder }, { headers });
    }
    const folder = await createCustomDriveFolder(context, name!, projectId, parentId, body.requestId);
    return NextResponse.json({ folder }, { status: 201, headers });
  } catch (error) {
    return NextResponse.json({ error: "Folder could not be synchronized. Check your Drive connection and retry." }, { status: driveServiceErrorResponseStatus(error), headers });
  }
}
