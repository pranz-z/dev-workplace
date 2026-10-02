"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChatMessageBubble, ChatTypingIndicator, type ChatMessage } from "@/components/ai/ChatPresentation";

const suggestedQuestions = [
  "What does this developer specialize in?",
  "What AI experience does he have?",
  "Which technologies appear in public projects?",
];

export function PublicAiConcierge() {
  const [available, setAvailable] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/public-ai", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("availability");
      const payload = await response.json() as { available?: boolean };
      if (active) setAvailable(payload.available === true);
    }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, busy]);

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentQuestion = question.trim();
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
      setMessages((current) => [...current, { role: "assistant" as const, content: payload.answer!, relatedProjects: Array.isArray(payload.relatedProjects) ? payload.relatedProjects : [] }].slice(-12));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The portfolio assistant is temporarily unavailable.");
    } finally { setBusy(false); }
  };

  if (!available) return null;

  return <section className="public-card p-5 md:p-6" aria-labelledby="public-ai-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Public portfolio concierge</p>
        <h2 id="public-ai-title" className="mt-2 text-2xl font-black text-[var(--ink)]">Ask about the developer</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Ask about skills, experience, technologies, and public work.</p>
      </div>
      <p className="max-w-xs text-xs leading-5 text-[var(--muted)]">Answers use information the developer has chosen to make public.</p>
    </div>
    <div ref={scrollRef} className="mt-4 max-h-[28rem] space-y-3 overflow-y-auto rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4" aria-live="polite">
      <ChatMessageBubble role="assistant" publicMode>Hi! Ask me about the developer&apos;s skills, experience, or public work.</ChatMessageBubble>
      {messages.map((item, index) => <div key={`${index}-${item.role}`} className={`flex flex-col gap-2 ${item.role === "user" ? "items-end" : "items-start"}`}>
        <ChatMessageBubble role={item.role} publicMode>{item.content}</ChatMessageBubble>
        {item.relatedProjects && item.relatedProjects.length > 0 && <div className="flex flex-wrap gap-2">{item.relatedProjects.map((project) => <Link key={project.slug} href={`/view/project/${encodeURIComponent(project.slug)}`} className="public-link">View {project.title}</Link>)}</div>}
      </div>)}
      {busy && <ChatTypingIndicator publicMode />}
    </div>
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggested questions">
      {suggestedQuestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => setQuestion(suggestion)} className="public-link">{suggestion}</button>)}
    </div>
    <form onSubmit={(event) => void ask(event)} className="mt-4 space-y-2">
      <label htmlFor="public-ai-question" className="sr-only">Question about the developer</label>
      <textarea id="public-ai-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={2} required placeholder="Ask about the developer…" className="w-full rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink)]" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--muted)]">{question.length}/500 characters</span>
        <button type="submit" disabled={busy || !question.trim()} className="public-link disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Thinking…" : "Send"}</button>
      </div>
    </form>
    {error && <p role="alert" className="mt-4 rounded-xl border border-[var(--public-border)] p-3 text-sm text-[var(--muted)]">{error}</p>}
  </section>;
}
