"use client";
import { useRef, useState } from "react";
import type { ProposalBatch, TaskChanges } from "@/lib/ai/agent/contract";
import { formatCalendarDate, isValidCalendarDate } from "@/data/workspaceCalendar";

const LABELS: Record<keyof TaskChanges, string> = { title: "Title", description: "Description", priority: "Priority", status: "Status", dueDate: "Due date", milestoneId: "Milestone" };
function display(field: keyof TaskChanges, value: string | null) {
  if (value === null || value === "") return "None";
  if (field === "dueDate" && isValidCalendarDate(value)) return formatCalendarDate(value, { month: "short", day: "numeric", year: "numeric" });
  return value;
}
interface Props { batch: ProposalBatch; onChange: (batch: ProposalBatch) => void; onApplied?: () => Promise<void>; onReview: (message: string) => void }
export function AgentProposalCards({ batch, onChange, onApplied, onReview }: Props) {
  const [selected, setSelected] = useState(() => batch.actions.filter(action => action.status === "pending").map(action => action.id));
  const [working, setWorking] = useState<"apply" | "cancel" | null>(null);
  const inFlight = useRef(false);
  const [feedback, setFeedback] = useState("");
  const pending = batch.actions.filter(action => action.status === "pending");
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
    } catch { setFeedback("Changes applied, but the workspace could not refresh. Refresh the page to see the latest tasks."); }
    finally { inFlight.current = false; setWorking(null); }
  };
  return <section aria-label="Proposed task changes" className="min-w-0 space-y-3 rounded-2xl dark-inset p-3 text-xs">
    <p className="font-semibold">{batch.actions.length} proposed task change{batch.actions.length === 1 ? "" : "s"}</p>
    {batch.actions.map(action => <article key={action.id} className="min-w-0 space-y-2 rounded-xl border border-[var(--edge-dark)] p-3">
      <label className="flex min-w-0 items-start gap-2"><input type="checkbox" aria-label={`Select ${action.title}`} disabled={working !== null || action.status !== "pending"} checked={selectedIds.includes(action.id)} onChange={event => setSelected(current => event.target.checked ? [...current, action.id] : current.filter(id => id !== action.id))} /><span className="min-w-0 break-words font-semibold">{action.type === "create_task" ? "Create task: " : ""}{action.title}</span></label>
      {action.diff.map(diff => <div key={diff.field} className="min-w-0"><p className="t-dark-muted">{LABELS[diff.field]}</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{display(diff.field, diff.before)} → {display(diff.field, diff.after)}</p></div>)}
      <p className="t-dark-muted">{action.status === "pending" ? "Pending approval" : action.status === "conflict" ? "Task changed since this proposal was created. Review it again before applying." : action.status === "failed" ? "Could not apply this change. Review it again." : action.status === "applied" ? "Applied" : "Cancelled"}</p>
      {(action.status === "conflict" || action.status === "failed") && <button type="button" className="dark-chip px-2 py-1" onClick={() => onReview(`Review the current state of task ${action.title} (${action.taskId ?? action.projectId}) and prepare a fresh proposal for the requested changes.`)}>Review again</button>}
    </article>)}
    {pending.length > 0 && <div className="flex flex-wrap gap-2"><button type="button" disabled={working !== null || selectedIds.length === 0} onClick={() => void perform("apply")} className="ink-button primary px-3 py-2 disabled:opacity-50">{working === "apply" ? "Applying…" : "Apply selected"}</button><button type="button" disabled={working !== null} onClick={() => void perform("cancel")} className="dark-chip px-3 py-2 disabled:opacity-50">{working === "cancel" ? "Cancelling…" : "Cancel"}</button></div>}
    {feedback && <p role="status" className="break-words">{feedback}</p>}
  </section>;
}
