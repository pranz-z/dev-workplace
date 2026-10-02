"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

const suggestedQuestions = [
  "What does this developer specialize in?",
  "Which technologies appear in public projects?",
  "What public work shows their AI experience?",
  "What roles relate to the public experience?",
];

interface RelatedProject {
  slug: string;
  title: string;
}

export function PublicAiConcierge() {
  const [available, setAvailable] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [relatedProjects, setRelatedProjects] = useState<RelatedProject[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/public-ai", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("availability");
      const payload = await response.json() as { available?: boolean };
      if (active) setAvailable(payload.available === true);
    }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, []);

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setAnswer("");
    setRelatedProjects([]);
    try {
      const response = await fetch("/api/public-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = await response.json() as { answer?: string; relatedProjects?: RelatedProject[]; error?: { message?: string } };
      if (!response.ok || typeof payload.answer !== "string") throw new Error(payload.error?.message || "The portfolio assistant is temporarily unavailable.");
      setAnswer(payload.answer);
      setRelatedProjects(Array.isArray(payload.relatedProjects) ? payload.relatedProjects : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The portfolio assistant is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;

  return <section className="public-card p-5 md:p-6" aria-labelledby="public-ai-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Public portfolio concierge</p>
        <h2 id="public-ai-title" className="mt-2 text-2xl font-black text-[var(--ink)]">Ask about the developer</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Ask about skills, experience, technologies, and public work.</p>
      </div>
      <p className="max-w-xs text-xs leading-5 text-[var(--muted)]">AI answers use information the developer has chosen to make public.</p>
    </div>
    <div className="mt-4 flex flex-wrap gap-2" aria-label="Suggested questions">
      {suggestedQuestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => setQuestion(suggestion)} className="public-link">{suggestion}</button>)}
    </div>
    <form onSubmit={(event) => void ask(event)} className="mt-4 space-y-2">
      <label htmlFor="public-ai-question" className="sr-only">Question about the developer</label>
      <textarea id="public-ai-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={2} required placeholder="What would you like to know about the developer?" className="w-full rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink)]" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--muted)]">{question.length}/500 characters</span>
        <button type="submit" disabled={busy || !question.trim()} className="public-link disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Thinking…" : "Ask"}</button>
      </div>
    </form>
    {error && <p role="alert" className="mt-4 rounded-xl border border-[var(--public-border)] p-3 text-sm text-[var(--muted)]">{error}</p>}
    {answer && <div className="mt-4 rounded-2xl border border-[var(--public-border)] bg-[var(--surface)] p-4">
      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">{answer}</p>
      {relatedProjects.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{relatedProjects.map((project) => <Link key={project.slug} href={`/view/project/${encodeURIComponent(project.slug)}`} className="public-link">View {project.title}</Link>)}</div>}
    </div>}
  </section>;
}
