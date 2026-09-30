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

export type WorkflowPhase =
  | "IDEA"
  | "PLANNING"
  | "RESEARCH"
  | "DEVELOPMENT"
  | "TESTING"
  | "DEPLOYMENT"
  | "MAINTENANCE"
  | "COMPLETED";

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
  id: string;
  slug?: string;
  name: string;
  description: string;
  type: string;
  status: ProjectStatus;
  progress: number;
  currentPhase: WorkflowPhase;
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
  priority: Priority;
  dueDate?: string;
  tags: string[];
  createdAt: string;
  completedAt?: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  status: "completed" | "active" | "pending";
  targetDate?: string;
  order: number;
}

export interface Plan {
  id: string;
  title: string;
  goal: string;
  deadline: string;
  tasks: { label: string; done: boolean }[];
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
}

export interface TechnologyItem {
  id: string;
  name: string;
  category: string;
  summary: string;
  usedIn: string[];
  deployed: number;
  clientProjects: number;
}
