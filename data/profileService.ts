import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import { getWorkspaceContext } from "@/data/context";
import type { ProfileRow } from "@/data/database.types";
import { describeDatabaseError, SAVE_FAILED_MESSAGE, serviceFail, serviceOk, type ServiceResult } from "@/data/serviceResult";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const PROFILE_COLUMNS = "id, display_name, username, github_username, avatar_url, bio, public_profile_enabled, created_at, updated_at";

function mapProfileRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name ?? "",
    username: row.username ?? undefined,
    githubUsername: row.github_username ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    bio: row.bio ?? undefined,
    publicProfileEnabled: row.public_profile_enabled,
  };
}

/** Reads the signed-in user's profile (owner-only through RLS). */
export async function getCurrentProfile(userId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? mapProfileRow(data as ProfileRow) : null;
}

/**
 * Creates the profile row the first time an account opens the workspace, seeded
 * from the GitHub identity Supabase already verified. It never overwrites an
 * existing row, so user edits survive.
 */
export async function ensureProfile(user: User): Promise<ServiceResult<Profile>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const existing = await getCurrentProfile(user.id);
  if (existing) return serviceOk(existing);

  const metadata = user.user_metadata ?? {};
  const displayName = (metadata.full_name ?? metadata.name ?? metadata.user_name ?? user.email ?? "") as string;
  const username = typeof metadata.user_name === "string" ? metadata.user_name : null;
  const avatarUrl = typeof metadata.avatar_url === "string" ? metadata.avatar_url : null;

  const { data, error } = await context.supabase
    .from("profiles")
    .insert({
      id: user.id,
      display_name: displayName || null,
      username,
      github_username: username,
      avatar_url: avatarUrl,
    })
    .select(PROFILE_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapProfileRow(data as ProfileRow));
}

export interface ProfilePatch {
  displayName?: string;
  username?: string | null;
  githubUsername?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  publicProfileEnabled?: boolean;
}

export async function updateProfile(patch: ProfilePatch): Promise<ServiceResult<Profile>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const payload: Record<string, unknown> = {};
  if (patch.displayName !== undefined) payload.display_name = patch.displayName.trim() || null;
  if (patch.username !== undefined) payload.username = patch.username?.trim() || null;
  if (patch.githubUsername !== undefined) payload.github_username = patch.githubUsername?.trim() || null;
  if (patch.avatarUrl !== undefined) payload.avatar_url = patch.avatarUrl;
  if (patch.bio !== undefined) payload.bio = patch.bio;
  if (patch.publicProfileEnabled !== undefined) payload.public_profile_enabled = patch.publicProfileEnabled;

  if (Object.keys(payload).length === 0) {
    const current = await getCurrentProfile(context.userId);
    return current ? serviceOk(current) : serviceFail(SAVE_FAILED_MESSAGE);
  }

  const { data, error } = await context.supabase
    .from("profiles")
    .update(payload)
    .eq("id", context.userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapProfileRow(data as ProfileRow));
}
