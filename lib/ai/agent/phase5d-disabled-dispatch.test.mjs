import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './phase5d-fixture.mjs';

const claim = (f, enabled, nonce = randomUUID()) => f.sql("select public.agent_pulse_claim_dispatch(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01'),$1,date_trunc('second',clock_timestamp()),$2) r", [nonce, enabled]);
const snapshot = f => f.one(`select
  (select coalesce(jsonb_agg(to_jsonb(s) order by user_id),'[]') from private.agent_pulse_state s) states,
  (select count(*)::int from private.agent_pulses) pulses,
  (select count(*)::int from private.agent_observations) observations,
  (select count(*)::int from private.agent_pulse_installation_events where event_kind='provider_reservation') reservations`);
const ledger = f => f.one("select count(*)::int n,min(dispatch_outcome) outcome,min(claim_count) claims from private.agent_pulse_installation_events where event_kind='dispatch_slot'");

test('fresh disabled dispatch establishes one zero-claim slot without touching any owner state', async t => {
  const f = await fixture(t); await f.enable(); await f.enable(f.other);
  const before = await snapshot(f), nonce = randomUUID(), result = await claim(f, false, nonce);
  await t.test('disabled with eligible owners', () => assert.deepEqual(result, { slot: result.slot, replay: false, outcome: 'disabled', claimCount: 0, claims: [] }));
  await t.test('no owner state or next_due changes, Pulses, observations or reservations', async () => assert.deepEqual(await snapshot(f), before));
  await t.test('one canonical content-free event', async () => {
    assert.deepEqual(await ledger(f), { n: 1, outcome: 'disabled', claims: 0 });
    const event = await f.one("select * from private.agent_pulse_installation_events where event_kind='dispatch_slot'");
    assert.deepEqual(Object.keys(event).sort(), ['id','event_kind','created_at','scheduled_slot','nonce_fingerprint','dispatch_outcome','claim_count','reservation_key'].sort());
    assert.equal(event.reservation_key, null);
    assert.equal(event.nonce_fingerprint, (await f.one('select private.agent_pulse_hash(to_jsonb($1::text)) hash', [nonce])).hash);
  });
  for (const [name, enabled, replayNonce] of [['same nonce disabled replay',false,nonce],['different nonce disabled replay',false,randomUUID()],['same nonce later enabled',true,nonce],['different nonce later enabled',true,randomUUID()]]) {
    await t.test(name, async () => {
      assert.deepEqual(await claim(f, enabled, replayNonce), { ...result, replay: true });
      assert.deepEqual(await snapshot(f), before);
      assert.deepEqual(await ledger(f), { n: 1, outcome: 'disabled', claims: 0 });
    });
  }
});

test('fresh disabled with no eligible owners is disabled and creates no owner state', async t => {
  const f = await fixture(t), before = await snapshot(f);
  assert.deepEqual(before.states, []);
  const result = await claim(f, false);
  assert.equal(result.outcome, 'disabled'); assert.equal(result.claimCount, 0); assert.deepEqual(result.claims, []);
  assert.deepEqual(await snapshot(f), before);
  assert.deepEqual(await ledger(f), { n: 1, outcome: 'disabled', claims: 0 });
  await t.test('later creation and opt-in cannot reopen disabled slot', async () => {
    const third = randomUUID(); await f.db.query('insert into auth.users(id) values($1)', [third]); await f.enable(third); await f.enable();
    const afterOptIn = await snapshot(f);
    assert.deepEqual(await claim(f, true), { ...result, replay: true });
    assert.deepEqual(await snapshot(f), afterOptIn);
  });
  await t.test('owner deletion cannot reopen disabled slot', async () => {
    await f.db.query('delete from auth.users where id=$1', [f.owner]);
    const afterDelete = await snapshot(f);
    assert.deepEqual(await claim(f, true), { ...result, replay: true });
    assert.deepEqual(await claim(f, false), { ...result, replay: true });
    assert.deepEqual(await snapshot(f), afterDelete);
    assert.deepEqual(await ledger(f), { n: 1, outcome: 'disabled', claims: 0 });
  });
});

test('enabled empty dispatch remains canonical when later disabled', async t => {
  const f = await fixture(t), first = await claim(f, true);
  assert.equal(first.outcome, 'empty'); assert.equal(first.claimCount, 0);
  await f.enable(); const before = await snapshot(f);
  for (const enabled of [false,true]) assert.deepEqual(await claim(f, enabled), { ...first, replay: true });
  assert.deepEqual(await snapshot(f), before);
  assert.deepEqual(await ledger(f), { n: 1, outcome: 'empty', claims: 0 });
});

test('enabled claimed dispatch remains canonical when later disabled or owners deleted', async t => {
  const f = await fixture(t); await f.enable(); await f.enable(f.other);
  const first = await claim(f, true); assert.equal(first.outcome, 'claimed'); assert.equal(first.claimCount, 2);
  await t.test('disabled replay returns original claims unchanged', async () => {
    const before = await snapshot(f);
    assert.deepEqual(await claim(f, false), { ...first, replay: true });
    assert.deepEqual(await snapshot(f), before);
  });
  await t.test('deleted claimed owners admit no replacements under either flag', async () => {
    for (const a of first.claims) await f.db.query('delete from auth.users where id=$1', [a.userId]);
    const replacement = randomUUID(); await f.db.query('insert into auth.users(id) values($1)', [replacement]); await f.enable(replacement);
    const before = await snapshot(f);
    for (const enabled of [true,false]) assert.deepEqual(await claim(f, enabled), { ...first, replay: true, claims: [] });
    assert.deepEqual(await snapshot(f), before);
    assert.deepEqual(await ledger(f), { n: 1, outcome: 'claimed', claims: 2 });
  });
});

test('NULL processing flag fails closed on both fresh and established slots', async t => {
  const f = await fixture(t); await f.enable(); const before = await snapshot(f);
  await assert.rejects(claim(f, null), { code: '22023' });
  assert.deepEqual(await snapshot(f), before); assert.equal((await ledger(f)).n, 0);
  await claim(f, false);
  await assert.rejects(claim(f, null), { code: '22023' });
  assert.deepEqual(await snapshot(f), before); assert.equal((await ledger(f)).n, 1);
});

test('exact required four-argument dispatch catalog and service-only grants', async t => {
  const f = await fixture(t);
  const rows = (await f.db.query(`select p.pronargs,p.pronargdefaults,p.proargnames,p.prosecdef,p.proconfig,
    oidvectortypes(p.proargtypes) types,
    has_function_privilege('service_role',p.oid,'execute') service,
    has_function_privilege('anon',p.oid,'execute') anon,
    has_function_privilege('authenticated',p.oid,'execute') browser,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='agent_pulse_claim_dispatch'`)).rows;
  assert.equal(rows.length, 1); const row = rows[0];
  await t.test('exactly four required arguments with boolean fourth and no defaults', () => {
    assert.equal(row.pronargs, 4); assert.equal(row.pronargdefaults, 0);
    assert.deepEqual(row.proargnames, ['p_slot','p_nonce','p_issued_at','p_processing_enabled']);
    assert.equal(row.types, 'timestamp with time zone, uuid, timestamp with time zone, boolean');
  });
  await t.test('old three-argument overload absent and cannot be called', async () => {
    assert.equal((await f.one("select to_regprocedure('public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz)') old")).old, null);
    await assert.rejects(f.sql("select public.agent_pulse_claim_dispatch(clock_timestamp(),gen_random_uuid(),clock_timestamp()) r"), { code: '42883' });
  });
  await t.test('SECURITY DEFINER empty search_path and role matrix', () => {
    assert.equal(row.prosecdef, true); assert.ok(row.proconfig.includes('search_path=""'));
    assert.equal(row.public, false); assert.equal(row.anon, false); assert.equal(row.browser, false); assert.equal(row.service, true);
  });
  await t.test('installation lock and replay precede disabled branch, which precedes owner selection', async () => {
    const body = (await f.one("select pg_get_functiondef('public.agent_pulse_claim_dispatch(timestamptz,uuid,timestamptz,boolean)'::regprocedure) body")).body;
    const lock = body.indexOf('perform pg_catalog.pg_advisory_xact_lock(505,5)'), replay = body.indexOf('if found then'),
      disabled = body.indexOf('if not p_processing_enabled then'), owners = body.indexOf('select array_agg(user_id');
    assert.ok(lock >= 0 && lock < replay && replay < disabled && disabled < owners);
    assert.doesNotMatch(body.slice(disabled,owners), /agent_pulse_state|agent_pulses|agent_observations|provider_reservation/);
  });
  for (const role of ['anon','authenticated','service_role']) await t.test(role + ' exact invocation and ledger boundary', async () => {
    await f.db.exec('set role ' + role);
    try {
      if (role === 'service_role') assert.equal((await claim(f, false)).outcome, 'disabled');
      else await assert.rejects(claim(f, false), { code: '42501' });
      await assert.rejects(f.db.exec('select * from private.agent_pulse_installation_events'), { code: '42501' });
      await assert.rejects(f.db.exec('insert into private.agent_pulse_installation_events default values'), { code: '42501' });
    } finally { await f.db.exec('reset role'); }
  });
});
