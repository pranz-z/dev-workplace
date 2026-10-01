import type { Milestone, NoteItem, Plan, Project, Task, TechnologyItem } from "@/types";
import { getWorkspaceContext } from "@/data/context";
import { listMilestones } from "@/data/milestoneService";
import { listNotes } from "@/data/noteService";
import { createPlanItem } from "@/data/planItemService";
import { listPlans } from "@/data/planService";
import { createProject, listProjects } from "@/data/projectService";
import { createTask, listTasks } from "@/data/taskService";
import { attachTechnology, createTechnology, listProjectTechnologyNames, listTechnologies } from "@/data/technologyService";
import { isValidSlug, slugify, stripUuidSuffix } from "@/lib/slug";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface WorkspaceData {
  projects: Project[];
  tasks: Task[];
  milestones: Milestone[];
  plans: Plan[];
  notes: NoteItem[];
  technologies: TechnologyItem[];
}

/**
 * Loads the whole workspace with one round trip per table. Progress and the
 * project technology pills are derived from the same snapshot, so the dashboard
 * never shows figures that disagree with the lists underneath.
 */
export async function loadWorkspaceData(): Promise<WorkspaceData | null> {
  if (!isSupabaseConfigured()) return null;

  const [tasks, milestones, notes, plans, technologyNames, technologies] = await Promise.all([
    listTasks(),
    listMilestones(),
    listNotes(),
    listPlans(),
    listProjectTechnologyNames(),
    listTechnologies(),
  ]);

  const projects = await listProjects({ tasks, milestones, technologyNames });
  return { projects, tasks, milestones, plans, notes, technologies };
}

// ---------------------------------------------------------------------------
// Local prototype migration
// ---------------------------------------------------------------------------

export interface LocalWorkspaceSnapshot {
  projects?: Array<Omit<Project, "id"> & { id?: string }>;
  tasks?: Task[];
  milestones?: Milestone[];
  plans?: Plan[];
  notes?: NoteItem[];
  technologies?: TechnologyItem[];
}

export type MigrationStatus = "unavailable" | "not-authenticated" | "empty-local" | "server-has-data" | "invalid" | "migrated";

export interface MigrationResult {
  status: MigrationStatus;
  message: string;
  projectCount?: number;
  skipped?: number;
}

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const isUsableDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(new Date(value).getTime());

const toDateOnly = (value: unknown): string | null => (isUsableDate(value) ? new Date(value).toISOString().slice(0, 10) : null);

/** True when the stored snapshot holds something worth importing. */
export function hasImportableLocalData(snapshot: LocalWorkspaceSnapshot): boolean {
  const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  return projects.some((project) => isNonEmptyString(project?.name)) || tasks.some((task) => isNonEmptyString(task?.title));
}

/**
 * Imports a prototype workspace from localStorage.
 *
 * Safety rules:
 *   * every record is validated before it is inserted - malformed entries are
 *     skipped and reported instead of breaking the import
 *   * nothing is imported when the server already holds projects, so server data
 *     is never overwritten or duplicated
 *   * the legacy snapshot in localStorage is only cleared by the caller, after
 *     this function reports success
 */
export async function migrateLocalWorkspace(snapshot: LocalWorkspaceSnapshot): Promise<MigrationResult> {
  if (!isSupabaseConfigured()) {
    return { status: "unavailable", message: "Supabase is not configured, so the local workspace remains unchanged." };
  }

  const context = await getWorkspaceContext();
  if (!context) {
    return { status: "not-authenticated", message: "Sign in again before importing a local workspace." };
  }

  const projects = Array.isArray(snapshot.projects) ? snapshot.projects.filter((project) => isNonEmptyString(project?.name)) : [];
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  const milestones = Array.isArray(snapshot.milestones) ? snapshot.milestones : [];
  const plans = Array.isArray(snapshot.plans) ? snapshot.plans : [];
  const notes = Array.isArray(snapshot.notes) ? snapshot.notes.filter((note) => isNonEmptyString(note?.title)) : [];
  const technologies = Array.isArray(snapshot.technologies) ? snapshot.technologies.filter((tech) => isNonEmptyString(tech?.name)) : [];

  if (!hasImportableLocalData(snapshot)) {
    return { status: "empty-local", message: "No importable local workspace data was found." };
  }

  const { data: existing, error: existingError } = await context.supabase.from("projects").select("id").limit(1);
  if (existingError) {
    return { status: "invalid", message: "We couldn't check the server workspace, so nothing was imported." };
  }
  if ((existing ?? []).length > 0) {
    return { status: "server-has-data", message: "Your server workspace already has data, so nothing was overwritten." };
  }

  let skipped = 0;
  const projectIdMap = new Map<string, string>();
  const keyFor = (value: string | undefined, fallback: string) => value ?? fallback;

  for (const [index, project] of projects.entries()) {
    const result = await createProject({
      name: project.name,
      slug: isValidSlug(project.slug ?? "") ? project.slug : stripUuidSuffix(slugify(project.name)),
      description: project.description ?? "",
      type: project.type ?? "Personal",
      status: project.status,
      currentPhase: project.currentPhase,
      role: project.role,
      startDate: toDateOnly(project.startDate),
      targetDate: toDateOnly(project.targetDate),
      objective: project.objective ?? "",
      nextAction: project.nextAction ?? "",
      visibility: project.visibility ?? "Private",
      featured: Boolean(project.featured),
      technologies: (project.technologies ?? []).filter(isNonEmptyString),
    });

    if (result.ok) projectIdMap.set(keyFor(project.id, `local-${index}`), result.data.id);
    else skipped += 1;
  }

  for (const milestone of milestones) {
    const projectId = projectIdMap.get(milestone.projectId);
    if (!projectId || !isNonEmptyString(milestone.title)) {
      skipped += 1;
      continue;
    }
    const { error } = await context.supabase.from("milestones").insert({
      project_id: projectId,
      title: milestone.title,
      status: milestone.status,
      target_date: toDateOnly(milestone.targetDate),
      sort_order: milestone.order ?? 0,
    });
    if (error) skipped += 1;
  }

  for (const task of tasks) {
    const projectId = projectIdMap.get(task.projectId);
    if (!projectId || !isNonEmptyString(task.title)) {
      skipped += 1;
      continue;
    }
    const result = await createTask({
      projectId,
      title: task.title,
      description: task.description ?? "",
      status: task.status,
      priority: task.priority,
      dueDate: isUsableDate(task.dueDate) ? task.dueDate : null,
    });
    if (!result.ok) skipped += 1;
  }

  for (const technology of technologies) {
    const created = await createTechnology(technology.name);
    if (!created.ok) {
      skipped += 1;
      continue;
    }
    for (const [projectIndex, project] of projects.entries()) {
      const projectId = projectIdMap.get(keyFor(project.id, `local-${projectIndex}`));
      const linked = (project.technologies ?? []).some((name) => name.toLowerCase() === technology.name.toLowerCase());
      if (projectId && linked) await attachTechnology(projectId, created.data.id);
    }
  }

  for (const plan of plans) {
    if (!isNonEmptyString(plan.title)) {
      skipped += 1;
      continue;
    }
    const { data, error } = await context.supabase
      .from("plans")
      .insert({
        user_id: context.userId,
        title: plan.title,
        description: plan.goal ?? "",
        status: plan.status ?? "Planning",
        target_date: toDateOnly(plan.deadline),
      })
      .select("id")
      .single();
    if (error || !data) {
      skipped += 1;
      continue;
    }
    for (const item of plan.tasks ?? []) {
      if (isNonEmptyString(item.label)) await createPlanItem((data as { id: string }).id, { label: item.label });
    }
  }

  for (const note of notes) {
    const { error } = await context.supabase.from("notes").insert({
      user_id: context.userId,
      project_id: note.projectId ? projectIdMap.get(note.projectId) ?? null : null,
      title: note.title,
      content: note.content ?? "",
    });
    if (error) skipped += 1;
  }

  const message =
    skipped > 0
      ? `Imported ${projectIdMap.size} projects into Supabase and skipped ${skipped} entries that could not be validated.`
      : `Imported ${projectIdMap.size} projects into Supabase.`;

  return { status: "migrated", message, projectCount: projectIdMap.size, skipped };
}

