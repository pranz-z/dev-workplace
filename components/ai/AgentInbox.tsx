'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { AgentPulseStatus } from '@/components/ai/AgentPulseStatus';
import { AgentPulseSettings } from '@/components/ai/AgentPulseSettings';
import { AgentInboxError, agentInboxService, inboxErrorMessage } from '@/data/agentInboxService';
import { buildInboxReviewDraft } from '@/data/agentInbox';
import type { InboxFilter, InboxItem, InboxPage, PulseJournalPage, PulseSettingsResponse } from '@/data/agentInbox';
import type { ActivityTarget } from '@/data/agentActivity';

interface Props { onReview: (draft: string) => void; onNavigate?: (target: ActivityTarget) => void }
const emptyPage: InboxPage = { items: [], nextCursor: null };
const emptyJournal: PulseJournalPage = { items: [], nextCursor: null };
const stamp = (value: string) => new Date(value).toLocaleString();
export function AgentInbox(props: Props) {
  const { status, user } = useAuth();
  return status === 'authenticated' && user ? <InboxSession key={user.id} {...props} /> : <p role="status">Sign in to view Agent Inbox.</p>;
}
function InboxSession({ onReview, onNavigate }: Props) {
  const [filter, setFilter] = useState<InboxFilter>('active'), [page, setPage] = useState<InboxPage>(emptyPage), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [settings, setSettings] = useState<PulseSettingsResponse | null>(null), [settingsError, setSettingsError] = useState(''), [settingsOpen, setSettingsOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false), [journal, setJournal] = useState<PulseJournalPage>(emptyJournal), [journalLoading, setJournalLoading] = useState(false), [journalError, setJournalError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null), [actionError, setActionError] = useState(''), [ackMessage, setAckMessage] = useState('');
  const [snoozeDays, setSnoozeDays] = useState<Record<string, 1 | 3 | 7>>({});
  const mounted = useRef(true), listGeneration = useRef(0), detailGeneration = useRef(0), journalGeneration = useRef(0);
  const listAbort = useRef<AbortController | null>(null), detailAbort = useRef<AbortController | null>(null), journalAbort = useRef<AbortController | null>(null);
  const settingsAbort = useRef<AbortController | null>(null), ackAbort = useRef<AbortController | null>(null), mutationAbort = useRef<AbortController | null>(null);
  const actionFlight = useRef(false), acknowledged = useRef(new Set<string>());
  const ackFlight = useRef<Promise<unknown> | null>(null);
  const loadPage = useCallback(async (state: InboxFilter = 'active', cursor: string | null = null, append = false) => {
    listAbort.current?.abort(); const controller = new AbortController(); listAbort.current = controller; const request = ++listGeneration.current;
    try {
      const value = await agentInboxService.getInboxPage({ state, limit: 20, cursor }, controller.signal);
      if (mounted.current && request === listGeneration.current && !controller.signal.aborted) setPage(current => {
        const ids = new Set(current.items.map(item => item.id));
        return append ? { items: [...current.items, ...value.items.filter(item => !ids.has(item.id))], nextCursor: value.nextCursor } : value;
      });
    } catch (caught) { if (mounted.current && request === listGeneration.current && !controller.signal.aborted) setError(inboxErrorMessage(caught)); }
    finally { if (mounted.current && request === listGeneration.current) setLoading(false); }
  }, []);
  const loadSettings = useCallback(async () => {
    settingsAbort.current?.abort(); const controller = new AbortController(); settingsAbort.current = controller;
    try { const value = await agentInboxService.getPulseSettings(controller.signal); if (mounted.current && !controller.signal.aborted) { setSettings(value); setSettingsError(''); } }
    catch (caught) { if (mounted.current && !controller.signal.aborted) setSettingsError(inboxErrorMessage(caught)); }
  }, []);
  function reloadPage(state: InboxFilter = filter, cursor: string | null = null, append = false) {
    setLoading(true); setError(''); return loadPage(state, cursor, append);
  }
  const loadJournal = useCallback(async (cursor: string | null = null, append = false) => {
    journalAbort.current?.abort(); const controller = new AbortController(); journalAbort.current = controller; const request = ++journalGeneration.current;
    setJournalLoading(true); setJournalError('');
    try {
      const value = await agentInboxService.getPulseJournal({ limit: 20, cursor }, controller.signal);
      if (mounted.current && request === journalGeneration.current && !controller.signal.aborted) setJournal(current => {
        const ids = new Set(current.items.map(item => item.id));
        return append ? { items: [...current.items, ...value.items.filter(item => !ids.has(item.id))], nextCursor: value.nextCursor } : value;
      });
    } catch (caught) { if (mounted.current && request === journalGeneration.current && !controller.signal.aborted) setJournalError(inboxErrorMessage(caught)); }
    finally { if (mounted.current && request === journalGeneration.current) setJournalLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) { void loadPage(); void loadSettings(); } });
    return () => {
      cancelled = true; mounted.current = false;
      for (const controller of [listAbort.current, detailAbort.current, journalAbort.current, settingsAbort.current, ackAbort.current, mutationAbort.current]) controller?.abort();
      actionFlight.current = false;
    };
  }, [loadPage, loadSettings]);
  // After the cards have committed, acknowledge exactly the revisions currently rendered.
  useEffect(() => {
    const displayed = page.items.filter(item => !item.seen && !acknowledged.current.has(`${item.id}:${item.contentRevision}`)).slice(0, 20);
    if (displayed.length === 0) return;
    for (const item of displayed) acknowledged.current.add(`${item.id}:${item.contentRevision}`);
    ackAbort.current?.abort(); const controller = new AbortController(); ackAbort.current = controller;
    ackFlight.current = agentInboxService.ackInbox({ items: displayed.map(({ id, contentRevision }) => ({ id, contentRevision })), brief: false }, controller.signal).then(value => {
      if (mounted.current && !controller.signal.aborted) setAckMessage(`${value.acknowledged} displayed revisions acknowledged. Newer revisions may remain unseen.`);
    }).catch(caught => { if (mounted.current && !controller.signal.aborted) setAckMessage(inboxErrorMessage(caught)); });
    // Do not mark seen locally: the response does not identify any newer content revision.
  }, [page.items]);
  function changeFilter(state: InboxFilter) {
    detailGeneration.current++; detailAbort.current?.abort(); ackAbort.current?.abort();
    mutationAbort.current?.abort(); mutationAbort.current = null; actionFlight.current = false; setBusyId(null);
    setFilter(state); setPage(emptyPage); setActionError(''); setAckMessage(''); void reloadPage(state);
  }
  async function review(item: InboxItem, navigate = false) {
    if (actionFlight.current) return;
    actionFlight.current = true; setBusyId(item.id); setActionError('');
    detailAbort.current?.abort(); const controller = new AbortController(); detailAbort.current = controller; const request = ++detailGeneration.current;
    try {
      const detail = await agentInboxService.getInboxDetail(item.id, controller.signal);
      if (!mounted.current || controller.signal.aborted || request !== detailGeneration.current) return;
      const draft = buildInboxReviewDraft(detail);
      if (!draft || !detail.item) { setActionError('This Inbox item changed or is unavailable. Refresh before Review.'); return; }
      if (navigate) {
        if (onNavigate && detail.item.target.type !== 'workspace_day') onNavigate({ type: detail.item.target.type, id: detail.item.target.id });
      } else onReview(draft);
    } catch (caught) { if (mounted.current && !controller.signal.aborted && request === detailGeneration.current) setActionError(inboxErrorMessage(caught)); }
    finally { if (mounted.current && request === detailGeneration.current) { actionFlight.current = false; setBusyId(null); } }
  }
  async function feedback(item: InboxItem, action: 'snooze' | 'dismiss' | 'resolve') {
    if (actionFlight.current) return;
    actionFlight.current = true; setBusyId(item.id); setActionError(''); const controller = new AbortController(); mutationAbort.current = controller;
    try {
      await ackFlight.current;
      if (!mounted.current || controller.signal.aborted) return;
      const { item: current } = await agentInboxService.getInboxDetail(item.id, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const ownAck = current?.seen && !item.seen && acknowledged.current.has(`${item.id}:${item.contentRevision}`) && current.rowRevision === item.rowRevision + 1;
      if (!current || current.contentRevision !== item.contentRevision || current.state !== item.state || current.target.id !== item.target.id || current.target.type !== item.target.type || (current.rowRevision !== item.rowRevision && !ownAck)) throw new AgentInboxError('STATE_CHANGED');
      await agentInboxService.sendInboxFeedback({ id: item.id, expectedRevision: current.rowRevision, action, ...(action === 'snooze' ? { snoozeDays: snoozeDays[item.id] ?? 1 } : {}) }, controller.signal);
      if (mounted.current && !controller.signal.aborted) await reloadPage(filter);
    } catch (caught) {
      if (mounted.current && !controller.signal.aborted) {
        setActionError(inboxErrorMessage(caught));
        if (typeof caught === 'object' && caught && 'code' in caught && caught.code === 'STATE_CHANGED') await reloadPage(filter);
      }
    } finally { if (mounted.current && mutationAbort.current === controller) { actionFlight.current = false; setBusyId(null); } }
  }
  function toggleJournal() {
    if (journalOpen) { journalGeneration.current++; journalAbort.current?.abort(); setJournalLoading(false); setJournalOpen(false); }
    else { setJournalOpen(true); void loadJournal(); }
  }
  function changedSettings(value: PulseSettingsResponse) {
    settingsAbort.current?.abort(); setSettings(value); setSettingsError(''); setActionError(''); void reloadPage(filter);
    if (journalOpen) void loadJournal();
  }
  return <section aria-label="Agent Inbox" className="min-w-0 max-w-full space-y-4 text-sm t-dark [overflow-wrap:anywhere]">
    <h2 className="font-semibold">Inbox</h2>
    <AgentPulseStatus status={{ settings: settings?.settings ?? null, loading: !settings && !settingsError, error: settingsError,
      latestCheck: journal.items[0] ?? null, stale: page.items.some(item => item.stale), unavailable: page.items.some(item => item.unavailable) }} />
    {settingsError && <button type="button" className="dark-chip p-2 text-xs" onClick={() => void loadSettings()}>Retry Agent status</button>}
    <div className="flex min-w-0 flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs">Inbox view<select aria-label="Inbox filter" value={filter} onChange={event => changeFilter(event.target.value as InboxFilter)} className="mt-1 w-full min-w-0 rounded-xl dark-inset p-2">
      <option value="active">Active</option><option value="snoozed">Snoozed</option><option value="dismissed">Dismissed</option><option value="resolved">Resolved</option><option value="all">All Inbox items</option>
    </select></label><button type="button" disabled={loading} onClick={() => void reloadPage()} className="dark-chip p-2 text-xs disabled:opacity-50">Refresh Inbox</button></div>
    {loading && <p role="status" className="text-xs">Loading Inbox…</p>}
    {error && <p role="alert" className="text-xs">{error}</p>}
    {actionError && <p role="alert" className="text-xs">{actionError}</p>}
    {ackMessage && <p role="status" className="text-xs t-dark-muted">{ackMessage}</p>}
    {!loading && !error && page.items.length === 0 && <p className="text-xs t-dark-muted">{filter === 'active' ? 'No current Inbox items.' : 'No Inbox items in this view.'}</p>}
    <div className="space-y-3">{page.items.map(item => <article key={item.id} className="min-w-0 max-w-full dark-inset space-y-2 rounded-xl p-3">
      <p className="text-xs t-dark-muted">{item.kind === 'idea' ? 'Optional AI idea' : 'Workspace observation'} · {item.seen ? 'Seen' : 'New / unseen'} · {item.state}</p>
      <h3 className="whitespace-pre-wrap font-semibold [overflow-wrap:anywhere]">{item.title}</h3>
      <p className="whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{item.summary}</p>
      {item.explanation && <p className="whitespace-pre-wrap text-xs t-dark-muted [overflow-wrap:anywhere]">{item.explanation}</p>}
      <p className="text-xs t-dark-muted">Last verified: <time dateTime={item.lastCheckedAt}>{stamp(item.lastCheckedAt)}</time></p>
      {item.stale && <p className="text-xs">Stale — this source changed since its last check.</p>}
      {item.unavailable && <p className="text-xs">Source unavailable — current ownership or links could not be verified.</p>}
      {(item.snoozeUntil || item.revisitAt) && <p className="text-xs">Snoozed / revisit: <time dateTime={(item.snoozeUntil || item.revisitAt)!}>{stamp((item.snoozeUntil || item.revisitAt)!)}</time></p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busyId !== null || item.stale || item.unavailable} className="dark-chip p-2 text-xs disabled:opacity-50" onClick={() => void review(item)}>Review</button>
        {onNavigate && item.target.type !== 'workspace_day' && <button type="button" disabled={busyId !== null || item.stale || item.unavailable} className="dark-chip p-2 text-xs disabled:opacity-50" onClick={() => void review(item, true)}>Open current target</button>}
        <label className="text-xs">Snooze for<select aria-label="Snooze duration" disabled={busyId !== null} value={snoozeDays[item.id] ?? 1} onChange={event => setSnoozeDays(current => ({ ...current, [item.id]: Number(event.target.value) as 1 | 3 | 7 }))} className="ml-1 rounded-xl dark-inset p-1">{[1, 3, 7].map(days => <option key={days} value={days}>{days} {days === 1 ? 'day' : 'days'}</option>)}</select></label>
        <button type="button" disabled={busyId !== null} className="dark-chip p-2 text-xs disabled:opacity-50" onClick={() => void feedback(item, 'snooze')}>Snooze</button>
        <button type="button" disabled={busyId !== null} className="dark-chip p-2 text-xs disabled:opacity-50" onClick={() => void feedback(item, 'dismiss')}>Dismiss</button>
        <button type="button" disabled={busyId !== null} className="dark-chip max-w-full whitespace-normal p-2 text-xs disabled:opacity-50" onClick={() => void feedback(item, 'resolve')}>Resolve Inbox item</button>
      </div>
      {busyId === item.id && <p role="status" className="text-xs">Loading detail or saving Inbox feedback…</p>}
      <p className="text-xs t-dark-muted">Resolve affects this Inbox item only; it does not complete workspace work.</p>
    </article>)}</div>
    {page.nextCursor && <button type="button" disabled={loading} className="dark-chip p-2 text-xs disabled:opacity-50" onClick={() => void reloadPage(filter, page.nextCursor, true)}>Load more Inbox items</button>}
    <div className="space-y-3 border-t border-[var(--edge-dark)] pt-3">
      <button type="button" aria-expanded={settingsOpen} className="dark-chip p-2 text-xs" onClick={() => setSettingsOpen(current => !current)}>Agent settings</button>
      {settingsOpen && <AgentPulseSettings onChanged={changedSettings} />}
      <div><button type="button" aria-expanded={journalOpen} className="dark-chip max-w-full whitespace-normal p-2 text-left text-xs" onClick={toggleJournal}>Journal — proactive check history</button></div>
      {journalOpen && <section aria-label="Proactive check Journal" className="min-w-0 space-y-2">
        <p className="text-xs t-dark-muted">Journal records proactive checks. Activity is separate manual Agent action history.</p>
        {journalLoading && <p role="status" className="text-xs">Loading Journal…</p>}
        {journalError && <><p role="alert" className="text-xs">{journalError}</p><button type="button" className="dark-chip p-2 text-xs" onClick={() => void loadJournal()}>Retry Journal read</button></>}
        {!journalLoading && !journalError && journal.items.length === 0 && <p className="text-xs t-dark-muted">No Journal entries.</p>}
        {journal.items.map(entry => <article key={entry.id} className="min-w-0 dark-inset space-y-1 rounded-xl p-2 text-xs [overflow-wrap:anywhere]">
          <p>{entry.status} · <time dateTime={entry.startedAt}>{stamp(entry.startedAt)}</time></p><p className="whitespace-pre-wrap">{entry.summary}</p>
          <p>Coverage: {entry.coverage.complete ? 'complete at this check' : `partial / unknown (${entry.coverage.unknown})`}</p>
          <p>Observations created: {entry.createdCount} · updated: {entry.updatedCount} · resolved: {entry.resolvedCount}</p>
          <p>{entry.aiOutcome === 'accepted' ? 'An optional AI idea was saved.' : entry.aiOutcome === 'none' ? 'No proactive AI request recorded.' : 'Proactive AI result was limited or unavailable; it is separate from deterministic coverage.'}</p>
        </article>)}
        {journal.nextCursor && <button type="button" disabled={journalLoading} className="dark-chip p-2 text-xs disabled:opacity-50" onClick={() => void loadJournal(journal.nextCursor, true)}>Load more Journal entries</button>}
      </section>}
    </div>
  </section>;
}
