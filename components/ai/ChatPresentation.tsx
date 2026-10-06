import type { ReactNode } from "react";

export type ChatMessage = { role: "user" | "assistant"; content: string; relatedProjects?: Array<{ slug: string; title: string }> };

export function ChatMessageBubble({ role, children, publicMode = false }: { role: ChatMessage["role"]; children: ReactNode; publicMode?: boolean }) {
  const user = role === "user";
  const bubbleStyle = publicMode
    ? user ? "ml-auto chat-note-user" : "bg-[var(--surface)] text-[var(--ink)]"
    : user ? "ml-auto chat-note-user" : "dark-inset t-dark";
  return <div data-public={publicMode || undefined} data-speaker={role} className={`chat-note max-w-[92%] rounded-2xl px-3 py-2.5 text-sm leading-6 ${bubbleStyle}`}><p className="whitespace-pre-wrap">{children}</p></div>;
}

export function ChatTypingIndicator({ publicMode = false }: { publicMode?: boolean }) {
  return <p className={`notebook-typing text-xs ${publicMode ? "text-[var(--muted)]" : "t-dark-muted"}`} role="status" aria-live="polite"><svg aria-hidden="true" viewBox="0 0 32 24" width="32" height="24"><path className="notebook-typing-pencil" d="m9 17 12-12 4 4-12 12-5 1Z m10-10 4 4 M9 17l4 4" /><path className="notebook-typing-line" d="M3 22h24" /></svg><span>Assistant is thinking…</span></p>;
}
