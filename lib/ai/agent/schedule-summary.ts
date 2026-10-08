import { formatCalendarDate } from "@/data/workspaceCalendar";
import type { ProposalDraft } from "@/lib/ai/agent/contract";
export interface CalendarLoadDay { date: string; incompleteTasks: number; milestones: number; projects: number }
/** Summarize only canonical actions, never the model's claims about completed work. */
export function proposalSummary(drafts: ProposalDraft[], load: CalendarLoadDay[], partial: boolean) {
  const groups = new Map<string, string[]>();
  for (const draft of drafts) {
    const diff = draft.diff.find(item => item.field === "dueDate" || item.field === "targetDate");
    if (!diff) continue;
    const date = diff.after ?? "Unscheduled";
    groups.set(date, [...(groups.get(date) ?? []), draft.title.replace(/[\r\n]/g, " ")]);
  }
  const lines = [`Prepared ${drafts.length} proposal${drafts.length === 1 ? "" : "s"}. Nothing has been changed yet.`];
  for (const [date, titles] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push("", date === "Unscheduled" ? date : formatCalendarDate(date, { weekday: "long", month: "short", day: "numeric", year: "numeric" }), ...titles.map(title => `• ${title}`));
    const day = load.find(day => day.date === date);
    if (day && day.incompleteTasks + day.milestones + day.projects > 0) lines.push(`Existing load: ${day.incompleteTasks} incomplete tasks, ${day.milestones} milestone deadlines, ${day.projects} project targets. Advisory only; these are not time conflicts.`);
  }
  for (const target of drafts.filter(draft => draft.type.startsWith("reschedule_"))) {
    const date = target.payload.targetDate;
    if (date && drafts.some(draft => draft.projectId === target.projectId && (target.type === "reschedule_project" || (draft.payload.milestoneId ?? draft.before.milestoneId) === target.entityId) && draft.payload.dueDate && draft.payload.dueDate > date)) lines.push(`Check dependencies: proposed tasks in ${target.title}'s project fall after its proposed target date.`);
  }
  lines.push("", `${partial ? "Partial results were returned. " : ""}Only the listed actions are proposed; this may be a partial schedule. Review the changes below and choose Apply selected to approve them.`);
  return lines.join("\n");
}
