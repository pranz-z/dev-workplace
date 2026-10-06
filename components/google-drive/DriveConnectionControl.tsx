"use client";

import { useCallback, useEffect, useState } from "react";
import { driveClientRequest } from "@/lib/google-drive/client";

export function DriveConnectionControl({ onOpenFiles }: { onOpenFiles: () => void }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await driveClientRequest<{ connected: boolean }>("/api/drive/status");
      setConnected(result.connected);
    } catch (cause) {
      setConnected(null);
      setError(cause instanceof Error ? cause.message : "Connection status is unavailable.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.has("drive_error")) setMessage("Google Drive could not be connected. Try connecting again.");
      else if (params.get("drive_connected") === "1") setMessage("Google Drive connected.");
      if (params.has("drive_error") || params.has("drive_connected")) {
        const url = new URL(window.location.href);
        url.searchParams.delete("drive_error"); url.searchParams.delete("drive_connected");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      }
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const disconnect = async () => {
    if (!window.confirm("Disconnect Google Drive? Your Drive files and Workplace file associations will remain.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await driveClientRequest<{ revoked: boolean }>("/api/drive/disconnect", { method: "DELETE" });
      setConnected(false);
      setMessage(result.revoked ? "Google Drive disconnected." : "Disconnected from Workplace. Google revocation failed; remove this app in your Google Account security settings.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Disconnect failed."); }
    finally { setBusy(false); }
  };

  return <section className="dark-inset p-4" aria-labelledby="drive-connection-heading">
    <h3 id="drive-connection-heading" className="font-medium t-dark">Google Drive</h3>
    <p className="mt-2 text-sm t-dark-muted">Store workspace files in your Google Drive.</p>
    <p className="mt-2 text-sm t-dark" role="status">{busy ? "Checking connection…" : connected === null ? "Status unavailable" : connected ? "Connected" : "Disconnected"}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {connected === false && !busy && <a href="/api/drive/connect" className="ink-button primary px-3 py-2 text-sm">Connect Google Drive</a>}
      {connected && <button type="button" disabled={busy} onClick={() => void disconnect()} className="dark-chip px-3 py-2 text-sm disabled:opacity-50">Disconnect</button>}
      <button type="button" onClick={onOpenFiles} className="dark-chip px-3 py-2 text-sm">Open Files</button>
      <button type="button" disabled={busy} onClick={() => void refresh()} className="dark-chip px-3 py-2 text-sm disabled:opacity-50">Refresh status</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--accent-peach)]">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm t-dark-muted">{message}</p>}
  </section>;
}
