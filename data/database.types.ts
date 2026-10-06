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
  headline: string | null;
  public_contact_email: string | null;
  show_public_contact_email: boolean;
  public_github_url: string | null;
  public_linkedin_url: string | null;
  public_website_url: string | null;
  public_profile_enabled: boolean;
  public_ai_assistant_enabled: boolean;
  time_zone: string | null;
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
  sort_order: number;
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
  show_public_accountability: boolean;
  show_public_accountability_score: boolean;
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
  sort_order: number;
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
  is_public: boolean;
  sort_order: number;
  created_at: string;
}

/** Private external-file metadata; provider content remains in the provider. */
export interface ExternalFileRow {
  id: string;
  user_id: string;
  provider: "google_drive";
  provider_file_id: string;
  name: string;
  mime_type: string;
  size_bytes: number | null;
  modified_at: string | null;
  status: "active" | "trashed" | "unavailable";
  project_id: string | null;
  task_id: string | null;
  parent_id: string | null;
  is_project_folder: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Server-only result shape for the service-role credential RPC. The field is
 * application-encrypted ciphertext, never a plaintext refresh/access token.
 */
export interface GoogleDriveConnectionCiphertextRow {
  user_id: string;
  refresh_token_ciphertext: string;
  encryption_key_version: number;
  created_at: string;
  updated_at: string;
}

/** Server-only resumable upload state returned by a service-role RPC. */
export interface GoogleDriveUploadSessionRow {
  id: string;
  user_id: string;
  project_id: string | null;
  task_id: string | null;
  expected_name: string;
  expected_mime_type: string;
  expected_size_bytes: number | string;
  google_account_sub: string;
  google_account_email: string;
  app_folder_id: string;
  /** Secret Google upload capability. Never include in an API response. */
  session_uri: string;
  expires_at: string;
  next_offset: number | string;
  status: "uploading" | "completed" | "expired";
  drive_file_id: string | null;
  external_file_id: string | null;
}

export interface PublicProfileRow {
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  avatar_url: string | null;
  public_contact_email: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  website_url: string | null;
}

export interface PublicAiProfileRow {
  portfolio?: import("@/lib/portfolio/content").PortfolioContent | null;
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  public_contact_email: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  website_url: string | null;
}

export interface PublicProjectScreenshotRow {
  id: string;
  project_slug: string;
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

export interface AccountabilitySnapshotRow {
  id: string; user_id: string; project_id: string; snapshot_date: string; captured_at: string;
  score: number | null; health: string; factors: Array<{ key: string; score: number; available: boolean }>;
  github_status: "not-connected" | "unavailable" | "available" | "not-relevant"; model_version: number;
  created_at: string; updated_at: string;
}

export interface AccountabilityGoalRow {
  id: string; user_id: string; project_id: string | null; title: string; description: string | null;
  metric: "tasks_completed" | "milestones_completed" | "plan_items_completed" | "manual";
  target: number; period_start: string; period_end: string; status: "active" | "completed" | "closed";
  manual_progress: number; created_at: string; updated_at: string;
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
  public_accountability_health: string | null;
  public_accountability_score: number | null;
}

/** Columns selected for workspace reads (explicit, never `*`). */
export const PROJECT_COLUMNS =
  "id, user_id, slug, title, description, project_type, status, workflow_stage, sort_order, priority, is_featured, visibility, role, team_size, start_date, target_date, current_objective, next_action, public_summary, public_problem, public_solution, public_result, repository_url, demo_url, docs_url, health_documentation, health_screenshots, health_testing, health_deployment, github_repository_id, github_repository_owner, github_repository_name, created_at, updated_at";

/**
 * Public projection columns. Kept in sync with the composite type
 * public.public_project_card in supabase/schema.sql; tests/rls.sql asserts the
 * type still has exactly these 39 attributes.
 */
export const PUBLIC_PROJECT_COLUMNS =
  "id, slug, title, description, project_type, status, workflow_stage, role, team_size, start_date, target_date, is_featured, visibility, public_summary, public_problem, public_solution, public_result, repository_url, demo_url, docs_url, health_documentation, health_screenshots, health_testing, health_deployment, show_github_activity, show_commit_count, show_streak, show_accountability, show_live_demo, show_repository, technologies, total_tasks, completed_tasks, total_milestones, completed_milestones, progress, updated_at, public_accountability_health, public_accountability_score";

/** Maps the lowercase database vocabulary to the UI's uppercase workflow stage. */
export function toWorkflowPhase(stage: string): WorkflowPhase {
  return stage.toUpperCase().replace(/\s+/g, "_") as WorkflowPhase;
}
