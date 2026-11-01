import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './phase5d-one-shot-fixture.mjs';
test('private one-shot capability exists with RLS and no direct grants',async t=>{
 const f=await fixture(t);
 assert.equal((await f.one("select relrowsecurity r from pg_class where oid='private.agent_pulse_one_shot_authorizations'::regclass")).r,true);
 for(const role of ['anon','authenticated','service_role']){
  const r=await f.one("select has_table_privilege($1,'private.agent_pulse_one_shot_authorizations','SELECT,INSERT,UPDATE,DELETE') allowed",[role]);
  assert.equal(r.allowed,false,role);
 }
 for(const name of ['agent_pulse_one_shot_preview','agent_pulse_one_shot_create','agent_pulse_one_shot_list','agent_pulse_one_shot_cancel','agent_pulse_one_shot_context','agent_pulse_one_shot_consume','agent_pulse_one_shot_record']){
  const rows=await f.db.query("select oid::text,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name]);
  assert.equal(rows.rows.length,1,name);assert.equal(rows.rows[0].prosecdef,true);
  for(const role of ['anon','authenticated'])assert.equal((await f.one('select has_function_privilege($1,$2::oid,\'EXECUTE\') allowed',[role,rows.rows[0].oid])).allowed,false);
  assert.equal((await f.one('select has_function_privilege(\'service_role\',$1::oid,\'EXECUTE\') allowed',[rows.rows[0].oid])).allowed,true);
 }
});
