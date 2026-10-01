"use client";

import { FolderGit2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { signInWithGithub } from "@/data/authService";
import { sanitizeNextPath } from "@/lib/auth/redirects";
import { getMissingSupabaseEnvVars } from "@/lib/supabase/env";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth: "GitHub sign-in could not be completed. Please try again.",
  callback: "We couldn't finish signing you in. Please try again.",
  session: "Your sign-in session expired. Please try again.",
};

const GENERIC_ERROR_MESSAGE = "Something went wrong while signing in. Please try again.";

function LoginPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const nextPath = sanitizeNextPath(searchParams.get("next"));
  const callbackErrorCode = searchParams.get("error");
  const missingEnvVars = getMissingSupabaseEnvVars();
  const configMessage = missingEnvVars.length > 0 ? `Supabase is not configured. Add ${missingEnvVars.join(", ")} to .env.local (see .env.example).` : "";
  const urlErrorMessage = callbackErrorCode ? AUTH_ERROR_MESSAGES[callbackErrorCode] ?? GENERIC_ERROR_MESSAGE : "";
  const errorMessage = error || urlErrorMessage || configMessage;

  useEffect(() => {
    if (status === "authenticated") router.replace(nextPath);
  }, [status, nextPath, router]);

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await signInWithGithub(nextPath);
      if (!result.configured) setError(configMessage || "Supabase is not configured yet.");
    } catch (cause) {
      console.error("[login] GitHub sign-in could not start.", cause);
      setError("GitHub sign-in could not be completed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell flex min-h-screen items-center justify-center p-4">
      <section className="hero-paper w-full max-w-lg p-6 text-center md:p-10">
        <p className="eyebrow t-paper-muted">Developer Workplace</p>
        <h1 className="hero-script mt-4 text-4xl leading-tight md:text-5xl">Welcome to your Developer Workplace</h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 t-paper-muted">Sign in to access your private workspace.</p>
        <button type="button" onClick={handleLogin} disabled={loading} className="ink-button primary mx-auto mt-7 px-5 py-3 text-sm font-semibold disabled:cursor-wait disabled:opacity-60">
          {loading ? <LoaderCircle size={16} className="animate-spin" /> : <FolderGit2 size={16} />}
          Continue with GitHub
        </button>
        <p className="mx-auto mt-3 max-w-md text-xs leading-5 t-paper-muted">GitHub verifies your identity through Supabase Auth. You can connect repository access separately from the workspace.</p>
        {errorMessage && (
          <p role="alert" className="mt-4 text-sm text-[var(--ink-peach)]">
            {errorMessage}
          </p>
        )}
        <Link href="/view" className="mt-6 inline-flex text-sm font-semibold underline underline-offset-4 t-paper-muted">
          Explore the public portfolio
        </Link>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="app-shell flex min-h-screen items-center justify-center p-4">
          <LoaderCircle size={20} className="animate-spin t-paper-muted" />
        </main>
      }
    >
      <LoginPanel />
    </Suspense>
  );
}

