import { fixture as base } from './phase5c-fixture.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export { root } from './phase5b-fixture.mjs';
const root = new URL('../../../', import.meta.url);
export const pulseMigration = () => {
  const names = readdirSync(new URL('supabase/migrations/', root)).filter(name => name.endsWith('_workspace_agent_pulse.sql'));
  if (names.length > 1) throw new Error('Exactly one Phase 5D migration is permitted');
  return names[0];
};
export async function fixture(t, { includePulse = true } = {}) {
  const f = await base(t);
  // Extend the earlier minimal fixture with actual existing source columns, not product schema changes.
  await f.db.exec(`alter table public.projects add column status text not null default 'Planning',
    add column workflow_stage text not null default 'planning', add column priority text not null default 'Medium',
    add column created_at timestamptz not null default clock_timestamp();`);
  const name = pulseMigration();
  if (includePulse && name) {
    try { await f.db.exec(readFileSync(new URL('supabase/migrations/' + name, root), 'utf8')); }
    catch (error) { throw new Error(`Phase 5D migration ${error.code}: ${error.message} at ${error.position}`); }
  }
  const sql = async (text, values = []) => (await f.one(text, values)).r;
  const state = async (user = f.owner) => f.db.query('insert into private.agent_pulse_state(user_id) values($1) on conflict do nothing', [user]);
  const pulse = async (user = f.owner, changes = {}) => {
    const id = randomUUID(), nonce = randomUUID(), lease = randomUUID();
    await state(user);
    await f.db.query(`insert into private.agent_pulses(id,user_id,scheduled_slot,dispatch_nonce,fence,lease_token,lease_expires_at,settings_revision,policy_version)
      values($1,$2,$3,$4,$6,$5,clock_timestamp()+interval '90 seconds',$7,'pulse-v1')`, [id, user, changes.slot ?? '2026-10-15T12:00:00Z', nonce, lease, changes.fence ?? 1, changes.settingsRevision ?? 1]);
    return { userId: user, pulseId: id, slot: changes.slot ?? '2026-10-15T12:00:00Z', leaseToken: lease, fence: changes.fence ?? 1, settingsRevision: changes.settingsRevision ?? 1, policyVersion: 'pulse-v1' };
  };
  const observation = async (authority, changes = {}) => {
    const id = randomUUID();
    await f.db.query(`insert into private.agent_observations(id,user_id,condition_key,family,target_type,target_id,
      material_fingerprint,source_token,evidence_valid_until,reason_codes,title,origin_pulse_id,latest_pulse_id)
      values($1,$2,$3,'deadline','task',$4,repeat('a',64),repeat('b',64),clock_timestamp()+interval '1 day',array['DEADLINE_TODAY'],'Task',$5,$5)`,
    [id, authority.userId, changes.key ?? `task:${f.task}:attention`, changes.targetId ?? f.task, authority.pulseId]);
    return id;
  };
  const authorize = async authority => f.db.query(`update private.agent_pulse_state set mode='workspace',checks_consent_version='checks-v1',checks_consented_at=clock_timestamp(),fence=$2,lease_token=$3,lease_expires_at=(select lease_expires_at from private.agent_pulses where id=$4) where user_id=$1`, [authority.userId, authority.fence, authority.leaseToken, authority.pulseId]);
  const readSource = authority => sql('select public.agent_pulse_read_source($1,$2,$3,$4) r', [authority.userId, authority.pulseId, authority.leaseToken, authority.fence]);
  const enable = async (user = f.owner) => {
    await state(user);
    await f.db.query("update private.agent_pulse_state set mode='workspace',checks_consent_version='checks-v1',checks_consented_at=clock_timestamp(),next_due_at=date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01') where user_id=$1", [user]);
  };
  const claim = () => sql("select public.agent_pulse_claim_dispatch(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01'),gen_random_uuid(),date_trunc('second',clock_timestamp()),true) r");
  const scan = async authority => {
    const { loadPulse } = await import('./phase5d-test-support.mjs');
    const { scanPulse } = await loadPulse('lib/ai/agent/pulse/scanner.ts');
    const { PULSE_POLICY } = await loadPulse('lib/ai/agent/pulse/policy.ts');
    const source = await readSource(authority);
    return scanPulse(source, source.existing, PULSE_POLICY);
  };
  const publish = async (authority, value = null, commitId = randomUUID()) => {
    const current = value ?? await scan(authority);
    return sql('select public.agent_pulse_publish_deterministic($1,$2,$3,$4,$5,$6,$7,$8) r', [authority.userId, authority.pulseId, authority.leaseToken, authority.fence, authority.settingsRevision, commitId, JSON.stringify({ decisions: current.decisions, coverage: current.coverage }), JSON.stringify(current.baselinePatches)]);
  };
  return { ...f, sql, state, pulse, observation, authorize, readSource, enable, claim, scan, publish };
}
