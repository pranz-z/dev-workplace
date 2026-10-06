import { NextResponse, type NextRequest } from "next/server";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import { driveBrowserAccessUrl, verifyDriveAccess } from "@/lib/google-drive/access";
import { getGoogleDriveAccess, getGoogleDriveUploadSession, readDriveFile, driveServiceErrorResponseStatus } from "@/lib/google-drive/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const fail = (status: number) => NextResponse.json({ error: "File access is unavailable. Check your Drive connection and account." }, { status, headers });

export async function GET(request: NextRequest, context: { params: Promise<{ fileId: string }> }) {
  const auth = await requireGoogleDriveUser();
  if (!("user" in auth)) {
    for (const [key, value] of Object.entries(headers)) auth.response.headers.set(key, value);
    return auth.response;
  }
  const { fileId } = await context.params;
  const modes = request.nextUrl.searchParams.getAll("mode");
  const mode = modes.length === 0 ? "preview" : modes.length === 1 ? modes[0] : null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId) || (mode !== "preview" && mode !== "download")) return fail(400);
  const { data: row, error } = await auth.supabase.from("external_files").select("id,user_id,provider_file_id,status")
    .eq("id", fileId).eq("user_id", auth.user.id).eq("provider", "google_drive").maybeSingle();
  if (error) return fail(502);
  if (!row || row.status !== "active") return fail(404);
  try {
    const access = await getGoogleDriveAccess(auth.user.id);
    const file = await readDriveFile(access.accessToken, row.provider_file_id);
    const marker = (file.appProperties as Record<string, unknown> | undefined)?.softwareWorkplaceUploadId;
    if (typeof marker !== "string" || !/^[0-9a-f-]{36}$/i.test(marker)) return fail(403);
    const session = await getGoogleDriveUploadSession(auth.user.id, marker);
    if (!verifyDriveAccess(file, session, row, access.identity)) return fail(403);
    const url = driveBrowserAccessUrl(file, mode);
    if (!url) return fail(403);
    // Only Google's authenticated browser UI serves bytes; no content or OAuth
    // credentials cross this response, avoiding Vercel's response size limit.
    return NextResponse.redirect(url, { status: 303, headers });
  } catch (cause) { return fail(driveServiceErrorResponseStatus(cause)); }
}
