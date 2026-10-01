import { calculateProjectProgress, WORKFLOW_PIPELINE } from "@/lib/projectProgress";
import type { Milestone, NoteItem, Plan, PlanItem, Project, Task, TechnologyItem, WorkflowPhase } from "@/types";
import type { PublicProject } from "@/types";
import type {
  MilestoneRow,
  NoteRow,
  PlanItemRow,
  PlanRow,
  ProjectRow,
  ProjectSettingsRow,
  PublicProjectCardRow,
  TaskRow,
  TechnologyRow,
} from "@/data/database.types";
import { toWorkflowPhase } from "@/data/database.types";

const isEmptyText = (value: string | null | undefined) => value === null || value === undefined || value.trim() === "";

/**
 * ProjectRow -> Project (view model).
 * `tasks`, `milestones` and `technologies` come from the same workspace load, so
 * progress and the tech pills stay consistent without extra queries.
 */
export function mapProjectRow(
  row: ProjectRow,
  context: {
    tasks?: Array<Pick<Task, "status">>;
    milestones?: Array<Pick<Milestone, "status">>;
    technologies?: string[];
  } = {},
): Project {
  const tasks = context.tasks ?? [];
  const milestones = context.milestones ?? [];
  const currentPhase = toWorkflowPhase(row.workflow_stage);
  const { total } = calculateProjectProgress({ workflowStage: currentPhase, tasks, milestones });

  return {
    id: row.id,
    slug: row.slug,
    name: row.title,
    description: row.description,
    type: row.project_type,
    status: row.status,
    progress: total,
    currentPhase,
    objective: row.current_objective,
    role: row.role ?? "Developer",
    startDate: row.start_date ?? row.created_at,
    targetDate: row.target_date ?? row.created_at,
    nextAction: row.next_action,
    technologies: context.technologies ?? [],
    lastUpdated: row.updated_at,
    githubConnected: row.github_repository_id !== null || !isEmptyText(row.repository_url),
    repoName: row.github_repository_name ?? undefined,
    featured: row.is_featured,
    visibility: row.visibility,
    priority: row.priority,
    teamSize: row.team_size ?? undefined,
    publicSummary: row.public_summary ?? undefined,
    publicProblem: row.public_problem ?? undefined,
    publicSolution: row.public_solution ?? undefined,
    publicResult: row.public_result ?? undefined,
    health: {
      documentation: row.health_documentation,
      screenshots: row.health_screenshots,
      github: row.github_repository_id !== null,
      testing: row.health_testing,
      deployment: row.health_deployment,
    },
    links: {
      github: row.repository_url ?? undefined,
      live: row.demo_url ?? undefined,
      docs: row.docs_url ?? undefined,
    },
  };
}

export function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    projectId: row.project_id,
    milestoneId: row.milestone_id ?? undefined,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date ?? undefined,
    tags: [],
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function mapMilestoneRow(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    targetDate: row.target_date ?? undefined,
    order: row.sort_order,
    lastUpdated: row.updated_at,
  };
}

export function mapPlanItemRow(row: PlanItemRow): PlanItem {
  return {
    id: row.id,
    planId: row.plan_id,
    projectId: row.project_id ?? undefined,
    taskId: row.task_id ?? undefined,
    label: row.label,
    done: row.done,
    order: row.sort_order,
  };
}

export function mapPlanRow(row: PlanRow, items: PlanItemRow[]): Plan {
  const planItems = items.filter((item) => item.plan_id === row.id).map(mapPlanItemRow);
  return {
    id: row.id,
    title: row.title,
    goal: row.description,
    deadline: row.target_date ?? row.created_at,
    status: row.status,
    timeframe: row.timeframe ?? undefined,
    items: planItems,
    tasks: planItems.map((item) => ({ id: item.id, label: item.label, done: item.done })),
  };
}

export function mapNoteRow(row: NoteRow): NoteItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    projectId: row.project_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * TechnologyRow -> TechnologyItem. The database stores only the name; `category`,
 * `usedIn`, `deployed` and `clientProjects` are derived from the project links so
 * the existing tech page keeps working with real data.
 */
export function mapTechnologyRow(
  row: TechnologyRow,
  links: Array<{ projectId: string; projectType: string; projectName: string }>,
): TechnologyItem {
  const usedIn = links.map((link) => link.projectName);
  return {
    id: row.id,
    name: row.name,
    category: "Technology",
    summary: usedIn.length > 0 ? `Used in ${usedIn.length} project${usedIn.length === 1 ? "" : "s"}.` : "Not linked to a project yet.",
    usedIn,
    deployed: usedIn.length,
    clientProjects: links.filter((link) => link.projectType.toLowerCase().includes("client")).length,
  };
}

export function mapProjectSettingsRow(row: ProjectSettingsRow) {
  return {
    projectId: row.project_id,
    customColor: row.custom_color ?? undefined,
    customIcon: row.custom_icon ?? undefined,
    showGithubActivity: row.show_github_activity,
    showCommitCount: row.show_commit_count,
    showStreak: row.show_streak,
    showAccountability: row.show_accountability,
    showLiveDemo: row.show_live_demo,
    showRepository: row.show_repository,
  };
}

/** PublicProjectCardRow -> PublicProject, the shape the /view pages render. */
export function mapPublicProjectRow(row: PublicProjectCardRow): PublicProject {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    projectType: row.project_type,
    status: row.status,
    workflowStage: toWorkflowPhase(row.workflow_stage),
    role: row.role ?? undefined,
    teamSize: row.team_size ?? undefined,
    startDate: row.start_date ?? undefined,
    targetDate: row.target_date ?? undefined,
    isFeatured: row.is_featured,
    visibility: row.visibility === "Unlisted" ? "Unlisted" : "Public",
    publicSummary: row.public_summary ?? undefined,
    publicProblem: row.public_problem ?? undefined,
    publicSolution: row.public_solution ?? undefined,
    publicResult: row.public_result ?? undefined,
    repositoryUrl: row.repository_url ?? undefined,
    demoUrl: row.demo_url ?? undefined,
    docsUrl: row.docs_url ?? undefined,
    health: {
      documentation: row.health_documentation,
      screenshots: row.health_screenshots,
      testing: row.health_testing,
      deployment: row.health_deployment,
    },
    showGithubActivity: row.show_github_activity,
    showCommitCount: row.show_commit_count,
    showStreak: row.show_streak,
    showAccountability: row.show_accountability,
    showLiveDemo: row.show_live_demo,
    showRepository: row.show_repository,
    technologies: row.technologies ?? [],
    totalTasks: row.total_tasks,
    completedTasks: row.completed_tasks,
    totalMilestones: row.total_milestones,
    completedMilestones: row.completed_milestones,
    progress: row.progress,
    updatedAt: row.updated_at,
  };
}

export const isPipelineStage = (stage: WorkflowPhase) => WORKFLOW_PIPELINE.includes(stage);

