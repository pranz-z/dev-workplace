import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiError } from "@/lib/ai/errors";
import type { WorkspaceEntityRef } from "@/lib/ai/chat-contract";

function contextReadError(operation: string, error: { code?: string; message?: string }) {
  console.error("[ai-chat] workspace context read failed", { operation, code: error.code ?? "unknown" });
  throw new AiError("UPSTREAM_ERROR");
}

export async function buildPrivateChatContext(supabase: SupabaseClient, userId: string, refs: WorkspaceEntityRef[]): Promise<unknown[]> {
  const context: unknown[] = [];
  for (const ref of refs) {
    if (ref.type === "project") {
      const { data, error } = await supabase.from("projects").select("id, user_id, title, description, status, workflow_stage, role, project_type, current_objective, next_action, priority, target_date")
        .eq("id", ref.id).eq("user_id", userId).maybeSingle();
      if (error) contextReadError("load_attached_project", error);
      if (!data) throw new AiError("FORBIDDEN");
      const row = data as unknown as Record<string, unknown>;
      const { data: techRows, error: techError } = await supabase.from("project_technologies").select("technologies ( name )").eq("project_id", ref.id).limit(20);
      if (techError) contextReadError("load_attached_project_technologies", techError);
      const technologies = ((techRows ?? []) as unknown as Array<{ technologies: { name: string } | null }>).map((item) => item.technologies?.name).filter((name): name is string => Boolean(name)).slice(0, 20).map((name) => name.slice(0, 60));
      context.push({ type: "project", title: String(row.title ?? "").slice(0, 180), description: String(row.description ?? "").slice(0, 2000), status: String(row.status ?? "").slice(0, 40), workflowStage: String(row.workflow_stage ?? "").slice(0, 40), role: String(row.role ?? "").slice(0, 120), projectType: String(row.project_type ?? "").slice(0, 80), objective: String(row.current_objective ?? "").slice(0, 700), nextAction: String(row.next_action ?? "").slice(0, 300), priority: String(row.priority ?? "").slice(0, 20), targetDate: String(row.target_date ?? "").slice(0, 40), technologies });
    } else if (ref.type === "task") {
      const { data, error } = await supabase.from("tasks").select("id, user_id, project_id, title, description, status, priority, due_date")
        .eq("id", ref.id).eq("user_id", userId).maybeSingle();
      if (error) contextReadError("load_attached_task", error);
      if (!data) throw new AiError("FORBIDDEN");
      const row = data as unknown as Record<string, unknown>;
      const { data: project, error: projectError } = await supabase.from("projects").select("id, user_id, title")
        .eq("id", String(row.project_id)).eq("user_id", userId).maybeSingle();
      if (projectError) contextReadError("verify_attached_task_project", projectError);
      if (!project) throw new AiError("FORBIDDEN");
      context.push({ type: "task", title: String(row.title ?? "").slice(0, 180), description: String(row.description ?? "").slice(0, 1200), status: String(row.status ?? "").slice(0, 40), priority: String(row.priority ?? "").slice(0, 20), dueDate: String(row.due_date ?? "").slice(0, 40), projectTitle: String((project as unknown as Record<string, unknown>).title ?? "").slice(0, 180) });
    } else {
      const { data, error } = await supabase.from("plans").select("id, user_id, title, description, status, target_date")
        .eq("id", ref.id).eq("user_id", userId).maybeSingle();
      if (error) contextReadError("load_attached_plan", error);
      if (!data) throw new AiError("FORBIDDEN");
      const row = data as unknown as Record<string, unknown>;
      const { data: items, error: itemsError } = await supabase.from("project_plan_items").select("label, done")
        .eq("plan_id", ref.id).order("sort_order", { ascending: true }).limit(20);
      if (itemsError) contextReadError("load_attached_plan_items", itemsError);
      context.push({ type: "plan", title: String(row.title ?? "").slice(0, 180), goal: String(row.description ?? "").slice(0, 1000), status: String(row.status ?? "").slice(0, 40), targetDate: String(row.target_date ?? "").slice(0, 40), checklist: ((items ?? []) as unknown as Array<Record<string, unknown>>).map((item) => ({ label: String(item.label ?? "").slice(0, 160), done: item.done === true })) });
    }
  }
  return context;
}
