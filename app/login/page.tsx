"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderGit2, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { signInWithGithub } from "@/data/authService";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.push("/app");
    });
  }, [router]);

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await signInWithGithub();
      if (!result.configured) setError("Supabase is not configured yet. Add the environment variables from .env.example.");
    } catch {
      setError("GitHub sign-in could not start. Check your Supabase Auth provider settings.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell flex min-h-screen items-center justify-center p-4">
      <section className="hero-paper w-full max-w-lg p-6 text-center md:p-10">
        <p className="eyebrow t-paper-muted">Developer Workplace</p>
        <h1 className="hero-script mt-4 text-5xl">Your workbench, synced.</h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 t-paper-muted">Sign in to keep projects, tasks, plans, and notes in your private Supabase workspace.</p>
        <button type="button" onClick={handleLogin} disabled={loading} className="ink-button primary mx-auto mt-7 px-5 py-3 text-sm font-semibold disabled:cursor-wait disabled:opacity-60">
          {loading ? <LoaderCircle size={16} className="animate-spin" /> : <FolderGit2 size={16} />}
          Continue with GitHub
        </button>
        {error && <p role="alert" className="mt-4 text-sm text-[var(--ink-peach)]">{error}</p>}
        <Link href="/view" className="mt-6 inline-flex text-sm font-semibold underline underline-offset-4 t-paper-muted">View public portfolio</Link>
      </section>
    </main>
  );
}
