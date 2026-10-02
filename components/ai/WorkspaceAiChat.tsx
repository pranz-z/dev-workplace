"use client";

import { Paperclip, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { Plan, Project, Task } from "@/types";
import { ChatMessageBubble, ChatTypingIndicator, type ChatMessage } from "@/components/ai/ChatPresentation";
import { MAX_CHAT_ENTITIES, MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, MAX_CHAT_TOTAL_FILE_BYTES, MAX_CHAT_HISTORY_MESSAGES, MAX_CHAT_MESSAGE_LENGTH, type WorkspaceEntityRef } from "@/lib/ai/chat-contract";
import { parseWorkspaceEntityDragPayload, WORKSPACE_AI_DRAG_TYPE } from "@/lib/ai/chat-drag";

const ACCEPT = ".txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.html,.css,.scss,.sql,.yaml,.yml,.toml,.xml,.java,.go,.rs,.sh,.bash,.c,.h,.cpp,.hpp,.cs,.php,.rb,.swift,.kt,.vue,.svelte,.pdf,.png,.jpg,.jpeg,.webp";
const supportedText = new Set(ACCEPT.split(",").filter((item) => ![".pdf", ".png", ".jpg", ".jpeg", ".webp"].includes(item)));

function supportedFile(file: File): boolean {
  const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  const imageOrPdf = extension === ".pdf" ? !file.type || file.type === "application/pdf" : extension === ".png" ? !file.type || file.type === "image/png" : [".jpg", ".jpeg"].includes(extension) ? !file.type || file.type === "image/jpeg" : extension === ".webp" ? !file.type || file.type === "image/webp" : false;
  return supportedText.has(extension) || imageOrPdf;
}

interface Props { projects: Project[]; tasks: Task[]; plans: Plan[] }

export function WorkspaceAiChat({ projects, tasks, plans }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [context, setContext] = useState<WorkspaceEntityRef[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [contextType, setContextType] = useState<WorkspaceEntityRef["type"]>("project");
  const [pickerId, setPickerId] = useState("");
  const [query, setQuery] = useState("");
  const requestSequence = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const entities = useMemo(() => ({ project: projects.map((item) => ({ id: item.id, title: item.name })), task: tasks.map((item) => ({ id: item.id, title: item.title })), plan: plans.map((item) => ({ id: item.id, title: item.title })) }), [projects, tasks, plans]);
  const labels = useMemo(() => new Map([
    ...projects.map((item) => [`project:${item.id}`, item.name] as const),
    ...tasks.map((item) => [`task:${item.id}`, item.title] as const),
    ...plans.map((item) => [`plan:${item.id}`, item.title] as const),
  ]), [projects, tasks, plans]);
  const choices = entities[contextType].filter((item) => item.title.toLowerCase().includes(query.toLowerCase())).slice(0, 100);
  const entityContext = context;

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, busy, open]);
  useEffect(() => {
    const onDragEnter = (event: globalThis.DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).some((type) => type === "Files" || type === WORKSPACE_AI_DRAG_TYPE)) { setDragging(true); setOpen(true); }
    };
    const onDragEnd = () => setDragging(false);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragend", onDragEnd);
    return () => { window.removeEventListener("dragenter", onDragEnter); window.removeEventListener("dragend", onDragEnd); };
  }, []);

  const addEntity = (entity: WorkspaceEntityRef) => {
    setError("");
    if (context.some((item) => item.type === entity.type && item.id === entity.id)) return;
    if (context.length >= MAX_CHAT_ENTITIES) { setError(`Attach up to ${MAX_CHAT_ENTITIES} workspace items.`); return; }
    setContext((current) => [...current, entity]);
  };

  const addFiles = (incoming: File[]) => {
    setError("");
    const next = [...files];
    let problem = "";
    for (const file of incoming) {
      if (!supportedFile(file)) { problem = "That file type is not supported. Add a text/code file, PDF, PNG, JPEG, or WebP."; continue; }
      if (file.size <= 0 || file.size > MAX_CHAT_FILE_BYTES) { problem = "Each attachment must be 2 MB or smaller."; continue; }
      if (next.length >= MAX_CHAT_FILES) { problem = `Attach up to ${MAX_CHAT_FILES} files per message.`; break; }
      if (next.reduce((total, item) => total + item.size, file.size) > MAX_CHAT_TOTAL_FILE_BYTES) { problem = "Attachments must total 4 MB or less."; continue; }
      if (!next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
    }
    setFiles(next);
    if (problem) setError(problem);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const entityJson = event.dataTransfer.getData(WORKSPACE_AI_DRAG_TYPE);
    if (entityJson) {
      const entity = parseWorkspaceEntityDragPayload(entityJson);
      if (entity && entities[entity.type].some((item) => item.id === entity.id)) addEntity(entity);
      return;
    }
    addFiles(Array.from(event.dataTransfer.files));
  };

  const clearChat = () => { requestSequence.current += 1; setBusy(false); setMessages([]); setContext([]); setFiles([]); setMessage(""); setError(""); };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim() || busy) return;
    const question = message.trim();
    const sequence = ++requestSequence.current;
    const prior = messages.slice(-MAX_CHAT_HISTORY_MESSAGES);
    const submittedFiles = [...files];
    setMessages((current) => [...current, { role: "user" as const, content: question }].slice(-MAX_CHAT_HISTORY_MESSAGES * 2));
    setMessage(""); setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("request", JSON.stringify({ message: question, history: prior, workspaceContext: entityContext }));
      submittedFiles.forEach((file) => form.append("files", file, file.name));
      const response = await fetch("/api/ai/chat", { method: "POST", body: form, cache: "no-store" });
      const payload = await response.json() as { answer?: string; error?: { message?: string } };
      if (!response.ok || typeof payload.answer !== "string") throw new Error(payload.error?.message || "The workspace assistant is temporarily unavailable.");
      if (sequence === requestSequence.current) {
        setMessages((current) => [...current, { role: "assistant" as const, content: payload.answer! }].slice(-MAX_CHAT_HISTORY_MESSAGES * 2));
        setFiles([]);
      }
    } catch (caught) {
      if (sequence === requestSequence.current) setError(caught instanceof Error ? caught.message : "The workspace assistant is temporarily unavailable.");
    } finally { if (sequence === requestSequence.current) setBusy(false); }
  };

  const panel = <section onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={handleDrop} aria-label="Workspace AI chat" className={`fixed z-50 flex flex-col overflow-hidden border border-[var(--edge-dark)] bg-[var(--surface-dark)] shadow-[var(--shadow-dark-lift)] ${open ? "inset-x-0 bottom-0 h-[82dvh] rounded-t-3xl md:inset-auto md:bottom-6 md:right-6 md:h-[min(78vh,680px)] md:w-[min(92vw,440px)] md:rounded-3xl" : "bottom-4 right-4 h-14 w-14 rounded-full"}`}>
    {!open ? <button type="button" onClick={() => setOpen(true)} aria-label="Open Workspace AI chat" className="flex h-full w-full items-center justify-center gap-1 rounded-full t-dark"><Sparkles size={17} /><span className="text-xs font-bold">AI</span></button> : <>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--edge-dark)] p-4">
        <div><p className="eyebrow t-mood">Private workspace assistant</p><h2 className="mt-1 text-lg font-semibold t-dark">Workspace AI</h2><p className="mt-1 text-xs t-dark-muted">Only the message, attached context, and files are sent when you send.</p></div>
        <div className="flex gap-1"><button type="button" title="Clear chat" aria-label="Clear chat" onClick={clearChat} className="dark-chip p-2"><Trash2 size={15} /></button><button type="button" title="Minimize chat" aria-label="Minimize chat" onClick={() => setOpen(false)} className="dark-chip p-2"><X size={15} /></button></div>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && <ChatMessageBubble role="assistant">How can I help with your workspace?</ChatMessageBubble>}
        {messages.map((item, index) => <ChatMessageBubble key={`${index}-${item.role}`} role={item.role}>{item.content}</ChatMessageBubble>)}
        {busy && <ChatTypingIndicator />}
      </div>
      <div className="shrink-0 space-y-2 border-t border-[var(--edge-dark)] p-3">
        <div className="flex flex-wrap gap-1.5" aria-label="Attached workspace context">
          {entityContext.map((item) => <span key={`${item.type}:${item.id}`} className="dark-chip inline-flex max-w-full items-center gap-1 px-2 py-1 text-xs">{item.type}: {labels.get(`${item.type}:${item.id}`) ?? "Selected item"}<button type="button" onClick={() => setContext((current) => current.filter((ref) => ref.id !== item.id || ref.type !== item.type))} aria-label={`Remove ${item.type} context`}><X size={12} /></button></span>)}
          {files.map((file) => <span key={`${file.name}:${file.lastModified}`} className="dark-chip inline-flex max-w-full items-center gap-1 px-2 py-1 text-xs"><Paperclip size={12} /><span className="max-w-36 truncate">{file.name.replace(/[\\/\u0000-\u001f]/g, "_")}</span><button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} aria-label={`Remove ${file.name}`}><X size={12} /></button></span>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Context type" value={contextType} onChange={(event) => { setContextType(event.target.value as WorkspaceEntityRef["type"]); setPickerId(""); }} className="dark-chip px-2 py-1.5 text-xs"><option value="project">Project</option><option value="task">Task</option><option value="plan">Plan</option></select>
          <input aria-label="Search workspace context" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find context" className="min-w-20 flex-1 rounded-xl dark-inset px-2 py-1.5 text-xs t-dark" />
          <select aria-label="Workspace item to attach" value={pickerId} onChange={(event) => setPickerId(event.target.value)} className="min-w-20 flex-1 rounded-xl dark-inset px-2 py-1.5 text-xs t-dark"><option value="">Choose…</option>{choices.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <button type="button" disabled={!pickerId} onClick={() => { addEntity({ type: contextType, id: pickerId }); setPickerId(""); }} className="dark-chip px-2 py-1.5 text-xs disabled:opacity-50">Add context</button>
        </div>
        <p className="text-[10px] leading-4 t-dark-muted">Files stay on this device until you send. Sent files go directly to Gemini for this request and are not saved by this app.</p>
        <form onSubmit={(event) => void send(event)} className="flex items-end gap-2">
          <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
          <button type="button" title="Attach file" aria-label="Attach file" onClick={() => fileInput.current?.click()} className="dark-chip p-2"><Paperclip size={16} /></button>
          <textarea aria-label="Message Workspace AI" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={MAX_CHAT_MESSAGE_LENGTH} rows={2} placeholder="Ask about your workspace…" className="min-w-0 flex-1 resize-none rounded-2xl dark-inset px-3 py-2 text-sm t-dark" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <button type="submit" disabled={busy || !message.trim()} aria-label="Send message" className="ink-button primary p-2 disabled:opacity-50">{busy ? <span className="px-1 text-xs">…</span> : <Send size={16} />}</button>
        </form>
        {error && <p role="alert" className="text-xs text-[var(--accent-peach)]">{error}</p>}
      </div>
    </>}
  </section>;

  return <>
    {dragging && <div aria-hidden="true" className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--scrim)]/40 p-6 pointer-events-none"><div className="rounded-3xl border-2 border-dashed border-[var(--ink-lavender)] bg-[var(--surface-dark)]/95 px-8 py-6 text-center text-lg font-semibold t-dark shadow-xl">Drop into AI context</div></div>}
    {panel}
  </>;
}
