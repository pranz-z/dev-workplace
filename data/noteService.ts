import type { NoteItem } from "@/types";
import { getWorkspaceContext } from "@/data/context";
import { mapNoteRow } from "@/data/mappers";
import type { NoteRow } from "@/data/database.types";
import {
  describeDatabaseError,
  DELETE_FAILED_MESSAGE,
  SAVE_FAILED_MESSAGE,
  serviceFail,
  serviceOk,
  type ServiceResult,
} from "@/data/serviceResult";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const NOTE_COLUMNS = "id, user_id, project_id, title, content, created_at, updated_at";

export async function listNotes(): Promise<NoteItem[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.from("notes").select(NOTE_COLUMNS).order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapNoteRow(row as NoteRow));
}

export interface NoteInput {
  title: string;
  content?: string;
  projectId?: string | null;
}

export async function createNote(input: NoteInput): Promise<ServiceResult<NoteItem>> {
  const title = input.title.trim();
  if (title.length === 0) return serviceFail("Give the note a title first.");

  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase
    .from("notes")
    .insert({
      user_id: context.userId,
      title,
      content: input.content ?? "",
      project_id: input.projectId ?? null,
    })
    .select(NOTE_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapNoteRow(data as NoteRow));
}

export interface NotePatch {
  title?: string;
  content?: string;
  projectId?: string | null;
}

export async function updateNote(noteId: string, patch: NotePatch): Promise<ServiceResult<NoteItem>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0) return serviceFail("Give the note a title first.");
    payload.title = title;
  }
  if (patch.content !== undefined) payload.content = patch.content;
  if (patch.projectId !== undefined) payload.project_id = patch.projectId ?? null;
  if (Object.keys(payload).length === 0) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase
    .from("notes")
    .update(payload)
    .eq("id", noteId)
    .select(NOTE_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapNoteRow(data as NoteRow));
}

export async function deleteNote(noteId: string): Promise<ServiceResult<{ id: string }>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(DELETE_FAILED_MESSAGE);

  const { error } = await context.supabase.from("notes").delete().eq("id", noteId);
  if (error) return serviceFail(describeDatabaseError(error, DELETE_FAILED_MESSAGE));
  return serviceOk({ id: noteId });
}
