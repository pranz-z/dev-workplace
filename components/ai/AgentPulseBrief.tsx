'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { agentInboxService, inboxErrorMessage } from '@/data/agentInboxService';
import type { InboxItem } from '@/data/agentInbox';

interface Props { onOpenInbox: () => void }

export function AgentPulseBrief(props: Props) {
  const { status, user } = useAuth();
  return status === 'authenticated' && user ? <BriefSession key={user.id} {...props} /> : null;
}

function BriefSession({ onOpenInbox }: Props) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const read = useRef<AbortController | null>(null), mutation = useRef<AbortController | null>(null);
  const generation = useRef(0), mounted = useRef(true), flight = useRef(false), focusDismissal = useRef(false);
  const region = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController(); read.current = controller; const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const value = await agentInboxService.getPulseBrief(controller.signal);
      if (!mounted.current || controller.signal.aborted || request !== generation.current) return;
      const revisions = new Set<string>();
      setItems(value.items.filter(item => {
        const key = `${item.id}:${item.contentRevision}`;
        if (item.stale || item.unavailable || item.seen || item.state !== 'active' || revisions.has(key)) return false;
        revisions.add(key); return true;
      }));
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && request === generation.current) { setItems([]); setError(inboxErrorMessage(cause)); }
    } finally {
      if (mounted.current && !controller.signal.aborted && request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true; let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; mounted.current = false; read.current?.abort(); mutation.current?.abort(); };
  }, [load]);
  useEffect(() => {
    if (focusDismissal.current && !loading && !busy) { focusDismissal.current = false; region.current?.focus(); }
  }, [loading, busy]);

  const acknowledge = async (open: boolean) => {
    if (flight.current || loading || items.length === 0) return;
    flight.current = true; setBusy(true); setError('');
    const controller = new AbortController(); mutation.current = controller;
    try {
      await agentInboxService.ackInbox({ items: items.map(({ id, contentRevision }) => ({ id, contentRevision })), brief: true }, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (open) onOpenInbox();
      else { setDismissed(true); focusDismissal.current = true; }
      await load();
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError(inboxErrorMessage(cause));
    } finally {
      flight.current = false;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  };

  if (!loading && !error && items.length === 0 && !dismissed) return null;
  return <section ref={region} tabIndex={-1} aria-label="Agent return Brief" className="min-w-0 dark-panel space-y-3 rounded-xl p-4 text-sm t-dark [overflow-wrap:anywhere]">
    {loading ? <p role="status" className="text-xs t-dark-muted">Loading Brief…</p> : <>
      {items.length > 0 && <>
        <h2 className="font-semibold">While you were away</h2>
        <div className="space-y-3">{items.map(item => <article key={`${item.id}:${item.contentRevision}`} className="min-w-0 dark-inset space-y-1 rounded-lg p-3">
          <h3 className="font-semibold">{item.title}</h3><p>{item.summary}</p><p className="text-xs t-dark-muted">{item.explanation}</p>
          <p className="text-xs t-dark-muted">{item.kind === 'idea' ? 'Advisory idea' : 'Workspace check'} · Last checked: <time dateTime={item.lastCheckedAt}>{new Date(item.lastCheckedAt).toLocaleString()}</time></p>
        </article>)}</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void acknowledge(true)} className="ink-button primary px-3 py-2 text-xs disabled:opacity-50">Open Inbox</button>
          <button type="button" disabled={busy} onClick={() => void acknowledge(false)} className="dark-chip px-3 py-2 text-xs disabled:opacity-50">Dismiss Brief</button>
        </div>
      </>}
      {dismissed && !error && items.length === 0 && <p role="status" className="text-xs t-dark-muted">Brief acknowledged.</p>}
    </>}
    {error && <div className="space-y-2"><p role="alert" className="text-xs t-dark-muted">{error}</p><button type="button" disabled={busy || loading} onClick={() => void load()} className="dark-chip px-3 py-2 text-xs disabled:opacity-50">Retry Brief</button></div>}
  </section>;
}
