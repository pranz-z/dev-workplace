import type { Milestone, NoteItem, Plan, Project, Task, TechnologyItem } from "@/types";
import { listMilestones } from "@/data/milestoneService";
import { listNotes } from "@/data/noteService";
import { listPlans } from "@/data/planService";
import { listProjects } from "@/data/projectService";
import { listTasks } from "@/data/taskService";
import { listProjectTechnologyNames, listTechnologies } from "@/data/technologyService";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface WorkspaceData {
  projects: Project[];
  tasks: Task[];
  milestones: Milestone[];
  plans: Plan[];
  notes: NoteItem[];
  technologies: TechnologyItem[];
}

/**
 * Loads the whole workspace with one round trip per table. Progress and the
 * project technology pills are derived from the same snapshot, so the dashboard
 * never shows figures that disagree with the lists underneath.
 */
export async function loadWorkspaceData(): Promise<WorkspaceData | null> {
  if (!isSupabaseConfigured()) return null;

  const [tasks, milestones, notes, plans, technologyNames, technologies] = await Promise.all([
    listTasks(),
    listMilestones(),
    listNotes(),
    listPlans(),
    listProjectTechnologyNames(),
    listTechnologies(),
  ]);

  const projects = await listProjects({ tasks, milestones, technologyNames });
  return { projects, tasks, milestones, plans, notes, technologies };
}
