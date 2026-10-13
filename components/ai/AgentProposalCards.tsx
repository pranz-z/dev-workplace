"use client";
import { useRef, useState } from "react";
import type { ProposalBatch, ProposalChanges } from "@/lib/ai/agent/contract";
import { formatCalendarDate, isValidCalendarDate } from "@/data/workspaceCalendar";
import {localDateTime} from "@/data/timeBlocks";
import {buildAgentReviewPrompt} from "@/data/agentProposalReview";

const LABELS: Record<keyof ProposalChanges, string> = { title: "Title", description: "Description", priority: "Priority", status: "Status", dueDate: "Due date", milestoneId: "Milestone", targetDate: "Target date",startAt:'Starts',endAt:'Ends',projectId:'Project',taskId:'Task',kind:'Block kind' };
const HEADINGS:Record<string,string>={create_task:'Create task: ',update_task:'Task: ',reschedule_milestone:'Milestone: ',reschedule_project:'Project: ',create_time_block:'Create time block: ',update_time_block:'Edit time block: ',cancel_time_block:'Cancel time block: ',create_milestone:'Create milestone: ',update_milestone:'Update milestone: '};
function display(field: keyof ProposalChanges, value: string | null,timeZone='UTC') {
  if (value === null || value === "") return field === "dueDate" || field === "targetDate" ? "Unscheduled" : "None";
  if(field==='status'&&['pending','active','completed'].includes(value))return value[0].toUpperCase()+value.slice(1);
  if ((field === "dueDate" || field === "targetDate") && isValidCalendarDate(value)) return formatCalendarDate(value, { month: "short", day: "numeric", year: "numeric" });
  if(field==='startAt'||field==='endAt')try{return `${localDateTime(value,timeZone).replace('T',' ')} (${timeZone})`;}catch{return value;}
  return value;
}
interface Props { batch: ProposalBatch; onChange: (batch: ProposalBatch) => void; onApplied?: () => Promise<void>; onReview: (message: string) => void;timeZone?:string;entityLabels?:Map<string,string> }
export function AgentProposalCards({ batch, onChange, onApplied, onReview,timeZone='UTC',entityLabels }: Props) {
  const [selected, setSelected] = useState(() => batch.actions.filter(action => action.status === "pending"&&Object.hasOwn(HEADINGS,action.type)).map(action => action.id));
  const [working, setWorking] = useState<"apply" | "cancel" | null>(null);
  const inFlight = useRef(false);
  const [feedback, setFeedback] = useState("");
  const pending = batch.actions.filter(action => action.status === "pending"&&Object.hasOwn(HEADINGS,action.type));
  const selectedIds = selected.filter(id => pending.some(action => action.id === id));
  const perform = async (operation: "apply" | "cancel") => {
    if (inFlight.current) return;
    const actionIds = operation === "cancel" ? pending.map(action => action.id) : selectedIds;
    if (!actionIds.length) return;
    inFlight.current = true; setWorking(operation); setFeedback("");
    const beforeApplied = new Set(batch.actions.filter(action => action.status === "applied").map(action => action.id));
    let updated: ProposalBatch | undefined;
    try {
      const response = await fetch(`/api/ai/agent/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: batch.runId, actionIds }), cache: "no-store", signal: AbortSignal.timeout(55_000) });
      const payload = await response.json() as { proposalBatch?: ProposalBatch; error?: { message?: string } };
      if (!response.ok || !payload.proposalBatch) throw new Error(payload.error?.message ?? "Could not confirm the action status.");
      updated = payload.proposalBatch;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not confirm the action status.");
      // A lost response is not proof of failure. Recover persisted status before retrying.
      try {
        const response = await fetch(`/api/ai/agent/apply?runId=${encodeURIComponent(batch.runId)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const payload = await response.json() as { proposalBatch?: ProposalBatch };
        if (response.ok) updated = payload.proposalBatch;
      } catch { /* Keep proposal IDs for a safe retry; SQL prevents duplicate execution. */ }
    }
    try {
      if (updated) {
        onChange(updated);
        const applied = updated.actions.filter(action => action.status === "applied" && !beforeApplied.has(action.id)).length;
        const conflicts = updated.actions.filter(action => actionIds.includes(action.id) && action.status === "conflict").length;
        const failed = updated.actions.filter(action => actionIds.includes(action.id) && action.status === "failed").length;
        const cancelled = updated.actions.filter(action => actionIds.includes(action.id) && action.status === "cancelled").length;
        const remaining = updated.actions.filter(action => actionIds.includes(action.id) && action.status === "pending").length;
        setFeedback([applied ? `Applied ${applied} change${applied === 1 ? "" : "s"}.` : "", conflicts ? `${conflicts} conflict${conflicts === 1 ? "" : "s"}.` : "", failed ? `${failed} failed.` : "", cancelled ? `Cancelled ${cancelled} proposal${cancelled === 1 ? "" : "s"}.` : "", remaining ? "Some actions are still pending. Check again before retrying." : ""].filter(Boolean).join(" "));
        if (applied) await onApplied?.();
      }
    } catch { setFeedback("Changes applied, but the workspace could not refresh. Refresh the page to see the latest Calendar."); }
    finally { inFlight.current = false; setWorking(null); }
  };
  return <section aria-label="Proposed workspace changes" className="min-w-0 space-y-3 rounded-2xl dark-inset p-3 text-xs">
    {batch.actions.some(action=>action.undoOf)&&<div className="min-w-0 space-y-1 [overflow-wrap:anywhere]"><p className="font-semibold">Undo proposal</p><p>Nothing has changed yet. Review this reversal before applying.</p>{batch.actions.filter(action=>action.undoOf).map(action=><p key={action.id}>Undo of action from {new Intl.DateTimeFormat(undefined,{timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(action.undoOf!.createdAt))}</p>)}</div>}
    <p className="font-semibold">{batch.actions.length} proposed change{batch.actions.length === 1 ? "" : "s"}</p>
    {batch.actions.map(action => <article key={action.id} className="min-w-0 space-y-2 rounded-xl border border-[var(--edge-dark)] p-3">
      <label className="flex min-w-0 items-start gap-2">{Object.hasOwn(HEADINGS,action.type)&&<input type="checkbox" aria-label={`Select ${action.title}`} disabled={working !== null || action.status !== "pending"} checked={selectedIds.includes(action.id)} onChange={event => setSelected(current => event.target.checked ? [...current, action.id] : current.filter(id => id !== action.id))} />}<span className="min-w-0 break-words font-semibold">{HEADINGS[action.type]??'Unsupported action: '}{action.title}</span></label>
      {(action.type==='create_milestone'||action.type==='update_milestone')&&<p className="break-words [overflow-wrap:anywhere]">Project: {entityLabels?.get(`project:${action.projectId}`)??'Unavailable project'}</p>}
      {action.diff.map(diff => <div key={diff.field} className="min-w-0"><p className="t-dark-muted">{LABELS[diff.field]}</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{diff.field==='taskId'||diff.field==='projectId'?diff.before?entityLabels?.get(`${diff.field==='taskId'?'task':'project'}:${diff.before}`)??diff.before:'None':diff.field==='milestoneId'&&diff.before&&/^[0-9a-f-]{36}$/i.test(diff.before)?entityLabels?.get(`milestone:${diff.before}`)??'Unavailable milestone':display(diff.field,diff.before,timeZone)} → {diff.field==='taskId'||diff.field==='projectId'?diff.after?entityLabels?.get(`${diff.field==='taskId'?'task':'project'}:${diff.after}`)??diff.after:'None':diff.field==='milestoneId'&&diff.after&&/^[0-9a-f-]{36}$/i.test(diff.after)?entityLabels?.get(`milestone:${diff.after}`)??'Unavailable milestone':display(diff.field,diff.after,timeZone)}</p></div>)}
      <p className="t-dark-muted">{action.status === "pending" ? "Pending approval" : action.status === "conflict" ? "Entity or availability changed. Review again before applying." : action.status === "failed" ? "Could not apply this change. Review it again." : action.status === "applied" ? "Applied" : "Proposal cancelled"}</p>
      {Object.hasOwn(HEADINGS,action.type)&&(action.status === "conflict" || action.status === "failed") && <button type="button" className="dark-chip px-2 py-1" onClick={() => onReview(buildAgentReviewPrompt(action,timeZone,entityLabels))}>Review again</button>}
    </article>)}
    {pending.length > 0 && <div className="flex flex-wrap gap-2"><button type="button" disabled={working !== null || selectedIds.length === 0} onClick={() => void perform("apply")} className="ink-button primary px-3 py-2 disabled:opacity-50">{working === "apply" ? "Applying…" : "Apply selected"}</button><button type="button" disabled={working !== null} onClick={() => void perform("cancel")} className="dark-chip px-3 py-2 disabled:opacity-50">{working === "cancel" ? "Cancelling…" : "Cancel"}</button></div>}
    {feedback && <p role="status" className="break-words">{feedback}</p>}
  </section>;
}
