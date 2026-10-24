import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './phase5d-fixture.mjs';

test('installation ledger shape and independent survival', async t => {
  const f = await fixture(t);
  const columns = (await f.db.query("select column_name from information_schema.columns where table_schema='private' and table_name='agent_pulse_installation_events' order by ordinal_position")).rows.map(row => row.column_name);
  assert.deepEqual(columns, ['id', 'event_kind', 'created_at', 'scheduled_slot', 'nonce_fingerprint', 'dispatch_outcome', 'claim_count', 'reservation_key']);
  await t.test('no_owner_or_pulse_foreign_keys', async () => {
    assert.equal((await f.one("select count(*)::int n from pg_constraint where conrelid='private.agent_pulse_installation_events'::regclass and contype='f'")).n, 0);
  });
  await t.test('exact_shapes_and_duplicate_guards', async () => {
    const reservation = randomUUID();
    await f.db.query("insert into private.agent_pulse_installation_events(event_kind,reservation_key) values('provider_reservation',$1)", [reservation]);
    await assert.rejects(f.db.query("insert into private.agent_pulse_installation_events(event_kind,reservation_key) values('provider_reservation',$1)", [reservation]), { code: '23505' });
    await f.db.exec("insert into private.agent_pulse_installation_events(event_kind,scheduled_slot,nonce_fingerprint,dispatch_outcome,claim_count) values('dispatch_slot','2026-10-15T12:00:00Z',repeat('a',64),'claimed',1)");
    for (const values of ["'dispatch_slot',null,null,null,null,null", "'provider_reservation',null,null,null,null,null", "'provider_reservation','2026-10-15T12:00:00Z',null,null,null,gen_random_uuid()", "'dispatch_slot','2026-10-15T13:00:00Z',repeat('a',64),'empty',0,null", "'dispatch_slot','2026-10-15T16:00:00Z',repeat('a',64),'empty',1,null"]) {
      await assert.rejects(f.db.exec(`insert into private.agent_pulse_installation_events(event_kind,scheduled_slot,nonce_fingerprint,dispatch_outcome,claim_count,reservation_key) values(${values})`), { code: '23514' });
    }
  });
  await t.test('account_deletion_cascades_owner_tables_but_preserves_events', async () => {
    const a = await f.pulse(); await f.observation(a);
    await f.db.query('delete from auth.users where id=$1', [f.owner]);
    for (const table of ['agent_pulse_state', 'agent_pulses', 'agent_observations']) assert.equal((await f.one(`select count(*)::int n from private.${table} where user_id=$1`, [f.owner])).n, 0);
    assert.equal((await f.one('select count(*)::int n from private.agent_pulse_installation_events')).n, 2);
  });
  await t.test('events_are_immutable_and_recent_events_cannot_be_pruned', async () => {
    await assert.rejects(f.db.exec('update private.agent_pulse_installation_events set created_at=clock_timestamp()'), { code: '42501' });
    await assert.rejects(f.db.exec('delete from private.agent_pulse_installation_events'), { code: '42501' });
  });
});
