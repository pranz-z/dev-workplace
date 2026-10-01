"use client";

import { LoaderCircle, LogOut, Settings, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";

interface UserMenuProps {
  /** Opens the workspace settings view; wired to the shell's own view switcher. */
  onOpenSettings?: () => void;
}

const readMetadataString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : "");

function Avatar({ avatarUrl, initials, displayName, className }: { avatarUrl: string; initials: string; displayName: string; className: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--edge-dark-soft)] bg-[linear-gradient(135deg,var(--accent-coral),var(--accent-lavender))] font-semibold text-[var(--text-dark)] ${className}`}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- small remote GitHub avatar; next/image optimization adds no value here.
        <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initials
      )}
    </span>
  );
}

export function UserMenu({ onOpenSettings }: UserMenuProps) {
  const router = useRouter();
  const { status, user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const metadata = user?.user_metadata ?? {};
  const displayName = readMetadataString(metadata.full_name) || readMetadataString(metadata.name) || readMetadataString(metadata.user_name) || user?.email || "Your account";
  const githubUsername = readMetadataString(metadata.user_name) || readMetadataString(metadata.preferred_username);
  const avatarUrl = readMetadataString(metadata.avatar_url);
  const email = user?.email ?? "";
  const initials = useMemo(
    () =>
      displayName
        .split(/[\s@._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "?",
    [displayName],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError("");
    const result = await signOut();
    setSigningOut(false);
    if (!result.ok) {
      setSignOutError(result.message);
      return;
    }
    setMenuOpen(false);
    router.replace("/login");
    router.refresh();
  };

  if (status === "loading") {
    return <span aria-hidden className="h-9 w-9 animate-pulse rounded-full border border-[var(--edge-cream)] bg-[var(--surface-cream)]" />;
  }

  if (status === "unauthenticated" || !user) {
    return (
      <Link href="/login" className="rounded-xl border border-[var(--edge-cream)] bg-[var(--surface-cream)] px-3 py-2 text-sm font-medium text-[var(--text-desk)]">
        Sign in
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setMenuOpen((current) => !current)} aria-label="Open account menu" aria-expanded={menuOpen} className="block rounded-full">
        <Avatar avatarUrl={avatarUrl} initials={initials} displayName={displayName} className="h-9 w-9" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-11 z-50 w-72 max-w-[calc(100vw-2rem)] dark-panel p-2 shadow-[var(--shadow-dark-lift)]">
          <div className="flex items-center gap-3 dark-inset p-3">
            <Avatar avatarUrl={avatarUrl} initials={initials} displayName={displayName} className="h-9 w-9 text-xs" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold t-dark">{displayName}</p>
              {githubUsername ? <p className="truncate text-xs t-dark-muted">@{githubUsername}</p> : null}
              {!githubUsername && email ? <p className="truncate text-xs t-dark-muted">{email}</p> : null}
            </div>
          </div>

          <div className="mt-2 space-y-2">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setProfileOpen(true);
              }}
              className="flex w-full items-center gap-2 dark-inset px-3 py-2 text-left text-sm t-dark hover:border-[var(--accent-peach)]"
            >
              <UserRound size={14} className="t-dark-muted" /> Profile
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenSettings?.();
              }}
              className="flex w-full items-center gap-2 dark-inset px-3 py-2 text-left text-sm t-dark hover:border-[var(--accent-peach)]"
            >
              <Settings size={14} className="t-dark-muted" /> Settings
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="flex w-full items-center gap-2 dark-inset px-3 py-2 text-left text-sm t-dark hover:border-[var(--accent-peach)] disabled:cursor-wait disabled:opacity-60"
            >
              {signingOut ? <LoaderCircle size={14} className="animate-spin t-dark-muted" /> : <LogOut size={14} className="t-dark-muted" />} Sign out
            </button>
          </div>

          {signOutError && (
            <p role="alert" className="mt-2 px-3 pb-1 text-xs leading-5 text-[var(--accent-peach)]">
              {signOutError}
            </p>
          )}
        </div>
      )}

      {profileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-sm">
          <div className="dark-panel w-full max-w-sm p-5 shadow-[var(--shadow-dark-lift)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow t-mood">Profile</p>
                <h3 className="mt-2 text-xl font-semibold t-dark">Your GitHub identity</h3>
              </div>
              <button type="button" onClick={() => setProfileOpen(false)} className="dark-chip p-2" aria-label="Close profile">
                <X size={15} />
              </button>
            </div>
            <div className="mt-4 flex items-center gap-3 dark-inset p-3">
              <Avatar avatarUrl={avatarUrl} initials={initials} displayName={displayName} className="h-12 w-12 text-base" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold t-dark">{displayName}</p>
                {githubUsername ? <p className="truncate text-xs t-dark-muted">@{githubUsername}</p> : null}
                {email ? <p className="truncate text-xs t-dark-muted">{email}</p> : null}
              </div>
            </div>
            <p className="mt-4 text-xs leading-5 t-dark-muted">
              Supabase Auth verifies this account. Repository access is a separate opt-in step and is not part of this phase.
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setProfileOpen(false)} className="ink-button primary px-3 py-2 text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
