'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { WorkspaceDialog } from '@/components/workspace/WorkspaceDialog';
import { agentInboxService, inboxErrorMessage } from '@/data/agentInboxService';
import type { PulseSettingsInput, PulseSettingsResponse } from '@/data/agentInbox';

interface Props { onChanged: (value: PulseSettingsResponse) => void }
function draft(value: PulseSettingsResponse) {
  const s = value.settings;
  return { mode: s.mode, cadence: s.cadence, checksConsent: s.checksConsented, aiConsent: s.aiConsented, aiProjectIds: [...s.aiProjectIds] };
}
export function AgentPulseSettings(props: Props) {
  const { status, user } = useAuth();
  return status === 'authenticated' && user ? <SettingsSession key={user.id} {...props} /> : <p role="status">Sign in to manage Agent settings.</p>;
}
function SettingsSession({ onChanged }: Props) {
  const [data, setData] = useState<PulseSettingsResponse | null>(null);
  const [form, setForm] = useState<ReturnType<typeof draft>>({ mode: 'off', cadence: 'normal', checksConsent: false, aiConsent: false, aiProjectIds: [] });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmation, setConfirmation] = useState(false);
  const read = useRef<AbortController | null>(null), mutation = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(true), flight = useRef(false);
  const load = useCallback(async (preserveError = false) => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller; const request = ++generation.current;
    try {
      const value = await agentInboxService.getPulseSettings(controller.signal);
      if (mounted.current && request === generation.current && !controller.signal.aborted) { setData(value); setForm(draft(value)); if (!preserveError) setError(''); return value; }
    } catch (caught) { if (mounted.current && request === generation.current && !controller.signal.aborted) setError(inboxErrorMessage(caught)); }
    finally { if (mounted.current && request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; mounted.current = false; read.current?.abort(); mutation.current?.abort(); flight.current = false; };
  }, [load]);
  async function save(clear = false) {
    if (!data || flight.current) return;
    flight.current = true; const controller = new AbortController(); mutation.current = controller; setBusy(true); setError('');
    try {
      let value: PulseSettingsResponse | undefined;
      if (clear) {
        await agentInboxService.clearPulseMemory({ expectedRevision: data.settings.settingsRevision, confirmation: 'CLEAR_AGENT_MEMORY' }, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        setLoading(true); value = await load();
      } else {
        const input: PulseSettingsInput = { expectedRevision: data.settings.settingsRevision, mode: form.mode, cadence: form.cadence,
          aiProjectIds: form.aiConsent ? [...form.aiProjectIds] : [],
          ...(form.checksConsent ? { checksConsentVersion: data.disclosures.checksConsentVersion } : {}),
          ...(form.aiConsent ? { aiConsentVersion: data.disclosures.aiConsentVersion } : {}) };
        value = await agentInboxService.updatePulseSettings(input, controller.signal);
      }
      if (mounted.current && !controller.signal.aborted && value) { setData(value); setForm(draft(value)); setConfirmation(false); onChanged(value); }
    } catch (caught) {
      if (mounted.current && !controller.signal.aborted) {
        setError(inboxErrorMessage(caught));
        if (typeof caught === 'object' && caught && 'code' in caught && caught.code === 'STATE_CHANGED') { setLoading(true); await load(true); }
      }
    } finally { if (mounted.current && mutation.current === controller) { flight.current = false; setBusy(false); } }
  }
  const invalidConsent = (form.mode !== 'off' && !form.checksConsent) || (form.mode === 'workspace_ai' && !form.aiConsent);
  return <section aria-label="Agent settings" className="min-w-0 space-y-3 text-xs t-dark [overflow-wrap:anywhere]">
    <h3 className="font-semibold">Agent settings</h3>
    {loading && <p role="status">Loading Agent settings…</p>}
    {error && <p role="alert">{error}</p>}
    {!data && !loading && <button type="button" className="dark-chip p-2" onClick={() => { setLoading(true); void load(); }}>Retry settings read</button>}
    {data && <>
      <fieldset disabled={busy || loading} className="min-w-0 space-y-3">
        <legend className="sr-only">Periodic checks and provider consent</legend>
        <label className="block space-y-1">Mode<select aria-label="Agent checks mode" value={form.mode} onChange={event => setForm(current => ({ ...current, mode: event.target.value as PulseSettingsInput['mode'] }))} className="w-full min-w-0 rounded-xl dark-inset p-2">
          <option value="off">Off</option><option value="workspace">Workspace checks</option><option value="workspace_ai">Workspace + optional AI</option>
        </select></label>
        <p>Off pauses checks; it does not delete history.</p>
        <label className="flex items-start gap-2"><input aria-label="Allow periodic workspace checks" type="checkbox" checked={form.checksConsent} onChange={event => setForm(current => ({ ...current, checksConsent: event.target.checked }))} />Allow periodic proactive workspace checks.</label>
        <p>Checks inspect recorded workspace state periodically, not continuously.</p>
        <div id="pulse-ai-disclosure" className="space-y-2">
          <p>Eligible periodic AI checks may send minimized information from your selected projects to Google Gemini: project, task and milestone titles, and bounded status, priority, deadline and deterministic check facts. Requests depend on service availability and budget limits.</p>
          <p>This deployment is intended to use Gemini&apos;s unpaid/free API service. Under Google&apos;s current unpaid-service terms, submitted content and generated responses may be used to provide, improve and develop Google products, services and machine-learning technologies. Human reviewers may read and process API inputs and outputs for quality and product improvement.</p>
          <p>Do not select projects whose titles or bounded facts contain sensitive, confidential or personal information for unpaid Gemini processing. Minimization does not guarantee that titles are non-sensitive. Data treatment can differ for paid services and under regional or account-specific terms.</p>
          <p>Turning proactive AI off or removing selected projects prevents future sends after the change takes effect. It cannot retract information already transmitted to Gemini. This consent is separate from mode; revoking it clears project scope. AI scope starts empty. You can keep deterministic workspace checks without AI, or turn all proactive checks Off.</p>
        </div>
        <label className="flex items-start gap-2"><input aria-label="Allow proactive AI provider disclosure" aria-describedby="pulse-ai-disclosure" type="checkbox" checked={form.aiConsent} onChange={event => setForm(current => ({ ...current, aiConsent: event.target.checked, aiProjectIds: event.target.checked ? current.aiProjectIds : [] }))} />Allow proactive AI provider disclosure.</label>
        <label className="block space-y-1">Cadence<select aria-label="Agent checks cadence" value={form.cadence} onChange={event => setForm(current => ({ ...current, cadence: event.target.value as PulseSettingsInput['cadence'] }))} className="w-full min-w-0 rounded-xl dark-inset p-2"><option value="normal">Normal</option><option value="quiet">Quiet</option></select></label>
        <fieldset className="min-w-0 space-y-2"><legend className="font-semibold">AI project scope</legend>
          <p>{form.aiProjectIds.length === 0 ? 'Empty selection means no proactive project AI context.' : `${form.aiProjectIds.length} selected (maximum 20).`}</p>
          {data.projectChoicesTruncated && <p>Only the first 20 project choices are shown; this is a limited list.</p>}
          {form.aiProjectIds.some(id => !data.projectChoices.some(choice => choice.id === id)) && <p>Additional saved selections are outside this list; saving preserves them.</p>}
          {data.projectChoices.length === 0 && <p>No project choices are available.</p>}
          {data.projectChoices.map(choice => <label key={choice.id} className="flex min-w-0 items-start gap-2"><input type="checkbox" aria-label={`AI scope: ${choice.title}`} disabled={!form.aiConsent || (!form.aiProjectIds.includes(choice.id) && form.aiProjectIds.length >= 20)} checked={form.aiProjectIds.includes(choice.id)} onChange={event => setForm(current => ({ ...current, aiProjectIds: event.target.checked ? current.aiProjectIds.length < 20 ? [...current.aiProjectIds, choice.id] : current.aiProjectIds : current.aiProjectIds.filter(id => id !== choice.id) }))} /><span className="min-w-0 [overflow-wrap:anywhere]">{choice.title}</span></label>)}
          {form.aiProjectIds.length > 0 && <button type="button" className="dark-chip p-2" onClick={() => setForm(current => ({ ...current, aiProjectIds: [] }))}>Clear project selection</button>}
        </fieldset>
      </fieldset>
      {invalidConsent && <p role="status">The selected mode requires explicit checks consent and, for AI mode, separate provider consent.</p>}
      <button type="button" disabled={busy || loading || invalidConsent} className="dark-chip p-2 disabled:opacity-50" onClick={() => void save()}>Save Agent settings</button>
      <div className="border-t border-[var(--edge-dark)] pt-3"><button type="button" disabled={busy || loading} className="dark-chip max-w-full whitespace-normal p-2 disabled:opacity-50" onClick={() => setConfirmation(true)}>Clear proactive Agent memory</button></div>
    </>}
    {busy && <p role="status">Saving Agent settings…</p>}
    {confirmation && <WorkspaceDialog label="Clear proactive Agent memory" onClose={() => { if (!busy) setConfirmation(false); }}>
      <section className="max-w-lg space-y-3 p-4 text-sm">
        <h3 className="font-semibold">Clear proactive Agent memory?</h3>
        <p>Proactive observations and memory are cleared. Relevant conditions may be rediscovered later.</p>
        <p>Your workspace projects, tasks and files are not deleted.</p>
        <p>Operational and provider accounting required for limits survives.</p>
        <div className="flex flex-wrap gap-2"><button type="button" autoFocus disabled={busy} className="ink-button px-3 py-2" onClick={() => setConfirmation(false)}>Cancel memory clear</button><button type="button" disabled={busy} className="ink-button primary px-3 py-2" onClick={() => void save(true)}>Confirm memory clear</button></div>
      </section>
    </WorkspaceDialog>}
  </section>;
}
