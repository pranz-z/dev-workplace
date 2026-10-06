import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_MANAGED_MARKER = "google-drive-files-v1";
export interface FolderReservation { metadata_id: string; drive_file_id: string; parent_drive_id: string | null }
type DriveRequest = (token: string, url: string, init?: RequestInit) => Promise<Response>;
const api = "https://www.googleapis.com/drive/v3/files";
const fields = "id,name,mimeType,parents,ownedByMe,trashed,appProperties";
const escapeQuery = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function reserveDriveFolder(ownerId: string, account: string, key: string, candidate: string | null = null, parent: string | null = null, previous: string | null = null): Promise<FolderReservation | null> {
  const { data, error } = await getSupabaseAdminClient().rpc("reserve_google_drive_folder", {
    p_user_id: ownerId, p_google_account_sub: account, p_logical_key: key,
    p_candidate_id: candidate, p_parent_drive_id: parent, p_previous_drive_id: previous,
  });
  if (error) throw new Error("drive_folder_registry_unavailable");
  return (Array.isArray(data) ? data[0] ?? null : null) as FolderReservation | null;
}

async function generateId(token: string, request: DriveRequest): Promise<string> {
  const response = await request(token, `${api}/generateIds?count=1&space=drive&type=files`);
  const body = await response.json() as { ids?: string[] };
  if (!response.ok || typeof body.ids?.[0] !== "string") throw new Error("drive_folder_id_unavailable");
  return body.ids[0];
}

/** Google pre-generated IDs + an atomic registry reserve prevent duplicates
 * across server instances and ambiguous create responses. No name-based adoption. */
export async function ensureRegisteredDriveFolder(token: string, ownerId: string, account: string, key: string, name: string, parent: string | null, markers: Record<string, string>, request: DriveRequest): Promise<FolderReservation> {
  let reservation = await reserveDriveFolder(ownerId, account, key);
  if (!reservation) {
    const url = new URL(api);
    const markerQuery = Object.entries(markers).map(([k, v]) => `appProperties has { key='${escapeQuery(k)}' and value='${escapeQuery(v)}' }`).join(" and ");
    url.searchParams.set("q", `${markerQuery} and mimeType='${DRIVE_FOLDER_MIME}' and trashed=false${parent ? ` and '${escapeQuery(parent)}' in parents` : ""}${key === "root" ? " and not appProperties has { key='softwareWorkplaceResourceType' and value='project-folder' }" : ""}`);
    url.searchParams.set("fields", `nextPageToken,incompleteSearch,files(${fields})`); url.searchParams.set("pageSize", "100");
    url.searchParams.set("spaces", "drive");
    const matches = new Set<string>();
    for (let page = 0; ; page++) {
      if (page >= 20) throw new Error("drive_folder_lookup_incomplete");
      const response = await request(token, url.toString());
      const body = await response.json() as { files?: Array<{ id?: string; ownedByMe?: boolean; trashed?: boolean; mimeType?: string; parents?: string[]; appProperties?: Record<string, string> }>; nextPageToken?: string; incompleteSearch?: boolean };
      if (!response.ok || body.incompleteSearch) throw new Error("drive_folder_lookup_failed");
      for (const file of body.files ?? []) {
        if (typeof file.id === "string" && file.ownedByMe === true && file.trashed === false
          && file.mimeType === DRIVE_FOLDER_MIME && (!parent || file.parents?.includes(parent))
          && Object.entries(markers).every(([k, v]) => file.appProperties?.[k] === v)
          && (key !== "root" || file.appProperties?.softwareWorkplaceResourceType !== "project-folder")) matches.add(file.id);
      }
      // Without a registry there is no authoritative canonical ID. Fail closed,
      // rather than choosing by API ordering or deleting the owner's Drive data.
      if (matches.size > 1) throw new Error("drive_folder_duplicate_matches");
      if (!body.nextPageToken) break;
      url.searchParams.set("pageToken", body.nextPageToken);
    }
    reservation = await reserveDriveFolder(ownerId, account, key, [...matches][0] ?? await generateId(token, request), parent);
  }
  if (!reservation) throw new Error("drive_folder_registry_unavailable");
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request(token, `${api}/${encodeURIComponent(reservation.drive_file_id)}?fields=${fields}`);
    let file = response.ok ? await response.json() : null;
    if (response.status !== 404 && !response.ok) throw new Error("drive_folder_unavailable");
    if (file?.trashed === true || reservation.parent_drive_id !== parent) {
      reservation = await reserveDriveFolder(ownerId, account, key, await generateId(token, request), parent, reservation.drive_file_id);
      if (!reservation) throw new Error("drive_folder_registry_unavailable");
      continue;
    }
    if (!file) {
      const created = await request(token, `${api}?fields=${fields}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reservation.drive_file_id, name, mimeType: DRIVE_FOLDER_MIME, ...(parent ? { parents: [parent] } : {}), appProperties: markers }),
      });
      if (created.status === 409) continue; // Another ensure already created this exact ID.
      if (created.status === 404) {
        reservation = await reserveDriveFolder(ownerId, account, key, await generateId(token, request), parent, reservation.drive_file_id);
        if (!reservation) throw new Error("drive_folder_registry_unavailable");
        continue;
      }
      if (!created.ok) throw new Error("drive_folder_create_failed");
      file = await created.json();
    }
    if (file.id !== reservation.drive_file_id || file.ownedByMe !== true || file.trashed !== false || file.mimeType !== DRIVE_FOLDER_MIME
      || (key === "root" && file.appProperties?.softwareWorkplaceResourceType === "project-folder")
      || (parent && (!Array.isArray(file.parents) || !file.parents.includes(parent)))
      || Object.entries(markers).some(([k, v]) => file.appProperties?.[k] !== v)) throw new Error("drive_folder_verification_failed");
    if (file.name !== name) {
      const renamed = await request(token, `${api}/${encodeURIComponent(reservation.drive_file_id)}?fields=id`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      if (!renamed.ok) throw new Error("drive_folder_rename_failed");
    }
    return reservation;
  }
  throw new Error("drive_folder_busy_retry");
}
