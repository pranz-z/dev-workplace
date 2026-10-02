"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="public-shell flex min-h-screen items-center justify-center px-5 py-12">
      <section className="public-card w-full max-w-lg p-6 text-center">
        <h1 className="text-2xl font-bold text-[var(--ink)]">This page couldn’t load</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">Something went wrong. Try again in a moment.</p>
        <button type="button" onClick={reset} className="public-link mt-5">Try again</button>
      </section>
    </main>
  );
}
