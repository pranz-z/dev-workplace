import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiError } from "@/lib/ai/errors";
import { type AiRequestBody } from "@/lib/ai/schemas";
import { loadProjectGithubActivity } from "@/lib/ai/githubContext";

type ProjectContext = {
  id: string; title: string; description: string; type: string; role: string | null; teamSize: number | null;
  status: string; workflowStage: string; objective: string; nextAction: string; priority: string;
  targetDate: string | null; technologies: string[]; challenge: string | null; solution: string | null;
  outcome: string | null; publicSummary: string | null;
};
type TaskContext = { id: string; title: string; description: string; status: string; priority: string; dueDate: string | null };
type MilestoneContext = { title: string; description: string; status: string; targetDate: string | null };
type PlanContext = { title: string; goal: string; status: string; items: Array<{ label: string; done: boolean }> };
type NoteContext = { id: string; title: string; content: string };

function databaseError(operation: string, error: { code?: string; message?: string }) {
  console.error("[ai] workspace context read failed", { operation, code: error.code ?? "unknown" });
  throw new AiError("UPSTREAM_ERROR");
}

async function ownedProject(supabase: SupabaseClient, userId: string, projectId: string): Promise<ProjectContext> {
  const { data, error } = await supabase.from("projects")
    .select("id, user_id, title, description, project_type, role, team_size, status, workflow_stage, current_objective, next_action, priority, target_date, public_problem, public_solution, public_result, public_summary")
    .eq("id", projectId).eq("user_id", userId).maybeSingle();
  if (error) databaseError("load_owned_project", error);
  if (!data) throw new AiError("FORBIDDEN");
  const row = data as unknown as Record<string, unknown>;
  const { data: techRows, error: techError } = await supabase.from("project_technologies")
    .select("technologies ( name )").eq("project_id", projectId).limit(20);
  if (techError) databaseError("load_project_technologies", techError);
  const technologies = ((techRows ?? []) as unknown as Array<{ technologies: { name: string } | null }>)
    .map((item) => item.technologies?.name).filter((name): name is string => Boolean(name)).slice(0, 20);
  return {
    id: String(row.id), title: String(row.title).slice(0, 180), description: String(row.description ?? "").slice(0, 3000),
    type: String(row.project_type ?? "").slice(0, 100), role: typeof row.role === "string" ? row.role.slice(0, 120) : null,
    teamSize: typeof row.team_size === "number" ? row.team_size : null, status: String(row.status), workflowStage: String(row.workflow_stage),
    objective: String(row.current_objective ?? "").slice(0, 1000), nextAction: String(row.next_action ?? "").slice(0, 500),
    priority: String(row.priority), targetDate: typeof row.target_date === "string" ? row.target_date : null, technologies,
    challenge: typeof row.public_problem === "string" ? row.public_problem.slice(0, 1500) : null,
    solution: typeof row.public_solution === "string" ? row.public_solution.slice(0, 1500) : null,
    outcome: typeof row.public_result === "string" ? row.public_result.slice(0, 1000) : null,
    publicSummary: typeof row.public_summary === "string" ? row.public_summary.slice(0, 1000) : null,
  };
}

async function projectTasks(supabase: SupabaseClient, userId: string, projectId: string): Promise<TaskContext[]> {
  const { data, error } = await supabase.from("tasks").select("id, title, description, status, priority, due_date, updated_at")
    .eq("project_id", projectId).eq("user_id", userId).order("updated_at", { ascending: false }).limit(30);
  if (error) databaseError("load_project_tasks", error);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).slice(0, 30).map((row) => ({
    id: String(row.id), title: String(row.title).slice(0, 180), description: String(row.description ?? "").slice(0, 600),
    status: String(row.status), priority: String(row.priority), dueDate: typeof row.due_date === "string" ? row.due_date : null,
  }));
}

async function projectMilestones(supabase: SupabaseClient, projectId: string): Promise<MilestoneContext[]> {
  const { data, error } = await supabase.from("milestones").select("title, description, status, target_date")
    .eq("project_id", projectId).order("sort_order", { ascending: true }).limit(20);
  if (error) databaseError("load_project_milestones", error);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).slice(0, 20).map((row) => ({
    title: String(row.title).slice(0, 180), description: String(row.description ?? "").slice(0, 500),
    status: String(row.status), targetDate: typeof row.target_date === "string" ? row.target_date : null,
  }));
}

async function projectPlans(supabase: SupabaseClient, userId: string, projectId: string): Promise<PlanContext[]> {
  const { data: rows, error } = await supabase.from("plans").select("id, title, description, status")
    .eq("user_id", userId).in("status", ["Planning", "Active"]).order("updated_at", { ascending: false }).limit(20);
  if (error) databaseError("load_owned_plans", error);
  const plans = (rows ?? []) as unknown as Array<Record<string, unknown>>;
  const ids = plans.map((row) => String(row.id));
  if (!ids.length) return [];
  const { data: items, error: itemError } = await supabase.from("plan_items").select("plan_id, project_id, label, done")
    .in("plan_id", ids).eq("project_id", projectId).limit(40);
  if (itemError) databaseError("load_project_plan_items", itemError);
  const grouped = new Map<string, Array<{ label: string; done: boolean }>>();
  for (const item of (items ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = String(item.plan_id);
    grouped.set(key, [...(grouped.get(key) ?? []), { label: String(item.label).slice(0, 180), done: item.done === true }]);
  }
  return plans.filter((row) => grouped.has(String(row.id))).slice(0, 10).map((row) => ({
    title: String(row.title).slice(0, 180), goal: String(row.description ?? "").slice(0, 500), status: String(row.status),
    items: grouped.get(String(row.id)) ?? [],
  }));
}

async function projectNotes(supabase: SupabaseClient, userId: string, projectId: string): Promise<Array<Pick<NoteContext, "title" | "content">>> {
  const { data, error } = await supabase.from("notes").select("title, content")
    .eq("user_id", userId).eq("project_id", projectId).order("updated_at", { ascending: false }).limit(5);
  if (error) databaseError("load_selected_project_notes", error);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    title: String(row.title).slice(0, 180), content: String(row.content ?? "").slice(0, 1600),
  }));
}

async function projectAccountabilityContext(supabase: SupabaseClient, userId: string, projectId: string) {
  const [{ data: tasks, error: taskError }, { data: milestones, error: milestoneError }] = await Promise.all([
    supabase.from("tasks").select("status").eq("user_id", userId).eq("project_id", projectId).limit(100),
    supabase.from("milestones").select("status").eq("project_id", projectId).limit(50),
  ]);
  if (taskError) databaseError("load_accountability_task_counts", taskError);
  if (milestoneError) databaseError("load_accountability_milestone_counts", milestoneError);
  const taskRows = (tasks ?? []) as unknown as Array<{ status: string }>;
  const milestoneRows = (milestones ?? []) as unknown as Array<{ status: string }>;
  return {
    completedTaskCount: taskRows.filter((task) => task.status === "Completed").length,
    openTaskCount: taskRows.filter((task) => task.status !== "Completed").length,
    completedMilestoneCount: milestoneRows.filter((milestone) => milestone.status === "completed").length,
    milestoneCount: milestoneRows.length,
    explanationOnly: true,
  };
}

async function selectedNote(supabase: SupabaseClient, userId: string, noteId: string): Promise<{ note: NoteContext; projectTitle: string | null }> {
  const { data, error } = await supabase.from("notes").select("id, user_id, project_id, title, content")
    .eq("id", noteId).eq("user_id", userId).maybeSingle();
  if (error) databaseError("load_owned_note", error);
  if (!data) throw new AiError("FORBIDDEN");
  const note = data as unknown as Record<string, unknown>;
  const projectId = typeof note.project_id === "string" ? note.project_id : null;
  let projectTitle: string | null = null;
  if (projectId) {
    const { data: project, error: projectError } = await supabase.from("projects").select("title")
      .eq("id", projectId).eq("user_id", userId).maybeSingle();
    if (projectError) databaseError("load_note_project_title", projectError);
    if (!project) throw new AiError("FORBIDDEN");
    projectTitle = String((project as unknown as { title: string }).title).slice(0, 180);
  }
  return { note: { id: String(note.id), title: String(note.title).slice(0, 180), content: String(note.content ?? "").slice(0, 12000) }, projectTitle };
}

async function selectedTask(supabase: SupabaseClient, userId: string, taskId: string): Promise<{ task: TaskContext; project: ProjectContext }> {
  const { data, error } = await supabase.from("tasks").select("id, user_id, project_id, title, description, status, priority, due_date")
    .eq("id", taskId).eq("user_id", userId).maybeSingle();
  if (error) databaseError("load_owned_task", error);
  if (!data) throw new AiError("FORBIDDEN");
  const taskRow = data as unknown as Record<string, unknown>;
  const project = await ownedProject(supabase, userId, String(taskRow.project_id));
  return {
    task: { id: String(taskRow.id), title: String(taskRow.title).slice(0, 180), description: String(taskRow.description ?? "").slice(0, 2000), status: String(taskRow.status), priority: String(taskRow.priority), dueDate: typeof taskRow.due_date === "string" ? taskRow.due_date : null },
    project,
  };
}

function selectedContext(body: AiRequestBody, key: string, defaultValue = false): boolean {
  return body.context?.[key as keyof NonNullable<AiRequestBody["context"]>] ?? defaultValue;
}

export async function buildAiContext(
  supabase: SupabaseClient,
  userId: string,
  body: AiRequestBody,
  githubActivityLoader: typeof loadProjectGithubActivity = loadProjectGithubActivity,
): Promise<unknown> {
  if (body.action === "summarize_note" || body.action === "extract_actions") {
    const context = await selectedNote(supabase, userId, body.noteId!);
    return { note: context.note, projectTitle: context.projectTitle };
  }
  if (body.action === "break_task") {
    const context = await selectedTask(supabase, userId, body.taskId!);
    return { project: { title: context.project.title, description: context.project.description, workflowStage: context.project.workflowStage }, task: context.task };
  }
  const project = await ownedProject(supabase, userId, body.projectId!);
  const projectContext = body.action === "improve_description"
    ? { title: project.title, description: project.description, type: project.type, role: project.role, technologies: project.technologies }
    : body.action === "draft_case_study"
      ? { title: project.title, description: project.description, type: project.type, role: project.role, teamSize: project.teamSize, technologies: project.technologies, challenge: project.challenge, solution: project.solution, outcome: project.outcome, publicSummary: project.publicSummary }
      : body.action === "next_actions" || body.action === "break_project"
        ? { title: project.title, description: project.description, status: project.status, workflowStage: project.workflowStage, nextAction: project.nextAction, targetDate: project.targetDate, objective: project.objective }
        : { title: project.title, description: project.description, type: project.type, role: project.role, status: project.status, workflowStage: project.workflowStage, objective: project.objective, nextAction: project.nextAction, priority: project.priority, targetDate: project.targetDate, technologies: project.technologies };
  const context: Record<string, unknown> = { project: projectContext };
  const includeTasks = body.action === "next_actions" || body.action === "break_project"
    || (body.action === "progress_summary" || body.action === "ask_project") && selectedContext(body, "tasks", true);
  const includeMilestones = body.action === "next_actions" || body.action === "break_project"
    || (body.action === "progress_summary" || body.action === "ask_project") && selectedContext(body, "milestones", true);
  if (includeTasks) context.tasks = await projectTasks(supabase, userId, project.id);
  if (includeMilestones) context.milestones = await projectMilestones(supabase, project.id);
  if ((body.action === "progress_summary" && selectedContext(body, "plans")) || (body.action === "ask_project" && selectedContext(body, "plans"))) context.plans = await projectPlans(supabase, userId, project.id);
  const includeNotes = (body.action === "progress_summary" || body.action === "ask_project") && selectedContext(body, "notes");
  if (includeNotes) context.notes = await projectNotes(supabase, userId, project.id);
  if ((body.action === "progress_summary" || body.action === "ask_project") && selectedContext(body, "github")) {
    context.githubActivity = await githubActivityLoader(supabase, userId, project.id);
  }
  if (body.action === "progress_summary" || body.action === "ask_project") {
    if (selectedContext(body, "accountability")) context.accountabilityContext = await projectAccountabilityContext(supabase, userId, project.id);
  }
  if (body.action === "ask_project") {
    if (!selectedContext(body, "projectDetails", true)) context.project = { title: project.title };
    context.question = body.question;
    context.history = (body.history ?? []).slice(-6).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 700) }));
  }
  if (body.action === "draft_case_study") {
    // Case-study source notes are omitted unless the owner explicitly opts in through context.
    if (selectedContext(body, "notes")) context.notes = await projectNotes(supabase, userId, project.id);
  }
  return context;
}
