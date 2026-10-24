import type { AgentPulseJournalItem, PulseSettingsDto } from '@/data/agentInbox';

export interface AgentPulseStatusValue {
  settings: PulseSettingsDto | null; loading?: boolean; error?: string;
  latestCheck?: AgentPulseJournalItem | null; stale?: boolean; unavailable?: boolean;
}
export function AgentPulseStatus({ status }: { status: AgentPulseStatusValue }) {
  const { settings, latestCheck } = status;
  if (!settings) return <section aria-label="Agent check status" role="status" className="dark-inset rounded-xl p-3 text-xs t-dark-muted">
    {status.loading ? 'Loading Agent status…' : 'Agent status is unavailable. Retry the read.'}
  </section>;
  let label = 'No checks recorded yet.';
  if (settings.mode === 'off') label = 'Off — periodic checks are disabled.';
  else if (latestCheck?.status === 'running') label = 'Checking — a recorded workspace check is running.';
  else if (latestCheck?.aiOutcome === 'skipped_budget' || latestCheck?.errorCode === 'BUDGET' || latestCheck?.errorCode === 'CAPACITY') label = 'Budget-limited — proactive AI may be skipped.';
  else if (status.error || latestCheck?.status === 'failed') label = 'A check or status read failed. Current coverage may be unknown.';
  else if (status.unavailable || !settings.checksEnabled) label = 'Paused / unavailable — check consent and timezone readiness.';
  else if (status.stale) label = 'Some Inbox content is stale. Re-check current state before Review.';
  else if (latestCheck?.aiOutcome === 'unavailable' || latestCheck?.aiOutcome === 'timeout') label = 'Proactive AI unavailable. Recorded deterministic checks remain separate.';
  else if (settings.lastDeterministicAt && !settings.coverage.complete) label = 'Partial coverage — some workspace state is unknown.';
  else if (settings.lastDeterministicAt) label = 'Workspace check recorded.';
  return <section aria-label="Agent check status" className="min-w-0 dark-inset space-y-2 rounded-xl p-3 text-xs t-dark-muted [overflow-wrap:anywhere]">
    <h3 className="font-semibold t-dark">Agent checks</h3><p role="status">{label}</p>
    {status.stale && <p>Stale Inbox content needs a current-state recheck.</p>}
    {status.unavailable && <p>Some current sources are unavailable.</p>}
    <p>Mode: {settings.mode === 'workspace_ai' ? 'Workspace + optional AI' : settings.mode === 'workspace' ? 'Workspace checks' : 'Off'}</p>
    {settings.lastDeterministicAt ? <p>Last deterministic check: <time dateTime={settings.lastDeterministicAt}>{new Date(settings.lastDeterministicAt).toLocaleString()}</time></p> : <p>No checks recorded yet.</p>}
    <p>Coverage: {settings.coverage.complete ? 'complete at the recorded check' : `unknown / partial (${settings.coverage.unknown} unknown sources)`}</p>
    <p>Check runs: {settings.usage.ownerPulses} · AI requests used: {settings.usage.ownerRequests} · Ideas saved: {settings.usage.ownerIdeas} (last 24 hours)</p>
    {settings.nextDueAt && <p>Approximate next check: <time dateTime={settings.nextDueAt}>{new Date(settings.nextDueAt).toLocaleString()}</time>, subject to service availability.</p>}
    <p>Periodic checks do not continuously monitor your workspace.</p>
  </section>;
}
