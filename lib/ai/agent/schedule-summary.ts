import { formatCalendarDate } from "@/data/workspaceCalendar";
import type { ProposalDraft, LegacyProposalDraft } from "@/lib/ai/agent/contract";
import {localDateTime} from "@/data/timeBlocks";
export interface CalendarLoadDay { date: string; incompleteTasks: number; milestones: number; projects: number }
/** Summarize only canonical actions, never the model's claims about completed work. */
export function proposalSummary(drafts: ProposalDraft[], load: CalendarLoadDay[], partial: boolean,timeZone='UTC') {
  const groups = new Map<string, string[]>();
  for (const draft of drafts) {
    if(draft.type==='create_milestone'||draft.type==='update_milestone')continue;
    const diff = draft.diff.find(item => item.field === "dueDate" || item.field === "targetDate");
    if (!diff) continue;
    const date = diff.after ?? "Unscheduled";
    groups.set(date, [...(groups.get(date) ?? []), draft.title.replace(/[\r\n]/g, " ")]);
  }
  const lines = [`Prepared ${drafts.length} proposal${drafts.length === 1 ? "" : "s"}. Nothing has been changed yet.`];
  for(const draft of drafts)if(draft.type==='create_milestone'||draft.type==='update_milestone')lines.push(`${draft.type==='create_milestone'?'Create':'Update'} milestone: ${draft.title.replace(/[\r\n]/g,' ')}. Review the proposed fields below.`);
  for(const block of drafts.filter((d):d is LegacyProposalDraft=>['create_time_block','update_time_block','cancel_time_block'].includes(d.type))){const after={...block.before,...block.payload};if(after.startAt&&after.endAt)lines.push(`• ${block.title.replace(/[\r\n]/g,' ')}: ${localDateTime(after.startAt,timeZone).replace('T',' ')} – ${localDateTime(after.endAt,timeZone).replace('T',' ')} (${timeZone})${block.type==='cancel_time_block'?', proposed cancellation':''}.`);}
  for (const [date, titles] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push("", date === "Unscheduled" ? date : formatCalendarDate(date, { weekday: "long", month: "short", day: "numeric", year: "numeric" }), ...titles.map(title => `• ${title}`));
    const day = load.find(day => day.date === date);
    if (day && day.incompleteTasks + day.milestones + day.projects > 0) lines.push(`Existing load: ${day.incompleteTasks} incomplete tasks, ${day.milestones} milestone deadlines, ${day.projects} project targets. Advisory only; these are not time conflicts.`);
  }
  for (const target of drafts.filter(draft => draft.type.startsWith("reschedule_"))) {
    const date = target.payload.targetDate;
    if (date && drafts.some(draft => (draft.type==='create_task'||draft.type==='update_task') && draft.projectId === target.projectId && (target.type === "reschedule_project" || (draft.payload.milestoneId ?? draft.before.milestoneId) === target.entityId) && draft.payload.dueDate && draft.payload.dueDate > date)) lines.push(`Check dependencies: proposed tasks in ${target.title}'s project fall after its proposed target date.`);
  }
  lines.push("", `${partial ? "Partial results were returned. " : ""}Only the listed actions are proposed; this may be a partial schedule. Review the changes below and choose Apply selected to approve them.`);
  return lines.join("\n");
}
