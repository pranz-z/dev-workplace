import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fixture, pulseMigration, root } from './phase5d-fixture.mjs';

test('Phase 5D schema, constraints and private boundaries', async t => {
  const f = await fixture(t);
  await t.test('all_four_tables_exist_without_opt_in_seeds', async () => {
    for (const name of ['agent_pulse_state', 'agent_pulses', 'agent_observations', 'agent_pulse_installation_events']) {
      assert.ok((await f.one('select to_regclass($1) r', ['private.' + name])).r, name);
      assert.equal((await f.one(`select count(*)::int n from private.${name}`)).n, 0);
    }
  });
  // Assert the intended missing feature before any dependent DML.
  assert.ok((await f.one("select to_regclass('private.agent_pulse_state') r")).r, 'Phase 5D schema missing');
  await t.test('owner_fk_and_checked_default_off', async () => {
    await assert.rejects(f.state(randomUUID()), { code: '23503' });
    await f.state();
    const row = await f.one('select mode,cadence,fence,settings_revision from private.agent_pulse_state where user_id=$1', [f.owner]);
    assert.deepEqual(row, { mode: 'off', cadence: 'normal', fence: 0, settings_revision: 1 });
    for (const change of ["mode='automatic'", 'fence=-1', "baseline='[]'::jsonb", "baseline=jsonb_build_object('x',repeat('x',17000))", 'ui_write_count=61']) {
      await assert.rejects(f.db.exec(`update private.agent_pulse_state set ${change} where user_id='${f.owner}'`), { code: '23514' });
    }
  });
  await t.test('unique_owner_slot_and_one_running_pulse', async () => {
    const a = await f.pulse();
    await assert.rejects(f.pulse(f.owner, { slot: '2026-10-15T16:00:00Z' }), { code: '23505' });
    await assert.rejects(f.pulse(), { code: '23505' });
    const id = await f.observation(a);
    await assert.rejects(f.observation(a), { code: '23505' });
    await assert.rejects(f.db.query('update private.agent_observations set content_revision=0 where id=$1', [id]), { code: '23514' });
    await assert.rejects(f.db.query('update private.agent_observations set seen_content_revision=2 where id=$1', [id]), { code: '23514' });
    await assert.rejects(f.db.query("update private.agent_observations set title=repeat('😀',121) where id=$1", [id]), { code: '23514' });
    await assert.rejects(f.db.query("update private.agent_observations set state='watching' where id=$1", [id]), { code: '23514' });
    await assert.rejects(f.db.query("update private.agent_observations set reason_codes=array['arbitrary'] where id=$1", [id]), { code: '23514' });
    const b = await f.pulse(f.other);
    await assert.rejects(f.db.query('update private.agent_observations set latest_pulse_id=$1 where id=$2', [b.pulseId, id]), { code: '23503' });
  });
  await t.test('rls_and_actual_browser_and_service_table_denial', async () => {
    const rows = (await f.db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('agent_pulse_state','agent_pulses','agent_observations','agent_pulse_installation_events')")).rows;
    assert.equal(rows.length, 4); assert.ok(rows.every(row => row.relrowsecurity));
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await f.db.exec(`set role ${role}`);
      try { await assert.rejects(f.db.exec('select * from private.agent_pulse_state'), { code: '42501' }); }
      finally { await f.db.exec('reset role'); }
    }
    const functions = (await f.db.query("select p.oid::regprocedure::text name,prosecdef,proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') browser from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'agent_pulse_%'")).rows;
    assert.ok(functions.length > 0);
    assert.ok(functions.every(row => !row.anon && !row.browser));
    assert.ok(functions.filter(row => row.prosecdef).every(row => row.proconfig.includes('search_path=""')));
  });
  await t.test('migration_has_no_activation_or_core_mutation', () => {
    const source = readFileSync(new URL('supabase/migrations/' + pulseMigration(), root), 'utf8');
    assert.doesNotMatch(source, /create\s+extension|cron\.schedule|net\.http|vault\.|insert\s+into\s+(?:public|auth)\.|update\s+(?:public|auth)\.|delete\s+from\s+(?:public|auth)\./i);
  });
  await t.test('idea_identity_parent_kind_self_reference_and_same_owner_provenance', async () => {
    const parent = await f.one('select id,origin_pulse_id from private.agent_observations where user_id=$1 limit 1', [f.owner]);
    const idea = async (id, parentId, key) => f.db.query(`insert into private.agent_observations(id,user_id,kind,condition_key,target_type,target_id,parent_observation_id,parent_episode,idea_category,material_fingerprint,source_token,evidence_valid_until,reason_codes,rank,origin_pulse_id,latest_pulse_id)
      values($1,$2,'idea',$3,'task',$4,$5,1,'review_deadline',repeat('a',64),repeat('b',64),clock_timestamp()+interval '1 day',array['DEADLINE_TODAY'],5,$6,$6)`, [id, f.owner, key, f.task, parentId, parent.origin_pulse_id]);
    const id = randomUUID(); await idea(id, parent.id, 'idea:first');
    await assert.rejects(idea(randomUUID(), parent.id, 'idea:duplicate'), { code: '23505' });
    await assert.rejects(idea(randomUUID(), id, 'idea:recursive'), { code: '23514' });
    const self = randomUUID(); await assert.rejects(idea(self, self, 'idea:self'), { code: '23514' });
    await assert.rejects(f.db.query('update private.agent_observations set target_id=$1 where id=$2', [randomUUID(), id]), { code: '42501' });
    await assert.rejects(f.db.query('update private.agent_observations set ai_attempt_count=1,ai_last_attempt_at=clock_timestamp() where id=$1', [id]), { code: '23514' });
  });
  await t.test('complete_role_matrix_including_every_helper_overload_and_direct_dml', async () => {
    const functions = (await f.db.query(`select n.nspname,p.proname,p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,
      has_function_privilege('service_role',p.oid,'execute') service,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public,
      (select string_agg('NULL::'||format_type(x,null),',' order by ordinal) from unnest(p.proargtypes::oid[]) with ordinality args(x,ordinal)) args
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'agent_pulse_%' order by n.nspname,p.proname`)).rows;
    assert.ok(functions.length>20);
    for (const fn of functions) {
      assert.equal(fn.public,false,fn.signature);
      assert.equal(fn.service,fn.nspname==='public',fn.signature);
      if (fn.nspname==='public') { assert.equal(fn.prosecdef,true); assert.ok(fn.proconfig.includes('search_path=""')); }
    }
    for (const role of ['anon','authenticated','service_role']) {
      await f.db.exec(`set role ${role}`);
      try {
        for (const table of ['agent_pulse_state','agent_pulses','agent_observations','agent_pulse_installation_events']) {
          for (const sql of [`select * from private.${table}`,`insert into private.${table} default values`,`update private.${table} set id=id where false`.replace(table==='agent_pulse_state'?'set id=id':'NO_MATCH','set user_id=user_id'),`delete from private.${table} where false`]) {
            await assert.rejects(f.db.exec(sql), { code:'42501' },role+' '+table);
          }
        }
        for (const fn of functions.filter(fn=>role!=='service_role'||fn.nspname==='private')) {
          await assert.rejects(f.db.exec(`select ${fn.nspname}.${fn.proname}(${fn.args??''})`), { code:'42501' },role+' '+fn.signature);
        }
        if (role==='service_role') assert.equal((await f.sql('select public.agent_pulse_get_settings($1) r',[f.other])).mode,'off');
      } finally { await f.db.exec('reset role'); }
    }
  });
});
