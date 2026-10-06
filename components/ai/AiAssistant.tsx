"use client";

import { useEffect, useState } from "react";
import type { AiAction, AiContextSelection, AiOutput, PriorityLabel } from "@/lib/ai/schemas";
import { clearAiSelection, getSelectedAiItems, hasAiSelection, toggleAiSelection } from "@/lib/ai/selection";
import type { NoteItem, Project, Task } from "@/types";

type TaskProposal = { title: string; description: string; priority: PriorityLabel };
type CaseStudyPatch = { publicSummary?: string; publicProblem?: string; publicSolution?: string; publicResult?: string };

interface AiAssistantProps {
  mode: "project" | "task" | "note";
  project?: Project;
  task?: Task;
  note?: NoteItem;
  projects?: Project[];
  onAddTasks: (projectId: string, tasks: TaskProposal[]) => Promise<void>;
  onSetNextAction: (projectId: string, nextAction: string) => Promise<void>;
  onApplyDescription: (projectId: string, description: string) => Promise<void>;
  onApplyCaseStudy: (projectId: string, patch: CaseStudyPatch) => Promise<void>;
  onApplyNoteSummary: (noteId: string, content: string) => Promise<void>;
}

const labels: Record<AiAction, string> = {
  next_actions: "Suggest next actions", break_project: "Break into tasks", break_task: "Break down",
  summarize_note: "Summarize", extract_actions: "Extract actions", improve_description: "Improve description",
  draft_case_study: "Draft case study", progress_summary: "Summarize progress", ask_project: "Ask AI",
};

const defaultsFor = (action: AiAction): AiContextSelection => action === "progress_summary"
  ? { tasks: true, milestones: true, plans: false, notes: false, github: false, accountability: false }
  : { projectDetails: true, tasks: true, milestones: true, plans: false, notes: false, github: false, accountability: false };

const toTaskPriority = (priority: PriorityLabel): Task["priority"] => priority === "high" ? "High" : priority === "low" ? "Low" : "Medium";

export function AiAssistant(props: AiAssistantProps) {
  const { mode, project, task, note, projects = [] } = props;
  const [action, setAction] = useState<AiAction | null>(null);
  const [context, setContext] = useState<AiContextSelection>({});
  const [output, setOutput] = useState<AiOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [caseStudyFields, setCaseStudyFields] = useState<string[]>(["summary", "challenge", "solution", "outcome"]);
  const [summaryMode, setSummaryMode] = useState<"append" | "replace">("append");
  const [targetProjectId, setTargetProjectId] = useState(note?.projectId ?? project?.id ?? projects[0]?.id ?? "");

  const begin = (nextAction: AiAction) => {
    setAction(nextAction);
    setContext(defaultsFor(nextAction));
    setOutput(null);
    setError("");
    setNotice("");
    setSelected(clearAiSelection());
    setQuestion("");
  };

  const generate = async () => {
    if (!action || busy) return;
    if (action === "ask_project" && !question.trim()) {
      setError("Enter a question about this project.");
      return;
    }
    setBusy(true);
    setSelected(clearAiSelection());
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(mode === "task" && task ? { taskId: task.id } : {}),
          ...(mode === "note" && note ? { noteId: note.id } : {}),
          ...(mode !== "note" && project ? { projectId: project.id } : {}),
          ...(action === "ask_project" ? { question: question.trim(), history: history.slice(-6) } : {}),
          context,
        }),
      });
      const payload = await response.json() as { output?: AiOutput; error?: { message?: string } };
      if (!response.ok || !payload.output) throw new Error(payload.error?.message || "The AI assistant could not complete this request.");
      setOutput(payload.output);
      if (action === "ask_project") {
        const answer = "answer" in payload.output ? payload.output.answer : "";
        setHistory((current) => [...current, { role: "user" as const, content: question.trim() }, { role: "assistant" as const, content: answer }].slice(-6));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The AI assistant could not complete this request.");
    } finally {
      setBusy(false);
    }
  };

  const withNotice = async (work: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The selected change could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = (index: number) => setSelected((current) => toggleAiSelection(current, index));
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice("Copied."); }
    catch { setError("Clipboard access is unavailable in this browser."); }
  };
  const updateContext = (key: keyof AiContextSelection, value: boolean) => setContext((current) => ({ ...current, [key]: value }));

  const taskButtons = mode === "project" ? (
    <div className="flex flex-wrap gap-2">
      {(["next_actions", "break_project", "improve_description", "draft_case_study", "progress_summary", "ask_project"] as const).map((item) => (
        <button key={item} type="button" onClick={() => begin(item)} className="dark-chip px-3 py-2 text-sm">{labels[item]}</button>
      ))}
    </div>
  ) : mode === "task" ? <button type="button" onClick={() => begin("break_task")} className="dark-chip px-2 py-1 text-xs">Break down</button>
    : <div className="flex flex-wrap gap-1"><button type="button" onClick={() => begin("summarize_note")} className="dark-chip px-2 py-1 text-xs">Summarize</button><button type="button" onClick={() => begin("extract_actions")} className="dark-chip px-2 py-1 text-xs">Extract actions</button></div>;

  const inputActions: AiAction[] = mode === "project" ? ["next_actions", "break_project", "improve_description", "draft_case_study", "progress_summary", "ask_project"] : mode === "task" ? ["break_task"] : ["summarize_note", "extract_actions"];
  const renderContextControls = action === "progress_summary" || action === "ask_project" || action === "draft_case_study";
  const contextChoices: Array<[keyof AiContextSelection, string]> = action === "progress_summary"
    ? [["tasks", "Tasks"], ["milestones", "Milestones"], ["plans", "Plans"], ["github", "GitHub activity"], ["accountability", "Accountability summary"], ["notes", "Notes"]]
    : action === "draft_case_study" ? [["notes", "Include this project’s notes"]]
      : [["projectDetails", "Project details"], ["tasks", "Tasks"], ["milestones", "Milestones"], ["plans", "Plans"], ["notes", "Notes"], ["github", "GitHub activity"], ["accountability", "Accountability summary"]];

  return <>
    <div className="flex flex-wrap items-center gap-2">{taskButtons}</div>
    {mode === "project" && <p className="mt-2 text-xs t-dark-muted">Selected workspace information is sent to Gemini for the requested action. Notes and GitHub activity stay off unless you select them.</p>}
    {mode === "note" && <p className="mt-1 text-[11px] t-dark-muted">Only this note is sent to Gemini.</p>}

    {action && <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[var(--scrim)] p-3 backdrop-blur-sm sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="ai-dialog-title" className="notebook-dense my-5 max-h-[92vh] w-full max-w-3xl overflow-y-auto dark-panel p-4 shadow-[var(--shadow-dark-lift)] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><p className="eyebrow t-mood">AI suggestion</p><h2 id="ai-dialog-title" className="mt-1 text-xl font-semibold t-dark">{labels[action]}</h2><p className="mt-1 text-xs t-dark-muted">Review generated content before applying it. Gemini cannot save changes.</p></div>
          <button type="button" aria-label="Close AI assistant" disabled={busy} onClick={() => { setAction(null); setOutput(null); setSelected(clearAiSelection()); }} className="dark-chip px-3 py-2 text-sm">Close</button>
        </div>

        {renderContextControls && <div className="mt-4 rounded-xl dark-inset p-3">
          <p className="text-sm font-medium t-dark">Context sent to Gemini</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {contextChoices.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm t-dark-muted"><input type="checkbox" checked={context[key] ?? false} onChange={(event) => updateContext(key, event.target.checked)} />{label}</label>)}
          </div>
        </div>}

        {action === "ask_project" && <div className="mt-4"><label className="block text-sm t-dark-muted">Question<textarea maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} className="mt-1 w-full dark-chip px-3 py-2" placeholder="What should I work on next?" /></label>
          {history.length > 0 && <button type="button" onClick={() => setHistory([])} className="mt-2 dark-chip px-2 py-1 text-xs">Clear this project’s conversation</button>}
        </div>}

        <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void generate()} disabled={busy || inputActions.length === 0} className="ink-button primary px-3 py-2 text-sm">{busy ? "Generating…" : output ? "Regenerate" : "Generate"}</button>
          {output && <button type="button" onClick={() => { setOutput(null); setSelected(clearAiSelection()); }} disabled={busy} className="dark-chip px-3 py-2 text-sm">Discard result</button>}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-[var(--accent-peach)]">{error}</p>}
        {notice && <p role="status" data-feedback="success" className="mt-3 text-sm t-dark-muted">{notice}</p>}

        {output && <div className="mt-5 space-y-3">
          {("suggestions" in output || "tasks" in output || "actions" in output) && (() => {
            const items = "suggestions" in output ? output.suggestions : "tasks" in output ? output.tasks : output.actions;
            return <div className="space-y-2">{items.map((item, index) => <label key={`${item.title}-${index}`} className="flex items-start gap-3 rounded-xl dark-inset p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={selected.includes(index)} onChange={() => toggleSelected(index)} />
              <span className="min-w-0 flex-1"><span className="font-medium t-dark">{item.title}</span>{"description" in item && item.description && <span className="mt-1 block t-dark-muted">{item.description}</span>}{"rationale" in item && <span className="mt-1 block t-dark-muted">{item.rationale}</span>}{"detail" in item && item.detail && <span className="mt-1 block t-dark-muted">{item.detail}</span>}{"priority" in item && <span className="mt-1 block text-xs uppercase t-dark-muted">{item.priority} priority</span>}</span>
            </label>)}
              {"tasks" in output && <button type="button" disabled={busy || !hasAiSelection(selected) || !project?.id} onClick={() => void withNotice(async () => {
                const tasks = getSelectedAiItems(output.tasks, selected).map((entry) => ({ ...entry, priority: entry.priority }));
                await props.onAddTasks(project!.id, tasks);
              }, "Selected tasks were added to the project.")} className="ink-button primary px-3 py-2 text-sm">Add selected tasks</button>}
              {"actions" in output && <div className="flex flex-wrap items-center gap-2"><select aria-label="Project for extracted actions" value={targetProjectId} onChange={(event) => setTargetProjectId(event.target.value)} className="dark-chip px-3 py-2 text-sm">{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" disabled={busy || !hasAiSelection(selected) || !targetProjectId} onClick={() => void withNotice(async () => {
                const tasks = getSelectedAiItems(output.actions, selected).map((entry) => ({ title: entry.title, description: entry.detail, priority: "medium" as const }));
                await props.onAddTasks(targetProjectId, tasks);
              }, "Selected actions were added as project tasks.")} className="ink-button primary px-3 py-2 text-sm">Add selected as tasks</button></div>}
              {"suggestions" in output && selected.length === 1 && project && <div className="flex flex-wrap gap-2">{(() => { const suggestion = output.suggestions[selected[0]]; return <><button type="button" disabled={busy} onClick={() => void withNotice(() => props.onAddTasks(project.id, [{ title: suggestion.title, description: suggestion.rationale, priority: suggestion.priority }]), "Suggestion added as a task.")} className="dark-chip px-3 py-2 text-sm">Add as task</button><button type="button" disabled={busy} onClick={() => void withNotice(() => props.onSetNextAction(project.id, suggestion.title), "Project next action updated.")} className="dark-chip px-3 py-2 text-sm">Use as next action</button></>; })()}</div>}
            </div>;
          })()}

          {"summary" in output && <div className="rounded-xl dark-inset p-4"><p className="whitespace-pre-wrap text-sm leading-6 t-dark-soft">{output.summary}</p>
            {action === "summarize_note" && note && <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void copy(output.summary)} className="dark-chip px-3 py-2 text-sm">Copy</button><select aria-label="How to apply note summary" value={summaryMode} onChange={(event) => setSummaryMode(event.target.value as "append" | "replace")} className="dark-chip px-3 py-2 text-sm"><option value="append">Append to note</option><option value="replace">Replace note</option></select><button type="button" disabled={busy} onClick={() => void withNotice(() => props.onApplyNoteSummary(note.id, summaryMode === "append" ? `${note.content}${note.content.trim() ? "\n\n" : ""}Summary\n${output.summary}` : output.summary), summaryMode === "append" ? "Summary appended to the note." : "Note replaced with the summary.")} className="ink-button primary px-3 py-2 text-sm">Apply to note</button></div>}
            {action === "progress_summary" && "completedHighlights" in output && <button type="button" onClick={() => void copy([output.summary, ...(output.completedHighlights.length ? ["Completed", ...output.completedHighlights] : []), ...(output.attentionItems.length ? ["Needs attention", ...output.attentionItems] : []), ...(output.suggestedNextSteps.length ? ["Suggested next steps", ...output.suggestedNextSteps] : [])].join("\n"))} className="mt-3 dark-chip px-3 py-2 text-sm">Copy summary</button>}
          </div>}
          {"completedHighlights" in output && action === "progress_summary" && <div className="grid gap-3 sm:grid-cols-3">{[["Completed highlights", output.completedHighlights], ["Attention items", output.attentionItems], ["Suggested next steps", output.suggestedNextSteps]].map(([heading, entries]) => <div key={heading as string} className="rounded-xl dark-inset p-3"><p className="text-sm font-medium t-dark">{heading as string}</p><ul className="mt-2 list-inside list-disc space-y-1 text-sm t-dark-muted">{(entries as string[]).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ul></div>)}</div>}
          {"answer" in output && <div className="rounded-xl dark-inset p-4"><p className="whitespace-pre-wrap text-sm leading-6 t-dark-soft">{output.answer}</p><button type="button" onClick={() => void copy(output.answer)} className="mt-3 dark-chip px-3 py-2 text-sm">Copy</button></div>}
          {"description" in output && project && <div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl dark-inset p-3"><p className="eyebrow t-dark-muted">Current</p><p className="mt-2 whitespace-pre-wrap text-sm t-dark-soft">{project.description || "No description"}</p></div><div className="rounded-xl dark-inset p-3"><p className="eyebrow t-mood">AI suggestion</p><p className="mt-2 whitespace-pre-wrap text-sm t-dark-soft">{output.description}</p></div><div className="flex flex-wrap gap-2 md:col-span-2"><button type="button" onClick={() => void copy(output.description)} className="dark-chip px-3 py-2 text-sm">Copy</button><button type="button" disabled={busy} onClick={() => void withNotice(() => props.onApplyDescription(project.id, output.description), "Project description updated.")} className="ink-button primary px-3 py-2 text-sm">Apply description</button></div></div>}
          {"challenge" in output && project && <div className="space-y-3">{([["summary", "Summary", output.summary], ["challenge", "Challenge", output.challenge], ["solution", "Solution", output.solution], ["outcome", "Outcome", output.outcome]] as const).map(([key, label, content]) => <label key={key} className="block rounded-xl dark-inset p-3"><span className="flex items-center gap-2 text-sm font-medium t-dark"><input type="checkbox" checked={caseStudyFields.includes(key)} onChange={(event) => setCaseStudyFields((current) => event.target.checked ? [...current, key] : current.filter((field) => field !== key))} />{label}</span><textarea readOnly value={content} rows={2} className="mt-2 w-full dark-chip px-3 py-2 text-sm" /></label>)}<button type="button" disabled={busy || caseStudyFields.length === 0} onClick={() => void withNotice(() => props.onApplyCaseStudy(project.id, Object.fromEntries(caseStudyFields.map((field) => [field === "summary" ? "publicSummary" : field === "challenge" ? "publicProblem" : field === "solution" ? "publicSolution" : "publicResult", output[field as keyof typeof output]])) as CaseStudyPatch), "Selected case-study fields were applied to this project.")} className="ink-button primary px-3 py-2 text-sm">Apply selected fields</button></div>}
        </div>}
        <p className="mt-5 border-t border-[var(--edge-dark)] pt-3 text-xs t-dark-muted">Selected workspace information is sent to Gemini for this request. Notes and GitHub activity are excluded unless you enable them. Usage and data handling follow your configured Gemini service terms. No content is saved automatically.</p>
      </section>
    </div>}
  </>;
}

export function AiSettingsStatus() {
  const [status, setStatus] = useState<{ configured: boolean; model: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/ai", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("status");
      const next = await response.json() as { configured: boolean; model: string | null };
      if (active) setStatus(next);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  return <div className="dark-inset p-4"><p className="text-sm font-medium t-dark">AI Assistant</p><p className="mt-2 text-sm t-dark-muted">{failed ? "Status unavailable" : status ? status.configured ? "Configured" : "Not configured" : "Checking…"}</p>{status?.configured && status.model && <p className="mt-1 text-xs t-dark-muted">Model: {status.model}</p>}</div>;
}

export { toTaskPriority };
