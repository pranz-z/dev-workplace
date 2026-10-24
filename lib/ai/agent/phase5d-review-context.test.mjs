import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './phase5d-fixture.mjs';
import { reviewContextCases } from './phase5d-review-context-cases.mjs';

test('read-only review context SQL contract on disposable PGlite',async t=>{
  t.mock.method(globalThis,'fetch',async()=>assert.fail('Review detail must not use network'));
  const f=await fixture(t);await f.enable();const authority=(await f.claim()).claims.find(p=>p.userId===f.owner);
  await f.db.query("update private.agent_pulse_state set mode='workspace_ai',ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$2::uuid] where user_id=$1",[f.owner,f.project]);
  await f.db.query("update public.tasks set title='Canonical target Alpha',priority='High',due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1",[f.task]);
  await f.publish(authority);
  await reviewContextCases(t,{...f,authority,otherProject:f.other,q:sql=>f.db.exec(sql),value:sql=>f.sql(sql),rows:async sql=>(await f.db.query(sql)).rows});
});
