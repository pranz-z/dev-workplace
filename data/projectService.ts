import { mockProjects } from "@/data/mockData";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Project } from "@/types";

const mapProjectRow = (row: Record<string, unknown>): Project => ({
  id: String(row.id),
  slug: row.slug ? String(row.slug) : undefined,
  name: String(row.title ?? "Untitled project"),
  description: String(row.description ?? ""),
  type: String(row.project_type ?? "Personal"),
  status: row.status as Project["status"],
  progress: 0,
  currentPhase: row.workflow_stage as Project["currentPhase"],
  objective: String(row.current_objective ?? ""),
  role: String(row.role ?? "Developer"),
  startDate: String(row.start_date ?? row.created_at),
  targetDate: String(row.target_date ?? row.created_at),
  nextAction: String(row.next_action ?? "Choose the next useful step"),
  technologies: [],
  lastUpdated: String(row.updated_at),
  githubConnected: false,
  featured: Boolean(row.is_featured),
  visibility: row.visibility as Project["visibility"],
  health: { documentation: false, screenshots: false, github: false, testing: false, deployment: false },
  links: {},
});

export async function listProjects(): Promise<Project[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return mockProjects;

  const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapProjectRow(row as Record<string, unknown>));
}

export async function listPublicProjects() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [] as Project[];
  const { data, error } = await supabase.from("projects").select("*").eq("visibility", "Public").order("is_featured", { ascending: false }).order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapProjectRow(row as Record<string, unknown>));
}

export async function getPublicProjectBySlug(slug: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("projects").select("*").eq("slug", slug).in("visibility", ["Public", "Unlisted"]).maybeSingle();
  if (error) throw error;
  return data ? mapProjectRow(data as Record<string, unknown>) : null;
}

export async function createProject(project: Project) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return project;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Authentication required");
  const { data, error } = await supabase.from("projects").insert({
    user_id: userData.user.id,
    slug: project.slug ?? project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    title: project.name,
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
  }).select().single();
  if (error) throw error;
  return mapProjectRow(data as Record<string, unknown>);
}
