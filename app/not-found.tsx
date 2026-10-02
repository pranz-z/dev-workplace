import Link from "next/link";

export default function NotFound() {
  return (
    <main className="public-shell flex min-h-screen items-center justify-center px-5 py-12">
      <section className="public-card w-full max-w-lg p-6 text-center">
        <h1 className="text-2xl font-bold text-[var(--ink)]">Page not found</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">That page may have moved or is not publicly available.</p>
        <Link href="/" className="public-link mt-5">Back to portfolio</Link>
      </section>
    </main>
  );
}
