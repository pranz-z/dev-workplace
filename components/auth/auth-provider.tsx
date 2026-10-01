"use client";

import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export type SignOutResult = { ok: true } | { ok: false; message: string };

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  configured: boolean;
  signOut: () => Promise<SignOutResult>;
}

const SIGN_OUT_FAILURE_MESSAGE = "We couldn't sign you out just now. Please try again.";

/** Supabase Auth is the single source of truth for the signed-in identity. */
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(configured ? "loading" : "unauthenticated");

  useEffect(() => {
    // When Supabase is not configured the state is already `unauthenticated` from initialisation.
    if (!configured) return;

    const supabase = getSupabaseBrowserClient();
    let active = true;

    supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (!active) return;
        if (data.user) {
          setUser(data.user);
          setStatus("authenticated");
          return;
        }
        if (error && error.name !== "AuthSessionMissingError") {
          // Network or provider problem: keep whatever session state onAuthStateChange restored.
          console.error("[auth] Unable to verify the Supabase session.", error.message);
          setStatus((current) => (current === "loading" ? "unauthenticated" : current));
          return;
        }
        setUser(null);
        setStatus("unauthenticated");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        console.error("[auth] Supabase session lookup failed.", cause);
        setStatus((current) => (current === "loading" ? "unauthenticated" : current));
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setStatus(session?.user ? "authenticated" : "unauthenticated");
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [configured]);

  const signOut = useCallback(async (): Promise<SignOutResult> => {
    if (!configured) return { ok: false, message: SIGN_OUT_FAILURE_MESSAGE };
    try {
      const { error } = await getSupabaseBrowserClient().auth.signOut();
      if (error) {
        console.error("[auth] Supabase sign out failed.", error.message);
        return { ok: false, message: SIGN_OUT_FAILURE_MESSAGE };
      }
      setUser(null);
      setStatus("unauthenticated");
      return { ok: true };
    } catch (cause) {
      console.error("[auth] Supabase sign out threw.", cause);
      return { ok: false, message: SIGN_OUT_FAILURE_MESSAGE };
    }
  }, [configured]);

  const value = useMemo<AuthContextValue>(() => ({ status, user, configured, signOut }), [status, user, configured, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth() must be used inside <AuthProvider>.");
  return context;
}
