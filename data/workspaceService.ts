import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Milestone, NoteItem, Plan, Project, Task, TechnologyItem } from "@/types";

export interface WorkspaceData {
  projects: Project[];
  tasks: Task[];
  milestones: Milestone[];
  plans: Plan[];
  notes: NoteItem[];
  technologies: TechnologyItem[];
}

type ProjectRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  project_type: string;
  status: Project["status"];
  workflow_stage: Project["currentPhase"];
  priority: string;
  is_featured: boolean;
  visibility: Project["visibility"];
  role: string | null;
  team_size: number | null;
  start_date: string | null;
  target_date: string | null;
  current_objective: string;
  next_action: string;
  created_at: string;
  updated_at: string;
};

const emptyHealth = { documentation: false, screenshots: false, github: false, testing: false, deployment: false };

const mapProject = (row: ProjectRow): Project => ({
  id: row.id,
  slug: row.slug,
  name: row.title,
  description: row.description,
  type: row.project_type,
  status: row.status,
  progress: 0,
  currentPhase: row.workflow_stage,
  objective: row.current_objective,
  role: row.role ?? "Developer",
  startDate: row.start_date ?? row.created_at,
  targetDate: row.target_date ?? row.created_at,
  nextAction: row.next_action,
  technologies: [],
  lastUpdated: row.updated_at,
  githubConnected: false,
  featured: row.is_featured,
  visibility: row.visibility,
  health: emptyHealth,
  links: {},
});

const mapTask = (row: Record<string, unknown>): Task => ({
  id: String(row.id),
  title: String(row.title),
  description: String(row.description ?? ""),
  projectId: String(row.project_id),
  milestoneId: row.milestone_id ? String(row.milestone_id) : undefined,
  status: row.status as Task["status"],
  priority: row.priority as Task["priority"],
  dueDate: row.due_date ? String(row.due_date) : undefined,
  tags: [],
  createdAt: String(row.created_at),
  completedAt: row.completed_at ? String(row.completed_at) : undefined,
});

export async function loadWorkspaceData(): Promise<WorkspaceData | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const [{ data: projects, error: projectsError }, { data: tasks, error: tasksError }, { data: milestones, error: milestonesError }, { data: plans, error: plansError }, { data: notes, error: notesError }, { data: technologies, error: technologiesError }] = await Promise.all([
    supabase.from("projects").select("*").order("updated_at", { ascending: false }),
    supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    supabase.from("milestones").select("*").order("sort_order"),
    supabase.from("plans").select("*").order("updated_at", { ascending: false }),
    supabase.from("notes").select("*").order("updated_at", { ascending: false }),
    supabase.from("technologies").select("*").order("name"),
  ]);
  const error = projectsError ?? tasksError ?? milestonesError ?? plansError ?? notesError ?? technologiesError;
  if (error) throw error;

  return {
    projects: (projects ?? []).map((row) => mapProject(row as ProjectRow)),
    tasks: (tasks ?? []).map((row) => mapTask(row as Record<string, unknown>)),
    milestones: (milestones ?? []).map((row) => ({ id: String(row.id), projectId: String(row.project_id), title: String(row.title), status: row.status as Milestone["status"], targetDate: row.target_date ? String(row.target_date) : undefined, order: Number(row.sort_order) })),
    plans: (plans ?? []).map((row) => ({ id: String(row.id), title: String(row.title), goal: String(row.description ?? ""), deadline: String(row.target_date ?? row.created_at), tasks: [] })),
    notes: (notes ?? []).map((row) => ({ id: String(row.id), title: String(row.title), content: String(row.content), projectId: row.project_id ? String(row.project_id) : undefined })),
    technologies: (technologies ?? []).map((row) => ({ id: String(row.id), name: String(row.name), category: "", summary: "", usedIn: [], deployed: 0, clientProjects: 0 })),
  };
}

export async function updateTask(task: Task) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return task;
  const { error } = await supabase.from("tasks").update({ status: task.status, completed_at: task.completedAt ?? null, updated_at: new Date().toISOString() }).eq("id", task.id);
  if (error) throw error;
  return task;
}

export async function createTask(task: Task) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return task;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Authentication required");
  const { data, error } = await supabase.from("tasks").insert({
    user_id: userData.user.id,
    project_id: task.projectId,
    milestone_id: task.milestoneId ?? null,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_date: task.dueDate ?? null,
  }).select().single();
  if (error) throw error;
  return mapTask(data as Record<string, unknown>);
}

export async function migrateLocalWorkspace(snapshot: Partial<WorkspaceData>) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { status: "unavailable" as const };
  const { data: existing, error: existingError } = await supabase.from("projects").select("id").limit(1);
  if (existingError) throw existingError;
  if ((existing ?? []).length > 0) return { status: "server-has-data" as const };

  const projectIdMap = new Map<string, string>();
  for (const project of snapshot.projects ?? []) {
    const { data, error } = await supabase.from("projects").insert({
      title: project.name,
      slug: project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      description: project.description,
      project_type: project.type,
      status: project.status,
      workflow_stage: project.currentPhase,
      priority: "Medium",
      is_featured: project.featured ?? false,
      visibility: project.visibility ?? "Private",
      role: project.role,
      start_date: project.startDate,
      target_date: project.targetDate,
      current_objective: project.objective,
      next_action: project.nextAction,
    }).select("id").single();
    if (error) throw error;
    projectIdMap.set(project.id, String(data.id));
  }

  if (snapshot.milestones?.length) {
    const rows = snapshot.milestones.map((milestone) => ({ project_id: projectIdMap.get(milestone.projectId), title: milestone.title, status: milestone.status, target_date: milestone.targetDate, sort_order: milestone.order }));
    const { error } = await supabase.from("milestones").insert(rows);
    if (error) throw error;
  }
  if (snapshot.tasks?.length) {
    const { data: userData } = await supabase.auth.getUser();
    const rows = snapshot.tasks.map((task) => ({ user_id: userData.user?.id, project_id: projectIdMap.get(task.projectId), title: task.title, description: task.description, status: task.status, priority: task.priority, due_date: task.dueDate, created_at: task.createdAt, completed_at: task.completedAt }));
    const { error } = await supabase.from("tasks").insert(rows);
    if (error) throw error;
  }
  const { data: userData } = await supabase.auth.getUser();
  if (snapshot.plans?.length && userData.user) {
    for (const plan of snapshot.plans) {
      const { data: planRow, error } = await supabase.from("plans").insert({ user_id: userData.user.id, title: plan.title, description: plan.goal, target_date: plan.deadline }).select("id").single();
      if (error) throw error;
      if (plan.tasks.length) {
        const { error: itemError } = await supabase.from("project_plan_items").insert(plan.tasks.map((item, index) => ({ plan_id: planRow.id, label: item.label, done: item.done, sort_order: index })));
        if (itemError) throw itemError;
      }
    }
  }
  if (snapshot.notes?.length && userData.user) {
    const { error } = await supabase.from("notes").insert(snapshot.notes.map((note) => ({ user_id: userData.user!.id, project_id: note.projectId ? projectIdMap.get(note.projectId) : null, title: note.title, content: note.content })));
    if (error) throw error;
  }
  if (snapshot.technologies?.length && userData.user) {
    const { error } = await supabase.from("technologies").upsert(snapshot.technologies.map((technology) => ({ user_id: userData.user!.id, name: technology.name })), { onConflict: "user_id,name" });
    if (error) throw error;
  }
  return { status: "migrated" as const, projectCount: projectIdMap.size };
}
