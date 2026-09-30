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
  Flame,
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
import { useEffect, useMemo, useState } from "react";
import { buildSeedState } from "@/data/mockData";
import { signInWithGithub, signOut } from "@/data/authService";
import { calculateAccountabilityScore } from "@/data/githubAccountabilityService";
import { loadWorkspaceData, migrateLocalWorkspace } from "@/data/workspaceService";
import { createTask, updateTask } from "@/data/workspaceService";
import { createProject } from "@/data/projectService";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
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

const formatRelativeAge = (value?: string) => {
  if (!value) return "No activity";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
};

export default function Home() {
  const router = useRouter();
  const initialWorkspace = getWorkspaceSnapshot();

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    return savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : "system";
  });
  const [projects, setProjects] = useState<Project[]>(initialWorkspace.projects);
  const [tasks, setTasks] = useState<Task[]>(initialWorkspace.tasks);
  const [plans, setPlans] = useState<Plan[]>(initialWorkspace.plans);
  const [milestones, setMilestones] = useState<Milestone[]>(initialWorkspace.milestones);
  const [activities, setActivities] = useState<ActivityItem[]>(initialWorkspace.activities);
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>(initialWorkspace.githubRepos);
  const [githubActivity] = useState<GithubActivityEvent[]>(initialWorkspace.githubActivity);
  const [jobApplications, setJobApplications] = useState<JobApplication[]>(initialWorkspace.jobApplications);
  const [freelanceLeads, setFreelanceLeads] = useState<FreelanceLead[]>(initialWorkspace.freelanceLeads);
  const [learningItems, setLearningItems] = useState<LearningItem[]>(initialWorkspace.learningItems);
  const [notes, setNotes] = useState<NoteItem[]>(initialWorkspace.notes);
  const [technologies, setTechnologies] = useState<TechnologyItem[]>(initialWorkspace.technologies);
  void setMilestones;
  void setActivities;
  void setGithubRepos;
  void setJobApplications;
  void setFreelanceLeads;
  void setLearningItems;
  void setNotes;
  void setTechnologies;
  const [activeView, setActiveView] = useState<ViewName>("dashboard");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialWorkspace.selectedProjectId);
  const [projectTab, setProjectTab] = useState("Overview");
  const [projectView, setProjectView] = useState<"grid" | "list" | "kanban">("grid");
  const [taskView, setTaskView] = useState<"list" | "kanban" | "today" | "upcoming">("kanban");
  const [searchOpen, setSearchOpen] = useState(false);
  const [githubImportOpen, setGithubImportOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showcaseMode, setShowcaseMode] = useState<"workspace" | "showcase">("workspace");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [focusRunning, setFocusRunning] = useState(false);
  const [publicVisibility, setPublicVisibility] = useState({ score: true, streak: true, commits: false, projects: true, heatmap: false, recent: false, username: false });
  const [githubAuthMessage, setGithubAuthMessage] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState<"checking" | "mock" | "ready" | "error">("checking");
  const [workspaceError, setWorkspaceError] = useState("");
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState("");
  const [hadLocalWorkspace] = useState(() => typeof window !== "undefined" && Boolean(window.localStorage.getItem("developer-workspace-v1")));

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
    let active = true;
    const hydrateWorkspace = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setWorkspaceStatus("mock");
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setWorkspaceStatus("mock");
        return;
      }
      try {
        const remote = await loadWorkspaceData();
        if (!active) return;
        if (remote && remote.projects.length > 0) {
          setProjects(remote.projects);
          setTasks(remote.tasks);
          setMilestones(remote.milestones);
          setPlans(remote.plans);
          setNotes(remote.notes);
          setTechnologies(remote.technologies);
        } else if (hadLocalWorkspace) {
          setMigrationOpen(true);
        }
        setWorkspaceStatus("ready");
      } catch {
        if (!active) return;
        setWorkspaceError("Couldn't load your synced workspace. Showing local data instead.");
        setWorkspaceStatus("error");
      }
    };
    void hydrateWorkspace();
    return () => { active = false; };
  }, [hadLocalWorkspace]);

  const handleMigrateWorkspace = async () => {
    try {
      const result = await migrateLocalWorkspace({ projects, tasks, milestones, plans, notes, technologies });
      if (result.status === "server-has-data") {
        setMigrationMessage("Your server workspace already has data, so nothing was overwritten.");
      } else if (result.status === "migrated") {
        setMigrationMessage(`Imported ${result.projectCount} projects into Supabase.`);
        setMigrationOpen(false);
      } else {
        setMigrationMessage("Supabase is not configured, so the local workspace remains unchanged.");
      }
    } catch {
      setMigrationMessage("The workspace could not be imported. Your local data is still intact.");
    }
  };

  useEffect(() => {
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
  }, [projects, tasks, plans, milestones, activities, githubRepos, githubActivity, jobApplications, freelanceLeads, learningItems, notes, technologies, selectedProjectId]);

  useEffect(() => {
    window.localStorage.setItem("developer-workplace-public-visibility", JSON.stringify(publicVisibility));
  }, [publicVisibility]);

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

  const todayTasks = useMemo(
    () => tasks.filter((task) => task.status !== "Completed").slice(0, 4),
    [tasks],
  );

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

  const accountability = useMemo(() => calculateAccountabilityScore(projects, githubActivity), [projects, githubActivity]);

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

  const sharePublicProject = (projectId: string) => {
    const url = `/view/project/${projectId}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleCreateProject = () => {
    const project: Project = {
      id: makeId("proj"),
      name: "New Product Sprint",
      description: "Explore the next milestone, customer value, and delivery path for a fresh software prototype.",
      type: "Personal",
      status: "Planning",
      progress: 12,
      currentPhase: "PLANNING",
      objective: "Define the sprint outcome and track the earliest release-ready milestone.",
      role: "Product builder",
      startDate: new Date().toISOString(),
      targetDate: getFutureDate(30),
      nextAction: "Confirm problem framing and deliver the first milestone",
      technologies: ["Next.js", "TypeScript"],
      lastUpdated: new Date().toISOString(),
      githubConnected: false,
      health: {
        documentation: false,
        screenshots: false,
        github: false,
        testing: false,
        deployment: false,
      },
      links: {},
    };
    setProjects((current) => [project, ...current]);
    setSelectedProjectId(project.id);
    setActiveView("projects");
    void createProject(project).then((savedProject) => {
      if (savedProject.id !== project.id) setProjects((current) => current.map((item) => item.id === project.id ? savedProject : item));
    }).catch(() => undefined);
  };

  const handleCreateTask = () => {
    const task: Task = {
      id: makeId("task"),
      title: "New task for the current project",
      description: "Capture the next important action for this sprint.",
      projectId: selectedProject?.id ?? "autocare",
      status: "Planned",
      priority: "Medium",
      dueDate: getFutureDate(1),
      tags: ["prototype"],
      createdAt: new Date().toISOString(),
    };
    setTasks((current) => [task, ...current]);
    setActiveView("tasks");
    void createTask(task).then((savedTask) => {
      if (savedTask.id !== task.id) setTasks((current) => current.map((item) => item.id === task.id ? savedTask : item));
    }).catch(() => undefined);
  };

  const handleCreatePlan = () => {
    const plan: Plan = {
      id: makeId("plan"),
      title: "Next milestone plan",
      goal: "Define the next significant objective for your current work cycle.",
      deadline: getFutureDate(12),
      tasks: [
        { label: "Define scope", done: false },
        { label: "Ship the first proof", done: false },
      ],
    };
    setPlans((current) => [plan, ...current]);
    setActiveView("plans");
  };

  const handleImportRepo = (repo: GithubRepo) => {
    const newProject: Project = {
      id: makeId("proj"),
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

  const updateTaskStatus = (taskId: string, nextStatus: Task["status"]) => {
    const currentTask = tasks.find((task) => task.id === taskId);
    if (!currentTask) return;
    const updatedTask = { ...currentTask, status: nextStatus, completedAt: nextStatus === "Completed" ? new Date().toISOString() : undefined };
    setTasks((current) => current.map((task) => task.id === taskId ? updatedTask : task));
    void updateTask(updatedTask).catch(() => setTasks((current) => current.map((task) => task.id === taskId ? currentTask : task)));
  };

  const toggleTaskComplete = (taskId: string) => {
    const currentTask = tasks.find((task) => task.id === taskId);
    if (!currentTask) return;
    const shouldComplete = currentTask.status !== "Completed";
    const updatedTask = { ...currentTask, status: shouldComplete ? "Completed" : "In Progress" as Task["status"], completedAt: shouldComplete ? new Date().toISOString() : undefined };
    setTasks((current) => current.map((task) => task.id === taskId ? updatedTask : task));
    void updateTask(updatedTask).catch(() => setTasks((current) => current.map((task) => task.id === taskId ? currentTask : task)));
  };

  const deleteTask = (taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  };

  const renderAccountability = () => {
    const healthByProject = new Map(accountability.projectHealth.map((item) => [item.projectId, item]));
    const heatmap = Array.from({ length: 30 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (29 - index));
      const key = date.toISOString().slice(0, 10);
      const count = githubActivity.filter((event) => event.meaningful && event.occurredAt.slice(0, 10) === key).length;
      return { key, label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }), count };
    });
    const needsAttention = projects.filter((project) => healthByProject.get(project.id)?.health === "Needs Attention");

    return (
      <section className="dark-panel accountability-panel p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2"><FolderGit2 size={17} className="t-mood" /><p className="eyebrow t-mood">GitHub accountability</p></div>
            <h2 className="mt-2 text-2xl font-semibold t-dark">Build, ship, document, repeat.</h2>
            <p className="mt-1 max-w-2xl text-sm t-dark-muted">A transparent consistency signal, not a measure of programming ability.</p>
          </div>
          <span className="dark-chip px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]">Demo data</span>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="dark-inset p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="eyebrow t-dark-soft">Accountability score</p><p className="mt-2 text-5xl font-semibold t-dark">{accountability.total}<span className="text-xl t-dark-soft"> / 100</span></p></div>
              <div className="sm:text-right"><p className="flex items-center gap-2 text-lg font-semibold t-dark"><Flame size={18} className="text-[var(--accent-peach-solid)]" /> {accountability.currentStreak} day streak</p><p className="mt-1 text-xs t-dark-muted">{accountability.state} · {accountability.activeDaysThisWeek} active days this week</p></div>
            </div>
            <div className="progress-track mt-4 h-2.5"><div className="progress-fill" style={{ width: `${accountability.total}%` }} /></div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {["Consistency", "Maintenance", "New projects", "Documentation", "Momentum"].map((label, index) => {
                const values = [accountability.consistency, accountability.maintenance, accountability.newProjects, accountability.documentation, accountability.momentum];
                const max = [40, 25, 15, 10, 10][index];
                return <div key={label} className="text-xs t-dark-muted"><div className="flex justify-between gap-2"><span>{label}</span><span>{values[index]} / {max}</span></div><div className="progress-track mt-1 h-1.5"><div className="progress-fill" style={{ width: `${(values[index] / max) * 100}%` }} /></div></div>;
              })}
            </div>
          </div>

          <div className="dark-inset p-4">
            <div className="flex items-center justify-between"><p className="eyebrow t-dark-soft">Last 30 days</p><span className="text-xs t-dark-muted">Meaningful activity</span></div>
            <div className="activity-heatmap mt-4" aria-label="GitHub activity heatmap">{heatmap.map((day) => <span key={day.key} title={`${day.label}: ${day.count} meaningful activities`} className={`activity-cell level-${Math.min(day.count, 3)}`} />)}</div>
            <div className="mt-4 flex items-center justify-between text-xs t-dark-muted"><span>Quiet</span><span>Active</span></div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div><p className="text-xl font-semibold t-dark">{accountability.updatedProjects}</p><p className="text-[10px] uppercase tracking-[0.12em] t-dark-soft">Updated</p></div><div><p className="text-xl font-semibold t-dark">{accountability.commits}</p><p className="text-[10px] uppercase tracking-[0.12em] t-dark-soft">Commits</p></div><div><p className="text-xl font-semibold t-dark">{accountability.documentationUpdates}</p><p className="text-[10px] uppercase tracking-[0.12em] t-dark-soft">Docs</p></div></div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_0.9fr]">
          <div><div className="mb-3 flex items-center justify-between"><p className="eyebrow t-dark-soft">Project maintenance</p><span className="text-xs t-dark-muted">{needsAttention.length} need attention</span></div><div className="space-y-2">{projects.slice(0, 4).map((project) => { const item = healthByProject.get(project.id); return <div key={project.id} className="dark-inset flex items-center justify-between gap-3 p-3"><div><p className="text-sm font-medium t-dark">{project.name}</p><p className="mt-1 text-xs t-dark-muted">{item?.health === "Exempt" ? `${project.status} · no penalty` : `${formatRelativeAge(item?.lastActivityAt)} · ${item?.health}`}</p></div><span className={`badge ${item?.health === "Healthy" ? "badge-completed" : item?.health === "Needs Attention" ? "badge-development" : item?.health === "Exempt" ? "badge-planning" : "badge-blocked"}`}>{item?.health}</span></div>; })}</div></div>
          <div><div className="mb-3 flex items-center justify-between"><p className="eyebrow t-dark-soft">Recent GitHub activity</p><span className="text-xs t-dark-muted">{accountability.recentEvents.length} events</span></div><div className="space-y-2">{accountability.recentEvents.slice(0, 4).map((event) => <div key={event.id} className="dark-inset flex items-start gap-2 p-3"><Check size={14} className="mt-0.5 shrink-0 text-[var(--ink-green)]" /><div><p className="text-sm t-dark">{event.summary}</p><p className="mt-1 text-xs t-dark-muted">{event.repository} · {formatRelativeAge(event.occurredAt)}</p></div></div>)}</div></div>
          <div className="dark-inset mood-peach p-4"><p className="eyebrow t-mood">Weekly goals</p><div className="mt-3 space-y-3 text-sm t-dark"><div className="flex justify-between"><span>Active days</span><span className="font-semibold">{Math.min(accountability.activeDaysThisWeek, 5)} / 5</span></div><div className="flex justify-between"><span>Project updates</span><span className="font-semibold">{accountability.updatedProjects} / 2</span></div><div className="flex justify-between"><span>Documentation</span><span className="font-semibold">{accountability.documentationUpdates} / 1</span></div></div><p className="mt-4 text-xs t-dark-muted">Longest streak: {accountability.longestStreak} days. Keep the rhythm forgiving.</p></div>
        </div>
      </section>
    );
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* GREETING SHEET — cream paper, deep warm charcoal ink, in both themes */}
      <div className="hero-paper tilt-left p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="hero-script text-[32px] leading-none">Good afternoon, Franz ✦</h3>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] t-paper-muted">Let&apos;s build something cool.</p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight t-paper text-shadow-paper">Tuesday, September 29</h1>
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
          { label: "Today tasks", value: `${tasks.filter((task) => task.status !== "Completed").length}`, mood: "mood-lavender" },
          { label: "Plans", value: `${plans.length}`, mood: "mood-blue" },
          { label: "Job apps", value: `${jobApplications.length}`, mood: "mood-green" },
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

      {renderAccountability()}

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
            <h2 className="t-dark mt-2 text-2xl font-semibold">Finish AutoCare Admin Chat Interface</h2>
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
                  <button type="button" onClick={() => deleteTask(task.id)} className="t-dark-muted rounded-lg p-1 transition hover:text-[var(--accent-coral)]">
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
              <div className="inset-soft flex items-center gap-3 px-3 py-2"><span className="dot-badge t-mood" /> 09:00 Kickoff and blockers</div>
              <div className="inset-soft flex items-center gap-3 px-3 py-2"><span className="dot-badge t-mood" /> 11:00 Product review</div>
              <div className="inset-soft flex items-center gap-3 px-3 py-2"><span className="dot-badge t-mood" /> 14:00 Build and QA pass</div>
              <div className="inset-soft flex items-center gap-3 px-3 py-2"><span className="dot-badge t-mood" /> 16:30 Update roadmap</div>
            </div>
          </div>

          <div className="paper-card p-4">
            <h3 className="mb-4 text-lg font-semibold">Completed today</h3>
            <div className="space-y-2 text-sm">
              <div className="inset-soft flex items-center gap-2 px-3 py-2"><Check size={14} className="text-[var(--ink-green)]" /> Research notes refined</div>
              <div className="inset-soft flex items-center gap-2 px-3 py-2"><Check size={14} className="text-[var(--ink-green)]" /> GitHub sync reviewed</div>
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

    return (
      <div className="dark-panel p-4">
        <div className="flex flex-col gap-4 border-b border-[var(--edge-dark)] pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="eyebrow t-mood">{selectedProject.type}</p>
            <h2 className="mt-2 text-3xl font-semibold t-dark">{selectedProject.name}</h2>
            <p className="mt-2 max-w-2xl text-sm t-dark-muted">{selectedProject.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="dark-chip px-3 py-2 text-sm">Edit</button>
            <button type="button" className="dark-chip px-3 py-2 text-sm">Connect GitHub</button>
            <button type="button" onClick={() => sharePublicProject(selectedProject.id)} className="rounded-xl ink-button px-3 py-2 text-sm">
              Share Public View
            </button>
            <button type="button" onClick={() => setShowcaseMode((current) => (current === "workspace" ? "showcase" : "workspace"))} className="rounded-xl ink-button primary px-3 py-2 text-sm">
              {showcaseMode === "workspace" ? "Preview Public Project" : "Return to workspace"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-b border-[var(--edge-dark)] pb-4">
          {[
            "Overview",
            "Workflow",
            "Tasks",
            "Milestones",
            "Notes",
            "Documentation",
            "Media",
            "Tech Stack",
            "Timeline",
            "GitHub",
            "Showcase",
          ].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setProjectTab(tab)}
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
                <div className="dark-inset p-3"><p className="eyebrow t-dark-soft">Problem</p><p className="mt-2 text-sm t-dark-soft">Local service businesses need clearer digital flow and better customer communication.</p></div>
                <div className="dark-inset p-3"><p className="eyebrow t-dark-soft">Solution</p><p className="mt-2 text-sm t-dark-soft">A booking-first product with clear admin states, AI support, and fast service updates.</p></div>
                <div className="dark-inset p-3"><p className="eyebrow t-dark-soft">Result</p><p className="mt-2 text-sm t-dark-soft">A high-confidence prototype that demonstrates product thinking and end-to-end UX flow.</p></div>
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
                      {Object.entries(selectedProject.health).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between dark-inset p-3 text-sm t-dark-soft">
                          <span className="capitalize">{key}</span>
                          <span className={value ? "text-[var(--ink-green)]" : "text-amber-300"}>{value ? "✓" : "⚠"}</span>
                        </div>
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
                      <div className="flex items-center justify-between"><span>Task progress</span><span>75%</span></div>
                      <div className="flex items-center justify-between"><span>Milestone progress</span><span>80%</span></div>
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
                {projectTasks.length > 0 ? projectTasks.map((task) => (
                  <div key={task.id} className="flex items-start justify-between gap-4 dark-inset p-3">
                    <div>
                      <p className="font-medium t-dark">{task.title}</p>
                      <p className="mt-1 text-xs t-dark-muted">{task.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`${priorityColors[task.priority]}`}>{task.priority}</span>
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
                )) : <p className="t-dark-muted">No tasks linked to this project yet.</p>}
              </div>
            )}

            {projectTab === "Milestones" && (
              <div className="space-y-3 dark-panel p-4">
                {projectMilestonesList.map((milestone) => (
                  <div key={milestone.id} className="flex items-center justify-between dark-inset p-3">
                    <div>
                      <p className="font-medium t-dark">{milestone.title}</p>
                      <p className="mt-1 text-xs t-dark-muted">Target: {formatDisplayDate(milestone.targetDate)}</p>
                    </div>
                    <span className="dark-chip px-2 py-1 text-xs">{milestone.status}</span>
                  </div>
                ))}
              </div>
            )}

            {projectTab === "GitHub" && (
              <div className="dark-panel p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="dark-inset p-4">
                    <p className="eyebrow t-dark-soft">Repository health</p>
                    <p className="mt-4 text-2xl font-semibold t-dark">Good</p>
                    <div className="mt-4 space-y-2 text-sm t-dark-muted">
                      <div>README: ✓</div>
                      <div>Documentation: ✓</div>
                      <div>Tests: ⚠</div>
                      <div>CI/CD: ✓</div>
                    </div>
                  </div>
                  <div className="dark-inset p-4">
                    <p className="eyebrow t-dark-soft">Recent activity</p>
                    <div className="mt-4 space-y-2 text-sm t-dark-muted">
                      <div>Today: Added appointment filtering</div>
                      <div>Yesterday: Improved mobile navigation</div>
                      <div>September 27: Added admin chat interface</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
            <div className="grid gap-4 md:grid-cols-2">{projects.map(renderProjectCard)}</div>
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
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {taskView === "list" && (
        <div className="space-y-3 dark-panel p-4">
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
                <button type="button" onClick={() => deleteTask(task.id)} className="dark-chip p-1.5 hover:text-[var(--accent-coral)]"><X size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderPlansPage = () => (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => {
          const doneCount = plan.tasks.filter((task) => task.done).length;
          const total = plan.tasks.length;
          const percent = Math.round((doneCount / total) * 100);
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
                  <div key={item.label} className="flex items-center gap-2 text-sm t-dark-soft">
                    <span className={item.done ? "text-[var(--ink-green)]" : "text-[var(--text-light-soft)]"}>{item.done ? "✓" : "□"}</span>
                    {item.label}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderGitHubPage = () => (
    <div className="space-y-6">
      <div className="dark-panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="eyebrow t-mood">Prototype integration</p>
            <h2 className="mt-2 text-2xl font-semibold t-dark">GitHub</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={async () => { const result = await signInWithGithub(); if (!result.configured) setGithubAuthMessage("Add Supabase environment variables to enable GitHub sign-in."); }} className="rounded-xl ink-button coral px-3 py-2 text-sm">Connect GitHub</button>
            <button type="button" onClick={() => setGithubImportOpen(true)} className="rounded-xl ink-button primary px-3 py-2 text-sm">Import from GitHub</button>
          </div>
        </div>
        {githubAuthMessage && <p className="mt-3 text-sm text-[var(--accent-peach)]">{githubAuthMessage}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {githubRepos.map((repo) => (
          <div key={repo.id} className="dark-panel p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-lg font-semibold t-dark">{repo.name}</p>
                <p className="mt-1 text-sm t-dark-muted">{repo.description}</p>
              </div>
              <span className="dark-chip px-2 py-1 uppercase">{repo.visibility}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {repo.technologies.map((tech) => (
                <span key={tech} className="dark-chip px-2 py-1">{tech}</span>
              ))}
            </div>
            <div className="mt-4 grid gap-2 text-sm t-dark-muted sm:grid-cols-2">
              <div>Language: {repo.language}</div>
              <div>Stars: {repo.stars}</div>
              <div>Forks: {repo.forks}</div>
              <div>Branch: {repo.branch}</div>
              <div>Latest commit: {repo.latestCommit}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
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

  const renderKnowledgePage = () => (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="dark-panel p-4">
          <h3 className="text-lg font-semibold t-dark">Notes</h3>
          <div className="mt-4 space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="dark-inset p-3">
                <p className="font-medium t-dark">{note.title}</p>
                <p className="mt-2 text-sm t-dark-muted">{note.content}</p>
              </div>
            ))}
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

  const renderTechPage = () => (
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
            <div>Deployed: {technology.deployed}</div>
            <div>Client projects: {technology.clientProjects}</div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderSettingsPage = () => (
    <div className="dark-panel p-6">
      <h2 className="text-2xl font-semibold t-dark">Workspace settings</h2>
      <p className="mt-2 t-dark-muted">This prototype intentionally keeps configuration local and lightweight for prototype exploration.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="dark-inset p-4">
          <p className="text-sm font-medium t-dark">Data storage</p>
          <p className="mt-2 text-sm t-dark-muted">Local browser persistence via localStorage.</p>
        </div>
        <div className="dark-inset p-4">
          <p className="text-sm font-medium t-dark">Prototype boundaries</p>
          <p className="mt-2 text-sm t-dark-muted">No production auth, cloud DB, or real GitHub OAuth yet.</p>
        </div>
      </div>
      <div className="mt-4 dark-inset p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium t-dark">Public GitHub accountability</p><p className="mt-1 text-xs t-dark-muted">Only aggregate fields enabled here can appear on the public portfolio.</p></div><span className="dark-chip px-2 py-1 text-[10px] uppercase">Safe by default</span></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(["score", "streak", "commits", "projects", "heatmap", "recent", "username"] as const).map((key) => (
            <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--edge-dark-soft)] px-3 py-2 text-sm t-dark-muted"><span className="capitalize">{key === "projects" ? "Project count" : key === "heatmap" ? "Activity heatmap" : key === "username" ? "GitHub username" : `Show ${key}`}</span><input type="checkbox" checked={publicVisibility[key]} onChange={() => setPublicVisibility((current) => ({ ...current, [key]: !current[key] }))} /></label>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => void signOut().then(() => router.push("/login"))} className="mt-4 ink-button coral px-3 py-2 text-sm">Sign out</button>
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
                    return (
                      <button
                        key={item.key}
                        type="button"
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
                <button type="button" className="rounded-xl border border-[var(--edge-cream)] bg-[var(--surface-cream)] p-2 text-[var(--text-desk)]">
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
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--edge-cream)] bg-[linear-gradient(135deg,var(--accent-coral),var(--accent-lavender))] font-semibold text-[var(--text-dark)]">F</div>
              </div>
            </div>
          </header>

          <main className="p-4 lg:p-6">
            {workspaceStatus === "checking" && <div className="mb-4 dark-panel px-4 py-3 text-sm t-dark-muted">Loading your workspace...</div>}
            {workspaceStatus === "error" && <div className="mb-4 dark-panel border-[var(--accent-peach-solid)] px-4 py-3 text-sm t-dark-muted">{workspaceError}</div>}
            {workspaceStatus === "mock" && <div className="mb-4 dark-panel px-4 py-3 text-sm t-dark-muted">Prototype mode: local workspace data is active until Supabase is configured.</div>}
            {migrationMessage && <div className="mb-4 dark-panel px-4 py-3 text-sm t-dark-muted">{migrationMessage}</div>}
            {renderPage()}
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

      {migrationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-sm">
          <div className="dark-panel w-full max-w-lg p-5 shadow-[var(--shadow-dark-lift)]">
            <p className="eyebrow t-mood">Workspace migration</p>
            <h3 className="mt-2 text-2xl font-semibold t-dark">Import your local workspace?</h3>
            <p className="mt-3 text-sm leading-6 t-dark-muted">Your browser has a saved prototype workspace and your Supabase workspace is empty. Import the local projects, tasks, milestones, plans, notes, and technologies once. Existing server data will never be overwritten.</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setMigrationOpen(false)} className="dark-chip px-3 py-2 text-sm">Keep local only</button><button type="button" onClick={() => void handleMigrateWorkspace()} className="ink-button primary px-3 py-2 text-sm">Import my workspace</button></div>
          </div>
        </div>
      )}

      {githubImportOpen && (
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
