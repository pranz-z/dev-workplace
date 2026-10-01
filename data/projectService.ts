import type { Milestone, Priority, Project, ProjectSettings, ProjectStatus, PublicProject, Task, TaskStatus, WorkflowPhase } from "@/types";
import { getWorkspaceContext, isUuid } from "@/data/context";
import { mapProjectRow, mapProjectSettingsRow, mapPublicProjectRow } from "@/data/mappers";
import { PROJECT_COLUMNS, type ProjectRow, type ProjectSettingsRow, type PublicProjectCardRow, type Visibility } from "@/data/database.types";
import {
  DELETE_FAILED_MESSAGE,
  describeDatabaseError,
  SAVE_FAILED_MESSAGE,
  serviceFail,
  serviceOk,
  type ServiceResult,
} from "@/data/serviceResult";
import { attachTechnology, createTechnology } from "@/data/technologyService";
import { buildSlugCandidate, isUniqueViolation, isValidSlug, MAX_SLUG_LENGTH } from "@/lib/slug";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const PROJECT_SETTINGS_COLUMNS =
  "id, project_id, custom_color, custom_icon, show_github_activity, show_commit_count, show_streak, show_accountability, show_public_accountability, show_public_accountability_score, show_live_demo, show_repository, created_at, updated_at";

export async function listProjectRows(): Promise<ProjectRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.from("projects").select(PROJECT_COLUMNS).order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ProjectRow[];
}

export interface ProjectLoadContext {
  tasks?: Array<Pick<Task, "status"> & { projectId?: string }>;
  milestones?: Array<Pick<Milestone, "status"> & { projectId?: string }>;
  technologyNames?: Map<string, string[]>;
}

/**
 * Workspace projects (owner only - RLS enforces it) with derived progress and
 * technology names. Progress is calculated from the tasks/milestones passed in,
 * never read from a stored percentage.
 */
export async function listProjects(context: ProjectLoadContext = {}): Promise<Project[]> {
  const rows = await listProjectRows();
  return rows.map((row) =>
    mapProjectRow(row, {
      tasks: (context.tasks ?? []).filter((task) => task.projectId === row.id),
      milestones: (context.milestones ?? []).filter((milestone) => milestone.projectId === row.id),
      technologies: context.technologyNames?.get(row.id) ?? [],
    }),
  );
}

export interface ProjectDraft {
  name: string;
  slug?: string;
  description?: string;
  type?: string;
  status?: ProjectStatus;
  currentPhase?: WorkflowPhase;
  priority?: Priority;
  role?: string;
  teamSize?: number | null;
  startDate?: string | null;
  targetDate?: string | null;
  objective?: string;
  nextAction?: string;
  visibility?: Visibility;
  featured?: boolean;
  /** Harmless placeholder link (no GitHub API access in Phase 2B). */
  repositoryUrl?: string | null;
  /** Technology names; missing ones are created and linked. */
  technologies?: string[];
}

const toWorkflowColumn = (phase: WorkflowPhase) => phase.toLowerCase();

/**
 * Inserts a project and returns the stored row.
 *
 * Slug handling: the base slug is derived from the title, then suffixed
 * (`-2`, `-3`, ...) on a unique violation. Postgres owns the final decision via
 * projects_slug_key, so two clients creating "Portfolio" at the same moment can
 * never silently share one public URL.
 */
export async function createProject(draft: ProjectDraft): Promise<ServiceResult<Project>> {
  const name = draft.name.trim();
  if (name.length === 0) return serviceFail("Give the project a title first.");

  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const baseSlug = draft.slug && isValidSlug(draft.slug) ? draft.slug : name;
  let lastError: unknown = null;
  let created: ProjectRow | null = null;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const slug = buildSlugCandidate(baseSlug, attempt).slice(0, MAX_SLUG_LENGTH);
    const { data, error } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        slug,
        title: name,
        description: draft.description ?? "",
        project_type: draft.type ?? "Personal",
        status: draft.status ?? "Planning",
        workflow_stage: toWorkflowColumn(draft.currentPhase ?? "PLANNING"),
        priority: draft.priority ?? "Medium",
        visibility: draft.visibility ?? "Private",
        is_featured: draft.featured ?? false,
        repository_url: draft.repositoryUrl ?? null,
        role: draft.role ?? "Developer",
        team_size: draft.teamSize ?? null,
        start_date: draft.startDate ?? null,
        target_date: draft.targetDate ?? null,
        current_objective: draft.objective ?? "",
        next_action: draft.nextAction ?? "",
      })
      .select(PROJECT_COLUMNS)
      .single();

    if (!error) {
      created = data as unknown as ProjectRow;
      break;
    }
    if (isUniqueViolation(error)) {
      lastError = error;
      continue;
    }
    return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  }

  if (!created) {
    console.error("[data] could not find a free slug", lastError);
    return serviceFail("Couldn't find a free public address for that name. Try a slightly different title.");
  }

  for (const technologyName of draft.technologies ?? []) {
    const technology = await createTechnology(technologyName);
    if (technology.ok) await attachTechnology(created.id, technology.data.id);
  }

  return serviceOk(mapProjectRow(created, { technologies: draft.technologies ?? [] }));
}

export interface ProjectPatch {
  name?: string;
  slug?: string;
  description?: string;
  type?: string;
  status?: ProjectStatus;
  currentPhase?: WorkflowPhase;
  priority?: Priority;
  role?: string;
  teamSize?: number | null;
  startDate?: string | null;
  targetDate?: string | null;
  objective?: string;
  nextAction?: string;
  visibility?: Visibility;
  featured?: boolean;
  publicSummary?: string | null;
  publicProblem?: string | null;
  publicSolution?: string | null;
  publicResult?: string | null;
  repositoryUrl?: string | null;
  demoUrl?: string | null;
  docsUrl?: string | null;
  health?: Partial<Project["health"]>;
}

/**
 * Updates the columns the UI actually edits. An existing slug is kept when the
 * title changes so a shared public link never breaks; pass `slug` explicitly to
 * rename the public address on purpose.
 */
export async function updateProject(projectId: string, patch: ProjectPatch): Promise<ServiceResult<Project>> {
  if (!isUuid(projectId)) return serviceFail(SAVE_FAILED_MESSAGE);

  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0) return serviceFail("Give the project a title first.");
    payload.title = name;
  }
  if (patch.slug !== undefined) {
    const slug = patch.slug.trim();
    if (slug.length === 0) {
      payload.slug = buildSlugCandidate(patch.name ?? "project", 1);
    } else {
      if (!isValidSlug(slug)) return serviceFail("Public addresses may only contain lowercase letters, numbers and hyphens.");
      payload.slug = slug;
    }
  }
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.type !== undefined) payload.project_type = patch.type;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.currentPhase !== undefined) payload.workflow_stage = toWorkflowColumn(patch.currentPhase);
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.role !== undefined) payload.role = patch.role.trim() || null;
  if (patch.teamSize !== undefined) payload.team_size = patch.teamSize ?? null;
  if (patch.startDate !== undefined) payload.start_date = patch.startDate;
  if (patch.targetDate !== undefined) payload.target_date = patch.targetDate;
  if (patch.objective !== undefined) payload.current_objective = patch.objective;
  if (patch.nextAction !== undefined) payload.next_action = patch.nextAction;
  if (patch.visibility !== undefined) payload.visibility = patch.visibility;
  if (patch.featured !== undefined) payload.is_featured = patch.featured;
  if (patch.publicSummary !== undefined) payload.public_summary = patch.publicSummary;
  if (patch.publicProblem !== undefined) payload.public_problem = patch.publicProblem;
  if (patch.publicSolution !== undefined) payload.public_solution = patch.publicSolution;
  if (patch.publicResult !== undefined) payload.public_result = patch.publicResult;
  if (patch.repositoryUrl !== undefined) payload.repository_url = patch.repositoryUrl;
  if (patch.demoUrl !== undefined) payload.demo_url = patch.demoUrl;
  if (patch.docsUrl !== undefined) payload.docs_url = patch.docsUrl;
  if (patch.health?.documentation !== undefined) payload.health_documentation = patch.health.documentation;
  if (patch.health?.screenshots !== undefined) payload.health_screenshots = patch.health.screenshots;
  if (patch.health?.testing !== undefined) payload.health_testing = patch.health.testing;
  if (patch.health?.deployment !== undefined) payload.health_deployment = patch.health.deployment;

  if (Object.keys(payload).length === 0) return serviceFail(SAVE_FAILED_MESSAGE);

  const { data, error } = await context.supabase
    .from("projects")
    .update(payload)
    .eq("id", projectId)
    .select(PROJECT_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));

  /**
   * The write is confirmed, so re-read the scoped progress inputs for this one
   * project. Without them the returned card would show workflow-only progress
   * and lose its technology pills even though nothing about them changed.
   */
  const row = data as unknown as ProjectRow;
  const [taskRows, milestoneRows, linkRows] = await Promise.all([
    context.supabase.from("tasks").select("status").eq("project_id", row.id),
    context.supabase.from("milestones").select("status").eq("project_id", row.id),
    context.supabase.from("project_technologies").select("technologies ( name )").eq("project_id", row.id),
  ]);
  if (taskRows.error) console.error("[data] couldn't reload tasks after project update", taskRows.error.message);
  if (milestoneRows.error) console.error("[data] couldn't reload milestones after project update", milestoneRows.error.message);
  if (linkRows.error) console.error("[data] couldn't reload technologies after project update", linkRows.error.message);

  const technologyNames = ((linkRows.data ?? []) as unknown as Array<{ technologies: { name: string } | null }>)
    .map((link) => link.technologies?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));

  return serviceOk(
    mapProjectRow(row, {
      tasks: (taskRows.data ?? []) as Array<{ status: TaskStatus }>,
      milestones: (milestoneRows.data ?? []) as Array<{ status: "completed" | "active" | "pending" }>,
      technologies: technologyNames,
    }),
  );
}

export async function setProjectVisibility(projectId: string, visibility: Visibility): Promise<ServiceResult<Project>> {
  return updateProject(projectId, { visibility });
}

/** Archive keeps the record and its history but takes it out of circulation. */
export async function archiveProject(projectId: string): Promise<ServiceResult<Project>> {
  return updateProject(projectId, { status: "On Hold", visibility: "Private", featured: false });
}

export async function restoreProject(projectId: string): Promise<ServiceResult<Project>> {
  return updateProject(projectId, { status: "In Development" });
}

export async function deleteProject(projectId: string): Promise<ServiceResult<{ id: string }>> {
  if (!isUuid(projectId)) return serviceFail("That project is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(DELETE_FAILED_MESSAGE);

  const { error } = await context.supabase.from("projects").delete().eq("id", projectId);
  if (error) return serviceFail(describeDatabaseError(error, DELETE_FAILED_MESSAGE));
  return serviceOk({ id: projectId });
}

/**
 * Public portfolio reads. These go through the two SECURITY DEFINER functions
 * from supabase/schema.sql, never through the base tables:
 *   public_project_list()        -> Public projects only
 *   public_project_by_slug(slug) -> Public + Unlisted by exact slug (share link)
 * Both return the curated public_project_card shape, so private columns such as
 * current_objective / next_action cannot leave the database at all.
 */
export async function listPublicProjects(): Promise<PublicProject[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("public_project_list");
  if (error) throw error;
  return ((data ?? []) as PublicProjectCardRow[]).map(mapPublicProjectRow);
}

export function toProjectViewFromPublicProject(project: PublicProject): Project {
  return {
    id: project.id,
    slug: project.slug,
    name: project.title,
    description: project.description,
    type: project.projectType,
    status: project.status as Project["status"],
    progress: project.progress,
    currentPhase: project.workflowStage as Project["currentPhase"],
    objective: project.publicSummary ?? project.description,
    role: project.role ?? "",
    teamSize: project.teamSize,
    startDate: project.startDate ?? "",
    targetDate: project.targetDate ?? "",
    nextAction: project.publicSummary ?? project.description,
    technologies: project.technologies,
    lastUpdated: project.updatedAt,
    githubConnected: Boolean(project.repositoryUrl || project.demoUrl || project.docsUrl),
    featured: project.isFeatured,
    visibility: project.visibility === "Unlisted" ? "Unlisted" : "Public",
    health: {
      documentation: project.health.documentation,
      screenshots: project.health.screenshots,
      github: Boolean(project.repositoryUrl),
      testing: project.health.testing,
      deployment: project.health.deployment,
    },
    links: {
      github: project.repositoryUrl,
      live: project.demoUrl,
      docs: project.docsUrl,
    },
    publicSummary: project.publicSummary,
    publicProblem: project.publicProblem,
    publicSolution: project.publicSolution,
    publicResult: project.publicResult,
  };
}

export async function getPublicProjectBySlug(slug: string): Promise<PublicProject | null> {
  const normalized = slug.trim().toLowerCase();
  if (!isValidSlug(normalized)) return null;

  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("public_project_by_slug", { p_slug: normalized });
  if (error) throw error;

  const rows = (data ?? []) as PublicProjectCardRow[];
  return rows.length > 0 ? mapPublicProjectRow(rows[0]) : null;
}

export async function getProjectSettings(projectId: string): Promise<ProjectSettings | null> {
  if (!isUuid(projectId)) return null;
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("project_settings")
    .select(PROJECT_SETTINGS_COLUMNS)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapProjectSettingsRow(data as ProjectSettingsRow) : null;
}

export interface ProjectSettingsPatch {
  customColor?: string | null;
  customIcon?: string | null;
  showGithubActivity?: boolean;
  showCommitCount?: boolean;
  showStreak?: boolean;
  showAccountability?: boolean;
  showPublicAccountability?: boolean;
  showPublicAccountabilityScore?: boolean;
  showLiveDemo?: boolean;
  showRepository?: boolean;
}

/** One-to-one settings row: created on first write, updated afterwards. */
export async function updateProjectSettings(projectId: string, patch: ProjectSettingsPatch): Promise<ServiceResult<ProjectSettings>> {
  if (!isUuid(projectId)) return serviceFail("That project is no longer available. Refresh and try again.");
  const context = await getWorkspaceContext();
  if (!context) return serviceFail(SAVE_FAILED_MESSAGE);

  const payload: Record<string, unknown> = { project_id: projectId };
  if (patch.customColor !== undefined) payload.custom_color = patch.customColor;
  if (patch.customIcon !== undefined) payload.custom_icon = patch.customIcon;
  if (patch.showGithubActivity !== undefined) payload.show_github_activity = patch.showGithubActivity;
  if (patch.showCommitCount !== undefined) payload.show_commit_count = patch.showCommitCount;
  if (patch.showStreak !== undefined) payload.show_streak = patch.showStreak;
  if (patch.showAccountability !== undefined) payload.show_accountability = patch.showAccountability;
  if (patch.showPublicAccountability !== undefined) payload.show_public_accountability = patch.showPublicAccountability;
  if (patch.showPublicAccountabilityScore !== undefined) payload.show_public_accountability_score = patch.showPublicAccountabilityScore;
  if (patch.showLiveDemo !== undefined) payload.show_live_demo = patch.showLiveDemo;
  if (patch.showRepository !== undefined) payload.show_repository = patch.showRepository;

  const { data, error } = await context.supabase
    .from("project_settings")
    .upsert(payload, { onConflict: "project_id" })
    .select(PROJECT_SETTINGS_COLUMNS)
    .single();

  if (error) return serviceFail(describeDatabaseError(error, SAVE_FAILED_MESSAGE));
  return serviceOk(mapProjectSettingsRow(data as ProjectSettingsRow));
}


