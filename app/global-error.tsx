"use client";

import "./globals.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--background)] text-[var(--ink)]">
        <main className="public-shell flex min-h-screen items-center justify-center px-5 py-12">
          <section className="public-card w-full max-w-lg p-6 text-center">
            <h1 className="text-2xl font-bold text-[var(--ink)]">Frami is having trouble</h1>
            <p className="mt-3 text-sm text-[var(--muted)]">Something went wrong. Try again in a moment.</p>
            <button type="button" onClick={reset} className="public-link mt-5">Try again</button>
          </section>
        </main>
      </body>
    </html>
  );
}
