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

  const { data, error } = await auth.supabase.from("external_files").delete()
    .eq("id", fileId).eq("provider", "google_drive").select("id").maybeSingle();
  if (error) {
    console.error("[google-drive] file unlink failed", { code: error.code ?? "unknown" });
    return NextResponse.json({ error: "Google Drive file could not be unlinked." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (!data) return NextResponse.json({ error: "File association not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ unlinked: true }, { headers: { "Cache-Control": "no-store" } });
}
