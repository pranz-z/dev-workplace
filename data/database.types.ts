/**
 * Row shapes as they exist in Postgres (supabase/schema.sql).
 *
 * These types are intentionally separate from the view models in types.ts:
 * the database is the source of truth for names and nullability, while the view
 * models keep the field names the existing UI already renders. Every conversion
 * happens in data/mappers.ts, so there is exactly one mapping layer to audit.
 */
import type { PlanStatus, Priority, ProjectStatus, TaskStatus, WorkflowPhase } from "@/types";

export type Visibility = "Private" | "Public" | "Unlisted";

export interface ProfileRow {
  id: string;
  display_name: string | null;
  username: string | null;
  github_username: string | null;
  avatar_url: string | null;
  bio: string | null;
  public_profile_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  description: string;
  project_type: string;
  status: ProjectStatus;
  workflow_stage: string;
  priority: Priority;
  is_featured: boolean;
  visibility: Visibility;
  role: string | null;
  team_size: number | null;
  start_date: string | null;
  target_date: string | null;
  current_objective: string;
  next_action: string;
  public_summary: string | null;
  public_problem: string | null;
  public_solution: string | null;
  public_result: string | null;
  repository_url: string | null;
  demo_url: string | null;
  docs_url: string | null;
  health_documentation: boolean;
  health_screenshots: boolean;
  health_testing: boolean;
  health_deployment: boolean;
  github_repository_id: number | null;
  github_repository_owner: string | null;
  github_repository_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSettingsRow {
  id: string;
  project_id: string;
  custom_color: string | null;
  custom_icon: string | null;
  show_github_activity: boolean;
  show_commit_count: boolean;
  show_streak: boolean;
  show_accountability: boolean;
  show_live_demo: boolean;
  show_repository: boolean;
  created_at: string;
  updated_at: string;
}

export interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: "completed" | "active" | "pending";
  target_date: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  user_id: string;
  project_id: string;
  milestone_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface PlanRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  timeframe: string | null;
  status: PlanStatus;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanItemRow {
  id: string;
  plan_id: string;
  project_id: string | null;
  task_id: string | null;
  label: string;
  done: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectScreenshotRow {
  id: string;
  user_id: string;
  project_id: string;
  storage_path: string;
  caption: string;
  created_at: string;
}

export interface TechnologyRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectTechnologyRow {
  project_id: string;
  technology_id: string;
  created_at: string;
}

export interface GithubInstallationRow {
  id: string;
  user_id: string;
  installation_id: number;
  account_login: string;
  account_type: string;
  created_at: string;
  updated_at: string;
}

export interface GithubRepositoryLinkRow {
  project_id: string;
  user_id: string;
  installation_record_id: string;
  repository_id: number;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string;
  is_private: boolean;
  primary_language: string | null;
  updated_at_github: string | null;
  connected_at: string;
  last_synced_at: string | null;
}

/** Row returned by public.public_project_list() / public.public_project_by_slug(). */
export interface PublicProjectCardRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  project_type: string;
  status: string;
  workflow_stage: string;
  role: string | null;
  team_size: number | null;
  start_date: string | null;
  target_date: string | null;
  is_featured: boolean;
  visibility: Visibility;
  public_summary: string | null;
  public_problem: string | null;
  public_solution: string | null;
  public_result: string | null;
  repository_url: string | null;
  demo_url: string | null;
  docs_url: string | null;
  health_documentation: boolean;
  health_screenshots: boolean;
  health_testing: boolean;
  health_deployment: boolean;
  show_github_activity: boolean;
  show_commit_count: boolean;
  show_streak: boolean;
  show_accountability: boolean;
  show_live_demo: boolean;
  show_repository: boolean;
  technologies: string[];
  total_tasks: number;
  completed_tasks: number;
  total_milestones: number;
  completed_milestones: number;
  progress: number;
  updated_at: string;
}

/** Columns selected for workspace reads (explicit, never `*`). */
export const PROJECT_COLUMNS =
  "id, user_id, slug, title, description, project_type, status, workflow_stage, priority, is_featured, visibility, role, team_size, start_date, target_date, current_objective, next_action, public_summary, public_problem, public_solution, public_result, repository_url, demo_url, docs_url, health_documentation, health_screenshots, health_testing, health_deployment, github_repository_id, github_repository_owner, github_repository_name, created_at, updated_at";

/**
 * Public projection columns. Kept in sync with the composite type
 * public.public_project_card in supabase/schema.sql; tests/rls.sql asserts the
 * type still has exactly these 37 attributes.
 */
export const PUBLIC_PROJECT_COLUMNS =
  "id, slug, title, description, project_type, status, workflow_stage, role, team_size, start_date, target_date, is_featured, visibility, public_summary, public_problem, public_solution, public_result, repository_url, demo_url, docs_url, health_documentation, health_screenshots, health_testing, health_deployment, show_github_activity, show_commit_count, show_streak, show_accountability, show_live_demo, show_repository, technologies, total_tasks, completed_tasks, total_milestones, completed_milestones, progress, updated_at";

/** Maps the lowercase database vocabulary to the UI's uppercase workflow stage. */
export function toWorkflowPhase(stage: string): WorkflowPhase {
  return stage.toUpperCase().replace(/\s+/g, "_") as WorkflowPhase;
}
