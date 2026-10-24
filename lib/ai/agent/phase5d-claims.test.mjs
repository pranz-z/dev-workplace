import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './phase5d-fixture.mjs';

export async function enable(f, owner = f.owner, mode = 'workspace') {
  await f.state(owner);
  await f.db.query("update private.agent_pulse_state set mode=$2,checks_consent_version='checks-v1',checks_consented_at=clock_timestamp(),next_due_at=pg_catalog.date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01') where user_id=$1", [owner, mode]);
}
export async function claim(f, nonce = randomUUID()) {
  return f.sql("select public.agent_pulse_claim_dispatch(pg_catalog.date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01'),$1,date_trunc('second',clock_timestamp()),true) r", [nonce]);
}
test('dispatch identity survives nonce changes and owner deletion', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean)') r")).r, 'claim RPC missing');
  const third = '33333333-3333-4333-8333-333333333333';
  await f.db.query('insert into auth.users(id) values($1)', [third]);
  for (const owner of [f.owner, f.other, third]) await enable(f, owner);
  const nonce = randomUUID(), first = await claim(f, nonce);
  await t.test('at_most_two_owners_and_ninety_second_leases', async () => {
    assert.equal(first.claimCount, 2); assert.equal(first.claims.length, 2); assert.equal(first.replay, false);
    const rows = (await f.db.query('select extract(epoch from lease_expires_at-started_at)::int seconds,fence from private.agent_pulses')).rows;
    assert.ok(rows.every(row => row.seconds === 90 && row.fence === 1));
  });
  await t.test('same_and_changed_nonce_recover_without_expanding_or_restarting', async () => {
    for (const n of [nonce, randomUUID()]) {
      const replay = await claim(f, n);
      assert.equal(replay.replay, true); assert.equal(replay.claimCount, 2);
      assert.deepEqual(replay.claims.map(a => a.pulseId), first.claims.map(a => a.pulseId));
    }
    assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n, 2);
  });
  await t.test('deleted_owners_never_reopen_the_slot', async () => {
    for (const authority of first.claims) await f.db.query('delete from auth.users where id=$1', [authority.userId]);
    const replay = await claim(f);
    assert.equal(replay.claimCount, 2); assert.equal(replay.replay, true); assert.equal(replay.claims.length, 0);
    assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n, 0);
    assert.equal((await f.one('select count(*)::int n from private.agent_pulse_installation_events')).n, 1);
  });
});
test('empty_slot_remains_empty_after_new_opt_in', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean)') r")).r, 'claim RPC missing');
  assert.equal((await claim(f)).claimCount, 0);
  await enable(f);
  const replay = await claim(f);
  assert.equal(replay.claimCount, 0); assert.equal(replay.outcome, 'empty'); assert.equal(replay.replay, true);
});
test('expired_authority_is_fenced_and_recovery_is_read_only', async t => {
  const f = await fixture(t);
  assert.ok((await f.one("select to_regprocedure('public.agent_pulse_finish(uuid,uuid,uuid,bigint,text)') r")).r, 'writer guard missing');
  await enable(f);
  const oldId = randomUUID(), oldLease = randomUUID();
  await f.db.query(`insert into private.agent_pulses(id,user_id,scheduled_slot,dispatch_nonce,started_at,fence,lease_token,lease_expires_at,settings_revision,policy_version)
    values($1,$2,date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')-interval '4 hours',gen_random_uuid(),clock_timestamp()-interval '91 seconds',1,$3,clock_timestamp()-interval '1 second',1,'pulse-v1')`, [oldId, f.owner, oldLease]);
  await f.db.query("update private.agent_pulse_state set fence=1,lease_token=$2,lease_expires_at=clock_timestamp()-interval '1 second' where user_id=$1", [f.owner, oldLease]);
  const newer = (await claim(f)).claims[0];
  assert.equal(newer.fence, 2);
  const finish = (id, lease, fence) => f.sql('select public.agent_pulse_finish($1,$2,$3,$4,$5) r', [f.owner, id, lease, fence, 'none']);
  await assert.rejects(finish(oldId, oldLease, 1), /AUTHORITY_LOST/);
  const before = (await f.one('select count(*)::int n from private.agent_pulses')).n;
  const recovery = await f.sql('select public.agent_pulse_recover($1,$2) r', [f.owner, newer.pulseId]);
  assert.equal(recovery.status, 'running'); assert.equal(recovery.reserved, false);
  assert.equal((await f.one('select count(*)::int n from private.agent_pulses')).n, before);
  assert.equal((await f.one('select status from private.agent_pulses where id=$1', [oldId])).status, 'abandoned');
  await f.db.query('update private.agent_pulse_state set settings_revision=settings_revision+1 where user_id=$1', [f.owner]);
  await assert.rejects(finish(newer.pulseId, newer.leaseToken, newer.fence), /AUTHORITY_LOST/);
});
