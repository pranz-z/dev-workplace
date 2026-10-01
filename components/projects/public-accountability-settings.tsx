"use client";

import { useEffect, useState } from "react";
import { getProjectSettings, updateProjectSettings } from "@/data/projectService";

type Props = { projectId: string };
type PublicSettings = { enabled: boolean; includeScore: boolean };

const PRIVATE_DEFAULTS: PublicSettings = { enabled: false, includeScore: false };

export function PublicAccountabilitySettings({ projectId }: Props) {
  const [settings, setSettings] = useState(PRIVATE_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let current = true;
    void getProjectSettings(projectId).then((saved) => {
      if (!current) return;
      setSettings({
        enabled: saved?.showPublicAccountability ?? false,
        includeScore: saved?.showPublicAccountabilityScore ?? false,
      });
    }).catch(() => {
      if (current) {
        setLoadFailed(true);
        setError("Public accountability settings could not be loaded.");
      }
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [projectId]);

  const save = async (patch: Partial<PublicSettings>) => {
    if (saving || loading || loadFailed) return;
    const next = { ...settings, ...patch };
    setSaving(true);
    setError("");
    try {
      const result = await updateProjectSettings(projectId, {
        showPublicAccountability: next.enabled,
        showPublicAccountabilityScore: next.includeScore,
      });
      if (result.ok) setSettings(next);
      else setError(result.error);
    } catch {
      setError("Public accountability settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-3 dark-inset p-3" aria-labelledby="public-accountability-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="public-accountability-title" className="font-medium t-dark">Public accountability</h3>
          <p className="mt-1 max-w-2xl text-sm t-dark-muted">
            Show a limited accountability summary on this project’s public page. Private tasks, goals, reports, snapshots, and repository activity stay hidden.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm t-dark-muted">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => void save({ enabled: event.target.checked, ...(!event.target.checked ? { includeScore: false } : {}) })}
            disabled={loading || saving || loadFailed}
            aria-label="Show public accountability"
          />
          {settings.enabled ? "On" : "Off"}
        </label>
      </div>
      {settings.enabled && (
        <label className="mt-3 inline-flex items-center gap-2 text-sm t-dark-muted">
          <input
            type="checkbox"
            checked={settings.includeScore}
            onChange={(event) => void save({ includeScore: event.target.checked })}
            disabled={loading || saving || loadFailed}
            aria-label="Show numeric accountability score publicly"
          />
          Show numeric accountability score
        </label>
      )}
      {loading && <p className="mt-2 text-xs t-dark-muted">Loading sharing settings…</p>}
      {saving && <p className="mt-2 text-xs t-dark-muted" role="status">Saving…</p>}
      {error && <p className="mt-2 text-sm text-[var(--accent-peach)]" role="alert">{error}</p>}
    </section>
  );
}
