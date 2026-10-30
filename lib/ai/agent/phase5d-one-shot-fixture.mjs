import {fixture as base} from './phase5d-fixture.mjs';
import {readdirSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {loadPulse} from './phase5d-test-support.mjs';
const root=new URL('../../../',import.meta.url);
export async function fixture(t){
 const f=await base(t);
 const names=readdirSync(new URL('supabase/migrations/',root)).filter(n=>n.endsWith('_workspace_agent_one_shot.sql'));
 assert.equal(names.length,1,'Exactly one one-shot migration must exist');
 await f.db.exec(readFileSync(new URL('supabase/migrations/'+names[0],root),'utf8'));
 // Disposable-only deterministic clock; production SQL is never rewritten on disk.
 await f.db.exec("create function private.one_shot_test_clock() returns timestamptz language sql stable as $$select coalesce(nullif(current_setting('one_shot.test_now',true),'')::timestamptz,pg_catalog.clock_timestamp())$$");
 const defs=await f.db.query("select pg_get_functiondef(oid) definition from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) and proname like 'agent_pulse%'");
 for(const {definition} of defs.rows)await f.db.exec(definition.replaceAll('clock_timestamp()','private.one_shot_test_clock()'));
 await f.db.exec(`alter table private.agent_observations alter first_noticed_at set default private.one_shot_test_clock(),
  alter last_checked_at set default private.one_shot_test_clock(),alter last_changed_at set default private.one_shot_test_clock();
  alter table private.agent_pulse_one_shot_authorizations alter created_at set default private.one_shot_test_clock();
  alter table private.agent_pulse_installation_events alter created_at set default private.one_shot_test_clock();`);
 const at=iso=>f.db.query("select set_config('one_shot.test_now',$1,false)",[iso]);
 const enable=async(user=f.owner)=>{await f.state(user);await f.db.query("update private.agent_pulse_state set mode='workspace',checks_consent_version='checks-v1',checks_consented_at=private.one_shot_test_clock(),next_due_at=date_bin(interval '4 hours',private.one_shot_test_clock(),timestamptz '1970-01-01') where user_id=$1",[user]);};
 const claim=()=>f.sql("select public.agent_pulse_claim_dispatch(date_bin(interval '4 hours',private.one_shot_test_clock(),timestamptz '1970-01-01'),gen_random_uuid(),date_trunc('second',private.one_shot_test_clock()),true) r");
 return {...f,at,enable,claim};
}
export async function seedOneShot(f){
 await f.at('2026-11-01T07:59:00Z');await f.db.query("update public.profiles set time_zone='UTC' where id=$1",[f.owner]);
 await f.db.query("update public.tasks set status='Todo',due_date='2026-11-01' where id=$1",[f.task]);await f.enable();
 const a=(await f.claim()).claims[0];await f.publish(a);await f.sql("select public.agent_pulse_finish($1,$2,$3,$4,'none') r",[a.userId,a.pulseId,a.leaseToken,a.fence]);
 const o=await f.one("select * from private.agent_observations where user_id=$1 and target_id=$2 and family='deadline'",[f.owner,f.task]);
 const preview=await f.sql('select public.agent_pulse_one_shot_preview($1,$2) r',[f.owner,o.id]);assert.ok(preview);
 const domain=await loadPulse('lib/ai/agent/pulse/one-shot.ts'),binding={...preview.binding,model:'fixture-model',contextFingerprint:''};
 const result=domain.buildOneShotContext(preview.source,domain.oneShotParents(preview.source,binding),binding,{configured:true,provider:'gemini',model:'fixture-model'},'preview');assert.equal(result.ok,true);
 const fingerprint=domain.oneShotFingerprint(result.context.contents);
 const auth=await f.sql('select public.agent_pulse_one_shot_create($1,$2,$3,$4,$5,$6,$7,$8) r',[f.owner,o.id,o.content_revision,binding.slot,binding.model,o.source_token,fingerprint,JSON.stringify({...binding,contextFingerprint:fingerprint})]);
 return {o,auth,contents:result.context.contents};
}
