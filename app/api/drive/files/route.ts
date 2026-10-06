import { NextResponse, type NextRequest } from "next/server";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";
import { DRIVE_METADATA_FIELDS } from "@/lib/google-drive/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await requireGoogleDriveUser();
  if ("response" in auth) return auth.response;

  const params = request.nextUrl.searchParams;
  const projectId = params.get("projectId");
  const taskId = params.get("taskId");
  const limitRaw = params.get("limit") ?? "50";
  const offsetRaw = params.get("offset") ?? "0";
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  if (
    (projectId !== null && !UUID_PATTERN.test(projectId))
    || (taskId !== null && !UUID_PATTERN.test(taskId))
    || !Number.isInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000
  ) return NextResponse.json({ error: "Invalid file list filters." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  let query = auth.supabase.from("external_files").select(
    DRIVE_METADATA_FIELDS,
    { count: "exact" },
  ).eq("provider", "google_drive").eq("status", "active").order("updated_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);
  if (taskId) query = query.eq("task_id", taskId);
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    console.error("[google-drive] file list failed", { code: error.code ?? "unknown" });
    return NextResponse.json({ error: "Google Drive files are unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ files: data ?? [], count: count ?? 0, nextOffset: offset + (data?.length ?? 0) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
