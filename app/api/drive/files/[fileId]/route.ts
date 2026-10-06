import { NextResponse } from "next/server";
import { requireGoogleDriveUser } from "@/lib/google-drive/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  const auth = await requireGoogleDriveUser();
  if ("response" in auth) return auth.response;
  const { fileId } = await context.params;
  if (!UUID_PATTERN.test(fileId)) return NextResponse.json({ error: "File association not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { data: item } = await auth.supabase.from("external_files").select("is_project_folder").eq("id", fileId).eq("user_id", auth.user.id).maybeSingle();
  if (item?.is_project_folder) return NextResponse.json({ error: "Project folders are managed by their Workplace project." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const { count, error: childrenError } = await auth.supabase.from("external_files").select("id", { head: true, count: "exact" }).eq("parent_id", fileId);
  if (childrenError || count) return NextResponse.json({ error: "Remove the folder's Workplace associations first. Drive content remains intact." }, { status: 409, headers: { "Cache-Control": "no-store" } });

  const { data, error } = await auth.supabase.from("external_files").delete()
    .eq("id", fileId).eq("provider", "google_drive").select("id").maybeSingle();
  if (error) {
    console.error("[google-drive] file unlink failed", { code: error.code ?? "unknown" });
    return NextResponse.json({ error: "Google Drive file could not be unlinked." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (!data) return NextResponse.json({ error: "File association not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ unlinked: true }, { headers: { "Cache-Control": "no-store" } });
}
