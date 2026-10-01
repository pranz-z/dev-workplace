"use client";

import {
  Activity,
  Bell,
  Briefcase,
  CalendarDays,
  Check,
  Clock3,
  Code2,
  FolderGit2,
  FolderKanban,
  GitBranch,
  Globe,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquareText,
  Moon,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Star,
  Sun,
  Target,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { UserMenu } from "@/components/auth/user-menu";
import { GithubRepositoryBrowser } from "@/components/github/repository-browser";
import { ProjectScreenshots } from "@/components/projects/project-screenshots";
import { hasLinkedGithubRepository } from "@/data/githubRepositoryLinkService";
import { buildSeedState } from "@/data/mockData";
import { calculateProjectAccountability } from "@/data/accountabilityService";
import { calculateProjectProgress } from "@/lib/projectProgress";
import { loadWorkspaceData } from "@/data/workspaceService";
import { completeTask, createTask, deleteTask, reopenTask, setTaskStatus, updateTask } from "@/data/taskService";
import { createPlan, deletePlan, setPlanStatus, updatePlan } from "@/data/planService";
import { createPlanItem, deletePlanItem, setPlanItemDone } from "@/data/planItemService";
import { createMilestone, deleteMilestone, setMilestoneStatus, updateMilestone } from "@/data/milestoneService";
import { createNote, deleteNote, updateNote } from "@/data/noteService";
import { attachTechnology, createTechnology, detachTechnology, listProjectTechnologyNames, listTechnologies } from "@/data/technologyService";
import { createProject, deleteProject, setProjectVisibility, updateProject } from "@/data/projectService";
import { listProjectScreenshots, type ProjectScreenshot } from "@/data/projectScreenshotService";
import type {
  ActivityItem,
  GithubActivityEvent,
  FreelanceLead,
  GithubRepo,
  JobApplication,
  LearningItem,
  Milestone,
  NoteItem,
  Plan,
  Project,
  Task,
  TechnologyItem,
} from "@/types";

type ViewName =
  | "dashboard"
  | "today"
  | "projects"
  | "tasks"
  | "plans"
  | "calendar"
  | "notes"
  | "learning"
  | "tech"
  | "applications"
  | "resume"
  | "freelance"
  | "portfolio"
  | "github"
  | "settings";

type ThemeMode = "light" | "dark" | "system";

type ProjectEditorState = {
  id?: string;
  name: string;
  description: string;
  type: string;
  status: Project["status"];
  currentPhase: Project["currentPhase"];
  priority: NonNullable<Project["priority"]>;
  role: string;
  teamSize: string;
  startDate: string;
  targetDate: string;
  objective: string;
  nextAction: string;
  visibility: NonNullable<Project["visibility"]>;
};

type TaskEditorState = {
  id?: string;
  title: string;
  description: string;
  projectId: string;
  status: Task["status"];
  priority: Task["priority"];
  dueDate: string;
};

type PlanEditorState = { id?: string; title: string; goal: string; status: NonNullable<Plan["status"]>; deadline: string; items: string };
type MilestoneEditorState = { id?: string; projectId: string; title: string; description: string; targetDate: string };
type NoteEditorState = { id?: string; title: string; content: string; projectId: string };

const THEME_STORAGE_KEY = "developer-workspace-theme";

const navGroups = [
  {
    label: "DEV WORKPLACE",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { key: "today", label: "Today", icon: Clock3 },
    ],
  },
  {
    label: "WORK",
    items: [
      { key: "projects", label: "Projects", icon: FolderKanban },
      { key: "tasks", label: "Tasks", icon: ListTodo },
      { key: "plans", label: "Plans", icon: Target },
      { key: "calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    label: "KNOWLEDGE",
    items: [
      { key: "notes", label: "Notes", icon: NotebookPen },
      { key: "learning", label: "Learning", icon: Sparkles },
      { key: "tech", label: "Tech Stack", icon: Code2 },
    ],
  },
  {
    label: "CAREER",
    items: [
      { key: "applications", label: "Applications", icon: Briefcase },
      { key: "resume", label: "Resume", icon: UserRound },
      { key: "freelance", label: "Freelance", icon: MessageSquareText },
    ],
  },
  {
    label: "SHOWCASE",
    items: [{ key: "portfolio", label: "Portfolio", icon: Globe }],
  },
  {
    label: "INTEGRATIONS",
    items: [{ key: "github", label: "GitHub", icon: FolderGit2 }],
  },
  {
    label: "SYSTEM",
    items: [{ key: "settings", label: "Settings", icon: Star }],
  },
] as const;

const workflowStages = [
  "Planning",
  "Research",
  "Development",
  "Testing",
  "Deployment",
  "Maintenance",
  "Completed",
];

const unavailableViews = new Set<ViewName>(["calendar", "resume", "portfolio"]);

/* Status + priority pills are token-driven (.badge / .prio) so they keep the
 * same pastel identity and dark-ink-on-pastel contrast in light AND dark. */
const statusColors: Record<string, string> = {
  Planning: "badge badge-planning",
  Research: "badge badge-research",
  "In Development": "badge badge-development",
  "In Progress": "badge badge-development",
  Testing: "badge badge-testing",
  Review: "badge badge-research",
  Deployment: "badge badge-completed",
  Maintenance: "badge badge-planning",
  Completed: "badge badge-completed",
  Blocked: "badge badge-blocked",
  "On Hold": "badge",
  Cancelled: "badge badge-blocked",
  Backlog: "badge",
  Planned: "badge badge-planning",
};

const priorityColors: Record<string, string> = {
  Low: "prio prio-low",
  Medium: "prio prio-medium",
  High: "prio prio-high",
  Critical: "prio prio-high",
};

/* Per-project muted accent, expressed as a mood token instead of a raw tint */
const projectMood = (projectId: string) =>
  projectId.includes("autocare")
    ? "mood-peach"
    : projectId.includes("ai-agent")
      ? "mood-lavender"
      : projectId.includes("mobile-llm")
        ? "mood-blue"
        : projectId.includes("autosimar")
          ? "mood-green"
          : projectId.includes("portfolio")
            ? "mood-pink"
            : "mood-lavender";

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

const getFutureDate = (days: number, hours = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
};

const getWorkspaceSnapshot = () => {
  const seed = buildSeedState();

  if (typeof window === "undefined") {
    return { ...seed, selectedProjectId: seed.projects[0]?.id ?? "autocare" };
  }

  const saved = window.localStorage.getItem("developer-workspace-v1");
  if (!saved) {
    return { ...seed, selectedProjectId: seed.projects[0]?.id ?? "autocare" };
  }

  try {
    const parsed = JSON.parse(saved) as Partial<ReturnType<typeof buildSeedState>> & { selectedProjectId?: string };
    return {
      projects: parsed.projects ?? seed.projects,
      tasks: parsed.tasks ?? seed.tasks,
      plans: parsed.plans ?? seed.plans,
      milestones: parsed.milestones ?? seed.milestones,
      activities: parsed.activities ?? seed.activities,
      githubRepos: parsed.githubRepos ?? seed.githubRepos,
      githubActivity: parsed.githubActivity ?? seed.githubActivity,
      jobApplications: parsed.jobApplications ?? seed.jobApplications,
      freelanceLeads: parsed.freelanceLeads ?? seed.freelanceLeads,
      learningItems: parsed.learningItems ?? seed.learningItems,
      notes: parsed.notes ?? seed.notes,
      technologies: parsed.technologies ?? seed.technologies,
      selectedProjectId: parsed.selectedProjectId ?? seed.projects[0]?.id ?? "autocare",
    };
  } catch {
    return { ...seed, selectedProjectId: seed.projects[0]?.id ?? "autocare" };
  }
};

const formatDisplayDate = (value?: string) => {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
};

const formatLongDate = (value?: string) => {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
};

const isHttpUrl = (value?: string) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

export default function Home() {
  const router = useRouter();
  const { status: authStatus, user, signOut: signOutOfSession } = useAuth();

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    return savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : "system";
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [githubActivity, setGithubActivity] = useState<GithubActivityEvent[]>([]);
  const [jobApplications, setJobApplications] = useState<JobApplication[]>([]);
  const [freelanceLeads, setFreelanceLeads] = useState<FreelanceLead[]>([]);
  const [learningItems, setLearningItems] = useState<LearningItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [technologies, setTechnologies] = useState<TechnologyItem[]>([]);
  const [activeView, setActiveView] = useState<ViewName>("dashboard");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectTab, setProjectTab] = useState("Overview");
  const [projectTaskFilter, setProjectTaskFilter] = useState<"all" | "testing">("all");
  const [noteProjectFilter, setNoteProjectFilter] = useState("");
  const [projectScreenshotsState, setProjectScreenshotsState] = useState<{ projectId: string; screenshots: ProjectScreenshot[]; error: string } | null>(null);
  const [projectGithubLinkState, setProjectGithubLinkState] = useState<{ projectId: string; connected: boolean; error: string } | null>(null);
  const [projectView, setProjectView] = useState<"grid" | "list" | "kanban">("grid");
  const [taskView, setTaskView] = useState<"list" | "kanban" | "today" | "upcoming">("kanban");
  const [searchOpen, setSearchOpen] = useState(false);
  const [githubImportOpen, setGithubImportOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showcaseMode, setShowcaseMode] = useState<"workspace" | "showcase">("workspace");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [focusRunning, setFocusRunning] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState<"checking" | "mock" | "ready" | "error">("checking");
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [shareNotice, setShareNotice] = useState<{ projectId: string; message: string } | null>(null);
  const [privateProjectConfirmation, setPrivateProjectConfirmation] = useState<Project | null>(null);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const visibilitySaveLock = useRef(false);
  const [signOutError, setSignOutError] = useState("");
  const [projectEditor, setProjectEditor] = useState<ProjectEditorState | null>(null);
  const [taskEditor, setTaskEditor] = useState<TaskEditorState | null>(null);
  const [planEditor, setPlanEditor] = useState<PlanEditorState | null>(null);
  const [milestoneEditor, setMilestoneEditor] = useState<MilestoneEditorState | null>(null);
  const [noteEditor, setNoteEditor] = useState<NoteEditorState | null>(null);
  const [isSavingEditor, setIsSavingEditor] = useState(false);
  const editorSaveLock = useRef(false);
  const [technologyName, setTechnologyName] = useState("");
  const [technologyProjectId, setTechnologyProjectId] = useState("");

  const closeWorkspaceEditor = () => {
    if (editorSaveLock.current) return;
    setProjectEditor(null);
    setTaskEditor(null);
    setPlanEditor(null);
    setMilestoneEditor(null);
    setNoteEditor(null);
  };

  const withEditorSaveProtection = async (save: () => Promise<void>) => {
    if (editorSaveLock.current) return;
    editorSaveLock.current = true;
    setIsSavingEditor(true);
    try {
      await save();
    } catch (error) {
      console.error("[workspace] editor save failed", error);
      setWorkspaceError("Couldn't save changes. Check your connection and try again.");
    } finally {
      editorSaveLock.current = false;
      setIsSavingEditor(false);
    }
  };

  const firstName = useMemo(() => {
    const metadata = user?.user_metadata ?? {};
    const explicitName = [metadata.full_name, metadata.name, metadata.user_name].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    const candidate = explicitName ?? user?.email ?? "";
    return candidate.split(/[\s@._-]+/).filter(Boolean)[0] ?? "there";
  }, [user]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const resolveTheme = () => {
      const nextTheme = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.setAttribute("data-theme", nextTheme);
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    };

    resolveTheme();

    const handleChange = () => {
      if (themeMode === "system") {
        resolveTheme();
      }
    };

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [themeMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubError = params.get("github_error");
    if (githubError) {
      void Promise.resolve().then(() => {
        setWorkspaceError(githubError);
        setActiveView("github");
      });
    } else if (params.get("github_connected") === "1") {
      void Promise.resolve().then(() => setActiveView("github"));
    }
  }, []);

  useEffect(() => {
    if (authStatus === "loading") return;
    let active = true;
    const hydrateWorkspace = async () => {
      if (authStatus !== "authenticated") {
        setWorkspaceUserId(null);
        const demo = getWorkspaceSnapshot();
        setProjects(demo.projects);
        setTasks(demo.tasks);
        setPlans(demo.plans);
        setMilestones(demo.milestones);
        setActivities(demo.activities);
        setGithubRepos(demo.githubRepos);
        setGithubActivity(demo.githubActivity);
        setJobApplications(demo.jobApplications);
        setFreelanceLeads(demo.freelanceLeads);
        setLearningItems(demo.learningItems);
        setNotes(demo.notes);
        setTechnologies(demo.technologies);
        setSelectedProjectId(demo.selectedProjectId);
        setWorkspaceStatus("mock");
        return;
      }
      setWorkspaceStatus("checking");
      setWorkspaceUserId(null);
      setActivities([]);
      setGithubRepos([]);
      setGithubActivity([]);
      setJobApplications([]);
      setFreelanceLeads([]);
      setLearningItems([]);
      try {
        const remote = await loadWorkspaceData();
        if (!active) return;
        if (!remote) throw new Error("Supabase is not configured.");
        setProjects(remote.projects);
        setTasks(remote.tasks);
        setMilestones(remote.milestones);
        setPlans(remote.plans);
        setNotes(remote.notes);
        setTechnologies(remote.technologies);
        setActivities([]);
        setGithubRepos([]);
        setGithubActivity([]);
        setJobApplications([]);
        setFreelanceLeads([]);
        setLearningItems([]);
        setSelectedProjectId(remote.projects[0]?.id ?? "");
        setWorkspaceUserId(user?.id ?? null);
        setWorkspaceError("");
        setWorkspaceStatus("ready");
      } catch {
        if (!active) return;
        setProjects([]);
        setTasks([]);
        setMilestones([]);
        setPlans([]);
        setNotes([]);
        setTechnologies([]);
        setSelectedProjectId("");
        setWorkspaceUserId(null);
        setWorkspaceError("Couldn't load your synced workspace. Refresh to try again.");
        setWorkspaceStatus("error");
      }
    };
    void hydrateWorkspace();
    return () => { active = false; };
  }, [authStatus, user?.id]);

  const handleSignOut = async () => {
    const result = await signOutOfSession();
    if (!result.ok) {
      setSignOutError(result.message);
      return;
    }
    setSignOutError("");
    router.replace("/login");
    router.refresh();
  };

  useEffect(() => {
    if (authStatus !== "unauthenticated" || workspaceStatus !== "mock") return;
    window.localStorage.setItem(
      "developer-workspace-v1",
      JSON.stringify({
        projects,
        tasks,
        plans,
        milestones,
        activities,
        githubRepos,
        githubActivity,
        jobApplications,
        freelanceLeads,
        learningItems,
        notes,
        technologies,
        selectedProjectId,
      }),
    );
  }, [authStatus, workspaceStatus, projects, tasks, plans, milestones, activities, githubRepos, githubActivity, jobApplications, freelanceLeads, learningItems, notes, technologies, selectedProjectId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!focusRunning) return;
    const timer = window.setInterval(() => {
      setFocusMinutes((current) => {
        if (current <= 0) {
          setFocusRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 60000);

    return () => window.clearInterval(timer);
  }, [focusRunning]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );

  const currentProjectScreenshots = projectScreenshotsState?.projectId === selectedProject?.id ? projectScreenshotsState : null;
  const projectScreenshots = currentProjectScreenshots?.screenshots ?? [];
  const projectScreenshotsError = currentProjectScreenshots?.error ?? "";
  const projectScreenshotsLoading = Boolean(selectedProject?.id && authStatus === "authenticated" && workspaceStatus === "ready" && !currentProjectScreenshots);
  const currentProjectGithubLink = projectGithubLinkState?.projectId === selectedProject?.id ? projectGithubLinkState : null;
  const projectGithubLinked = currentProjectGithubLink?.connected ?? false;
  const projectGithubLoading = Boolean(selectedProject?.id && authStatus === "authenticated" && workspaceStatus === "ready" && !currentProjectGithubLink);

  const refreshProjectScreenshots = useCallback(async (projectId: string) => {
    if (authStatus !== "authenticated" || workspaceStatus !== "ready") return;
    try {
      const data = await listProjectScreenshots(projectId);
      if (selectedProjectId !== projectId) return;
      setProjectScreenshotsState({ projectId, screenshots: data, error: "" });
    } catch (error) {
      if (selectedProjectId !== projectId) return;
      setProjectScreenshotsState({ projectId, screenshots: [], error: error instanceof Error ? error.message : "Couldn't load project screenshots." });
    }
  }, [authStatus, workspaceStatus, selectedProjectId]);

  useEffect(() => {
    if (!selectedProject?.id || authStatus !== "authenticated" || workspaceStatus !== "ready") return;
    let current = true;
    void listProjectScreenshots(selectedProject.id)
      .then((data) => { if (current) setProjectScreenshotsState({ projectId: selectedProject.id, screenshots: data, error: "" }); })
      .catch((error: unknown) => {
        if (current) {
          setProjectScreenshotsState({ projectId: selectedProject.id, screenshots: [], error: error instanceof Error ? error.message : "Couldn't load project screenshots." });
        }
      });
    return () => { current = false; };
  }, [selectedProject?.id, authStatus, workspaceStatus]);

  useEffect(() => {
    if (!selectedProject?.id || authStatus !== "authenticated" || workspaceStatus !== "ready") return;
    let current = true;
    void hasLinkedGithubRepository(selectedProject.id)
      .then((connected) => { if (current) setProjectGithubLinkState({ projectId: selectedProject.id, connected, error: "" }); })
      .catch((error: unknown) => {
        if (current) setProjectGithubLinkState({ projectId: selectedProject.id, connected: false, error: error instanceof Error ? error.message : "Couldn't check this project's GitHub connection." });
      });
    return () => { current = false; };
  }, [selectedProject?.id, authStatus, workspaceStatus]);

  const handleProjectHealthAction = (action: "documentation" | "screenshots" | "github" | "testing" | "deployment", projectId: string) => {
    setSelectedProjectId(projectId);
    setShowcaseMode("workspace");
    if (action === "documentation") {
      setNoteProjectFilter(projectId);
      setActiveView("notes");
      return;
    }
    setActiveView("projects");
    if (action === "screenshots") setProjectTab("Screenshots");
    if (action === "github") setProjectTab("GitHub");
    if (action === "testing") {
      setProjectTaskFilter("testing");
      setProjectTab("Tasks");
    }
    if (action === "deployment") setProjectTab("Workflow");
  };

  const todayTasks = useMemo(
    () => tasks.filter((task) => task.status !== "Completed").slice(0, 4),
    [tasks],
  );

  const completedToday = useMemo(() => {
    const today = new Date().toDateString();
    return tasks.filter((task) => task.completedAt && new Date(task.completedAt).toDateString() === today);
  }, [tasks]);

  const upcomingItems = useMemo(() => {
    const items = [...tasks]
      .filter((task) => task.status !== "Completed")
      .map((task) => ({
        type: "Task",
        label: task.title,
        date: task.dueDate,
        projectId: task.projectId,
      }))
      .concat(
        milestones.map((milestone) => ({
          type: "Milestone",
          label: milestone.title,
          date: milestone.targetDate,
          projectId: milestone.projectId,
        })),
      )
      .filter((item) => item.date)
      .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())
      .slice(0, 5);
    return items;
  }, [tasks, milestones]);

  const projectAccountability = useMemo(() => projects.map((project) => ({
    project,
    result: calculateProjectAccountability({
      project,
      tasks,
      milestones,
      plans,
      github: project.health.github ? { status: "loading" } : { status: "not-connected" },
    }),
  })), [projects, tasks, milestones, plans]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [] as Array<{ id: string; kind: string; label: string; meta: string }>;

    const hits: Array<{ id: string; kind: string; label: string; meta: string }> = [];

    projects.forEach((project) => {
      if (project.name.toLowerCase().includes(query) || project.description.toLowerCase().includes(query)) {
        hits.push({ id: project.id, kind: "Project", label: project.name, meta: project.type });
      }
    });

    tasks.forEach((task) => {
      if (task.title.toLowerCase().includes(query) || task.tags.some((tag) => tag.toLowerCase().includes(query))) {
        hits.push({ id: task.id, kind: "Task", label: task.title, meta: task.status });
      }
    });

    plans.forEach((plan) => {
      if (plan.title.toLowerCase().includes(query) || plan.goal.toLowerCase().includes(query)) {
        hits.push({ id: plan.id, kind: "Plan", label: plan.title, meta: plan.deadline });
      }
    });

    notes.forEach((note) => {
      if (note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query)) {
        hits.push({ id: note.id, kind: "Note", label: note.title, meta: "Knowledge" });
      }
    });

    technologies.forEach((technology) => {
      if (technology.name.toLowerCase().includes(query)) {
        hits.push({ id: technology.id, kind: "Technology", label: technology.name, meta: technology.category });
      }
    });

    return hits.slice(0, 8);
  }, [searchQuery, projects, tasks, plans, notes, technologies]);

  const taskColumns = ["Backlog", "Planned", "In Progress", "Review", "Testing", "Blocked", "Completed"] as const;

  /* Project cards are DARK PAPER in both themes — the muted mood accent gives
     each one its colour, and the type follows the warm cream ink tiers. */
  const renderProjectCard = (project: Project) => (
    <button
      key={project.id}
      type="button"
      onClick={() => {
        setSelectedProjectId(project.id);
        setActiveView("projects");
      }}
      className={`project-card group w-full p-4 text-left ${projectMood(project.id)} ${
        selectedProject?.id === project.id ? "is-selected" : ""
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold t-dark">{project.name}</p>
          <p className="mt-1 text-xs t-dark-soft">{project.type}</p>
        </div>
        <span className={statusColors[project.status] ?? "badge"}>{project.status}</span>
      </div>
      <p className="mb-4 line-clamp-2 text-sm t-dark-muted">{project.description}</p>
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em]">
        <span className="t-mood font-bold">{project.currentPhase}</span>
        <span className="font-bold t-dark-muted">{project.progress}%</span>
      </div>
      <div className="progress-track mb-3 h-2">
        <div className="progress-fill" style={{ width: `${project.progress}%` }} />
      </div>
      <div className="flex flex-wrap gap-2">
        {project.technologies.slice(0, 3).map((tech) => (
          <span key={tech} className="soft-pill px-2 py-1">
            {tech}
          </span>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-[11px]">
        <span className="line-clamp-2 t-dark-muted">{project.nextAction}</span>
        <span className="inline-flex shrink-0 items-center gap-1 t-dark">
          <GitBranch size={12} />
          {project.githubConnected ? "GitHub" : "Local"}
        </span>
      </div>
    </button>
  );

  const sharePublicProject = (project: Project) => {
    if ((project.visibility ?? "Private") === "Private") {
      setShareNotice({ projectId: project.id, message: "This project is private. Make it Public or Unlisted before sharing a public view." });
      return;
    }
    if (!project.slug.trim()) {
      setWorkspaceError("This project has no public slug. Edit and save the project before sharing it.");
      return;
    }
    const url = `${window.location.origin}/view/project/${encodeURIComponent(project.slug)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setShareNotice({ projectId: project.id, message: "Opened the public project view." });
  };

  const saveProjectVisibility = async (project: Project, visibility: NonNullable<Project["visibility"]>) => {
    if (visibilitySaveLock.current) return;
    visibilitySaveLock.current = true;
    setIsSavingVisibility(true);
    try {
      const result = await setProjectVisibility(project.id, visibility);
      if (!result.ok) {
        setWorkspaceError(result.error);
        return;
      }
      setProjects((current) => current.map((item) => item.id === result.data.id ? result.data : item));
      setWorkspaceError("");
      setPrivateProjectConfirmation(null);
      const messages = {
        Private: "Project is Private. Public listings and existing shared links no longer expose it.",
        Public: "Visibility is Public. The project is available in the public portfolio and by direct link.",
        Unlisted: "Visibility is Unlisted. The project is available by direct link but hidden from the public listing.",
      };
      setShareNotice({ projectId: project.id, message: messages[visibility] });
    } catch (error) {
      console.error("[workspace] could not update project visibility", error);
      setWorkspaceError("Couldn't save the visibility change. Refresh and try again.");
    } finally {
      visibilitySaveLock.current = false;
      setIsSavingVisibility(false);
    }
  };

  const requestProjectVisibilityChange = (project: Project, visibility: NonNullable<Project["visibility"]>) => {
    if ((project.visibility ?? "Private") === visibility) return;
    setWorkspaceError("");
    if (visibility === "Private" && project.visibility !== "Private") {
      setPrivateProjectConfirmation(project);
      return;
    }
    void saveProjectVisibility(project, visibility);
  };

  const copyPublicProjectLink = async (project: Project) => {
    if ((project.visibility ?? "Private") === "Private" || !project.slug.trim()) return;
    const url = `${window.location.origin}/view/project/${encodeURIComponent(project.slug)}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice({ projectId: project.id, message: "Public project link copied." });
    } catch (error) {
      console.error("[workspace] could not copy public project link", error);
      setWorkspaceError("Couldn't copy the public link. Use Share Public View to open it.");
    }
  };

  const dateInputValue = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  };

  const handleCreateProject = () => {
    setWorkspaceError("");
    setProjectEditor({ name: "", description: "", type: "Personal", status: "Planning", currentPhase: "PLANNING", priority: "Medium", role: "Developer", teamSize: "", startDate: "", targetDate: "", objective: "", nextAction: "", visibility: "Private" });
  };

  const handleEditProject = (project: Project) => {
    setProjectEditor({
      id: project.id,
      name: project.name,
      description: project.description,
      type: project.type,
      status: project.status,
      currentPhase: project.currentPhase,
      priority: project.priority ?? "Medium",
      role: project.role,
      teamSize: project.teamSize?.toString() ?? "",
      startDate: dateInputValue(project.startDate),
      targetDate: dateInputValue(project.targetDate),
      objective: project.objective,
      nextAction: project.nextAction,
      visibility: project.visibility ?? "Private",
    });
  };

  const saveProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectEditor) return;
    await withEditorSaveProtection(async () => {
      const draft = {
        name: projectEditor.name,
        description: projectEditor.description,
        type: projectEditor.type,
        status: projectEditor.status,
        currentPhase: projectEditor.currentPhase,
        priority: projectEditor.priority,
        role: projectEditor.role,
        teamSize: projectEditor.teamSize ? Number(projectEditor.teamSize) : null,
        startDate: projectEditor.startDate || null,
        targetDate: projectEditor.targetDate || null,
        objective: projectEditor.objective,
        nextAction: projectEditor.nextAction,
        visibility: projectEditor.id ? undefined : projectEditor.visibility,
      };
      const result = projectEditor.id ? await updateProject(projectEditor.id, draft) : await createProject(draft);
      if (!result.ok) {
        setWorkspaceError(result.error);
        return;
      }
      setProjects((current) => projectEditor.id
        ? current.map((project) => project.id === result.data.id ? result.data : project)
        : [result.data, ...current]);
      setSelectedProjectId(result.data.id);
      setProjectEditor(null);
      setWorkspaceError("");
      setActiveView("projects");
    });
  };

  const saveProjectField = async (projectId: string, patch: Parameters<typeof updateProject>[1]) => {
    try {
      const result = await updateProject(projectId, patch);
      if (result.ok) {
        setProjects((current) => current.map((project) => project.id === result.data.id ? result.data : project));
        if (patch.visibility !== undefined) {
          setShareNotice({ projectId, message: `Visibility saved as ${result.data.visibility}.` });
        }
        setWorkspaceError("");
      } else {
        setWorkspaceError(result.error);
      }
    } catch (error) {
      console.error("[workspace] project update failed", error);
      setWorkspaceError("Couldn't save changes. Refresh and try again.");
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (!window.confirm(`Delete ${project.name} and its workspace records?`)) return;
    const result = await deleteProject(project.id);
    if (!result.ok) {
      setWorkspaceError(result.error);
      return;
    }
    const remaining = projects.filter((item) => item.id !== project.id);
    setProjects(remaining);
    setTasks((current) => current.filter((task) => task.projectId !== project.id));
    setMilestones((current) => current.filter((milestone) => milestone.projectId !== project.id));
    setNotes((current) => current.map((note) => note.projectId === project.id ? { ...note, projectId: undefined } : note));
    setSelectedProjectId(remaining[0]?.id ?? "");
    void refreshTechnologyData();
    setWorkspaceError("");
  };

  const updateDerivedProjectProgress = (projectId: string, nextTasks = tasks, nextMilestones = milestones) => {
    setProjects((current) => current.map((project) => project.id === projectId ? {
      ...project,
      progress: calculateProjectProgress({
        workflowStage: project.currentPhase,
        tasks: nextTasks.filter((task) => task.projectId === projectId),
        milestones: nextMilestones.filter((milestone) => milestone.projectId === projectId),
      }).total,
    } : project));
  };

  const handleCreateTask = () => {
    const projectId = selectedProject?.id ?? projects[0]?.id;
    if (!projectId) {
      setWorkspaceError("Create a project before adding a task.");
      return;
    }
    setWorkspaceError("");
    setTaskEditor({ title: "", description: "", projectId, status: "Backlog", priority: "Medium", dueDate: "" });
  };

  const handleCreateTestingTask = () => {
    const projectId = selectedProject?.id;
    if (!projectId) return;
    setWorkspaceError("");
    setTaskEditor({ title: "Testing: ", description: "", projectId, status: "Backlog", priority: "Medium", dueDate: "" });
  };

  const handleEditTask = (task: Task) => {
    setTaskEditor({ id: task.id, title: task.title, description: task.description, projectId: task.projectId, status: task.status, priority: task.priority, dueDate: dateInputValue(task.dueDate) });
  };

  const saveTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskEditor) return;
    await withEditorSaveProtection(async () => {
      let result: Awaited<ReturnType<typeof updateTask>>;
      if (taskEditor.id) {
        result = await updateTask(taskEditor.id, {
          projectId: taskEditor.projectId,
          title: taskEditor.title,
          description: taskEditor.description,
          priority: taskEditor.priority,
          status: taskEditor.status,
          dueDate: taskEditor.dueDate || null,
        });
        if (result.ok) {
          const savedTask = result.data;
          const nextTasks = tasks.map((task) => task.id === savedTask.id ? savedTask : task);
          setTasks(nextTasks);
          updateDerivedProjectProgress(savedTask.projectId, nextTasks);
        }
      } else {
        result = await createTask({ ...taskEditor, dueDate: taskEditor.dueDate || null });
        if (result.ok) {
          const savedTask = result.data;
          const nextTasks = [savedTask, ...tasks];
          setTasks(nextTasks);
          updateDerivedProjectProgress(savedTask.projectId, nextTasks);
        }
      }
      if (!result.ok) {
        setWorkspaceError(result.error);
        return;
      }
      setTaskEditor(null);
      setWorkspaceError("");
    });
  };

  const handleCreatePlan = () => {
    setWorkspaceError("");
    setPlanEditor({ title: "", goal: "", status: "Planning", deadline: "", items: "" });
  };

  const handleEditPlan = (plan: Plan) => {
    setPlanEditor({ id: plan.id, title: plan.title, goal: plan.goal, status: plan.status ?? "Planning", deadline: dateInputValue(plan.deadline), items: "" });
  };

  const savePlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!planEditor) return;
    await withEditorSaveProtection(async () => {
      const result = planEditor.id
        ? await updatePlan(planEditor.id, { title: planEditor.title, goal: planEditor.goal, status: planEditor.status, targetDate: planEditor.deadline || null })
        : await createPlan({
            title: planEditor.title,
            goal: planEditor.goal,
            status: planEditor.status,
            targetDate: planEditor.deadline || null,
            items: planEditor.items.split("\n").map((label) => label.trim()).filter(Boolean).map((label) => ({ label })),
          });
      if (!result.ok) {
        setWorkspaceError(result.error);
        return;
      }
      setPlans((current) => planEditor.id ? current.map((plan) => plan.id === result.data.id ? result.data : plan) : [result.data, ...current]);
      setPlanEditor(null);
      setWorkspaceError("");
    });
  };

  const changePlanStatus = async (planId: string, status: NonNullable<Plan["status"]>) => {
    const result = await setPlanStatus(planId, status);
    if (result.ok) setPlans((current) => current.map((plan) => plan.id === result.data.id ? result.data : plan));
    else setWorkspaceError(result.error);
  };

  const removePlan = async (planId: string) => {
    const result = await deletePlan(planId);
    if (result.ok) setPlans((current) => current.filter((plan) => plan.id !== planId));
    else setWorkspaceError(result.error);
  };

  const togglePlanItem = async (planId: string, itemId: string, done: boolean) => {
    const result = await setPlanItemDone(itemId, done);
    if (!result.ok) {
      setWorkspaceError(result.error);
      return;
    }
    setPlans((current) => current.map((plan) => plan.id === planId ? {
      ...plan,
      items: plan.items?.map((item) => item.id === itemId ? result.data : item),
      tasks: plan.tasks.map((item) => item.id === itemId ? { ...item, done: result.data.done } : item),
    } : plan));
  };

  const addPlanItem = async (planId: string) => {
    const label = window.prompt("Plan step");
    if (!label?.trim()) return;
    const result = await createPlanItem(planId, { label });
    if (!result.ok) {
      setWorkspaceError(result.error);
      return;
    }
    setPlans((current) => current.map((plan) => plan.id === planId ? {
      ...plan,
      items: [...(plan.items ?? []), result.data],
      tasks: [...plan.tasks, { id: result.data.id, label: result.data.label, done: result.data.done }],
    } : plan));
  };

  const removePlanItem = async (planId: string, itemId: string) => {
    const result = await deletePlanItem(itemId);
    if (!result.ok) {
      setWorkspaceError(result.error);
      return;
    }
    setPlans((current) => current.map((plan) => plan.id === planId ? {
      ...plan,
      items: plan.items?.filter((item) => item.id !== itemId),
      tasks: plan.tasks.filter((item) => item.id !== itemId),
    } : plan));
  };

  const handleCreateMilestone = (projectId: string) => {
    setMilestoneEditor({ projectId, title: "", description: "", targetDate: "" });
  };

  const handleEditMilestone = (milestone: Milestone) => {
    setMilestoneEditor({ id: milestone.id, projectId: milestone.projectId, title: milestone.title, description: milestone.description ?? "", targetDate: dateInputValue(milestone.targetDate) });
  };

  const saveMilestone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!milestoneEditor) return;
    const result = milestoneEditor.id
      ? await updateMilestone(milestoneEditor.id, { title: milestoneEditor.title, description: milestoneEditor.description, targetDate: milestoneEditor.targetDate || null })
      : await createMilestone({ projectId: milestoneEditor.projectId, title: milestoneEditor.title, description: milestoneEditor.description, targetDate: milestoneEditor.targetDate || null });
    if (!result.ok) {
      setWorkspaceError(result.error);
      return;
    }
    const nextMilestones = milestoneEditor.id
      ? milestones.map((milestone) => milestone.id === result.data.id ? result.data : milestone)
      : [...milestones, result.data];
    setMilestones(nextMilestones);
    updateDerivedProjectProgress(result.data.projectId, tasks, nextMilestones);
    setMilestoneEditor(null);
    setWorkspaceError("");
  };

  const changeMilestoneStatus = async (milestone: Milestone, status: Milestone["status"]) => {
    const result = await setMilestoneStatus(milestone.id, status);
    if (result.ok) {
      const nextMilestones = milestones.map((item) => item.id === result.data.id ? result.data : item);
      setMilestones(nextMilestones);
      updateDerivedProjectProgress(result.data.projectId, tasks, nextMilestones);
    }
    else setWorkspaceError(result.error);
  };

  const removeMilestone = async (milestoneId: string) => {
    const result = await deleteMilestone(milestoneId);
    if (result.ok) {
      const projectId = milestones.find((item) => item.id === milestoneId)?.projectId;
      const nextMilestones = milestones.filter((item) => item.id !== milestoneId);
      setMilestones(nextMilestones);
      if (projectId) updateDerivedProjectProgress(projectId, tasks, nextMilestones);
    }
    else setWorkspaceError(result.error);
  };

  const handleCreateNote = () => setNoteEditor({ title: "", content: "", projectId: selectedProject?.id ?? "" });

  const handleEditNote = (note: NoteItem) => setNoteEditor({ id: note.id, title: note.title, content: note.content, projectId: note.projectId ?? "" });

  const saveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!noteEditor) return;
    const result = noteEditor.id
      ? await updateNote(noteEditor.id, { title: noteEditor.title, content: noteEditor.content, projectId: noteEditor.projectId || null })
      : await createNote({ title: noteEditor.title, content: noteEditor.content, projectId: noteEditor.projectId || null });
    if (!result.ok) {
      setWorkspaceError(result.error);
      return;
    }
    setNotes((current) => noteEditor.id ? current.map((note) => note.id === result.data.id ? result.data : note) : [result.data, ...current]);
    setNoteEditor(null);
    setWorkspaceError("");
  };

  const removeNote = async (noteId: string) => {
    const result = await deleteNote(noteId);
    if (result.ok) setNotes((current) => current.filter((note) => note.id !== noteId));
    else setWorkspaceError(result.error);
  };

  const refreshTechnologyData = async () => {
    try {
      const [nextTechnologies, names] = await Promise.all([listTechnologies(), listProjectTechnologyNames()]);
      setTechnologies(nextTechnologies);
      setProjects((current) => current.map((project) => ({ ...project, technologies: names.get(project.id) ?? [] })));
    } catch (error) {
      console.error("[workspace] technology refresh failed", error);
      setWorkspaceError("The technology was saved, but the list could not be refreshed.");
    }
  };

  const handleTechnologySave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!technologyName.trim()) return;
    const result = await createTechnology(technologyName);
    if (!result.ok) {
      setWorkspaceError(result.error);
      return;
    }
    if (technologyProjectId) {
      const linkResult = await attachTechnology(technologyProjectId, result.data.id);
      if (!linkResult.ok) {
        setWorkspaceError(linkResult.error);
        return;
      }
    }
    await refreshTechnologyData();
    setTechnologyName("");
    setWorkspaceError("");
  };

  const handleTechnologyLink = async (technologyId: string, action: "attach" | "detach") => {
    if (!technologyProjectId) {
      setWorkspaceError("Choose a project first.");
      return;
    }
    const result = action === "attach"
      ? await attachTechnology(technologyProjectId, technologyId)
      : await detachTechnology(technologyProjectId, technologyId);
    if (!result.ok) {
      setWorkspaceError(result.error);
      return;
    }
    await refreshTechnologyData();
    setWorkspaceError("");
  };

  const handleImportRepo = (repo: GithubRepo) => {
    if (authStatus === "authenticated") {
      setWorkspaceError("Use the GitHub App repository browser to import authenticated repositories.");
      setGithubImportOpen(false);
      return;
    }
    const slug = repo.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "imported-project";
    const newProject: Project = {
      id: makeId("proj"),
      slug,
      name: repo.name,
      description: repo.description,
      type: "Personal",
      status: "Planning",
      progress: 18,
      currentPhase: "PLANNING",
      objective: `Import project context from ${repo.name} and turn it into a visible software project record.`,
      role: "Developer",
      startDate: new Date().toISOString(),
      targetDate: getFutureDate(40),
      nextAction: "Review repository structure, README, and demo architecture",
      technologies: repo.technologies,
      lastUpdated: new Date().toISOString(),
      githubConnected: true,
      repoName: repo.name,
      health: {
        documentation: true,
        screenshots: false,
        github: true,
        testing: false,
        deployment: false,
      },
      links: {
        github: `https://github.com/example/${repo.name.toLowerCase().replace(/\s+/g, "-")}`,
      },
    };

    setProjects((current) => [newProject, ...current]);
    setSelectedProjectId(newProject.id);
    setGithubImportOpen(false);
    setActiveView("projects");
  };

  /** Status changes keep the old row visible until Supabase confirms the write. */
  const updateTaskStatus = (taskId: string, nextStatus: Task["status"]) => {
    const currentTask = tasks.find((task) => task.id === taskId);
    if (!currentTask) return;
    void (async () => {
      const result = await setTaskStatus(taskId, nextStatus);
      if (result.ok) {
        const nextTasks = tasks.map((task) => task.id === taskId ? result.data : task);
        setTasks(nextTasks);
        updateDerivedProjectProgress(result.data.projectId, nextTasks);
      } else {
        setWorkspaceError(result.error);
      }
    })();
  };

  const toggleTaskComplete = (taskId: string) => {
    const currentTask = tasks.find((task) => task.id === taskId);
    if (!currentTask) return;
    const action = currentTask.status === "Completed" ? reopenTask : completeTask;
    void (async () => {
      const result = await action(taskId);
      if (result.ok) {
        const nextTasks = tasks.map((task) => task.id === taskId ? result.data : task);
        setTasks(nextTasks);
        updateDerivedProjectProgress(result.data.projectId, nextTasks);
      } else {
        setWorkspaceError(result.error);
      }
    })();
  };

  /** Persist-first delete — the task leaves the list only after Supabase confirms it. */
  const handleDeleteTask = (taskId: string) => {
    void (async () => {
      const result = await deleteTask(taskId);
      if (result.ok) {
        const projectId = tasks.find((task) => task.id === taskId)?.projectId;
        const nextTasks = tasks.filter((task) => task.id !== taskId);
        setTasks(nextTasks);
        if (projectId) updateDerivedProjectProgress(projectId, nextTasks);
      } else {
        setWorkspaceError(result.error);
      }
    })();
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* GREETING SHEET — cream paper, deep warm charcoal ink, in both themes */}
      <div className="hero-paper tilt-left p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="hero-script text-[32px] leading-none">Good afternoon, {firstName} ✦</h3>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] t-paper-muted">Let&apos;s build something cool.</p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight t-paper text-shadow-paper">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleCreateProject} className="ink-button primary px-3 py-2 text-sm font-semibold">
              <span className="inline-flex items-center gap-2"><Plus size={15} /> New Project</span>
            </button>
            <button type="button" onClick={handleCreateTask} className="ink-button soft px-3 py-2 text-sm font-semibold">
              <span className="inline-flex items-center gap-2"><Plus size={15} /> New Task</span>
            </button>
            <button type="button" onClick={handleCreatePlan} className="ink-button px-3 py-2 text-sm font-semibold">
              <span className="inline-flex items-center gap-2"><Plus size={15} /> New Plan</span>
            </button>
            <button type="button" onClick={() => setGithubImportOpen(true)} className="ink-button coral px-3 py-2 text-sm font-semibold">
              <span className="inline-flex items-center gap-2"><FolderGit2 size={15} /> Import from GitHub</span>
            </button>
          </div>
        </div>
      </div>

      {/* STAT SHEETS — cream cards, pastel corner accents, deep warm numbers */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Active projects", value: `${projects.filter((project) => project.status !== "Completed").length}`, mood: "mood-peach" },
          { label: "Open tasks", value: `${tasks.filter((task) => task.status !== "Completed").length}`, mood: "mood-lavender" },
          { label: "Plans", value: `${plans.length}`, mood: "mood-blue" },
          { label: "Milestones", value: `${milestones.length}`, mood: "mood-green" },
        ].map((stat) => (
          <div key={stat.label} className={`${stat.mood} stat-card p-4`}>
            <p className="eyebrow flex items-center gap-2">
              <span className="dot-badge h-2 w-2 t-mood" aria-hidden="true" />
              {stat.label}
            </p>
            <p className="stat-value mt-4">{stat.value}</p>
          </div>
        ))}
      </div>

      {authStatus === "authenticated" && workspaceStatus === "ready" && <section className="dark-panel p-4 md:p-5" aria-label="Project accountability overview">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="eyebrow t-mood">Project health</p><h2 className="mt-2 text-2xl font-semibold t-dark">Your current project rhythm</h2><p className="mt-1 text-sm t-dark-muted">Workspace progress; open a project&apos;s GitHub tab to include its repository activity.</p></div>
          <span className="dark-chip px-2.5 py-1 text-xs">Private workspace</span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(["Active", "Steady", "Needs Attention"] as const).map((health) => <div key={health} className="dark-inset p-3"><p className="text-xs t-dark-muted">{health}</p><p className="mt-1 text-2xl font-semibold t-dark">{projectAccountability.filter((item) => item.result.githubStatus !== "loading" && item.result.health === health).length}</p></div>)}
          <div className="dark-inset p-3"><p className="text-xs t-dark-muted">Repository check needed</p><p className="mt-1 text-2xl font-semibold t-dark">{projectAccountability.filter((item) => item.result.githubStatus === "loading").length}</p></div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {projectAccountability.filter(({ project, result }) => ["Needs Attention", "Blocked"].includes(result.health) || (result.health === "Stalled" && (!project.health.github || result.githubStatus === "not-relevant"))).slice(0, 4).map(({ project, result }) => <div key={project.id} className="dark-inset flex items-start justify-between gap-3 p-3">
            <div><p className="text-sm font-medium t-dark">{project.name}</p><p className="mt-1 text-xs t-dark-muted">{result.reasons.find((reason) => reason.kind === "attention")?.text ?? (result.daysSinceActivity === null ? "No recent progress signals" : `${result.daysSinceActivity} days since progress`)}</p></div>
            <span className="dark-chip shrink-0 px-2 py-1 text-xs">{result.health}</span>
          </div>)}
          {projectAccountability.every(({ project, result }) => !["Needs Attention", "Blocked"].includes(result.health) && !(result.health === "Stalled" && (!project.health.github || result.githubStatus === "not-relevant"))) && <p className="dark-inset p-3 text-sm t-dark-muted">No projects currently need attention based on loaded workspace data.</p>}
        </div>
      </section>}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-7">
          {/* dark project sheets sit directly on the desk, heading handwritten above */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="section-title text-[30px]">Active Projects</h2>
              <button type="button" onClick={() => setActiveView("projects")} className="text-sm font-semibold underline decoration-[var(--edge-cream)] underline-offset-4">
                View all
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">{projects.slice(0, 4).map(renderProjectCard)}</div>
          </section>

          {/* cream index cards for the pipeline stages */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="section-title text-[30px]">Current Workflow</h2>
              <button type="button" onClick={() => setActiveView("projects")} className="text-sm font-semibold underline decoration-[var(--edge-cream)] underline-offset-4">
                Open workflow
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {workflowStages.map((stage, stageIndex) => {
                const safeStage = stage === "Development" ? "DEVELOPMENT" : stage === "Planning" ? "PLANNING" : stage === "Research" ? "RESEARCH" : stage === "Testing" ? "TESTING" : stage === "Deployment" ? "DEPLOYMENT" : stage === "Maintenance" ? "MAINTENANCE" : "COMPLETED";
                const count = projects.filter((project) => project.currentPhase === safeStage).length;
                const stageMoods = ["mood-peach", "mood-blue", "mood-lavender", "mood-pink", "mood-green", "mood-blue", "mood-green"];
                return (
                  <div key={stage} className={`paper-card ${stageMoods[stageIndex % stageMoods.length]} p-3`}>
                    <div className="flex items-center justify-between text-sm t-paper">
                      <span className="font-semibold">{stage}</span>
                      <span className="soft-pill px-2 py-0.5">{count}</span>
                    </div>
                    <div className="mt-3 space-y-2 text-xs t-paper-muted">
                      {count > 0 ? (
                        projects
                          .filter((project) => project.currentPhase === safeStage)
                          .slice(0, 3)
                          .map((project) => <div key={project.id}>{project.name}</div>)
                      ) : (
                        <div className="t-paper-soft">No active work</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          {/* TODAY NOTES — dark paper sheet, warm cream type, in both themes */}
          <div className="dark-panel p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title text-[30px]">Today</h2>
              <button type="button" onClick={() => setActiveView("today")} className="text-sm font-semibold underline decoration-[var(--edge-dark)] underline-offset-4">
                Open today
              </button>
            </div>
            <div className="space-y-3">
              {todayTasks.map((task) => (
                <div key={task.id} className="dark-inset p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium t-dark">{task.title}</p>
                      <p className="mt-1 text-xs t-dark-soft">{projects.find((project) => project.id === task.projectId)?.name}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={task.status === "Completed"}
                      onChange={() => toggleTaskComplete(task.id)}
                      className="h-4 w-4"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={priorityColors[task.priority]}>{task.priority}</span>
                    <span className="text-[10px] uppercase tracking-[0.15em] t-dark-soft">{task.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="paper-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title text-[30px]">Upcoming</h2>
            </div>
            <div className="space-y-3">
              {upcomingItems.map((item) => (
                <div key={`${item.type}-${item.label}`} className="inset-soft p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium t-paper">{item.label}</p>
                    <span className="soft-pill px-2 py-1">{item.type}</span>
                  </div>
                  <p className="mt-2 text-xs t-paper-muted">{formatDisplayDate(item.date)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="paper-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title text-[30px]">Recent activity</h2>
            </div>
            <div className="space-y-3">
              {activities.map((activity) => (
                <div key={activity.id} className="inset-soft flex items-start gap-3 p-3">
                  <div className="soft-pill mt-1 shrink-0 p-2 t-mood"><Activity size={14} /></div>
                  <div>
                    <p className="text-sm t-paper">{activity.kind}</p>
                    <p className="mt-1 text-xs t-paper-muted">{activity.message}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.15em] t-paper-soft">{activity.when}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderTodayPage = () => (
    <div className="space-y-6">
      <div className="dark-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow t-mood">Focus</p>
            <h2 className="t-dark mt-2 text-2xl font-semibold">{tasks.find((task) => task.status !== "Completed")?.title ?? "No open tasks"}</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="dark-chip t-mood px-3 py-2 text-center font-mono text-sm">
              {`${String(Math.floor(focusMinutes / 60)).padStart(2, "0")}:${String(focusMinutes % 60).padStart(2, "0")}`}
            </div>
            <button
              type="button"
              onClick={() => setFocusRunning((current) => !current)}
              className="ink-button primary px-3 py-2 text-sm"
            >
              {focusRunning ? "Pause" : "Start Focus Session"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="dark-panel p-4">
          <h3 className="t-dark mb-4 text-lg font-semibold">Today&apos;s tasks</h3>
          <div className="space-y-3">
            {tasks.slice(0, 5).map((task) => (
              <div key={task.id} className="dark-inset flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={task.status === "Completed"}
                    onChange={() => toggleTaskComplete(task.id)}
                    className="h-4 w-4"
                  />
                  <div>
                    <p className="t-dark font-medium">{task.title}</p>
                    <div className="t-dark-soft mt-1 flex flex-wrap gap-2 text-[10px]">
                      <span>{projects.find((project) => project.id === task.projectId)?.name}</span>
                      <span>•</span>
                      <span>{formatDisplayDate(task.dueDate)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`prio prio-${task.priority.toLowerCase()}`}>{task.priority}</span>
                  <button type="button" onClick={() => handleDeleteTask(task.id)} className="t-dark-muted rounded-lg p-1 transition hover:text-[var(--accent-coral)]">
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="paper-card p-4">
            <h3 className="mb-4 text-lg font-semibold">Schedule</h3>
            <div className="space-y-2.5 text-sm">
              {upcomingItems.map((item) => <div key={`${item.type}-${item.label}`} className="inset-soft flex items-center justify-between gap-3 px-3 py-2"><span>{item.label}</span><span className="text-xs t-paper-muted">{formatDisplayDate(item.date)}</span></div>)}
              {upcomingItems.length === 0 && <p className="text-sm t-paper-muted">No upcoming tasks or milestones.</p>}
            </div>
          </div>

          <div className="paper-card p-4">
            <h3 className="mb-4 text-lg font-semibold">Completed today</h3>
            <div className="space-y-2 text-sm">
              {completedToday.map((task) => <div key={task.id} className="inset-soft flex items-center gap-2 px-3 py-2"><Check size={14} className="text-[var(--ink-green)]" /> {task.title}</div>)}
              {completedToday.length === 0 && <p className="text-sm t-paper-muted">No tasks completed today.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const openProjectDetail = (project: Project) => {
    setSelectedProjectId(project.id);
    setProjectTab("Overview");
    setActiveView("projects");
  };

  const renderProjectDetail = () => {
    if (!selectedProject) return null;

    const projectTasks = tasks.filter((task) => task.projectId === selectedProject.id);
    const projectMilestonesList = milestones.filter((milestone) => milestone.projectId === selectedProject.id);
    const projectNotes = notes.filter((note) => note.projectId === selectedProject.id);
    const hasMeaningfulDocumentation = isHttpUrl(selectedProject.links.docs)
      || projectNotes.some((note) => note.title.trim().length > 0 && note.content.trim().length >= 20);
    const testingTasks = projectTasks.filter((task) => task.status === "Testing" || /\b(test|testing|qa|quality assurance|verification|validate)\b/i.test(`${task.title} ${task.description}`));
    const testingCompleted = testingTasks.length > 0
      ? testingTasks.every((task) => task.status === "Completed")
      : ["DEPLOYMENT", "MAINTENANCE", "COMPLETED"].includes(selectedProject.currentPhase);
    const hasDeploymentUrl = isHttpUrl(selectedProject.links.live);
    const deploymentStageReached = ["DEPLOYMENT", "MAINTENANCE", "COMPLETED"].includes(selectedProject.currentPhase);
    const healthItems = [
      { key: "documentation" as const, label: "Documentation", complete: hasMeaningfulDocumentation, hint: hasMeaningfulDocumentation ? "Project documentation is available." : "Add a project note or documentation link." },
      { key: "screenshots" as const, label: "Screenshots", complete: projectScreenshots.length > 0, hint: projectScreenshotsLoading ? "Checking saved screenshots." : projectScreenshotsError || (projectScreenshots.length > 0 ? "Saved screenshots are available." : "Add a project screenshot.") },
      { key: "github" as const, label: "GitHub", complete: authStatus === "authenticated" && workspaceStatus === "ready" ? projectGithubLinked : selectedProject.health.github, hint: projectGithubLoading ? "Checking the repository connection." : currentProjectGithubLink?.error || (projectGithubLinked || (authStatus !== "authenticated" && selectedProject.health.github) ? "Repository connected." : "Connect a repository.") },
      { key: "testing" as const, label: "Testing", complete: testingCompleted, hint: testingCompleted ? "Testing work is complete or the workflow has advanced beyond testing." : testingTasks.length ? "Complete outstanding testing tasks." : "Add testing tasks or advance the workflow after testing." },
      { key: "deployment" as const, label: "Deployment", complete: hasDeploymentUrl && deploymentStageReached, hint: hasDeploymentUrl && deploymentStageReached ? "Deployment URL is configured for this stage." : "Add a deployment URL and set the deployment stage." },
    ];
    const visibleProjectTasks = projectTaskFilter === "testing" ? testingTasks : projectTasks;

    return (
      <div className="dark-panel p-4">
        <div className="flex flex-col gap-4 border-b border-[var(--edge-dark)] pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="eyebrow t-mood">{selectedProject.type}</p>
            <h2 className="mt-2 text-3xl font-semibold t-dark">{selectedProject.name}</h2>
            <p className="mt-2 max-w-2xl text-sm t-dark-muted">{selectedProject.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => handleEditProject(selectedProject)} className="dark-chip px-3 py-2 text-sm">Edit</button>
            <button type="button" onClick={() => void handleDeleteProject(selectedProject)} className="dark-chip px-3 py-2 text-sm hover:text-[var(--accent-coral)]">Delete</button>
            <a href="/api/github/connect" className="dark-chip px-3 py-2 text-sm">Connect GitHub</a>
            {(selectedProject.visibility ?? "Private") !== "Private" && <button type="button" onClick={() => sharePublicProject(selectedProject)} className="rounded-xl ink-button px-3 py-2 text-sm">Open Public View</button>}
            {(selectedProject.visibility ?? "Private") !== "Private" && selectedProject.slug && <button type="button" onClick={() => void copyPublicProjectLink(selectedProject)} className="dark-chip px-3 py-2 text-sm">Copy Public Link</button>}
            <button type="button" onClick={() => setShowcaseMode((current) => (current === "workspace" ? "showcase" : "workspace"))} className="rounded-xl ink-button primary px-3 py-2 text-sm">
              {showcaseMode === "workspace" ? "Preview Public Project" : "Return to workspace"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 dark-inset p-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-3 text-sm t-dark-muted">
            <span>Visibility</span>
            <select
              aria-label="Project visibility"
              value={selectedProject.visibility ?? "Private"}
              onChange={(event) => requestProjectVisibilityChange(selectedProject, event.target.value as NonNullable<Project["visibility"]>)}
              disabled={isSavingVisibility}
              className="dark-chip px-3 py-2"
            >
              {(["Private", "Public", "Unlisted"] as const).map((visibility) => <option key={visibility}>{visibility}</option>)}
            </select>
          </label>
          <p className="text-sm t-dark-muted">
            {(selectedProject.visibility ?? "Private") === "Private"
              ? "This project is not publicly accessible."
              : selectedProject.visibility === "Unlisted"
                ? "Accessible by direct link; excluded from the public project listing."
                : "Available through your public portfolio and direct link."}
          </p>
        </div>
        {shareNotice?.projectId === selectedProject.id && <p role="status" className="mt-2 text-sm t-dark-muted">{shareNotice.message}</p>}

        <div className="mt-4 flex flex-wrap gap-2 border-b border-[var(--edge-dark)] pb-4">
          {["Overview", "Workflow", "Tasks", "Milestones", "Screenshots", "GitHub"].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => { setProjectTab(tab); if (tab === "Tasks") setProjectTaskFilter("all"); }}
              className={`soft-pill px-3 py-1.5 text-xs ${
                projectTab === tab ? "is-selected" : "t-dark-muted"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {showcaseMode === "showcase" ? (
          <div className="mt-6 space-y-5">
            <div className="dark-inset mood-peach p-5">
              <p className="eyebrow t-mood">Portfolio preview</p>
              <h3 className="mt-3 text-3xl font-semibold t-dark">{selectedProject.name}</h3>
              <p className="mt-4 max-w-3xl t-dark-soft">{selectedProject.objective}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {selectedProject.technologies.map((tech) => (
                <div key={tech} className="dark-inset p-3 text-sm t-dark-soft">{tech}</div>
              ))}
            </div>
            <div className="dark-panel p-4">
              <h4 className="text-lg font-semibold t-dark">Problem / Solution / Result</h4>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="dark-inset p-3"><p className="eyebrow t-dark-soft">Problem</p><p className="mt-2 text-sm t-dark-soft">{selectedProject.publicProblem || "No public problem statement added."}</p></div>
                <div className="dark-inset p-3"><p className="eyebrow t-dark-soft">Solution</p><p className="mt-2 text-sm t-dark-soft">{selectedProject.publicSolution || "No public solution added."}</p></div>
                <div className="dark-inset p-3"><p className="eyebrow t-dark-soft">Result</p><p className="mt-2 text-sm t-dark-soft">{selectedProject.publicResult || "No public result added."}</p></div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {projectTab === "Overview" && (
              <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-4">
                  <div className="dark-panel p-4">
                    <h3 className="text-lg font-semibold t-dark">Project overview</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div><p className="eyebrow t-dark-soft">Objective</p><p className="mt-2 text-sm t-dark-soft">{selectedProject.objective}</p></div>
                      <div><p className="eyebrow t-dark-soft">Role</p><p className="mt-2 text-sm t-dark-soft">{selectedProject.role}</p></div>
                      <div><p className="eyebrow t-dark-soft">Project type</p><p className="mt-2 text-sm t-dark-soft">{selectedProject.type}</p></div>
                      <div><p className="eyebrow t-dark-soft">Current phase</p><p className="mt-2 text-sm t-dark-soft">{selectedProject.currentPhase}</p></div>
                      <div><p className="eyebrow t-dark-soft">Start date</p><p className="mt-2 text-sm t-dark-soft">{formatLongDate(selectedProject.startDate)}</p></div>
                      <div><p className="eyebrow t-dark-soft">Target date</p><p className="mt-2 text-sm t-dark-soft">{formatLongDate(selectedProject.targetDate)}</p></div>
                    </div>
                  </div>

                  <div className="dark-panel p-4">
                    <h3 className="text-lg font-semibold t-dark">Project health</h3>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {healthItems.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          title={item.hint}
                          aria-label={`${item.label}: ${item.key === "screenshots" && projectScreenshotsLoading || item.key === "github" && projectGithubLoading ? "checking" : item.complete ? "complete" : "needs attention"}. ${item.hint}`}
                          onClick={() => handleProjectHealthAction(item.key, selectedProject.id)}
                          className="flex min-h-11 cursor-pointer items-center justify-between rounded-xl dark-inset p-3 text-left text-sm t-dark-soft transition-colors hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-coral)]"
                        >
                          <span>{item.label}</span>
                          <span aria-hidden="true" className={item.complete ? "text-[var(--ink-green)]" : "text-amber-300"}>
                            {item.key === "screenshots" && projectScreenshotsLoading || item.key === "github" && projectGithubLoading ? "…" : item.complete ? "✓" : "⚠"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="dark-panel p-4">
                    <p className="eyebrow t-dark-soft">Project progress</p>
                    <p className="mt-4 text-4xl font-semibold t-dark">{selectedProject.progress}%</p>
                    <div className="progress-track mt-4 h-2.5">
                      <div className="progress-fill" style={{ width: `${selectedProject.progress}%` }} />
                    </div>
                    <div className="mt-4 space-y-2 text-sm t-dark-muted">
                      <div className="flex items-center justify-between"><span>Task progress</span><span>{calculateProjectProgress({ workflowStage: selectedProject.currentPhase, tasks: projectTasks }).taskPercent}%</span></div>
                      <div className="flex items-center justify-between"><span>Milestone progress</span><span>{calculateProjectProgress({ workflowStage: selectedProject.currentPhase, milestones: projectMilestonesList }).milestonePercent}%</span></div>
                    </div>
                  </div>

                  <div className="dark-panel p-4">
                    <h3 className="text-lg font-semibold t-dark">Links</h3>
                    <div className="mt-4 space-y-2 text-sm t-dark-muted">
                      {selectedProject.links.github && <div>GitHub: {selectedProject.links.github}</div>}
                      {selectedProject.links.live && <div>Live: {selectedProject.links.live}</div>}
                      {selectedProject.links.docs && <div>Docs: {selectedProject.links.docs}</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {projectTab === "Workflow" && (
              <div className="dark-panel p-4">
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm t-dark-muted">Project status
                    <select value={selectedProject.status} onChange={(event) => void saveProjectField(selectedProject.id, { status: event.target.value as Project["status"] })} className="mt-1 w-full dark-chip px-3 py-2">
                      {(["Planning", "In Development", "Research", "Testing", "Deployment", "Completed", "Blocked", "On Hold", "Cancelled"] as const).map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </label>
                  <label className="text-sm t-dark-muted">Workflow stage
                    <select value={selectedProject.currentPhase} onChange={(event) => void saveProjectField(selectedProject.id, { currentPhase: event.target.value as Project["currentPhase"] })} className="mt-1 w-full dark-chip px-3 py-2">
                      {(["IDEA", "PLANNING", "RESEARCH", "DEVELOPMENT", "TESTING", "DEPLOYMENT", "MAINTENANCE", "COMPLETED", "BLOCKED", "ON_HOLD", "CANCELLED"] as const).map((stage) => <option key={stage}>{stage}</option>)}
                    </select>
                  </label>
                </div>
                <form key={`deployment-${selectedProject.id}`} onSubmit={(event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  const url = String(formData.get("deploymentUrl") ?? "").trim();
                  void saveProjectField(selectedProject.id, { demoUrl: url || null });
                }} className="mb-4 rounded-xl dark-inset p-3">
                  <label htmlFor="project-deployment-url" className="block text-sm t-dark-muted">Deployment / live-demo URL</label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input id="project-deployment-url" name="deploymentUrl" type="url" defaultValue={selectedProject.links.live ?? ""} placeholder="https://example.com" className="min-w-0 flex-1 dark-chip px-3 py-2 text-sm" />
                    <button type="submit" className="ink-button primary px-3 py-2 text-sm">Save deployment URL</button>
                  </div>
                  {!deploymentStageReached && <p className="mt-2 text-xs t-dark-muted">Set the workflow stage to Deployment or later when the project reaches that point.</p>}
                </form>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    "PLANNING",
                    "RESEARCH",
                    "DEVELOPMENT",
                    "TESTING",
                    "DEPLOYMENT",
                    "MAINTENANCE",
                    "COMPLETED",
                  ].map((stage) => (
                    <div key={stage} className={`rounded-xl border p-3 ${selectedProject.currentPhase === stage ? "mood-peach" : "dark-inset"}`}>
                      <p className="eyebrow t-dark-soft">{stage}</p>
                      <p className="mt-3 text-sm t-dark-soft">{selectedProject.currentPhase === stage ? "Current stage" : "Next milestone"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {projectTab === "Tasks" && (
              <div className="space-y-3 dark-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold t-dark">{projectTaskFilter === "testing" ? "Testing tasks" : "Project tasks"}</h3>
                  <div className="flex flex-wrap gap-2">
                    {projectTaskFilter === "testing" && <button type="button" onClick={() => setProjectTaskFilter("all")} className="dark-chip px-3 py-2 text-sm">Show all tasks</button>}
                    <button type="button" onClick={projectTaskFilter === "testing" ? handleCreateTestingTask : handleCreateTask} className="ink-button primary px-3 py-2 text-sm">{projectTaskFilter === "testing" ? "Add testing task" : "Add task"}</button>
                  </div>
                </div>
                {visibleProjectTasks.length > 0 ? visibleProjectTasks.map((task) => (
                  <div key={task.id} className="flex items-start justify-between gap-4 dark-inset p-3">
                    <div>
                      <p className="font-medium t-dark">{task.title}</p>
                      <p className="mt-1 text-xs t-dark-muted">{task.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`${priorityColors[task.priority]}`}>{task.priority}</span>
                      <button type="button" onClick={() => handleEditTask(task)} className="dark-chip px-2 py-1 text-xs">Edit</button>
                      <select
                        value={task.status}
                        onChange={(event) => updateTaskStatus(task.id, event.target.value as Task["status"])}
                        className="dark-chip px-2 py-1 text-xs"
                      >
                        {taskColumns.map((column) => (
                          <option key={column} value={column}>{column}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )) : <div className="rounded-xl dark-inset p-3 text-sm t-dark-muted">{projectTaskFilter === "testing" ? "No testing tasks yet." : "No tasks linked to this project yet."}</div>}
              </div>
            )}

            {projectTab === "Milestones" && (
              <div className="space-y-3 dark-panel p-4">
                <button type="button" onClick={() => handleCreateMilestone(selectedProject.id)} className="ink-button primary px-3 py-2 text-sm">Add milestone</button>
                {projectMilestonesList.map((milestone) => (
                  <div key={milestone.id} className="flex items-center justify-between dark-inset p-3">
                    <div>
                      <p className="font-medium t-dark">{milestone.title}</p>
                      <p className="mt-1 text-xs t-dark-muted">Target: {formatDisplayDate(milestone.targetDate)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={milestone.status} onChange={(event) => void changeMilestoneStatus(milestone, event.target.value as Milestone["status"])} className="dark-chip px-2 py-1 text-xs">
                        {(["pending", "active", "completed"] as const).map((status) => <option key={status}>{status}</option>)}
                      </select>
                      <button type="button" onClick={() => handleEditMilestone(milestone)} className="dark-chip px-2 py-1 text-xs">Edit</button>
                      <button type="button" onClick={() => void removeMilestone(milestone.id)} className="dark-chip p-1.5"><X size={13} /></button>
                    </div>
                  </div>
                ))}
                {projectMilestonesList.length === 0 && <p className="t-dark-muted">No milestones for this project yet.</p>}
              </div>
            )}

            {projectTab === "Screenshots" && (
              authStatus === "authenticated" && workspaceStatus === "ready"
                ? <ProjectScreenshots
                    projectId={selectedProject.id}
                    screenshots={projectScreenshots}
                    loading={projectScreenshotsLoading}
                    loadError={projectScreenshotsError}
                    onChange={(nextScreenshots) => setProjectScreenshotsState({ projectId: selectedProject.id, screenshots: nextScreenshots, error: "" })}
                    onRefresh={() => refreshProjectScreenshots(selectedProject.id)}
                  />
                : <div className="dark-panel p-4 text-sm t-dark-muted"><h3 className="text-lg font-semibold t-dark">Project screenshots</h3><p className="mt-2">Sign in to manage screenshots that persist to your workspace.</p></div>
            )}

            {projectTab === "GitHub" && <GithubRepositoryBrowser projects={projects} projectId={selectedProject.id} tasks={tasks} milestones={milestones} plans={plans} showAccountability={authStatus === "authenticated" && workspaceStatus === "ready"} onLinked={() => window.location.reload()} />}
          </div>
        )}
      </div>
    );
  };

  const renderProjectsPage = () => (
    <div className="space-y-6">
      <div className="dark-panel p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow t-mood">Portfolio workspace</p>
            <h2 className="mt-2 text-2xl font-semibold t-dark">Projects</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleCreateProject} className="ink-button primary px-3 py-2 text-sm"><Plus size={14} className="mr-1 inline" /> New project</button>
            {(["grid", "list", "kanban"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setProjectView(view)}
                className={`soft-pill px-3 py-1.5 text-xs ${projectView === view ? "is-selected" : "t-dark-muted"}`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          {projectView === "grid" && (
            <div className="grid gap-4 md:grid-cols-2">{projects.map(renderProjectCard)}{projects.length === 0 && <div className="dark-panel p-5 text-sm t-dark-muted">No projects yet. Create a project to start your workspace.</div>}</div>
          )}

          {projectView === "list" && (
            <div className="space-y-3 dark-panel p-3">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => openProjectDetail(project)}
                  className="flex w-full flex-col gap-2 dark-inset p-3 text-left md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-medium t-dark">{project.name}</p>
                    <p className="text-xs t-dark-muted">{project.type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${statusColors[project.status]}`}>{project.status}</span>
                    <span className="text-sm t-dark-muted">{project.progress}%</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {projectView === "kanban" && (
            <div className="grid gap-4 xl:grid-cols-3">
              {workflowStages.map((stage) => (
                <div key={stage} className="dark-panel p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium t-dark">{stage}</h3>
                    <span className="dark-chip px-2 py-1">
                      {projects.filter((project) => project.currentPhase === (stage === "Development" ? "DEVELOPMENT" : stage === "Planning" ? "PLANNING" : stage === "Research" ? "RESEARCH" : stage === "Testing" ? "TESTING" : stage === "Deployment" ? "DEPLOYMENT" : stage === "Maintenance" ? "MAINTENANCE" : "COMPLETED")).length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {projects
                      .filter((project) => project.currentPhase === (stage === "Development" ? "DEVELOPMENT" : stage === "Planning" ? "PLANNING" : stage === "Research" ? "RESEARCH" : stage === "Testing" ? "TESTING" : stage === "Deployment" ? "DEPLOYMENT" : stage === "Maintenance" ? "MAINTENANCE" : "COMPLETED"))
                      .map((project) => (
                        <button key={project.id} type="button" onClick={() => openProjectDetail(project)} className="w-full dark-inset p-3 text-left">
                          <p className="text-sm font-medium t-dark">{project.name}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] t-dark-muted">{project.progress}%</p>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>{renderProjectDetail()}</div>
      </div>
    </div>
  );

  const renderTasksPage = () => (
    <div className="space-y-6">
      <div className="dark-panel p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow t-mood">Execution</p>
            <h2 className="mt-2 text-2xl font-semibold t-dark">Task management</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleCreateTask} className="ink-button primary px-3 py-2 text-sm"><Plus size={14} className="mr-1 inline" /> New task</button>
            {(["list", "kanban", "today", "upcoming"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setTaskView(view)}
                className={`soft-pill px-3 py-1.5 text-xs ${taskView === view ? "is-selected" : "t-dark-muted"}`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>
      </div>

      {taskView === "kanban" && (
        <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-7">
          {taskColumns.map((column) => (
            <div key={column} className="dark-panel p-3">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium t-dark">{column}</h3>
                <span className="dark-chip px-2 py-1">{tasks.filter((task) => task.status === column).length}</span>
              </div>
              <div className="space-y-2">
                {tasks.filter((task) => task.status === column).map((task) => (
                  <div key={task.id} className="dark-inset p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium t-dark">{task.title}</p>
                      <button type="button" onClick={() => toggleTaskComplete(task.id)} className="text-xs text-[var(--ink-green)]">{task.status === "Completed" ? "Done" : "Done?"}</button>
                    </div>
                    <p className="mt-2 text-[11px] t-dark-muted">{projects.find((project) => project.id === task.projectId)?.name}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`${priorityColors[task.priority]}`}>{task.priority}</span>
                      <span className="dark-chip px-2 py-1">{task.tags[0] ?? "Work"}</span>
                    </div>
                    <select aria-label={`Move ${task.title}`} value={task.status} onChange={(event) => updateTaskStatus(task.id, event.target.value as Task["status"])} className="mt-3 w-full dark-chip px-2 py-1 text-xs">
                      {taskColumns.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {tasks.length === 0 && <p className="text-sm t-dark-muted">No tasks yet. Add a project before creating a task.</p>}
        </div>
      )}

      {taskView === "list" && (
        <div className="space-y-3 dark-panel p-4">
          {tasks.length === 0 && <p className="text-sm t-dark-muted">No tasks yet. Add a project before creating a task.</p>}
          {tasks.map((task) => (
            <div key={task.id} className="flex flex-col gap-3 dark-inset p-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium t-dark">{task.title}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] t-dark-muted">
                  <span>{projects.find((project) => project.id === task.projectId)?.name}</span>
                  <span>•</span>
                  <span>{formatDisplayDate(task.dueDate)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`${priorityColors[task.priority]}`}>{task.priority}</span>
                <select
                  value={task.status}
                  onChange={(event) => updateTaskStatus(task.id, event.target.value as Task["status"])}
                  className="rounded-lg border dark-inset px-2 py-1 text-xs t-dark-soft"
                >
                  {taskColumns.map((column) => <option key={column} value={column}>{column}</option>)}
                </select>
                <button type="button" onClick={() => handleDeleteTask(task.id)} className="dark-chip p-1.5 hover:text-[var(--accent-coral)]"><X size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderPlansPage = () => (
    <div className="space-y-6">
      <div className="flex justify-end"><button type="button" onClick={handleCreatePlan} className="ink-button primary px-3 py-2 text-sm"><Plus size={14} className="mr-1 inline" /> New plan</button></div>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => {
          const doneCount = plan.tasks.filter((task) => task.done).length;
          const total = plan.tasks.length;
          const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
          return (
            <div key={plan.id} className="dark-panel p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold t-dark">{plan.title}</h3>
                <span className="dark-chip px-2 py-1">{percent}%</span>
              </div>
              <p className="mt-3 text-sm t-dark-muted">{plan.goal}</p>
              <p className="mt-3 eyebrow t-dark-soft">Deadline: {formatDisplayDate(plan.deadline)}</p>
              <div className="progress-track mt-4 h-2">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="mt-4 space-y-2">
                {plan.tasks.map((item) => (
                  <div key={item.id ?? item.label} className="flex items-center gap-2 text-sm t-dark-soft">
                    <input type="checkbox" checked={item.done} disabled={!item.id} onChange={(event) => item.id && void togglePlanItem(plan.id, item.id, event.target.checked)} />
                    <span className={item.done ? "text-[var(--ink-green)]" : "text-[var(--text-light-soft)]"}>{item.label}</span>
                    {item.id && <button type="button" onClick={() => void removePlanItem(plan.id, item.id!)} className="ml-auto dark-chip p-1"><X size={12} /></button>}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => handleEditPlan(plan)} className="dark-chip px-2 py-1 text-xs">Edit</button>
                <select value={plan.status ?? "Planning"} onChange={(event) => void changePlanStatus(plan.id, event.target.value as NonNullable<Plan["status"]>)} className="dark-chip px-2 py-1 text-xs">
                  {(["Planning", "Active", "Paused", "Completed", "Cancelled"] as const).map((status) => <option key={status}>{status}</option>)}
                </select>
                <button type="button" onClick={() => void addPlanItem(plan.id)} className="dark-chip px-2 py-1 text-xs">Add step</button>
                <button type="button" onClick={() => void removePlan(plan.id)} className="dark-chip px-2 py-1 text-xs">Delete</button>
              </div>
            </div>
          );
        })}
        {plans.length === 0 && <p className="dark-panel p-4 text-sm t-dark-muted">No plans yet.</p>}
      </div>
    </div>
  );

  const renderGitHubPage = () => (
    <GithubRepositoryBrowser projects={projects} onLinked={() => window.location.reload()} />
  );

  const renderCareerPage = () => (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="dark-panel p-4">
          <h3 className="text-lg font-semibold t-dark">Job applications</h3>
          <div className="mt-4 space-y-3">
            {jobApplications.map((item) => (
              <div key={item.id} className="dark-inset p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium t-dark">{item.company}</p>
                  <span className="dark-chip px-2 py-1">{item.status}</span>
                </div>
                <p className="mt-2 text-sm t-dark-muted">{item.role}</p>
                <p className="mt-2 text-xs t-dark-muted">Applied: {formatDisplayDate(item.date)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="dark-panel p-4">
          <h3 className="text-lg font-semibold t-dark">Freelance pipeline</h3>
          <div className="mt-4 space-y-3">
            {freelanceLeads.map((lead) => (
              <div key={lead.id} className="dark-inset p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium t-dark">{lead.company}</p>
                  <span className="dark-chip px-2 py-1">{lead.status}</span>
                </div>
                <p className="mt-2 text-sm t-dark-muted">{lead.projectIdea}</p>
                <p className="mt-2 text-xs t-dark-muted">Budget: {lead.budget}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderKnowledgePage = () => {
    const visibleNotes = noteProjectFilter ? notes.filter((note) => note.projectId === noteProjectFilter) : notes;
    const documentationProject = projects.find((project) => project.id === noteProjectFilter);
    return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="dark-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-semibold t-dark">{documentationProject ? `${documentationProject.name} documentation` : "Notes"}</h3>{documentationProject && <p className="mt-1 text-xs t-dark-muted">Project documentation and notes</p>}</div><div className="flex flex-wrap gap-2">{documentationProject && <button type="button" onClick={() => setNoteProjectFilter("")} className="dark-chip px-3 py-2 text-sm">All notes</button>}<button type="button" onClick={() => documentationProject ? setNoteEditor({ title: "Documentation", content: "", projectId: documentationProject.id }) : handleCreateNote()} className="ink-button primary px-3 py-2 text-sm"><Plus size={14} className="mr-1 inline" /> {documentationProject ? "Add documentation" : "New note"}</button></div></div>
          <div className="mt-4 space-y-3">
            {visibleNotes.map((note) => (
              <div key={note.id} className="dark-inset p-3">
                <div className="flex items-start justify-between gap-2"><p className="font-medium t-dark">{note.title}</p><div className="flex gap-1"><button type="button" onClick={() => handleEditNote(note)} className="dark-chip px-2 py-1 text-xs">Edit</button><button type="button" onClick={() => void removeNote(note.id)} className="dark-chip p-1.5"><X size={13} /></button></div></div>
                <p className="mt-2 text-sm t-dark-muted">{note.content}</p>
              </div>
            ))}
            {visibleNotes.length === 0 && <div className="rounded-xl dark-inset p-3 text-sm t-dark-muted">{documentationProject ? "No documentation yet." : "No notes yet."} Use the action above to add one.</div>}
          </div>
        </div>

        <div className="dark-panel p-4">
          <h3 className="text-lg font-semibold t-dark">Learning</h3>
          <div className="mt-4 space-y-3">
            {learningItems.map((item) => (
              <div key={item.id} className="dark-inset p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium t-dark">{item.topic}</p>
                  <span className="dark-chip px-2 py-1">{item.status}</span>
                </div>
                <p className="mt-2 text-sm t-dark-muted">{item.why}</p>
                <p className="mt-2 text-[11px] t-dark-muted">Related project: {item.relatedProject}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    );
  };

  const renderTechPage = () => (
    <div className="space-y-4">
      <form onSubmit={(event) => void handleTechnologySave(event)} className="dark-panel flex flex-col gap-2 p-4 sm:flex-row">
        <input value={technologyName} onChange={(event) => setTechnologyName(event.target.value)} required placeholder="Technology name" className="dark-chip min-w-0 flex-1 px-3 py-2 text-sm" />
        <select value={technologyProjectId} onChange={(event) => setTechnologyProjectId(event.target.value)} className="dark-chip px-3 py-2 text-sm">
          <option value="">Create without linking</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button type="submit" className="ink-button primary px-3 py-2 text-sm">Add technology</button>
      </form>
      <div className="dark-panel flex items-center gap-2 p-3"><label htmlFor="technology-project" className="text-sm t-dark-muted">Manage links for</label><select id="technology-project" value={technologyProjectId} onChange={(event) => setTechnologyProjectId(event.target.value)} className="dark-chip px-3 py-2 text-sm"><option value="">Choose a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {technologies.map((technology) => (
        <div key={technology.id} className="dark-panel p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-lg font-semibold t-dark">{technology.name}</p>
            <span className="dark-chip px-2 py-1">{technology.category}</span>
          </div>
          <p className="mt-3 text-sm t-dark-muted">{technology.summary}</p>
          <div className="mt-4 space-y-2 text-sm t-dark-muted">
            <div>Used in: {technology.usedIn.join(", ")}</div>
            {technologyProjectId && <button type="button" onClick={() => void handleTechnologyLink(technology.id, technology.usedIn.includes(projects.find((project) => project.id === technologyProjectId)?.name ?? "") ? "detach" : "attach")} className="dark-chip px-2 py-1 text-xs">{technology.usedIn.includes(projects.find((project) => project.id === technologyProjectId)?.name ?? "") ? "Remove from project" : "Attach to project"}</button>}
          </div>
        </div>
      ))}
      {technologies.length === 0 && <p className="dark-panel p-4 text-sm t-dark-muted">No technologies yet.</p>}
      </div>
    </div>
  );

  const renderSettingsPage = () => (
    <div className="dark-panel p-6">
      <h2 className="text-2xl font-semibold t-dark">Workspace settings</h2>
      <p className="mt-2 t-dark-muted">Your account is verified by Supabase Auth. Authenticated workspace data is stored in Supabase; local browser storage is used only by the unauthenticated prototype.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="dark-inset p-4">
          <p className="text-sm font-medium t-dark">Data storage</p>
          <p className="mt-2 text-sm t-dark-muted">{authStatus === "authenticated" ? "Supabase is the source of truth for this signed-in workspace." : "Prototype workspace data is stored in this browser."}</p>
        </div>
        <div className="dark-inset p-4">
          <p className="text-sm font-medium t-dark">Phase boundaries</p>
          <p className="mt-2 text-sm t-dark-muted">GitHub activity is read-only. Accountability results stay in your authenticated private workspace.</p>
        </div>
      </div>
      <button type="button" onClick={() => void handleSignOut()} className="mt-4 ink-button coral px-3 py-2 text-sm">Sign out</button>
      {signOutError && <p role="alert" className="mt-3 text-sm text-[var(--accent-peach)]">{signOutError}</p>}
    </div>
  );

  const renderPage = () => {
    switch (activeView) {
      case "today":
        return renderTodayPage();
      case "projects":
        return renderProjectsPage();
      case "tasks":
        return renderTasksPage();
      case "plans":
        return renderPlansPage();
      case "github":
        return renderGitHubPage();
      case "applications":
      case "freelance":
        return renderCareerPage();
      case "notes":
      case "learning":
        return renderKnowledgePage();
      case "tech":
        return renderTechPage();
      case "settings":
        return renderSettingsPage();
      default:
        return renderDashboard();
    }
  };

  return (
    <div className="app-shell min-h-screen text-[var(--ink)]">
      <div className="mx-auto flex max-w-[1700px]">
        <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"} workspace-sidebar fixed inset-y-0 left-0 z-40 w-72 p-4 transition duration-200 lg:static lg:w-72`}>
          <div className="flex items-center justify-between border-b border-[var(--edge-cream)] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--edge-cream)] bg-[var(--lavender)] text-[var(--ink-lavender)]"><Code2 size={20} /></div>
              <div>
                <p className="nav-label">Workspace</p>
                <p className="font-semibold text-[var(--text-desk)]">Dev Office</p>
              </div>
            </div>
            <button type="button" onClick={() => setSidebarOpen(false)} className="rounded-xl border border-[var(--edge-cream)] p-1.5 text-[var(--text-desk-muted)] lg:hidden">
              <X size={14} />
            </button>
          </div>

          <div className="mt-6 space-y-6">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p className="nav-label mb-2">{group.label}</p>
                <div className="space-y-1.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeView === item.key;
                    const unavailable = unavailableViews.has(item.key as ViewName);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={unavailable}
                        title={unavailable ? `${item.label} is not available in this phase.` : undefined}
                        onClick={() => {
                          setActiveView(item.key as ViewName);
                          setSidebarOpen(false);
                        }}
                        className={`nav-item px-3 py-2.5 text-left text-sm ${active ? "active" : ""}`}
                      >
                        <Icon size={15} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex-1">
          <header className="workspace-header sticky top-0 z-20 px-4 py-3 lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setSidebarOpen(true)} className="rounded-xl border border-[var(--edge-cream)] bg-[var(--surface-cream)] p-2 text-[var(--text-desk)] lg:hidden">
                  <Menu size={16} />
                </button>
                <div className="hidden items-center gap-2 rounded-2xl border border-[var(--edge-cream)] bg-[var(--surface-cream)] px-3 py-2 text-sm text-[var(--text-desk-muted)] md:flex">
                  <Search size={14} />
                  <span>Search workspace</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSearchOpen(true)} className="rounded-xl border border-[var(--edge-cream)] bg-[var(--surface-cream)] p-2 text-[var(--text-desk)]">
                  <Search size={15} />
                </button>
                <button type="button" disabled title="Notifications are not available yet." className="rounded-xl border border-[var(--edge-cream)] bg-[var(--surface-cream)] p-2 text-[var(--text-desk)]">
                  <Bell size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setThemeMode((current) => current === "light" ? "dark" : current === "dark" ? "system" : "light")}
                  className="rounded-xl border border-[var(--edge-cream)] bg-[var(--surface-cream)] p-2 text-[var(--text-desk)]"
                  aria-label="Toggle theme"
                  title={`Theme: ${themeMode}`}
                >
                  {themeMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                <Link href="/view" className="rounded-xl border border-[var(--edge-cream)] bg-[var(--surface-cream)] px-3 py-2 text-sm font-medium text-[var(--text-desk)]">Public View</Link>
                <UserMenu onOpenSettings={() => setActiveView("settings")} />
              </div>
            </div>
          </header>

          <main className="p-4 lg:p-6">
            {workspaceStatus === "checking" && <div className="mb-4 dark-panel px-4 py-3 text-sm t-dark-muted">Loading your workspace...</div>}
            {workspaceStatus === "error" && <div className="mb-4 dark-panel border-[var(--accent-peach-solid)] px-4 py-3 text-sm t-dark-muted">{workspaceError}</div>}
            {workspaceStatus === "mock" && <div className="mb-4 dark-panel px-4 py-3 text-sm t-dark-muted">Prototype mode: showing local workspace data. Sign in with GitHub to sync with Supabase.</div>}
            {workspaceError && workspaceStatus !== "error" && <div role="alert" className="mb-4 flex items-center justify-between gap-3 dark-panel border-[var(--accent-peach-solid)] px-4 py-3 text-sm t-dark-muted">{workspaceError}<button type="button" onClick={() => setWorkspaceError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
            {((authStatus === "authenticated" && workspaceStatus === "ready" && workspaceUserId === user?.id) || (authStatus === "unauthenticated" && workspaceStatus === "mock")) && renderPage()}
          </main>
        </div>
      </div>

      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--scrim)] p-4 pt-20 backdrop-blur-sm">
          <div className="w-full max-w-2xl dark-panel p-4 shadow-[var(--shadow-dark-lift)]">
            <div className="flex items-center gap-3 dark-inset p-3">
              <Search size={15} className="t-dark-muted" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search projects, tasks, plans, notes..."
                className="w-full bg-transparent text-sm t-dark placeholder:text-[var(--text-light-soft)] focus:outline-none"
                autoFocus
              />
              <button type="button" onClick={() => setSearchOpen(false)} className="t-dark-muted hover:text-[var(--ink)]"><X size={15} /></button>
            </div>

            <div className="mt-4 space-y-2">
              {searchResults.length > 0 ? (
                searchResults.map((result) => (
                  <button
                    key={`${result.kind}-${result.id}`}
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchQuery("");
                      setActiveView(result.kind === "Project" ? "projects" : result.kind === "Task" ? "tasks" : result.kind === "Plan" ? "plans" : "notes");
                    }}
                    className="flex w-full items-center justify-between dark-inset p-3 text-left hover:border-[var(--accent-peach)]"
                  >
                    <div>
                      <p className="text-sm font-medium t-dark">{result.label}</p>

                      <p className="text-[10px] uppercase tracking-[0.18em] t-dark-muted">{result.kind}</p>
                    </div>
                    <span className="text-xs t-dark-muted">{result.meta}</span>
                  </button>
                ))
              ) : (
                <div className="dark-inset border-dashed p-6 text-center text-sm t-dark-muted">
                  No matches. Try another keyword.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {privateProjectConfirmation && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="private-project-title" className="dark-panel w-full max-w-md p-5 shadow-[var(--shadow-dark-lift)]">
            <p className="eyebrow t-mood">Project visibility</p>
            <h2 id="private-project-title" className="mt-2 text-xl font-semibold t-dark">Make this project private?</h2>
            <p className="mt-3 text-sm leading-6 t-dark-muted">It will no longer be accessible from your public portfolio or existing shared links.</p>
            {workspaceError && <p role="alert" className="mt-3 text-sm text-[var(--accent-peach)]">{workspaceError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setPrivateProjectConfirmation(null); setWorkspaceError(""); }} disabled={isSavingVisibility} className="dark-chip px-3 py-2 text-sm">Cancel</button>
              <button type="button" onClick={() => void saveProjectVisibility(privateProjectConfirmation, "Private")} disabled={isSavingVisibility} className="ink-button coral px-3 py-2 text-sm">{isSavingVisibility ? "Saving..." : "Make Private"}</button>
            </div>
          </div>
        </div>
      )}

      {(projectEditor || taskEditor || planEditor || milestoneEditor || noteEditor) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-sm">
          <div className="dark-panel max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5 shadow-[var(--shadow-dark-lift)]">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold t-dark">{projectEditor ? `${projectEditor.id ? "Edit" : "New"} project` : taskEditor ? `${taskEditor.id ? "Edit" : "New"} task` : planEditor ? `${planEditor.id ? "Edit" : "New"} plan` : milestoneEditor ? `${milestoneEditor.id ? "Edit" : "New"} milestone` : `${noteEditor?.id ? "Edit" : "New"} note`}</h2><button type="button" onClick={closeWorkspaceEditor} className="dark-chip p-2" aria-label="Close editor" disabled={isSavingEditor}><X size={15} /></button></div>
            {workspaceError && <p role="alert" className="mb-3 text-sm text-[var(--accent-peach)]">{workspaceError}</p>}
            {projectEditor && <form onSubmit={(event) => void saveProject(event)} className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm t-dark-muted">Title<input autoFocus required value={projectEditor.name} onChange={(event) => setProjectEditor({ ...projectEditor, name: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted">Type<input value={projectEditor.type} onChange={(event) => setProjectEditor({ ...projectEditor, type: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted sm:col-span-2">Description<textarea value={projectEditor.description} onChange={(event) => setProjectEditor({ ...projectEditor, description: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" rows={2} /></label>
              <label className="text-sm t-dark-muted">Status<select value={projectEditor.status} onChange={(event) => setProjectEditor({ ...projectEditor, status: event.target.value as Project["status"] })} className="mt-1 w-full dark-chip px-3 py-2">{(["Planning", "In Development", "Research", "Testing", "Deployment", "Completed", "Blocked", "On Hold", "Cancelled"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="text-sm t-dark-muted">Workflow stage<select value={projectEditor.currentPhase} onChange={(event) => setProjectEditor({ ...projectEditor, currentPhase: event.target.value as Project["currentPhase"] })} className="mt-1 w-full dark-chip px-3 py-2">{(["IDEA", "PLANNING", "RESEARCH", "DEVELOPMENT", "TESTING", "DEPLOYMENT", "MAINTENANCE", "COMPLETED", "BLOCKED", "ON_HOLD", "CANCELLED"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="text-sm t-dark-muted">Priority<select value={projectEditor.priority} onChange={(event) => setProjectEditor({ ...projectEditor, priority: event.target.value as ProjectEditorState["priority"] })} className="mt-1 w-full dark-chip px-3 py-2">{(["Low", "Medium", "High", "Critical"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="text-sm t-dark-muted">Role<input value={projectEditor.role} onChange={(event) => setProjectEditor({ ...projectEditor, role: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted">Team size<input type="number" min="1" value={projectEditor.teamSize} onChange={(event) => setProjectEditor({ ...projectEditor, teamSize: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted">Start date<input type="date" value={projectEditor.startDate} onChange={(event) => setProjectEditor({ ...projectEditor, startDate: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted">Target date<input type="date" value={projectEditor.targetDate} onChange={(event) => setProjectEditor({ ...projectEditor, targetDate: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted sm:col-span-2">Objective<textarea value={projectEditor.objective} onChange={(event) => setProjectEditor({ ...projectEditor, objective: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" rows={2} /></label>
              <label className="text-sm t-dark-muted sm:col-span-2">Next action<input value={projectEditor.nextAction} onChange={(event) => setProjectEditor({ ...projectEditor, nextAction: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={closeWorkspaceEditor} disabled={isSavingEditor} className="dark-chip px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={isSavingEditor} className="ink-button primary px-3 py-2 text-sm">{isSavingEditor ? "Saving..." : "Save project"}</button></div>
            </form>}
            {taskEditor && <form onSubmit={(event) => void saveTask(event)} className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm t-dark-muted sm:col-span-2">Title<input autoFocus required value={taskEditor.title} onChange={(event) => setTaskEditor({ ...taskEditor, title: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted sm:col-span-2">Description<textarea value={taskEditor.description} onChange={(event) => setTaskEditor({ ...taskEditor, description: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" rows={3} /></label>
              <label className="text-sm t-dark-muted">Project<select value={taskEditor.projectId} onChange={(event) => setTaskEditor({ ...taskEditor, projectId: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="text-sm t-dark-muted">Status<select value={taskEditor.status} onChange={(event) => setTaskEditor({ ...taskEditor, status: event.target.value as Task["status"] })} className="mt-1 w-full dark-chip px-3 py-2">{taskColumns.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="text-sm t-dark-muted">Priority<select value={taskEditor.priority} onChange={(event) => setTaskEditor({ ...taskEditor, priority: event.target.value as Task["priority"] })} className="mt-1 w-full dark-chip px-3 py-2">{(["Low", "Medium", "High", "Critical"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="text-sm t-dark-muted">Due date<input type="date" value={taskEditor.dueDate} onChange={(event) => setTaskEditor({ ...taskEditor, dueDate: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={closeWorkspaceEditor} disabled={isSavingEditor} className="dark-chip px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={isSavingEditor} className="ink-button primary px-3 py-2 text-sm">{isSavingEditor ? "Saving..." : "Save task"}</button></div>
            </form>}
            {planEditor && <form onSubmit={(event) => void savePlan(event)} className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm t-dark-muted sm:col-span-2">Title<input autoFocus required value={planEditor.title} onChange={(event) => setPlanEditor({ ...planEditor, title: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted sm:col-span-2">Goal<textarea value={planEditor.goal} onChange={(event) => setPlanEditor({ ...planEditor, goal: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" rows={2} /></label>
              <label className="text-sm t-dark-muted">Status<select value={planEditor.status} onChange={(event) => setPlanEditor({ ...planEditor, status: event.target.value as PlanEditorState["status"] })} className="mt-1 w-full dark-chip px-3 py-2">{(["Planning", "Active", "Paused", "Completed", "Cancelled"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="text-sm t-dark-muted">Deadline<input type="date" value={planEditor.deadline} onChange={(event) => setPlanEditor({ ...planEditor, deadline: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              {!planEditor.id && <label className="text-sm t-dark-muted sm:col-span-2">Checklist items, one per line<textarea value={planEditor.items} onChange={(event) => setPlanEditor({ ...planEditor, items: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" rows={3} /></label>}
              <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={closeWorkspaceEditor} disabled={isSavingEditor} className="dark-chip px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={isSavingEditor} className="ink-button primary px-3 py-2 text-sm">{isSavingEditor ? "Saving..." : "Save plan"}</button></div>
            </form>}
            {milestoneEditor && <form onSubmit={(event) => void saveMilestone(event)} className="grid gap-3">
              <label className="text-sm t-dark-muted">Title<input autoFocus required value={milestoneEditor.title} onChange={(event) => setMilestoneEditor({ ...milestoneEditor, title: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted">Description<textarea value={milestoneEditor.description} onChange={(event) => setMilestoneEditor({ ...milestoneEditor, description: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" rows={2} /></label>
              <label className="text-sm t-dark-muted">Target date<input type="date" value={milestoneEditor.targetDate} onChange={(event) => setMilestoneEditor({ ...milestoneEditor, targetDate: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <div className="flex justify-end gap-2"><button type="button" onClick={closeWorkspaceEditor} disabled={isSavingEditor} className="dark-chip px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={isSavingEditor} className="ink-button primary px-3 py-2 text-sm">{isSavingEditor ? "Saving..." : "Save milestone"}</button></div>
            </form>}
            {noteEditor && <form onSubmit={(event) => void saveNote(event)} className="grid gap-3">
              <label className="text-sm t-dark-muted">Title<input autoFocus required value={noteEditor.title} onChange={(event) => setNoteEditor({ ...noteEditor, title: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" /></label>
              <label className="text-sm t-dark-muted">Project<select value={noteEditor.projectId} onChange={(event) => setNoteEditor({ ...noteEditor, projectId: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2"><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="text-sm t-dark-muted">Note<textarea value={noteEditor.content} onChange={(event) => setNoteEditor({ ...noteEditor, content: event.target.value })} className="mt-1 w-full dark-chip px-3 py-2" rows={5} /></label>
              <div className="flex justify-end gap-2"><button type="button" onClick={closeWorkspaceEditor} disabled={isSavingEditor} className="dark-chip px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={isSavingEditor} className="ink-button primary px-3 py-2 text-sm">{isSavingEditor ? "Saving..." : "Save note"}</button></div>
            </form>}
          </div>
        </div>
      )}

      {githubImportOpen && authStatus === "authenticated" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[var(--scrim)] p-4 backdrop-blur-sm">
          <div className="my-6 w-full max-w-5xl dark-panel p-5 shadow-[var(--shadow-dark-lift)]">
            <GithubRepositoryBrowser projects={projects} onClose={() => setGithubImportOpen(false)} onLinked={() => window.location.reload()} />
          </div>
        </div>
      )}

      {githubImportOpen && authStatus !== "authenticated" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl dark-panel p-5 shadow-[var(--shadow-dark-lift)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow t-mood">Import from GitHub</p>
                <h3 className="mt-2 text-2xl font-semibold t-dark">Repository browser</h3>
              </div>
              <button type="button" onClick={() => setGithubImportOpen(false)} className="dark-chip p-2 hover:text-[var(--ink)]"><X size={15} /></button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {githubRepos.map((repo) => (
                <div key={repo.id} className="dark-inset p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium t-dark">{repo.name}</p>
                    <span className="dark-chip px-2 py-1">{repo.visibility}</span>
                  </div>
                  <p className="mt-2 text-sm t-dark-muted">{repo.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {repo.technologies.map((tech) => (
                      <span key={tech} className="dark-chip px-2 py-1">{tech}</span>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs t-dark-muted">
                    <span>{repo.language}</span>
                    <span>★ {repo.stars}</span>
                  </div>
                  <button type="button" onClick={() => handleImportRepo(repo)} className="mt-4 w-full rounded-xl ink-button primary px-3 py-2 text-sm">
                    Import Repository
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
