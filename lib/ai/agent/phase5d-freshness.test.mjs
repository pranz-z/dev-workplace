import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './phase5d-fixture.mjs';
import { dispatchTestClock, restoreDispatchTestClock, dispatchFreshnessCases } from './phase5d-freshness-cases.mjs';

test('actual SQL dispatch freshness uses whole issued seconds and inclusive integer boundaries', async t => {
  const f = await fixture(t);
  const originalClock = (await f.one("select pg_get_functiondef('pg_catalog.clock_timestamp()'::regprocedure) definition")).definition;
  const dispatch = (await f.one("select pg_get_functiondef('public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean)'::regprocedure) definition")).definition;
  await f.db.exec(dispatchTestClock);
  let events = 0;
  try {
    for (const item of dispatchFreshnessCases()) await t.test(item.name, async () => {
      await f.db.query("select set_config('phase5d.test_tick',$1,false)",[item.tick]);
      assert.equal((await f.one('select clock_timestamp()=$1::timestamptz exact',[item.tick])).exact,true);
      const invoke = () => f.sql('select public.agent_pulse_claim_dispatch($1,$2,$3,false) r',[item.slot,randomUUID(),item.issued]);
      if (item.accepted) {
        assert.deepEqual(await invoke(),{slot:item.slot.replace('.000Z','.000000Z'),replay:false,outcome:'disabled',claimCount:0,claims:[]});
        events++;
      } else await assert.rejects(invoke(),{code:'22023'});
      assert.deepEqual(await f.one(`select (select count(*)::int from private.agent_pulse_installation_events) events,
        (select count(*)::int from private.agent_pulses) pulses,(select count(*)::int from private.agent_pulse_state) owners`),{events,pulses:0,owners:0});
    });
    assert.equal((await f.one("select pg_get_functiondef('public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean)'::regprocedure) definition")).definition,dispatch);
  } finally { await f.db.exec(restoreDispatchTestClock); }
  assert.equal((await f.one("select pg_get_functiondef('pg_catalog.clock_timestamp()'::regprocedure) definition")).definition,originalClock);
});
