import type { ReactNode } from "react";

export type ChatMessage = { role: "user" | "assistant"; content: string; relatedProjects?: Array<{ slug: string; title: string }> };

export function ChatMessageBubble({ role, children, publicMode = false }: { role: ChatMessage["role"]; children: ReactNode; publicMode?: boolean }) {
  const user = role === "user";
  const bubbleStyle = publicMode
    ? user ? "ml-auto bg-[var(--ink)] text-white" : "bg-[var(--surface)] text-[var(--ink)]"
    : user ? "ml-auto bg-[var(--ink-lavender)] text-white" : "dark-inset t-dark-soft";
  return <div className={`max-w-[92%] rounded-2xl px-3 py-2.5 text-sm leading-6 ${bubbleStyle}`}><p className="whitespace-pre-wrap">{children}</p></div>;
}

export function ChatTypingIndicator({ publicMode = false }: { publicMode?: boolean }) {
  return <p className={`text-xs ${publicMode ? "text-[var(--muted)]" : "t-dark-muted"}`} role="status" aria-live="polite">Assistant is thinking…</p>;
}
