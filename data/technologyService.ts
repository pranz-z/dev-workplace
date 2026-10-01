import type { TechnologyItem } from "@/types";
import { getWorkspaceContext } from "@/data/context";
import { mapTechnologyRow } from "@/data/mappers";
import type { ProjectRow, TechnologyRow } from "@/data/database.types";
import {
  DELETE_FAILED_MESSAGE,
  describeDatabaseError,
  SAVE_FAILED_MESSAGE,
  serviceFail,
  serviceOk,
  type ServiceResult,
} from "@/data/serviceResult";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const TECHNOLOGY_COLUMNS = "id, user_id, name, created_at, updated_at";

interface LinkRow {
  project_id: string;
  technology_id: string;
  projects: { id: string; title: string; project_type: string } | null;
}

/**
 * Technologies plus their project links. `usedIn` is derived from
 * project_technologies, never stored twice.
 */
export async function listTechnologies(): Promise<TechnologyItem[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();

  const [{ data: technologies, error: technologyError }, { data: links, error: linkError }] = await Promise.all([
    supabase.from("technologies").select(TECHNOLOGY_COLUMNS).order("name", { ascending: true }),
    supabase.from("project_technologies").select("project_id, technology_id, projects ( id, title, project_type )"),
  ]);
  if (technologyError) throw technologyError;
  if (linkError) throw linkError;

  const typedLinks = (links ?? []) as unknown as LinkRow[];
  return (technologies ?? []).map((row) => {
    const technology = row as TechnologyRow;
    return mapTechnologyRow(
      technology,
      typedLinks
        .filter((link) => link.technology_id === technology.id)
        .map((link) => ({
          projectId: link.project_id,
          projectType: link.projects?.project_type ?? "",
          projectName: link.projects?.title ?? "Untitled project",
        })),
    );
  });
}

/** projectId -> technology names, used to decorate project cards. */
export async function listProjectTechnologyNames(): Promise<Map<string, string[]>> {
  const byProject = new Map<string, string[]>();
  if (!isSupabaseConfigured()) return byProject;

  const supabase = getSupabaseBrowserClient();
  const { data: links, error } = await supabase
    .from("project_technologies")
    .select("project_id, technology_id, technologies ( id, name )");
  if (error) throw error;

  const typed = (links ?? []) as unknown as Array<{ project_id: string; technologies: { name: string } | null }>;
  typed.forEach((link) => {
    const name = link.technologies?.name;
    if (!name) return;
    const existing = byProject.get(link.project_id) ?? [];
    byProject.set(link.project_id, [...existing, name].sort((a, b) => a.localeCompare(b)));
  });
  return byProject;
}

/** Creates a technology, or returns the existing one when the name is taken. */
export async function createTechnology(name: string): Promise<ServiceResult<TechnologyItem>> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return serviceFail("Give the technology a name first.");

  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase
    .from("technologies")
    .insert({ user_id: context.userId, name: trimmed })
    .select(TECHNOLOGY_COLUMNS)
    .single();

  if (error) {
    // 23505 = the case-insensitive unique (user_id, name) rule: reuse the row.
    if ((error as { code?: string }).code === "23505") {
      const existing = await context.supabase
        .from("technologies")
        .select(TECHNOLOGY_COLUMNS)
        .ilike("name", trimmed)
        .maybeSingle();
      if (!existing.error && existing.data) {
        return serviceOk(mapTechnologyRow(existing.data as TechnologyRow, []));
      }
    }
    return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  }

  return serviceOk(mapTechnologyRow(data as TechnologyRow, []));
}

export async function deleteTechnology(technologyId: string): Promise<ServiceResult<{ id: string }>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(DELETE_FAILED_MESSAGE);

  const { error } = await context.supabase.from("technologies").delete().eq("id", technologyId);
  if (error) return serviceFail(describeDatabaseError(error, DELETE_FAILED_MESSAGE));
  return serviceOk({ id: technologyId });
}

/** Idempotent attach: the composite primary key makes a duplicate a no-op. */
export async function attachTechnology(
  projectId: string,
  technologyId: string,
): Promise<ServiceResult<{ projectId: string; technologyId: string }>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const { error } = await context.supabase
    .from("project_technologies")
    .upsert({ project_id: projectId, technology_id: technologyId }, { onConflict: "project_id,technology_id", ignoreDuplicates: true });
  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk({ projectId, technologyId });
}

export async function detachTechnology(
  projectId: string,
  technologyId: string,
): Promise<ServiceResult<{ projectId: string; technologyId: string }>> {
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(DELETE_FAILED_MESSAGE);

  const { error } = await context.supabase
    .from("project_technologies")
    .delete()
    .eq("project_id", projectId)
    .eq("technology_id", technologyId);
  if (error) return serviceFail(describeDatabaseError(error, DELETE_FAILED_MESSAGE));
  return serviceOk({ projectId, technologyId });
}

/** Projects of the current account, used by the tech page's attach controls. */
export async function listProjectOptions(): Promise<Array<{ id: string; name: string }>> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.from("projects").select("id, title").order("title", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Pick<ProjectRow, "id" | "title">[]).map((row) => ({ id: row.id, name: row.title }));
}

