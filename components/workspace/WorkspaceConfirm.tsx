"use client";

import { useState, type FormEvent } from "react";
import { WorkspaceDialog } from "./WorkspaceDialog";

/** Destructive confirmation. Cancel is focused first, so Enter never deletes by accident. */
export function WorkspaceConfirmDialog({ title, message, confirmLabel, busy = false, onConfirm, onCancel }: {
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = () => { if (!busy) onCancel(); };
  return (
    <WorkspaceDialog label={title} onClose={cancel} className="z-[60]">
      <div className="dark-panel w-full max-w-md p-5 shadow-[var(--shadow-dark-lift)]">
        <h2 className="text-xl font-semibold t-dark [overflow-wrap:anywhere]">{title}</h2>
        <p className="mt-3 text-sm leading-6 t-dark-muted">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={cancel} disabled={busy} className="dark-chip px-3 py-2 text-sm">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="ink-button coral px-3 py-2 text-sm">{busy ? "Working..." : confirmLabel}</button>
        </div>
      </div>
    </WorkspaceDialog>
  );
}

/** Single-field entry that replaces window.prompt and keeps the notebook styling. */
export function WorkspacePromptDialog({ title, label, submitLabel, busy = false, onSubmit, onCancel }: {
  title: string;
  label: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const cancel = () => { if (!busy) onCancel(); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };
  return (
    <WorkspaceDialog label={title} onClose={cancel} className="z-[60]">
      <form onSubmit={submit} className="dark-panel w-full max-w-md p-5 shadow-[var(--shadow-dark-lift)]">
        <h2 className="text-xl font-semibold t-dark">{title}</h2>
        <label className="mt-3 block text-sm t-dark-muted">{label}<input autoFocus required value={value} onChange={(event) => setValue(event.target.value)} className="mt-1 w-full dark-chip px-3 py-2" /></label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={cancel} disabled={busy} className="dark-chip px-3 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={busy || !value.trim()} className="ink-button primary px-3 py-2 text-sm">{busy ? "Saving..." : submitLabel}</button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
