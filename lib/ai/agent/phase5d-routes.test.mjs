import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { fixture } from './phase5d-fixture.mjs';
import { loadPulse } from './phase5d-test-support.mjs';
import { dispatchTestClock, restoreDispatchTestClock } from './phase5d-freshness-cases.mjs';

const root = resolve(import.meta.dirname, '../../..'), require = createRequire(import.meta.url);
const settingsPath = '/api/ai/agent/pulse-settings', clearPath = settingsPath+'/clear';
const owner = '11111111-1111-4111-8111-111111111111';
const defaults = () => ({mode:'off',cadence:'normal',settingsRevision:0,policyVersion:'pulse-v1',checksConsented:false,aiConsented:false,
  aiProjectIds:[],aiEligible:false,nextDueAt:null,lastSuccessAt:null,lastDeterministicAt:null,coverage:{complete:false,unknown:0},
  usage:{ownerPulses:0,ownerRequests:0,installationRequests:0,ownerIdeas:0}});
const setting = (revision = 0, changes = {}) => ({expectedRevision:revision,mode:'workspace',cadence:'normal',aiProjectIds:[],checksConsentVersion:'checks-v1',...changes});
const clear = revision => ({expectedRevision:revision,confirmation:'CLEAR_AGENT_MEMORY'});
const task20Paths={inbox:'/api/ai/agent/inbox',feedback:'/api/ai/agent/inbox/feedback',ack:'/api/ai/agent/inbox/ack',brief:'/api/ai/agent/brief',journal:'/api/ai/agent/journal'};
const task20Rpcs={agent_pulse_list_inbox:['p_user_id','p_state','p_cursor','p_limit'],agent_pulse_get_observation:['p_user_id','p_id'],
  agent_pulse_get_brief:['p_user_id'],agent_pulse_list_journal:['p_user_id','p_cursor','p_limit'],
  agent_pulse_feedback:['p_user_id','p_id','p_row_revision','p_action','p_snooze_days'],agent_pulse_ack:['p_user_id','p_items','p_brief']};

function loadRoutes(client, admin) {
  const cache = new Map();
  function load(file) {
    assert.ok(existsSync(file),`Missing Task19 implementation: ${file}`);
    if(cache.has(file)) return cache.get(file);
    const exports={}; cache.set(file,exports);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','exports',code)(name => {
      if(name==='server-only') return {};
      if(name==='@/lib/supabase/server') return {getSupabaseServerClient:async()=>client};
      if(name==='@/lib/supabase/admin') return {getSupabaseAdminClient:()=>admin};
      if(name.startsWith('@/')) return load(resolve(root,name.slice(2)+'.ts'));
      if(name.startsWith('.')) return load(resolve(dirname(file),name+'.ts'));
      return require(name);
    },exports); return exports;
  }
  const routes={settings:load(resolve(root,'app/api/ai/agent/pulse-settings/route.ts')),clear:load(resolve(root,'app/api/ai/agent/pulse-settings/clear/route.ts'))};
  for(const [name,path] of Object.entries(task20Paths)){
    const file=resolve(root,'app'+path+'/route.ts');routes[name]=existsSync(file) ? load(file) : {};
  }
  return routes;
}
async function harness(t, database = true) {
  const f=database ? await fixture(t) : null;
  const effects={rpcs:[],network:0,queries:[]}, state={user:owner,rpcError:null,transform:value=>value,queryError:false};
  t.mock.method(globalThis,'fetch',async()=>{effects.network++;assert.fail('Task19 must not use network/provider/scheduler');});
  const rpcArguments={agent_pulse_get_settings:['p_user_id'],agent_pulse_set_settings:['p_user_id','p_expected_revision','p_input'],agent_pulse_clear_memory:['p_user_id','p_expected_revision'],...task20Rpcs};
  const admin={rpc:async(name,args)=>{
    assert.ok(rpcArguments[name],`Unexpected Task19 SQL capability: ${name}`);
    assert.deepEqual(Object.keys(args).sort(),[...rpcArguments[name]].sort());
    assert.equal(args.p_user_id,state.user); effects.rpcs.push({name,args:structuredClone(args)});
    if(state.rpcError) return {data:null,error:state.rpcError};
    try {
      const values=rpcArguments[name].map(key=>args[key] !== null && typeof args[key]==='object' ? JSON.stringify(args[key]) : args[key]);
      const data=f ? await f.db.transaction(async tx=>{
        await tx.exec('set local role service_role');
        return (await tx.query(`select public.${name}(${values.map((_x,i)=>'$'+(i+1)).join(',')}) r`,values)).rows[0].r;
      }) : defaults();
      return {data:state.transform(data,name),error:null};
    } catch(error) {return {data:null,error:{code:error.code,message:error.message}};}
  }};
  const client={auth:{getUser:async()=>({data:{user:state.user ? {id:state.user} : null},error:null})},from(table){
    assert.ok(['profiles','projects'].includes(table),'Only fixed owner-safe projections');
    let selection,filter,limit;
    const query={select(value){selection=value;return query;},eq(key,value){filter=[key,value];return query;},order(key){assert.equal(key,'id');return query;},limit(value){limit=value;return query;},
      async maybeSingle(){assert.equal(table,'profiles');assert.equal(selection,'time_zone');assert.deepEqual(filter,['id',owner]);effects.queries.push(table);
        return {data:f ? await f.one('select time_zone from public.profiles where id=$1',[owner]) : {time_zone:'UTC'},error:state.queryError ? {message:'PRIVATE_DATABASE_ERROR'} : null};},
      async then(yes,no){assert.equal(table,'projects');assert.equal(selection,'id,title');assert.deepEqual(filter,['user_id',owner]);assert.equal(limit,21);effects.queries.push(table);
        return Promise.resolve({data:f ? (await f.db.query('select id,title from public.projects where user_id=$1 order by id limit 21',[owner])).rows : [],error:state.queryError ? {message:'PRIVATE_DATABASE_ERROR'} : null}).then(yes,no);},
    }; return query;
  }};
  const routes=loadRoutes(client,admin);
  const invoke=async (body,options={})=>{
    const method=options.method ?? (body===undefined ? 'GET' : 'POST'), path=options.clear ? clearPath : settingsPath;
    const headers={'content-type':'application/json',...options.headers};
    const request=new Request('https://workspace.invalid'+path+(options.query ?? ''),{method,headers,
      ...(method==='GET'||method==='HEAD' ? {} : {body:options.raw ?? JSON.stringify(body),duplex:'half'})});
    const handler=options.clear ? routes.clear.POST : routes.settings[method];
    const response=await handler(request);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    return {status:response.status,body:await response.json()};
  };
  const snapshot=async (onlyCore=false)=>{
    if(!f) return null;
    const tables=(await f.db.query("select schemaname||'.'||tablename name from pg_tables where schemaname in ('public','private') order by schemaname,tablename")).rows;
    const result={};
    for(const {name} of tables){if(onlyCore && /^private\.agent_(pulse|observations)/.test(name))continue;
      result[name]=createHash('sha256').update(JSON.stringify((await f.db.query(`select to_jsonb(x) r from ${name} x order by to_jsonb(x)::text`)).rows)).digest('hex');}
    return result;
  };
  const invoke20=async(name,body,options={})=>{
    const method=options.method ?? (['feedback','ack'].includes(name)?'POST':'GET');
    assert.equal(typeof routes[name][method],'function',`Task20 ${name} ${method} handler is not implemented`);
    const request=new Request('https://workspace.invalid'+task20Paths[name]+(options.query ?? ''),{method,headers:{'content-type':'application/json',...options.headers},
      ...(method==='GET'||method==='HEAD'?{}:{body:options.raw ?? JSON.stringify(body),duplex:'half'})});
    const response=await routes[name][method](request);assert.equal(response.headers.get('Cache-Control'),'no-store');
    const value=await response.json();assert.doesNotMatch(JSON.stringify(value),/PRIVATE_|before_state|sourceToken|materialFingerprint|leaseToken|reservationKey|nonceFingerprint|service_role|SQLSTATE/);
    return {status:response.status,body:value};
  };
  return {...f,initializeState:f?.state,effects,state,routes,invoke,snapshot,invoke20};
}

test('settings authentication, same origin and strict HTTP boundary',async t=>{
  const h=await harness(t,false);
  for(const [name,body,options,status] of [
    ['unauthenticated settings GET',undefined,{signedOut:true},401],['unauthenticated settings POST',setting(),{signedOut:true},401],
    ['unauthenticated clear',clear(0),{clear:true,signedOut:true},401],
    ['cross-origin settings',setting(),{headers:{origin:'https://foreign.invalid'}},403],
    ['cross-site clear',clear(0),{clear:true,headers:{'sec-fetch-site':'cross-site'}},403],
    ['GET owner query',undefined,{query:'?ownerId='+owner},400],['POST query',setting(),{query:'?mode=off'},400],
    ['clear query',clear(0),{clear:true,query:'?id='+owner},400],
    ['unknown field',setting(0,{ownerId:owner}),{},400],['nested unexpected value',setting(0,{mode:{value:'workspace'}}),{},400],
    ['scheduler injection',setting(0,{scheduledSlot:'arbitrary'}),{},400],['model injection',setting(0,{model:'forbidden'}),{},400],
    ['invalid mode',setting(0,{mode:'autonomous'}),{},400],['array mode',setting(0,{mode:['workspace']}),{},400],
    ['array cadence',setting(0,{cadence:['normal']}),{},400],['arbitrary cadence',setting(0,{cadence:4}),{},400],
    ['missing revision',setting(undefined,{expectedRevision:undefined}),{},400],['null revision',setting(0,{expectedRevision:null}),{},400],
    ['fractional revision',setting(0,{expectedRevision:0.5}),{},400],['negative revision',setting(-1),{},400],
    ['null scope',setting(0,{aiProjectIds:null}),{},400],['scope object',setting(0,{aiProjectIds:{id:owner}}),{},400],
    ['malformed UUID',setting(0,{aiProjectIds:['bad']}),{},400],['duplicate UUID',setting(0,{aiProjectIds:[owner,owner.toUpperCase()]}),{},400],
    ['twenty-one scope',setting(0,{aiProjectIds:Array.from({length:21},()=>randomUUID())}),{},400],
    ['missing checks consent',setting(0,{checksConsentVersion:undefined}),{},400],['old checks disclosure',setting(0,{checksConsentVersion:'checks-old'}),{},400],
    ['AI mode does not imply AI consent',setting(0,{mode:'workspace_ai'}),{},400],['old AI disclosure',setting(0,{aiConsentVersion:'ai-old'}),{},400],
    ['null disclosure',setting(0,{checksConsentVersion:null}),{},400],
    ['unknown clear field', {...clear(0),userId:owner},{clear:true},400],['wrong clear confirmation',{...clear(0),confirmation:'clear'},{clear:true},400],
    ['missing clear revision',{confirmation:'CLEAR_AGENT_MEMORY'},{clear:true},400],
    ['non JSON media type',setting(),{headers:{'content-type':'text/plain'}},400],
    ['malformed JSON',setting(),{raw:'{"mode":'},400],['top-level array',setting(),{raw:'[]'},400],
    ['duplicate JSON key',setting(),{raw:JSON.stringify(setting()).replace(/}$/,',"mode":"off"}')},400],
    ['escaped duplicate key',setting(),{raw:JSON.stringify(setting()).replace(/}$/,',"mo\\u0064e":"off"}')},400],
    ['4097 bytes',setting(),{raw:JSON.stringify(setting()).padEnd(4097,' ')},400],
    ['invalid UTF8',setting(),{raw:new Uint8Array([0xc3,0x28])},400],
  ]) await t.test(name,async()=>{
    h.state.user=options.signedOut ? null : owner; const before=h.effects.rpcs.length;
    const result=await h.invoke(body,options); assert.equal(result.status,status); assert.equal(h.effects.rpcs.length,before);
    assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE|database|stack|service_role|leaseToken|nonce|sourceToken/);
  });
  assert.equal(h.effects.network,0);
});

test('settings GET defaults and safe status are genuinely read-only',async t=>{
  const h=await harness(t),before=await h.snapshot();
  for(const name of ['first settings GET','repeated settings GET']) await t.test(name,async()=>{
    const result=await h.invoke(); assert.equal(result.status,200); const s=result.body.settings;
    assert.equal(s.mode,'off');assert.equal(s.settingsRevision,0);assert.equal(s.checksConsented,false);assert.equal(s.aiConsented,false);
    assert.deepEqual(s.aiProjectIds,[]);assert.equal(s.lastDeterministicAt,null);assert.equal(s.checksEnabled,false);
    assert.deepEqual(result.body.disclosures,{checksConsentVersion:'checks-v1',aiConsentVersion:'ai-v1'});
    assert.deepEqual(await h.snapshot(),before);assert.equal((await h.one('select count(*)::int n from private.agent_pulse_state')).n,0);
  });
  for(const [zone,readiness] of [[null,'missing'],['','missing'],['Not/AZone','invalid'],['Asia/Manila','configured']]) await t.test('settings timezone '+readiness+' '+String(zone),async()=>{
    await h.db.query('update public.profiles set time_zone=$2 where id=$1',[owner,zone]); const before=await h.snapshot();
    const result=await h.invoke();assert.equal(result.body.settings.timezoneReadiness,readiness);assert.deepEqual(await h.snapshot(),before);
    assert.equal(result.body.settings.timeZone,undefined);
  });
  await t.test('safe settings projection rejects internal fields',async()=>{
    h.state.transform=data=>({...data,leaseToken:'PRIVATE',nonce:'PRIVATE',sourceToken:'PRIVATE'});
    const result=await h.invoke();assert.equal(result.status,502);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE|leaseToken|nonce|sourceToken/);
  });
  await t.test('clear against absent settings conflicts without initialization',async()=>{
    const before=await h.snapshot();const result=await h.invoke(clear(0),{clear:true});assert.equal(result.status,409);assert.deepEqual(await h.snapshot(),before);
  });
  assert.equal(h.effects.network,0);
});

test('settings modes, separate consent, complete scope and SQL revisions',async t=>{
  const h=await harness(t); let revision=0;
  const post=async changes=>{const result=await h.invoke(setting(revision,changes));if(result.status===200)revision=result.body.settings.settingsRevision;return result;};
  for(const [mode,consents] of [['off',{checksConsentVersion:undefined}],['workspace',{}],['workspace_ai',{aiConsentVersion:'ai-v1'}]]) await t.test('settings mode '+mode,async()=>{
    const result=await post({mode,...consents});assert.equal(result.status,200);assert.equal(result.body.settings.mode,mode);
  });
  await t.test('deterministic consent never enables proactive AI',async()=>{const result=await post({mode:'workspace'});assert.equal(result.body.settings.checksConsented,true);assert.equal(result.body.settings.aiConsented,false);});
  await t.test('AI consent can be separately granted while mode is off',async()=>{const result=await post({mode:'off',checksConsentVersion:undefined,aiConsentVersion:'ai-v1'});assert.equal(result.body.settings.checksConsented,false);assert.equal(result.body.settings.aiConsented,true);assert.equal(result.body.settings.aiEligible,false);});
  await t.test('empty scope never means all projects',async()=>{const result=await post({mode:'workspace_ai',aiConsentVersion:'ai-v1'});assert.deepEqual(result.body.settings.aiProjectIds,[]);assert.equal(result.body.settings.aiEligible,false);});
  await t.test('owned scope is accepted',async()=>{const result=await post({mode:'workspace_ai',aiConsentVersion:'ai-v1',aiProjectIds:[h.project]});assert.equal(result.status,200);assert.deepEqual(result.body.settings.aiProjectIds,[h.project]);assert.equal(result.body.settings.aiEligible,true);});
  await t.test('foreign and nonexistent scopes have identical safe errors and no mutation',async()=>{
    const before=await h.snapshot();const a=await post({mode:'workspace_ai',aiConsentVersion:'ai-v1',aiProjectIds:[h.other]});const b=await post({mode:'workspace_ai',aiConsentVersion:'ai-v1',aiProjectIds:[randomUUID()]});
    assert.equal(a.status,400);assert.deepEqual(a,b);assert.deepEqual(await h.snapshot(),before);
  });
  await t.test('twenty owned projects accepted and scope order canonicalized',async()=>{
    await h.db.query("insert into public.projects(user_id,title) select $1,'Scope '||g from generate_series(1,19) g",[owner]);
    const ids=(await h.db.query('select id from public.projects where user_id=$1 order by id',[owner])).rows.map(x=>x.id);
    const result=await post({mode:'workspace_ai',aiConsentVersion:'ai-v1',aiProjectIds:[...ids].reverse()});assert.equal(result.status,200);assert.deepEqual(result.body.settings.aiProjectIds,ids);
  });
  await t.test('removing scope replaces rather than merges',async()=>{const result=await post({mode:'workspace_ai',aiConsentVersion:'ai-v1',aiProjectIds:[h.project]});assert.deepEqual(result.body.settings.aiProjectIds,[h.project]);});
  await t.test('settings update invalidates stale worker and retains history',async()=>{
    const current=await h.one('select fence from private.agent_pulse_state where user_id=$1',[owner]);
    const a=await h.pulse(owner,{settingsRevision:revision,fence:current.fence+1});await h.authorize(a);assert.ok(await h.readSource(a));
    const before=await h.one('select fence from private.agent_pulse_state where user_id=$1',[owner]);const result=await post({mode:'off',checksConsentVersion:undefined});assert.equal(result.status,200);
    assert.equal(await h.readSource(a),null);assert.ok((await h.one('select fence from private.agent_pulse_state where user_id=$1',[owner])).fence>before.fence);
    assert.equal((await h.one('select count(*)::int n from private.agent_pulses')).n,1);
    await assert.rejects(h.sql('select public.agent_pulse_reserve_ai($1,$2,$3,$4,$5,$6,$7) r',[owner,a.pulseId,a.leaseToken,a.fence,a.settingsRevision,randomUUID(),1]),/AUTHORITY_LOST/);
  });
  await t.test('stale revision conflicts safely without mutation',async()=>{const before=await h.snapshot();const result=await h.invoke(setting(revision-1));assert.equal(result.status,409);assert.equal(result.body.error.code,'STATE_CHANGED');assert.deepEqual(await h.snapshot(),before);});
  await t.test('project choices are owner-only bounded id/title fields',async()=>{
    await h.db.query("insert into public.projects(user_id,title) values($1,$2)",[owner,'x'.repeat(500)]);
    const result=await h.invoke();assert.equal(result.body.projectChoices.length,20);assert.equal(result.body.projectChoicesTruncated,true);
    for(const project of result.body.projectChoices){assert.deepEqual(Object.keys(project).sort(),['id','title']);assert.notEqual(project.id,h.other);assert.ok([...project.title].length<=180);}
  });
});

test('clear preserves workspace, manual audits, rolling usage and replay identity',async t=>{
  const h=await harness(t);
  await h.db.query('insert into private.agent_runs(id,user_id) values($1,$2)',[randomUUID(),owner]);
  await h.sql('select public.save_agent_proposal_batch($1,$2) r',[owner,JSON.stringify([{id:randomUUID(),type:'create_task',entityId:null,taskId:null,projectId:h.project,title:'Manual history',payload:{title:'Manual history'},before:{},expectedUpdatedAt:null,diff:[{field:'title',before:null,after:'Manual history'}]}])]);
  await t.test('manual AI history never enables proactive consent or initializes settings',async()=>{
    const result=await h.invoke();assert.equal(result.body.settings.checksConsented,false);assert.equal(result.body.settings.aiConsented,false);
    assert.equal((await h.one('select count(*)::int n from private.agent_pulse_state')).n,0);
  });
  await h.enable();const a=(await h.claim()).claims[0];
  await h.db.query("update private.agent_pulse_state set mode='workspace_ai',ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$2::uuid] where user_id=$1",[owner,h.project]);
  await h.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1",[h.task]);await h.publish(a);
  const o=await h.one('select id,episode from private.agent_observations where target_id=$1',[h.task]);
  await h.sql('select public.agent_pulse_reserve_ai($1,$2,$3,$4,$5,$6,$7) r',[owner,a.pulseId,a.leaseToken,a.fence,a.settingsRevision,o.id,o.episode]);
  for(const name of ['20261002140000_phase6a_private_ai_rate_limit.sql','20261002150000_phase6a1_private_ai_concurrency_leases.sql']){
    const source=readFileSync(resolve(root,'supabase/migrations',name),'utf8');await h.db.exec(source.match(/create table if not exists private\.[\s\S]*?\n\);/)[0]);
  }
  await h.db.query("insert into private.private_ai_rate_limit_buckets(user_id,bucket_kind,bucket_start,request_count) values($1,'user_minute',clock_timestamp(),7)",[owner]);
  await h.db.query("insert into private.private_ai_active_leases values($1,$2,clock_timestamp()+interval '1 minute')",[owner,randomUUID()]);
  const source=readFileSync(resolve(root,'supabase/migrations/20261001153933_phase4b_accountability_goals_reports.sql'),'utf8');
  await h.db.exec(source.match(/create table if not exists public\.accountability_snapshots \([\s\S]*?\n\);/)[0]);
  await h.db.query("insert into public.accountability_snapshots(user_id,project_id,snapshot_date,health,github_status) values($1,$2,current_date,'Active','not-connected')",[owner,h.project]);
  const core=await h.snapshot(true),events=await h.db.query('select to_jsonb(e) r from private.agent_pulse_installation_events e order by id');
  const usage=await h.sql('select private.agent_pulse_usage($1,clock_timestamp()) r',[owner]),staleScan=await h.scan(a);
  await t.test('settings safely reports actual owner rolling usage',async()=>{const result=await h.invoke();assert.deepEqual(result.body.settings.usage,usage);assert.equal(usage.ownerRequests,1);});
  await t.test('explicit confirmed clear returns bounded confirmation',async()=>{const result=await h.invoke(clear(a.settingsRevision),{clear:true});assert.equal(result.status,200);assert.deepEqual(result.body,{cleared:true,settingsRevision:a.settingsRevision+1});});
  await t.test('clear removed observation and baseline memory',async()=>{assert.equal((await h.one('select count(*)::int n from private.agent_observations')).n,0);assert.deepEqual((await h.one('select baseline from private.agent_pulse_state where user_id=$1',[owner])).baseline,{});});
  await t.test('clear invalidates old worker',async()=>{assert.equal(await h.readSource(a),null);await assert.rejects(h.publish(a,staleScan),/AUTHORITY_LOST/);});
  await t.test('clear retains owner requests and installation events',async()=>{assert.deepEqual(await h.sql('select private.agent_pulse_usage($1,clock_timestamp()) r',[owner]),usage);assert.deepEqual(await h.db.query('select to_jsonb(e) r from private.agent_pulse_installation_events e order by id'),events);});
  await t.test('clear retains exact installation dispatch replay identity',async()=>{const result=await h.claim();assert.equal(result.replay,true);assert.equal(result.claimCount,1);});
  await t.test('clear/settings leave every core/manual/counter table unchanged',async()=>{assert.deepEqual(await h.snapshot(true),core);});
  await t.test('condition can be rediscovered as new Agent memory',async()=>{
    // Model a later check after the superseded running worker becomes abandoned.
    await h.db.query("update private.agent_pulses set status='abandoned',completed_at=clock_timestamp() where id=$1",[a.pulseId]);
    const b=await h.pulse(owner,{settingsRevision:a.settingsRevision+1,fence:a.fence+2});await h.authorize(b);await h.publish(b);
    const next=await h.one('select id from private.agent_observations where target_id=$1',[h.task]);assert.ok(next);assert.notEqual(next.id,o.id);
  });
  assert.equal(h.effects.network,0);
});

test('settings and clear enforce isolated SQL sixty-write limit',async t=>{
  const h=await harness(t);let revision=0;
  for(const name of ['20261002140000_phase6a_private_ai_rate_limit.sql','20261002150000_phase6a1_private_ai_concurrency_leases.sql']){
    const source=readFileSync(resolve(root,'supabase/migrations',name),'utf8');await h.db.exec(source.match(/create table if not exists private\.[\s\S]*?\n\);/)[0]);
  }
  await h.db.query("insert into private.private_ai_rate_limit_buckets(user_id,bucket_kind,bucket_start,request_count) values($1,'user_minute',clock_timestamp(),7)",[owner]);
  await h.db.query("insert into private.private_ai_active_leases values($1,$2,clock_timestamp()+interval '1 minute')",[owner,randomUUID()]);
  await h.db.query('insert into private.agent_action_limits values($1,clock_timestamp(),9)',[owner]);
  const core=await h.snapshot(true);
  for(let i=0;i<60;i++){
    const result=i%2===0 ? await h.invoke(setting(revision)) : await h.invoke(clear(revision),{clear:true});
    assert.equal(result.status,200);revision=result.body.settings?.settingsRevision ?? result.body.settingsRevision;
  }
  for(const useClear of [false,true]) await t.test('sixty-first '+(useClear?'clear':'settings')+' write rejected',async()=>{
    const before=await h.snapshot();const result=await h.invoke(useClear ? clear(revision) : setting(revision),{clear:useClear});assert.equal(result.status,429);assert.deepEqual(await h.snapshot(),before);
  });
  assert.deepEqual(await h.snapshot(true),core);
});

test('settings safe failures and unsupported methods',async t=>{
  const h=await harness(t,false);
  for(const [error,status] of [[{code:'22023',message:'PRIVATE_SQL'},400],[{code:'40001',message:'PRIVATE_SQL'},409],[{code:'P0001',message:'RATE_LIMITED'},429],[{code:'XX000',message:'PRIVATE_SQL credentials stack'},502]]) await t.test('settings safe SQL error '+error.code,async()=>{
    h.state.rpcError=error;const result=await h.invoke(setting());assert.equal(result.status,status);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE|credentials|stack|SQL/);
  });
  h.state.rpcError=null;h.state.queryError=true;assert.equal((await h.invoke()).status,502);
  const {autoImplementMethods}=require('next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js');
  for(const [name,route,allowed] of [['settings',h.routes.settings,['GET','POST']],['clear',h.routes.clear,['POST']]]) await t.test(name+' unsupported methods never reach SQL',async()=>{
    assert.equal(route.runtime,'nodejs');assert.equal(route.dynamic,'force-dynamic');
    const methods=autoImplementMethods(route);const before=h.effects.rpcs.length;
    for(const method of ['PUT','PATCH','DELETE',...(name==='clear'?['GET','HEAD']:[])])assert.equal((await methods[method](new Request('https://workspace.invalid',{method}))).status,405);
    assert.equal((await methods.OPTIONS(new Request('https://workspace.invalid',{method:'OPTIONS'}))).status,204);
    assert.deepEqual(Object.keys(route).filter(key=>/^[A-Z]+$/.test(key)).sort(),allowed.sort());assert.equal(h.effects.rpcs.length,before);
  });
});

test('settings runtime import graph has only owner auth, safe projections and fixed RPCs',()=>{
  const seen=new Set(),bootstraps=new Set(['lib/supabase/server.ts','lib/supabase/admin.ts']);
  function walk(file){if(seen.has(file))return;seen.add(file);const source=readFileSync(resolve(root,file),'utf8');
    assert.doesNotMatch(source,/console\.|\bfetch\s*\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    if(bootstraps.has(file))return;
    const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
    for(const node of parsed.statements){if(!ts.isImportDeclaration(node)||node.importClause?.isTypeOnly)continue;const name=node.moduleSpecifier.text;
      assert.doesNotMatch(name,/executor|registry|proposal|gemini|scheduler|engine|pulse\/db|private-concurrency|github|drive/);
      if(name.startsWith('@/'))walk(name.slice(2)+'.ts');else if(name.startsWith('.'))walk(resolve(dirname(file),name+'.ts').replace(root+'/',''));else assert.ok(['server-only','next/server'].includes(name));
    }
  }
  walk('app/api/ai/agent/pulse-settings/route.ts');walk('app/api/ai/agent/pulse-settings/clear/route.ts');
  for(const path of Object.values(task20Paths))walk('app'+path+'/route.ts');
  const source=readFileSync(resolve(root,'lib/ai/agent/pulse/routes.ts'),'utf8');
  const rpcs=[...source.matchAll(/['"](agent_pulse_[a-z_]+)['"]/g)].map(x=>x[1]);
  assert.deepEqual([...new Set(rpcs)].sort(),['agent_pulse_clear_memory','agent_pulse_get_settings','agent_pulse_set_settings',...Object.keys(task20Rpcs)].sort());
});

async function seedInbox(h,count=3){
  await h.enable();const authority=(await h.claim()).claims.find(a=>a.userId===owner);
  const tasks=[];for(let i=0;i<count;i++){const id=i===0?h.task:randomUUID();if(i>0)await h.db.query("insert into public.tasks(id,user_id,project_id,title) values($1,$2,$3,'Current task')",[id,owner,h.project]);
    await h.db.query("update public.tasks set due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1",[id]);tasks.push(id);}
  const {scanPulse}=await loadPulse('lib/ai/agent/pulse/scanner.ts'),{PULSE_POLICY}=await loadPulse('lib/ai/agent/pulse/policy.ts');
  const source=await h.readSource(authority),items=[];
  for(const id of tasks){const d=scanPulse({...source,tasks:source.tasks.filter(task=>task.id===id)},[],PULSE_POLICY).decisions.find(d=>d.target.id===id);assert.ok(d,'real source decision required');
    const row=await h.one(`insert into private.agent_observations(user_id,condition_key,family,target_type,target_id,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,summary,explanation,importance,rank,origin_pulse_id,latest_pulse_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Current task','Current deterministic summary','Current explanation',$11,$12,$13,$13) returning id,content_revision`,
      [owner,d.key,d.family,d.target.type,d.target.id,d.materialFingerprint,d.sourceToken,d.evidenceValidUntil,d.reasonCodes,JSON.stringify({...d.evidence,complete:d.complete}),d.importance,d.rank,authority.pulseId]);
    items.push({id:row.id,contentRevision:row.content_revision,taskId:id});}
  return {authority,items};
}
const feedback=(id,action,extra={})=>({id,expectedRevision:1,action,...extra});
const ack=(items,brief=false)=>({items:items.map(({id,contentRevision})=>({id,contentRevision})),brief});
const encodeCursor=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

test('Task20 authentication and exact request grammar',async t=>{
  const h=await harness(t,false),id=randomUUID(),one=[{id,contentRevision:1}];
  for(const name of Object.keys(task20Paths))await t.test('unauthenticated '+name,async()=>{
    h.state.user=null;const result=await h.invoke20(name,name==='feedback'?feedback(id,'dismiss'):name==='ack'?ack(one):undefined);assert.equal(result.status,401);assert.equal(h.effects.rpcs.length,0);h.state.user=owner;
  });
  await t.test('unauthenticated Inbox detail',async()=>{h.state.user=null;assert.equal((await h.invoke20('inbox',undefined,{query:'?id='+id})).status,401);h.state.user=owner;});
  const cases=[
    ['inbox id and state','inbox',undefined,{query:'?id='+id+'&state=active'}],['inbox id and cursor','inbox',undefined,{query:'?id='+id+'&cursor=abc'}],
    ['inbox id and limit','inbox',undefined,{query:'?id='+id+'&limit=1'}],['bad detail UUID','inbox',undefined,{query:'?id=bad'}],
    ['duplicate id','inbox',undefined,{query:'?id='+id+'&id='+id}],['duplicate state','inbox',undefined,{query:'?state=active&state=all'}],
    ['duplicate cursor','inbox',undefined,{query:'?cursor=abc&cursor=abc'}],['duplicate limit','inbox',undefined,{query:'?limit=1&limit=2'}],
    ['unknown Inbox query','inbox',undefined,{query:'?ownerId='+owner}],['invalid state','inbox',undefined,{query:'?state=deleted'}],
    ['limit21','inbox',undefined,{query:'?limit=21'}],['limit0','inbox',undefined,{query:'?limit=0'}],['fractional limit','inbox',undefined,{query:'?limit=1.5'}],
    ['string limit','inbox',undefined,{query:'?limit=abc'}],['empty limit','inbox',undefined,{query:'?limit='}],['padded limit','inbox',undefined,{query:'?limit=01'}],
    ['malformed cursor','inbox',undefined,{query:'?cursor=%25'}],['non JSON cursor','inbox',undefined,{query:'?cursor=YWJj'}],
    ['Brief query forbidden','brief',undefined,{query:'?limit=5'}],['Journal unknown key','journal',undefined,{query:'?state=active'}],
    ['Journal duplicate cursor','journal',undefined,{query:'?cursor=a&cursor=b'}],['Journal duplicate limit','journal',undefined,{query:'?limit=1&limit=2'}],
    ['Journal limit21','journal',undefined,{query:'?limit=21'}],['Journal malformed cursor','journal',undefined,{query:'?cursor=bad'}],
    ['feedback owner injection','feedback',feedback(id,'dismiss',{userId:owner}),{}],['feedback unknown field','feedback',feedback(id,'dismiss',{rank:0}),{}],
    ['feedback malformed id','feedback',feedback('bad','dismiss'),{}],['feedback invalid action','feedback',feedback(id,'complete_task'),{}],
    ['feedback revision0','feedback',feedback(id,'resolve',{expectedRevision:0}),{}],['feedback fractional revision','feedback',feedback(id,'resolve',{expectedRevision:1.5}),{}],
    ['feedback null revision','feedback',feedback(id,'resolve',{expectedRevision:null}),{}],['snooze missing days','feedback',feedback(id,'snooze'),{}],
    ['non snooze days','feedback',feedback(id,'dismiss',{snoozeDays:1}),{}],['non snooze null days','feedback',feedback(id,'resolve',{snoozeDays:null}),{}],
    ...[0,-1,2,4,8,1.5,'3',null].map(days=>['invalid snooze '+String(days),'feedback',feedback(id,'snooze',{snoozeDays:days}),{}]),
    ['ACK21','ack',ack(Array.from({length:21},()=>({id:randomUUID(),contentRevision:1}))),{}],
    ['Brief ACK6','ack',ack(Array.from({length:6},()=>({id:randomUUID(),contentRevision:1})),true),{}],
    ['ACK duplicates','ack',ack([one[0],one[0]]),{}],['ACK empty','ack',ack([]),{}],['ACK malformed id','ack',ack([{id:'bad',contentRevision:1}]),{}],
    ['ACK revision0','ack',ack([{id,contentRevision:0}]),{}],['ACK string revision','ack',ack([{id,contentRevision:'1'}]),{}],
    ['ACK fractional revision','ack',ack([{id,contentRevision:1.5}]),{}],['ACK extra nested field','ack',{items:[{...one[0],evidence:{}}],brief:false},{}],
    ['ACK owner field','ack',{...ack(one),ownerId:owner},{}],['ACK nonboolean brief','ack',{...ack(one),brief:'true'},{}],
    ['feedback oversized','feedback',feedback(id,'dismiss'),{raw:' '.repeat(4097)}],['ACK oversized','ack',ack(one),{raw:' '.repeat(4097)}],
    ['feedback malformed UTF8','feedback',feedback(id,'dismiss'),{raw:new Uint8Array([0xc3,0x28])}],
    ['ACK malformed JSON','ack',ack(one),{raw:'{"items":'}],['wrong media type','feedback',feedback(id,'dismiss'),{headers:{'content-type':'text/plain'}}],
    ['feedback duplicate decoded root','feedback',feedback(id,'dismiss'),{raw:JSON.stringify(feedback(id,'dismiss')).replace(/}$/,',"act\\u0069on":"resolve"}')}],
    ['ACK duplicate decoded root','ack',ack(one),{raw:JSON.stringify(ack(one)).replace(/}$/,',"br\\u0069ef":true}')}],
    ['feedback query injection','feedback',feedback(id,'dismiss'),{query:'?owner='+owner}],['ACK query injection','ack',ack(one),{query:'?owner='+owner}],
  ];
  for(const [label,name,body,options] of cases)await t.test(label,async()=>{const before=h.effects.rpcs.length;assert.equal((await h.invoke20(name,body,options)).status,400);assert.equal(h.effects.rpcs.length,before);});
  for(const name of ['feedback','ack'])await t.test('same-origin '+name,async()=>{const before=h.effects.rpcs.length;assert.equal((await h.invoke20(name,name==='feedback'?feedback(id,'dismiss'):ack(one),{headers:{origin:'https://foreign.invalid'}})).status,403);assert.equal(h.effects.rpcs.length,before);});
  assert.equal(h.effects.network,0);
});

test('Task20 Inbox ownership, pagination and exclusive safe detail',async t=>{
  const h=await harness(t),{items}=await seedInbox(h,24);
  await h.db.query("insert into public.profiles(id,time_zone) values($1,'Asia/Manila') on conflict(id) do nothing",[h.other]);
  const foreignAuthority=await h.pulse(h.other);const foreignId=await h.observation(foreignAuthority,{key:'task:'+randomUUID()+':attention',targetId:randomUUID()});
  let first;
  await t.test('Inbox default page20 owner-only and read-only',async()=>{const before=await h.snapshot();first=await h.invoke20('inbox');assert.equal(first.status,200);assert.equal(first.body.items.length,20);assert.ok(first.body.items.every(x=>items.some(i=>i.id===x.id)));assert.deepEqual(await h.snapshot(),before);});
  await t.test('Inbox explicit limit20',async()=>assert.equal((await h.invoke20('inbox',undefined,{query:'?limit=20'})).body.items.length,20));
  for(const state of ['active','snoozed','dismissed','resolved','all'])await t.test('approved Inbox filter '+state,async()=>assert.equal((await h.invoke20('inbox',undefined,{query:'?state='+state})).status,200));
  await t.test('Inbox cursor returns remaining four without mutation',async()=>{const before=await h.snapshot();const page=await h.invoke20('inbox',undefined,{query:'?cursor='+first.body.nextCursor});assert.equal(page.status,200);assert.equal(page.body.items.length,4);assert.equal(page.body.nextCursor,null);assert.equal(new Set([...first.body.items,...page.body.items].map(x=>x.id)).size,24);assert.deepEqual(await h.snapshot(),before);});
  await t.test('Inbox other owner cursor rejected',async()=>{h.state.user=h.other;assert.equal((await h.invoke20('inbox',undefined,{query:'?cursor='+first.body.nextCursor})).status,400);h.state.user=owner;});
  await t.test('Inbox other filter cursor rejected',async()=>assert.equal((await h.invoke20('inbox',undefined,{query:'?state=all&cursor='+first.body.nextCursor})).status,400));
  for(const patch of [{v:2},{ownerDigest:'bad'},{rank:9},{changedAt:'bad'},{payload:{}}])await t.test('Inbox malformed cursor '+Object.keys(patch)[0],async()=>{const cursor={...JSON.parse(Buffer.from(first.body.nextCursor,'base64url').toString()),...patch};assert.equal((await h.invoke20('inbox',undefined,{query:'?cursor='+encodeCursor(cursor)})).status,400);});
  await t.test('Inbox id-only safe detail and zero writes',async()=>{const before=await h.snapshot();const result=await h.invoke20('inbox',undefined,{query:'?id='+items[0].id});assert.equal(result.status,200);assert.equal(result.body.item.id,items[0].id);assert.equal(result.body.item.stale,false);assert.equal(result.body.item.summary,'Current deterministic summary');assert.deepEqual(await h.snapshot(),before);});
  await t.test('foreign and absent Inbox detail are indistinguishable',async()=>{const before=await h.snapshot();const a=await h.invoke20('inbox',undefined,{query:'?id='+foreignId}),b=await h.invoke20('inbox',undefined,{query:'?id='+randomUUID()});assert.deepEqual(a,b);assert.deepEqual(a,{status:200,body:{item:null,reviewContext:null}});assert.deepEqual(await h.snapshot(),before);});
  await t.test('changed source withdraws evidence without writes',async()=>{await h.db.query("update public.tasks set title='Current replacement' where id=$1",[items[0].taskId]);const before=await h.snapshot();const result=await h.invoke20('inbox',undefined,{query:'?id='+items[0].id});assert.equal(result.body.item.stale,true);assert.equal(result.body.item.summary,'');assert.equal(result.body.item.explanation,'');assert.deepEqual(result.body.item.reasonCodes,[]);assert.deepEqual(await h.snapshot(),before);});
  for(const [name,change] of [['deleted',()=>h.db.query('delete from public.tasks where id=$1',[items[1].taskId])],['no longer owned',()=>h.db.query('update public.tasks set user_id=$2,project_id=$2 where id=$1',[items[2].taskId,h.other])]])await t.test('Inbox target '+name+' read does not mutate',async()=>{await change();const before=await h.snapshot();const index=name==='deleted'?1:2;const result=await h.invoke20('inbox',undefined,{query:'?id='+items[index].id});assert.equal(result.body.item.unavailable,true);assert.equal(result.body.item.title,'');assert.equal(result.body.item.summary,'');assert.deepEqual(await h.snapshot(),before);});
  assert.equal(h.effects.network,0);
});

test('Task20 feedback and acknowledgement use only owned Agent state',async t=>{
  const h=await harness(t),{items}=await seedInbox(h,24);
  await h.db.query('insert into private.agent_runs(id,user_id) values($1,$2)',[randomUUID(),owner]);
  await h.sql('select public.save_agent_proposal_batch($1,$2) r',[owner,JSON.stringify([{id:randomUUID(),type:'create_task',entityId:null,taskId:null,projectId:h.project,title:'Manual preserved',payload:{title:'Manual preserved'},before:{},expectedUpdatedAt:null,diff:[{field:'title',before:null,after:'Manual preserved'}]}])]);
  const source=readFileSync(resolve(root,'supabase/migrations/20261001153933_phase4b_accountability_goals_reports.sql'),'utf8');await h.db.exec(source.match(/create table if not exists public\.accountability_snapshots \([\s\S]*?\n\);/)[0]);
  await h.db.query("insert into public.accountability_snapshots(user_id,project_id,snapshot_date,health,github_status) values($1,$2,current_date,'Active','not-connected')",[owner,h.project]);
  await h.db.query('insert into private.agent_action_limits values($1,clock_timestamp(),8)',[owner]);
  const foreignAuthority=await h.pulse(h.other),foreignId=await h.observation(foreignAuthority,{key:'task:'+randomUUID()+':attention',targetId:randomUUID()});
  const core=await h.snapshot(true),agentTables=await h.snapshot();
  for(const [i,days] of [1,3,7].entries())await t.test('feedback snooze '+days+' SQL local days',async()=>{const result=await h.invoke20('feedback',feedback(items[i].id,'snooze',{snoozeDays:days}));assert.equal(result.status,200);assert.equal(result.body.state,'snoozed');assert.equal(result.body.rowRevision,2);const row=await h.one("select (snooze_until at time zone 'Asia/Manila')::date-(clock_timestamp() at time zone 'Asia/Manila')::date days from private.agent_observations where id=$1",[items[i].id]);assert.equal(row.days,days);});
  for(const [i,action] of [[3,'dismiss'],[4,'resolve']])await t.test('feedback '+action+' affects observation only',async()=>{const result=await h.invoke20('feedback',feedback(items[i].id,action));assert.equal(result.status,200);assert.equal(result.body.state,action==='dismiss'?'dismissed':'resolved');assert.deepEqual(await h.snapshot(true),core);});
  await t.test('stale feedback conflicts with zero database mutation',async()=>{const before=await h.snapshot();const result=await h.invoke20('feedback',feedback(items[0].id,'resolve'));assert.equal(result.status,409);assert.deepEqual(await h.snapshot(),before);});
  await t.test('foreign and absent feedback identical safe conflicts',async()=>{const before=await h.snapshot();const a=await h.invoke20('feedback',feedback(foreignId,'resolve')),b=await h.invoke20('feedback',feedback(randomUUID(),'resolve'));assert.deepEqual(a,b);assert.equal(a.status,409);assert.deepEqual(await h.snapshot(),before);});
  await t.test('ACK maximum20 marks exactly displayed current revisions',async()=>{const result=await h.invoke20('ack',ack(items.slice(0,20)));assert.deepEqual(result,{status:200,body:{acknowledged:20}});assert.equal((await h.one('select count(*)::int n from private.agent_observations where user_id=$1 and seen_content_revision=content_revision',[owner])).n,20);});
  await t.test('stale ACK cannot hide newer content',async()=>{await h.db.query("update private.agent_observations set content_revision=content_revision+1,row_revision=row_revision+1,summary='New content' where id=$1",[items[0].id]);const result=await h.invoke20('ack',ack([items[0]]));assert.equal(result.body.acknowledged,0);const row=await h.one('select seen_content_revision,content_revision from private.agent_observations where id=$1',[items[0].id]);assert.deepEqual(row,{seen_content_revision:1,content_revision:2});});
  await t.test('current ACK marks only the displayed new revision',async()=>{const result=await h.invoke20('ack',ack([{id:items[0].id,contentRevision:2}]));assert.equal(result.body.acknowledged,1);assert.equal((await h.one('select seen_content_revision from private.agent_observations where id=$1',[items[0].id])).seen_content_revision,2);});
  await t.test('foreign ACK cannot mutate foreign observation',async()=>{const before=await h.one('select to_jsonb(o) r from private.agent_observations o where id=$1',[foreignId]);const a=await h.invoke20('ack',ack([{id:foreignId,contentRevision:1}])),b=await h.invoke20('ack',ack([{id:randomUUID(),contentRevision:1}]));assert.deepEqual(a,b);assert.equal(a.body.acknowledged,0);assert.deepEqual(await h.one('select to_jsonb(o) r from private.agent_observations o where id=$1',[foreignId]),before);});
  await t.test('feedback/ACK preserve core workspace and manual audit hashes',async()=>assert.deepEqual(await h.snapshot(true),core));
  await t.test('feedback/ACK leave Pulse execution, provider and installation accounting unchanged',async()=>{const after=await h.snapshot();for(const name of Object.keys(agentTables))if(!['private.agent_observations','private.agent_pulse_state'].includes(name))assert.equal(after[name],agentTables[name],name);assert.equal(h.effects.queries.length,0);});
  await t.test('GET after feedback and ACK performs zero writes',async()=>{const before=await h.snapshot();for(const name of ['inbox','brief','journal'])assert.equal((await h.invoke20(name)).status,200);assert.deepEqual(await h.snapshot(),before);});
  assert.equal(h.effects.network,0);
});

test('Task20 Brief SQL freshness, deduplication and acknowledgement boundaries',async t=>{
  const h=await harness(t),native=await h.one('select clock_timestamp()::text tick');
  await h.db.exec(dispatchTestClock);await h.db.query("select set_config('phase5d.test_tick',$1,false)",[native.tick]);
  try{
    const {items}=await seedInbox(h,6);
    await h.db.query("update private.agent_pulse_state set mode='workspace_ai',ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$2::uuid] where user_id=$1",[owner,h.project]);
    await h.db.query(`insert into private.agent_observations(user_id,kind,condition_key,target_type,target_id,parent_observation_id,parent_episode,idea_category,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,rank,origin_pulse_id,latest_pulse_id)
      select user_id,'idea','idea:'||id||':1:review_deadline',target_type,target_id,id,episode,'review_deadline',material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,'Advisory',5,origin_pulse_id,latest_pulse_id from private.agent_observations where id=$1`,[items[0].id]);
    await t.test('Brief maximum5 fresh unseen deduplicated and zero writes',async()=>{const before=await h.snapshot();const result=await h.invoke20('brief');assert.equal(result.status,200);assert.equal(result.body.items.length,5);assert.equal(new Set(result.body.items.map(x=>x.target.type+':'+x.target.id)).size,5);assert.ok(result.body.items.every(x=>!x.seen&&!x.stale&&!x.unavailable&&x.state==='active'));assert.deepEqual(await h.snapshot(),before);});
    await t.test('seen item absent from fresh Brief',async()=>{await h.invoke20('ack',ack([items[0]]));const result=await h.invoke20('brief');assert.ok(result.body.items.every(x=>x.id!==items[0].id));});
    const subject=items[1];await h.db.query("update private.agent_observations set first_noticed_at=clock_timestamp()-interval '26 hours',last_checked_at=clock_timestamp()-interval '25 hours'");
    for(const [label,offset,present] of [['inside',"interval '1 microsecond'",true],['exact',"interval '0 microseconds'",false],['outside',"-interval '1 microsecond'",false]])await t.test('Brief24h freshness '+label,async()=>{
      await h.db.query(`update private.agent_observations set last_checked_at=clock_timestamp()-interval '24 hours'+${offset} where id=$1`,[subject.id]);const before=await h.snapshot();const result=await h.invoke20('brief');assert.equal(result.body.items.some(x=>x.id===subject.id),present);assert.deepEqual(await h.snapshot(),before);
    });
    await h.db.query('update private.agent_observations set last_checked_at=clock_timestamp()');
    await t.test('Brief ACK5 uses SQL time and does not take a browser timestamp',async()=>{const displayed=(await h.invoke20('brief')).body.items;assert.equal(displayed.length,5);const result=await h.invoke20('ack',ack(displayed,true));assert.equal(result.body.acknowledged,5);assert.equal((await h.one('select last_brief_ack_at=clock_timestamp() exact from private.agent_pulse_state where user_id=$1',[owner])).exact,true);assert.equal((await h.invoke20('brief')).body.items.length,0);});
    for(const [label,offset,present] of [['inside',"interval '1 microsecond'",false],['exact',"interval '0 microseconds'",true],['outside',"-interval '1 microsecond'",true]])await t.test('Brief24h no-nag '+label,async()=>{
      await h.db.query(`update private.agent_pulse_state set last_brief_ack_at=clock_timestamp()-interval '24 hours'+${offset} where user_id=$1`,[owner]);const before=await h.snapshot();assert.equal((await h.invoke20('brief')).body.items.length>0,present);assert.deepEqual(await h.snapshot(),before);
    });
  }finally{await h.db.exec(restoreDispatchTestClock);}
});

test('Task20 Journal owner-bound meaningful pagination and zero writes',async t=>{
  const h=await harness(t);await h.initializeState();
  await h.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,started_at,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,summary,created_count)
    select $1,timestamptz '2026-01-01'+g*interval '4 hours',gen_random_uuid(),'succeeded',clock_timestamp()-g*interval '1 minute',clock_timestamp(),1,gen_random_uuid(),clock_timestamp()+interval '90 seconds',1,'pulse-v1','Meaningful',1 from generate_series(1,24) g`,[owner]);
  await h.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,summary)
    values($1,timestamptz '2026-01-01',gen_random_uuid(),'succeeded',clock_timestamp(),1,gen_random_uuid(),clock_timestamp()+interval '90 seconds',1,'pulse-v1','Quiet')`,[owner]);
  await h.initializeState(h.other);await h.db.query(`insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,status,completed_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,summary,created_count)
    values($1,timestamptz '2026-01-01',gen_random_uuid(),'succeeded',clock_timestamp(),1,gen_random_uuid(),clock_timestamp()+interval '90 seconds',1,'pulse-v1','Foreign',1)`,[h.other]);
  let first;
  await t.test('Journal default20 meaningful owner-only and read-only',async()=>{const before=await h.snapshot();first=await h.invoke20('journal');assert.equal(first.status,200);assert.equal(first.body.items.length,20);assert.ok(first.body.items.every(x=>x.summary==='Meaningful'));assert.deepEqual(await h.snapshot(),before);});
  await t.test('Journal limit20 accepted',async()=>assert.equal((await h.invoke20('journal',undefined,{query:'?limit=20'})).body.items.length,20));
  await t.test('Journal cursor gives remaining four',async()=>{const before=await h.snapshot();const result=await h.invoke20('journal',undefined,{query:'?cursor='+first.body.nextCursor});assert.equal(result.body.items.length,4);assert.equal(result.body.nextCursor,null);assert.deepEqual(await h.snapshot(),before);});
  await t.test('Journal cursor from another owner rejected',async()=>{h.state.user=h.other;assert.equal((await h.invoke20('journal',undefined,{query:'?cursor='+first.body.nextCursor})).status,400);h.state.user=owner;});
  await t.test('Journal invalid cursor version rejected',async()=>{const cursor={...JSON.parse(Buffer.from(first.body.nextCursor,'base64url').toString()),v:2};assert.equal((await h.invoke20('journal',undefined,{query:'?cursor='+encodeCursor(cursor)})).status,400);});
});

const safeInbox=()=>({id:randomUUID(),kind:'signal',title:'Safe text',summary:'Summary',explanation:'Explanation',state:'active',target:{type:'task',id:randomUUID()},rowRevision:1,contentRevision:1,seen:false,stale:false,unavailable:false,watching:false,reasonCodes:['DEADLINE_TODAY'],firstNoticedAt:'2026-10-16T12:00:00.000000Z',lastCheckedAt:'2026-10-16T12:00:00.000000Z',snoozeUntil:null,revisitAt:null});
const safeJournal=()=>({id:randomUUID(),status:'succeeded',startedAt:'2026-10-16T12:00:00.000000Z',completedAt:'2026-10-16T12:00:01.000000Z',summary:'Safe summary',createdCount:1,updatedCount:0,resolvedCount:0,aiOutcome:'none',errorCode:null,coverage:{complete:true,unknown:0},checkedCounts:{projects:1,tasks:1,milestones:0,blocks:0}});
const safeReviewContext=()=>({targetLabel:'Canonical target Alpha',deterministicSummary:'Parent deterministic facts',deterministicExplanation:'Parent explanation',advisoryIdea:null});

test('E4a authenticated HTTP detail separates exact parent facts and changes no tables',async t=>{
  const h=await harness(t);await h.enable();const a=(await h.claim()).claims.find(p=>p.userId===owner);
  await h.db.query("update private.agent_pulse_state set mode='workspace_ai',ai_consent_version='ai-v1',ai_consented_at=clock_timestamp(),ai_project_ids=array[$2::uuid] where user_id=$1",[owner,h.project]);
  await h.db.query("update public.tasks set title='Canonical target Alpha',priority='High',due_date=(clock_timestamp() at time zone 'Asia/Manila')::date where id=$1",[h.task]);await h.publish(a);
  const parent=await h.one('select id,episode,summary,explanation from private.agent_observations where user_id=$1 and target_id=$2',[owner,h.task]);
  await h.sql('select public.agent_pulse_reserve_ai($1,$2,$3,$4,$5,$6,$7) r',[owner,a.pulseId,a.leaseToken,a.fence,a.settingsRevision,parent.id,parent.episode]);
  const idea=await h.sql('select public.agent_pulse_publish_ai($1,$2,$3,$4,$5,$6) r',[owner,a.pulseId,a.leaseToken,a.fence,a.settingsRevision,JSON.stringify({category:'review_deadline',title:'Provider idea Bravo',summary:'Provider advisory Charlie'})]);
  const before=await h.snapshot();const result=await h.invoke20('inbox',undefined,{query:'?id='+idea.id});assert.equal(result.status,200);
  assert.deepEqual(result.body.reviewContext,{targetLabel:'Canonical target Alpha',deterministicSummary:'Deadline today. Important task has no qualifying scheduled work before its deadline.',deterministicExplanation:parent.explanation || null,advisoryIdea:{title:'Provider idea Bravo',summary:'Provider advisory Charlie'}});
  assert.deepEqual(await h.snapshot(),before);assert.equal(h.effects.network,0);assert.equal(h.effects.queries.length,0);
});

test('E4a detail review context is reconstructed, bounded and isolated from other HTTP projections',async t=>{
  const h=await harness(t,false),item=safeInbox();
  for(const [label,patch] of [
    ['unknown key',{sourceToken:'PRIVATE_CONTEXT'}],['overlong label',{targetLabel:'😀'.repeat(121)}],['overlong facts',{deterministicSummary:'😀'.repeat(401)}],
    ['overlong explanation',{deterministicExplanation:'😀'.repeat(241)}],['wrong label type',{targetLabel:1}],['wrong facts type',{deterministicSummary:null}],
    ['wrong explanation type',{deterministicExplanation:[]}],['HTML label',{targetLabel:'<b>title</b>'}],['array advisory',{advisoryIdea:[]}],
    ['advisory unknown key',{advisoryIdea:{title:'Idea',summary:'Advisory',parentObservationId:owner}}],
    ['advisory overlong title',{advisoryIdea:{title:'😀'.repeat(121),summary:'Advisory'}}],['advisory overlong summary',{advisoryIdea:{title:'Idea',summary:'😀'.repeat(401)}}],
    ['advisory invalid title type',{advisoryIdea:{title:null,summary:'Advisory'}}],['advisory missing summary',{advisoryIdea:{title:'Idea'}}],
    ['signal with provider advisory',{advisoryIdea:{title:'Idea',summary:'Advisory'}}],
  ])await t.test('detail rejects '+label,async()=>{h.state.transform=()=>({...item,reviewContext:{...safeReviewContext(),...patch}});assert.equal((await h.invoke20('inbox',undefined,{query:'?id='+item.id})).status,502);});
  await t.test('detail reconstructs exact nested signal review context',async()=>{h.state.transform=()=>({...item,reviewContext:safeReviewContext()});assert.deepEqual(await h.invoke20('inbox',undefined,{query:'?id='+item.id}),{status:200,body:{item,reviewContext:safeReviewContext()}});});
  await t.test('detail reconstructs exact nested idea advisory without authority',async()=>{const idea={...item,kind:'idea',title:'Provider idea Bravo',summary:'Provider advisory Charlie'};const review={...safeReviewContext(),advisoryIdea:{title:idea.title,summary:idea.summary}};h.state.transform=()=>({...idea,reviewContext:review});assert.deepEqual((await h.invoke20('inbox',undefined,{query:'?id='+item.id})).body,{item:idea,reviewContext:review});});
  await t.test('fresh safe detail can have null review authority',async()=>{h.state.transform=()=>({...item,reviewContext:null});assert.deepEqual((await h.invoke20('inbox',undefined,{query:'?id='+item.id})).body,{item,reviewContext:null});});
  await t.test('missing nested contract fails closed',async()=>{h.state.transform=()=>item;assert.equal((await h.invoke20('inbox',undefined,{query:'?id='+item.id})).status,502);});
  await t.test('stale item cannot carry review authority',async()=>{h.state.transform=()=>({...item,stale:true,reviewContext:safeReviewContext()});assert.equal((await h.invoke20('inbox',undefined,{query:'?id='+item.id})).status,502);});
  await t.test('unavailable item cannot carry review authority',async()=>{h.state.transform=()=>({...item,unavailable:true,reviewContext:safeReviewContext()});assert.equal((await h.invoke20('inbox',undefined,{query:'?id='+item.id})).status,502);});
  await t.test('idea cannot silently omit or replace its child advisory',async()=>{for(const advisoryIdea of [null,{title:'Other provider',summary:item.summary}]){h.state.transform=()=>({...item,kind:'idea',reviewContext:{...safeReviewContext(),advisoryIdea}});assert.equal((await h.invoke20('inbox',undefined,{query:'?id='+item.id})).status,502);}});
  for(const name of ['inbox','brief'])await t.test(name+' rejects detail-only reviewContext in list item',async()=>{h.state.transform=()=>name==='inbox'?{items:[{...item,reviewContext:safeReviewContext()}],nextCursor:null}:{items:[{...item,reviewContext:safeReviewContext()}],lastCheckedAt:null};assert.equal((await h.invoke20(name)).status,502);});
  assert.equal(h.effects.network,0);assert.equal(h.effects.queries.length,0);
});
test('Task20 allowlisted DTO grammar and safe errors',async t=>{
  const h=await harness(t,false),item=safeInbox();
  for(const [label,patch] of [['unknown reason',{reasonCodes:['PRIVATE_REASON']}],['unknown state',{state:'PRIVATE_STATE'}],['extra evidence',{evidence:{PRIVATE_DATA:true}}],['nested authority',{target:{...item.target,leaseToken:'PRIVATE_TOKEN'}}],['oversized title',{title:'😀'.repeat(121)}],['oversized summary',{summary:'x'.repeat(401)}],['oversized explanation',{explanation:'x'.repeat(241)}],['HTML title',{title:'<script>alert(1)</script>'}],['bad timestamp',{lastCheckedAt:'2026-02-31T12:00:00Z'}],['null revision',{rowRevision:null}],['nonboolean seen',{seen:'false'}]])for(const name of ['inbox','brief'])await t.test(name+' projection '+label,async()=>{h.state.transform=()=>name==='inbox'?{items:[{...item,...patch}],nextCursor:null}:{items:[{...item,...patch}],lastCheckedAt:null};assert.equal((await h.invoke20(name)).status,502);});
  for(const [label,patch] of [['unknown error',{errorCode:'PRIVATE_ERROR'}],['unknown status',{status:'PRIVATE_STATUS'}],['nested source',{coverage:{complete:true,unknown:0,sourceToken:'PRIVATE'}}],['invalid counts',{checkedCounts:{projects:1,tasks:-1,milestones:0,blocks:0}}],['raw body',{before_state:{PRIVATE:true}}],['bad time',{startedAt:'bad'}]])await t.test('Journal projection '+label,async()=>{h.state.transform=()=>({items:[{...safeJournal(),...patch}],nextCursor:null});assert.equal((await h.invoke20('journal')).status,502);});
  await t.test('Brief maximum5 projection enforced',async()=>{h.state.transform=()=>({items:Array.from({length:6},safeInbox),lastCheckedAt:null});assert.equal((await h.invoke20('brief')).status,502);});
  for(const name of Object.keys(task20Paths))await t.test(name+' unknown SQL failure is safe',async()=>{h.state.rpcError={code:'XX000',message:'PRIVATE_SQL provider secret stack'};const result=await h.invoke20(name,name==='feedback'?feedback(item.id,'dismiss'):name==='ack'?ack([item]):undefined);assert.equal(result.status,502);});
  h.state.rpcError=null;
  await t.test('feedback unsafe resulting revision fails closed',async()=>{h.state.transform=()=>({id:item.id,state:'dismissed',rowRevision:Number.MAX_SAFE_INTEGER+1,contentRevision:1});assert.equal((await h.invoke20('feedback',feedback(item.id,'dismiss',{expectedRevision:Number.MAX_SAFE_INTEGER}))).status,502);});
  for(const name of ['feedback','ack'])for(const [code,message,status] of [['22023','PRIVATE_SQL',400],['40001','PRIVATE_SQL',409],['P0001','RATE_LIMITED',429]])await t.test(name+' safe SQL '+code,async()=>{h.state.rpcError={code,message};assert.equal((await h.invoke20(name,name==='feedback'?feedback(item.id,'dismiss'):ack([item]))).status,status);});
});

test('Task20 unsupported methods and transitive capabilities',async t=>{
  const h=await harness(t,false),{autoImplementMethods}=require('next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js');
  for(const [name,route] of Object.entries(h.routes).filter(([name])=>name in task20Paths))await t.test(name+' unsupported methods do not mutate',async()=>{const allowed=['feedback','ack'].includes(name)?'POST':'GET';assert.equal(typeof route[allowed],'function','Task20 method missing');assert.equal(route.runtime,'nodejs');assert.equal(route.dynamic,'force-dynamic');assert.deepEqual(Object.keys(route).filter(k=>/^[A-Z]+$/.test(k)),[allowed]);const methods=autoImplementMethods(route),before=h.effects.rpcs.length;for(const method of ['PUT','PATCH','DELETE',...(allowed==='GET'?['POST']:['GET','HEAD'])])assert.equal((await methods[method](new Request('https://workspace.invalid',{method}))).status,405);assert.equal(h.effects.rpcs.length,before);});
  await t.test('Task20 handlers exist without composer handoff',async()=>{const code=readFileSync(resolve(root,'lib/ai/agent/pulse/routes.ts'),'utf8');for(const name of ['handleInbox','handleInboxFeedback','handleInboxAck','handlePulseBrief','handlePulseJournal'])assert.match(code,new RegExp('export async function '+name+'\\('));assert.doesNotMatch(code,/buildInboxReviewDraft|buildAgentReviewPrompt|createPulseRepository|fetch\(|acquirePrivateAiLease/);});
});

test('settings projection rejects malformed canonical DTOs',async t=>{
  const h=await harness(t,false);
  for(const [name,patch] of [
    ['array mode',{mode:['off']}],['array cadence',{cadence:['normal']}],['negative revision',{settingsRevision:-1}],
    ['invalid consent',{checksConsented:'true'}],['unknown policy',{policyVersion:'pulse-old'}],['invalid time',{nextDueAt:'not-time'}],
    ['oversized scope',{aiProjectIds:Array.from({length:21},()=>randomUUID())}],['invalid usage',{usage:{...defaults().usage,ownerRequests:-1}}],
    ['extra usage field',{usage:{...defaults().usage,reservationKey:'PRIVATE'}}],['missing usage',{usage:null}],
    ['extra coverage field',{coverage:{...defaults().coverage,sourceToken:'PRIVATE'}}],
  ]) await t.test('settings projection '+name,async()=>{
    h.state.transform=data=>({...data,...patch});const result=await h.invoke();assert.equal(result.status,502);
    assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE|sourceToken|reservationKey/);
  });
});

test('settings body byte, stream and cancellation boundaries',async t=>{
  const h=await harness(t,false);
  await t.test('settings exactly4096 bytes accepted',async()=>{
    assert.equal((await h.invoke(setting(),{raw:JSON.stringify(setting()).padEnd(4096,' ')})).status,200);
  });
  await t.test('settings multichunk overflow cancelled before SQL',async()=>{
    let cancelled=false;const raw=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify(setting())));controller.enqueue(new Uint8Array(4096));},cancel(){cancelled=true;}});
    const before=h.effects.rpcs.length;assert.equal((await h.invoke(setting(),{raw})).status,400);assert.equal(cancelled,true);assert.equal(h.effects.rpcs.length,before);
  });
  await t.test('settings BOM rejected',async()=>{const before=h.effects.rpcs.length;assert.equal((await h.invoke(setting(),{raw:'\uFEFF'+JSON.stringify(setting())})).status,400);assert.equal(h.effects.rpcs.length,before);});
  await t.test('settings JSON media type prefix is not accepted',async()=>{const before=h.effects.rpcs.length;assert.equal((await h.invoke(setting(),{headers:{'content-type':'application/jsonx'}})).status,400);assert.equal(h.effects.rpcs.length,before);});
  await t.test('clear oversized body rejected before SQL',async()=>{const before=h.effects.rpcs.length;assert.equal((await h.invoke(clear(0),{clear:true,raw:JSON.stringify(clear(0)).padEnd(4097,' ')})).status,400);assert.equal(h.effects.rpcs.length,before);});
});
