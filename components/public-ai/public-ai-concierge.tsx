"use client";

import Link from "next/link";
import { Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChatMessageBubble, ChatTypingIndicator, type ChatMessage } from "@/components/ai/ChatPresentation";

const suggestedQuestions = [
  "What does Franz specialize in?",
  "What experience does Franz have at BMWare?",
  "What AI systems has Franz built?",
  "What technologies does Franz work with?",
  "What did Franz build for his thesis?",
  "How can I contact Franz?",
  "Tell me about Frami.",
  "Where can I download his resume?",
];

type PublicChatMessage = ChatMessage & { showResumeLink?: boolean };

export function PublicAiConcierge() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<PublicChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/public-ai", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("availability");
      const payload = await response.json() as { available?: boolean };
      if (active) setAvailable(payload.available === true);
    }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      questionRef.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      launcherRef.current?.focus();
    }
  }, [open]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, busy, open]);

  const clearChat = () => { setMessages([]); setQuestion(""); setError(""); };

  const ask = async (text: string) => {
    const currentQuestion = text.trim();
    if (!currentQuestion || busy) return;
    const history = messages.slice(-6).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user" as const, content: currentQuestion }].slice(-12));
    setQuestion(""); setBusy(true); setError("");
    try {
      const response = await fetch("/api/public-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion, history }),
      });
      const payload = await response.json() as { answer?: string; relatedProjects?: Array<{ slug: string; title: string }>; error?: { message?: string } };
      if (!response.ok || typeof payload.answer !== "string") throw new Error(payload.error?.message || "The portfolio assistant is temporarily unavailable.");
      setMessages((current) => [...current, { role: "assistant" as const, content: payload.answer!, relatedProjects: Array.isArray(payload.relatedProjects) ? payload.relatedProjects : [], showResumeLink: /\b(resume|cv)\b/i.test(currentQuestion) }].slice(-12));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The portfolio assistant is temporarily unavailable.");
    } finally { setBusy(false); }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void ask(question); };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (!available) return null;

  return <div className="public-ai-concierge">
    {!open && <button ref={launcherRef} type="button" onClick={() => setOpen(true)} aria-label="Ask AI about Franz" aria-haspopup="dialog" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 inline-flex min-h-12 items-center gap-2 rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold text-[var(--ink)] shadow-xl transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ink)]">
      <Sparkles size={17} aria-hidden="true" /> Ask AI
    </button>}

    {open && <section role="dialog" aria-modal="false" aria-labelledby="public-ai-title" aria-describedby="public-ai-disclosure" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex h-[min(42rem,82dvh)] max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-3xl border border-[var(--public-border)] bg-[var(--surface)] text-[var(--ink)] shadow-2xl md:inset-x-auto md:right-6 md:bottom-6 md:h-[min(40rem,calc(100dvh-3rem))] md:w-[min(27rem,calc(100vw-3rem))]">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--public-border)] p-4">
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Public Portfolio Concierge</p><h2 id="public-ai-title" className="mt-1 text-lg font-bold">Ask about the Developer</h2><p id="public-ai-disclosure" className="mt-1 text-xs leading-5 text-[var(--muted)]">Answers are based only on information the developer has chosen to make public.</p></div>
        <div className="flex shrink-0 gap-1"><button type="button" onClick={clearChat} disabled={busy} aria-label="Clear public chat" title="Clear chat" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[var(--public-border)] text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-50"><Trash2 size={15} /></button><button type="button" onClick={() => setOpen(false)} aria-label="Close public concierge" title="Close chat" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[var(--public-border)] text-[var(--muted)] hover:text-[var(--ink)]"><X size={17} /></button></div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 && <ChatMessageBubble role="assistant" publicMode>Hi! Ask me about Franz&apos;s skills, experience, or public work.</ChatMessageBubble>}
        {messages.map((item, index) => <div key={`${index}-${item.role}`} className={`flex flex-col gap-2 ${item.role === "user" ? "items-end" : "items-start"}`}>
          <ChatMessageBubble role={item.role} publicMode>{item.content}</ChatMessageBubble>
          {item.showResumeLink && <a href="/resume/Franz_Michael_Cayanan_Resume.pdf" download className="public-link">Download Resume</a>}
          {item.relatedProjects && item.relatedProjects.length > 0 && <div className="flex flex-wrap gap-2">{item.relatedProjects.map((project) => <Link key={project.slug} href={`/projects/${encodeURIComponent(project.slug)}`} className="public-link">View {project.title}</Link>)}</div>}
        </div>)}
        {busy && <ChatTypingIndicator publicMode />}
      </div>

      <div className="shrink-0 space-y-2 border-t border-[var(--public-border)] p-3">
        <div className="flex flex-wrap gap-1.5" aria-label="Suggested recruiter questions">
          {(messages.length > 0 && messages.length % 4 >= 2 ? suggestedQuestions.slice(4, 8) : suggestedQuestions.slice(0, 4)).map((suggestion) => <button key={suggestion} type="button" disabled={busy} onClick={() => void ask(suggestion)} className="rounded-full border border-[var(--public-border)] px-2.5 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--surface-strong)] disabled:opacity-50">{suggestion}</button>)}
        </div>
        <form onSubmit={submit} className="flex items-end gap-2">
          <label htmlFor="public-ai-question" className="sr-only">Question about the developer</label>
          <textarea ref={questionRef} id="public-ai-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={2} required placeholder="Ask about Franz…" className="min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted)]" />
          <button type="submit" disabled={busy || !question.trim()} aria-label="Send question" className="inline-flex min-h-11 items-center justify-center gap-1 rounded-full bg-[var(--ink)] px-3 text-sm font-semibold text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50">{busy ? <span>…</span> : <Send size={16} />}<span className="sr-only">Send</span></button>
        </form>
        {error && <p role="alert" className="rounded-xl border border-[var(--public-border)] p-2.5 text-xs text-[var(--ink)]">{error}</p>}
      </div>
    </section>}
  </div>;
}
