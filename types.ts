export type ProjectStatus =
  | "Planning"
  | "In Development"
  | "Research"
  | "Testing"
  | "Deployment"
  | "Completed"
  | "Blocked"
  | "On Hold"
  | "Cancelled";

/**
 * Workflow stage vocabulary. The database stores these lowercase
 * (see projects_workflow_stage_check in supabase/schema.sql); the UI uses the
 * uppercase form and the extra paused states are excluded from progress.
 */
export type WorkflowPhase =
  | "IDEA"
  | "PLANNING"
  | "RESEARCH"
  | "DEVELOPMENT"
  | "TESTING"
  | "DEPLOYMENT"
  | "MAINTENANCE"
  | "COMPLETED"
  | "BLOCKED"
  | "ON_HOLD"
  | "CANCELLED";

export type TaskStatus =
  | "Backlog"
  | "Planned"
  | "In Progress"
  | "Review"
  | "Testing"
  | "Blocked"
  | "Completed";

export type Priority = "Low" | "Medium" | "High" | "Critical";

export interface Project {
  /** Internal database uuid. Never used in a public URL. */
  id: string;
  /** Public, globally unique identifier: /view/project/<slug>. */
  slug: string;
  name: string;
  description: string;
  type: string;
  status: ProjectStatus;
  /** Derived from tasks, milestones and the workflow stage (lib/projectProgress.ts). */
  progress: number;
  currentPhase: WorkflowPhase;
  /** Persisted order within the owner's current workflow stage. */
  sortOrder?: number;
  objective: string;
  role: string;
  startDate: string;
  targetDate: string;
  nextAction: string;
  technologies: string[];
  lastUpdated: string;
  githubConnected: boolean;
  repoName?: string;
  featured?: boolean;
  visibility?: "Private" | "Public" | "Unlisted";
  priority?: Priority;
  teamSize?: number;
  publicSummary?: string;
  publicProblem?: string;
  publicSolution?: string;
  publicResult?: string;
  health: {
    documentation: boolean;
    screenshots: boolean;
    github: boolean;
    testing: boolean;
    deployment: boolean;
  };
  links: {
    github?: string;
    live?: string;
    docs?: string;
  };
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string;
  milestoneId?: string;
  status: TaskStatus;
  sortOrder?: number;
  priority: Priority;
  dueDate?: string;
  tags: string[];
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: "completed" | "active" | "pending";
  targetDate?: string;
  order: number;
  lastUpdated?: string;
}

export interface PlanItem {
  id: string;
  planId: string;
  projectId?: string;
  taskId?: string;
  label: string;
  done: boolean;
  order: number;
  updatedAt?: string;
}

export type PlanStatus = "Planning" | "Active" | "Paused" | "Completed" | "Cancelled";

export interface Plan {
  id: string;
  title: string;
  goal: string;
  deadline: string;
  /** Persisted checklist rows; `tasks` below is the derived read model. */
  items?: PlanItem[];
  tasks: Array<{ id?: string; label: string; done: boolean }>;
  status?: PlanStatus;
  timeframe?: string;
}

export interface Profile {
  id: string;
  displayName: string;
  username?: string;
  githubUsername?: string;
  avatarUrl?: string;
  bio?: string;
  headline?: string;
  publicContactEmail?: string;
  showPublicContactEmail: boolean;
  publicGithubUrl?: string;
  publicLinkedinUrl?: string;
  publicWebsiteUrl?: string;
  publicProfileEnabled: boolean;
  publicAiAssistantEnabled: boolean;
  timeZone?: string;
}

export interface PublicProfile {
  displayName: string;
  headline?: string;
  bio?: string;
  avatarUrl?: string;
  contactEmail?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
}

export interface ProjectSettings {
  projectId: string;
  customColor?: string;
  customIcon?: string;
  showGithubActivity: boolean;
  showCommitCount: boolean;
  showStreak: boolean;
  showAccountability: boolean;
  showPublicAccountability: boolean;
  showPublicAccountabilityScore: boolean;
  showLiveDemo: boolean;
  showRepository: boolean;
}

export type PublicAccountabilityHealth =
  | "Active"
  | "Steady"
  | "Needs Attention"
  | "Stalled"
  | "Blocked"
  | "Completed"
  | "On Hold"
  | "Cancelled"
  | "Building Baseline";

/**
 * Row returned by the public projection functions
 * (public.public_project_list / public.public_project_by_slug). This is the only
 * shape a public visitor can read - it never carries internal columns.
 * `progress` is calculated in SQL with the same formula as lib/projectProgress.ts.
 */
export interface PublicProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  projectType: string;
  status: string;
  workflowStage: string;
  role?: string;
  teamSize?: number;
  startDate?: string;
  targetDate?: string;
  isFeatured: boolean;
  visibility: "Public" | "Unlisted";
  publicSummary?: string;
  publicProblem?: string;
  publicSolution?: string;
  publicResult?: string;
  repositoryUrl?: string;
  demoUrl?: string;
  docsUrl?: string;
  health: {
    documentation: boolean;
    screenshots: boolean;
    testing: boolean;
    deployment: boolean;
  };
  showGithubActivity: boolean;
  showCommitCount: boolean;
  showStreak: boolean;
  showAccountability: boolean;
  accountabilityHealth: PublicAccountabilityHealth | null;
  accountabilityScore: number | null;
  showLiveDemo: boolean;
  showRepository: boolean;
  technologies: string[];
  totalTasks: number;
  completedTasks: number;
  totalMilestones: number;
  completedMilestones: number;
  progress: number;
  updatedAt: string;
}

export interface ActivityItem {
  id: string;
  kind: string;
  message: string;
  when: string;
  projectId?: string;
}

export interface GithubRepo {
  id: string;
  name: string;
  description: string;
  language: string;
  technologies: string[];
  stars: number;
  forks: number;
  latestCommit: string;
  branch: string;
  visibility: string;
  connected?: boolean;
}

export type GithubActivityType = "commit" | "pull_request" | "issue" | "release" | "documentation" | "repository";
export type GithubProjectHealth = "Healthy" | "Needs Attention" | "Dormant" | "Exempt";

export interface GithubActivityEvent {
  id: string;
  type: GithubActivityType;
  projectId?: string;
  repository: string;
  summary: string;
  occurredAt: string;
  meaningful: boolean;
  public: boolean;
}

export interface GithubProjectHealthItem {
  projectId: string;
  lastActivityAt?: string;
  health: GithubProjectHealth;
  score: number;
}

export interface AccountabilityScore {
  total: number;
  state: "Inactive" | "Getting Started" | "Steady" | "Active" | "Locked In";
  consistency: number;
  maintenance: number;
  newProjects: number;
  documentation: number;
  momentum: number;
  activeDaysThisWeek: number;
  currentStreak: number;
  longestStreak: number;
  projectHealth: GithubProjectHealthItem[];
  updatedProjects: number;
  newProjectsThisMonth: number;
  documentationUpdates: number;
  commits: number;
  recentEvents: GithubActivityEvent[];
}

export interface JobApplication {
  id: string;
  company: string;
  role: string;
  status: string;
  date: string;
  interviewDate?: string;
  followUpDate?: string;
  resumeVersion: string;
  notes: string;
  projectIds: string[];
}

export interface FreelanceLead {
  id: string;
  company: string;
  contact: string;
  website: string;
  projectIdea: string;
  notes: string;
  budget: string;
  status: string;
  followUpDate: string;
  projectId?: string;
}

export interface LearningItem {
  id: string;
  topic: string;
  status: "Not Started" | "Learning" | "Practicing" | "Applied" | "Mastered";
  why: string;
  resources: string[];
  relatedProject: string;
  priority: "Low" | "Medium" | "High";
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TechnologyItem {
  id: string;
  name: string;
  /** Presentational grouping. The database only stores the name, so this is
   *  derived from the projects the technology is attached to. */
  category: string;
  summary?: string;
  usedIn: string[];
  deployed: number;
  clientProjects: number;
}
