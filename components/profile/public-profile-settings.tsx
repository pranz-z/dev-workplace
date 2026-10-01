"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getCurrentProfile, updateProfile } from "@/data/profileService";
import { useAuth } from "@/components/auth/auth-provider";
import type { Profile } from "@/types";

const emptyProfile: Profile = {
  id: "",
  displayName: "",
  publicProfileEnabled: false,
  showPublicContactEmail: false,
};

function isWebUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function PublicProfileSettings() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    void getCurrentProfile(user.id).then((current) => {
      if (active && current) setProfile(current);
    }).catch(() => {
      if (active) setNotice("Couldn't load your profile settings.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [user]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice("");
    if ([profile.publicGithubUrl, profile.publicLinkedinUrl, profile.publicWebsiteUrl].some((value) => value && !isWebUrl(value))) {
      setNotice("Social and website links must be valid HTTP or HTTPS URLs.");
      return;
    }
    if (profile.showPublicContactEmail && profile.publicContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.publicContactEmail)) {
      setNotice("Enter a valid public contact email or turn off email sharing.");
      return;
    }
    setSaving(true);
    const result = await updateProfile({
      bio: profile.bio ?? null,
      headline: profile.headline ?? null,
      publicContactEmail: profile.publicContactEmail ?? null,
      showPublicContactEmail: profile.showPublicContactEmail,
      publicGithubUrl: profile.publicGithubUrl ?? null,
      publicLinkedinUrl: profile.publicLinkedinUrl ?? null,
      publicWebsiteUrl: profile.publicWebsiteUrl ?? null,
      publicProfileEnabled: profile.publicProfileEnabled,
    });
    setSaving(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setProfile(result.data);
    setNotice("Public profile settings saved.");
  };

  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => setProfile((current) => ({ ...current, [key]: value }));
  const textField = (label: string, key: "headline" | "bio" | "publicContactEmail" | "publicGithubUrl" | "publicLinkedinUrl" | "publicWebsiteUrl", placeholder: string, type = "text") => (
    <label className="block text-sm t-dark-muted">{label}
      <input type={type} value={profile[key] ?? ""} onChange={(event) => update(key, event.target.value)} className="mt-1 w-full dark-chip px-3 py-2 text-sm" />
      {placeholder && <span className="mt-1 block text-xs t-dark-muted">{placeholder}</span>}
    </label>
  );

  return (
    <section className="mt-6 dark-panel p-5" aria-labelledby="public-profile-settings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="public-profile-settings-title" className="text-lg font-semibold t-dark">Public portfolio profile</h3>
          <p className="mt-1 text-sm t-dark-muted">Only the fields below are included in the public profile. Your sign-in email and account username stay private.</p>
        </div>
        <a href="/view" target="_blank" rel="noopener noreferrer" className="dark-chip px-3 py-2 text-sm">Preview public portfolio</a>
      </div>
      {loading ? <p role="status" className="mt-4 text-sm t-dark-muted">Loading profile settings…</p> : (
        <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4">
          <label className="flex items-start gap-3 text-sm t-dark"><input type="checkbox" checked={profile.publicProfileEnabled} onChange={(event) => update("publicProfileEnabled", event.target.checked)} className="mt-1" />
            <span><strong>Show my profile on the public portfolio</strong><span className="mt-1 block text-xs t-dark-muted">Off by default. Public projects remain governed by their own visibility settings.</span></span>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            {textField("Professional headline", "headline", "For example, your current role or specialization.")}
            {textField("Public bio", "bio", "A concise professional introduction.")}
            {textField("Public contact email", "publicContactEmail", "Separate from your Supabase sign-in email.", "email")}
            {textField("Public GitHub profile URL", "publicGithubUrl", "Only shown when you configure this link.", "url")}
            {textField("Public LinkedIn URL", "publicLinkedinUrl", "Only shown when you configure this link.", "url")}
            {textField("Personal website URL", "publicWebsiteUrl", "Only shown when you configure this link.", "url")}
          </div>
          <label className="flex items-center gap-2 text-sm t-dark"><input type="checkbox" checked={profile.showPublicContactEmail} onChange={(event) => update("showPublicContactEmail", event.target.checked)} /> Explicitly show this contact email</label>
          {notice && <p role={notice.includes("saved") ? "status" : "alert"} className="text-sm t-dark-muted">{notice}</p>}
          <button type="submit" disabled={saving} className="ink-button primary px-3 py-2 text-sm disabled:opacity-50">{saving ? "Saving…" : "Save public profile"}</button>
        </form>
      )}
    </section>
  );
}
