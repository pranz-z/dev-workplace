import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadPulse } from './phase5d-test-support.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
let deadlockObserved=false;
export const lit = value => value === null ? 'null' : "'"+String(value).replaceAll("'","''")+"'";
export const json = value => lit(JSON.stringify(value))+'::jsonb';
export const rpc = (name,...args) => 'select public.'+name+'('+args.map(lit).join(',')+') r';

function target() {
  if (!process.env.AGENT_TEST_POSTGRES_DSN || !process.env.AGENT_TEST_PSQL || !process.env.AGENT_TEST_POSTGRES_DATA_DIR) throw new Error('Explicit retained local PostgreSQL target, psql and data directory are required');
  const url = new URL(process.env.AGENT_TEST_POSTGRES_DSN);
  if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname!=='127.0.0.1' || url.port!=='55436' || url.pathname!=='/postgres' || url.search || url.hash) throw new Error('Only the verified retained loopback maintenance target is allowed');
  const psql = resolve(process.env.AGENT_TEST_PSQL), data = resolve(process.env.AGENT_TEST_POSTGRES_DATA_DIR);
  if (!existsSync(psql) || !existsSync(resolve(data,'PG_VERSION'))) throw new Error('Retained PostgreSQL runtime is missing');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
  Object.assign(env,{PGHOST:url.hostname,PGPORT:url.port,PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGCONNECT_TIMEOUT:'5',PGCLIENTENCODING:'UTF8',PGOPTIONS:'-c timezone=UTC'});
  return {psql,data,env};
}
class Connection {
  constructor(config, database, label) {
    this.label=label; this.buffer=''; this.stderr=''; this.counter=0;
    this.child=spawn(config.psql,['-X','-qAt','-d',database,'-v','VERBOSITY=verbose'],{env:config.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stdout.on('data',chunk=>{this.buffer+=chunk.toString();this.flush();});
    this.child.stderr.on('data',chunk=>{this.stderr+=chunk.toString();});
    this.child.on('error',()=>this.reject(new Error('Local psql process failed')));
    this.closed=new Promise(resolve=>this.child.on('exit',code=>{this.reject(new Error('Local psql exited unexpectedly: '+code));resolve();}));
  }
  reject(error) { if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;} }
  flush() {
    if(!this.pending)return;
    const at=this.buffer.indexOf(this.pending.marker), end=this.buffer.indexOf('\n',at);
    if(at<0 || end<0)return;
    const state=this.buffer.slice(at+this.pending.marker.length,end).trim(), text=this.buffer.slice(0,at).trim(), pending=this.pending;
    const constraint=this.stderr.match(/constraint "([a-z0-9_]+)"/i)?.[1]??null;
    if(state==='40P01')deadlockObserved=true;
    this.buffer=this.buffer.slice(end+1);this.stderr='';this.pending=null;clearTimeout(pending.timer);
    if(state!=='00000')pending.reject(Object.assign(new Error(this.label+' SQLSTATE '+state),{code:state,constraint}));
    else pending.resolve(text);
  }
  q(sql) {
    if(this.pending)throw new Error('Concurrent queries require independent connections');
    return new Promise((resolve,reject)=>{
      const marker='__PHASE5D_'+(++this.counter)+'__';
      this.pending={marker,resolve,reject,timer:setTimeout(()=>{this.reject(new Error('Bounded psql harness timeout'));this.child.kill();},12000)};
      this.child.stdin.write(sql+';\n\\echo '+marker+' :SQLSTATE\n');
    });
  }
  async one(sql) { const result=await this.q('with result as ('+sql+') select row_to_json(result) from result');return result?JSON.parse(result):null; }
  async init() {
    await this.q("set statement_timeout='8s';set lock_timeout='5s';set deadlock_timeout='100ms';set application_name="+lit(this.label));
    this.pid=(await this.one('select pg_backend_pid() pid')).pid;
    assert.equal((await this.one("select current_setting('TimeZone') zone")).zone,'UTC');
  }
  async close() { if(this.child.exitCode===null){this.child.stdin.end('\\q\n');const timer=setTimeout(()=>this.child.kill(),2000);await this.closed;clearTimeout(timer);} }
}

export async function withPostgresFixture(t, fn) {
  if(deadlockObserved)throw new Error('Execution stopped after observed PostgreSQL deadlock');
  const config=target(), database='phase5d_test_'+randomUUID().replaceAll('-',''), sessions=[], evidence={case:t.name,races:[]};
  function command(sql,db='postgres') {
    try {return execFileSync(config.psql,['-X','-qAt','-d',db,'-v','ON_ERROR_STOP=1','-c',sql],{env:config.env,windowsHide:true,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();}
    catch {throw new Error('Local disposable PostgreSQL setup/cleanup failed');}
  }
  const metadata=JSON.parse(command("select json_build_object('address',inet_server_addr(),'port',inet_server_port(),'data',current_setting('data_directory'),'version',current_setting('server_version'),'canCreate',(select rolcreatedb or rolsuper from pg_roles where rolname=current_user),'roles',(select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')))"));
  assert.equal(metadata.address,'127.0.0.1');assert.equal(metadata.port,55436);assert.equal(resolve(metadata.data),config.data);assert.equal(metadata.canCreate,true);assert.equal(metadata.roles,3);
  evidence.serverVersion=metadata.version;
  command('create database '+database);
  try {
    command(`create schema auth;create schema storage;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;`,database);
    const migrations=readdirSync(resolve(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
    assert.equal(migrations.length,26);assert.equal(migrations.at(-1),'20261029123841_workspace_agent_one_shot.sql');
    command('create schema test_harness;create table test_harness.migrations(ordinal integer primary key,filename text unique not null,sha256 text not null)',database);
    const migrationMap=migrations.map((name,i)=>({ordinal:i+1,filename:name,sha256:createHash('sha256').update(readFileSync(resolve(root,'supabase/migrations',name))).digest('hex').toUpperCase()}));
    for(const entry of migrationMap) {
      const name=entry.filename;
      try {execFileSync(config.psql,['-X','-qAt','-d',database,'-v','ON_ERROR_STOP=1','--single-transaction','-f',resolve(root,'supabase/migrations',name),'-c',`insert into test_harness.migrations values(${entry.ordinal},${lit(name)},${lit(entry.sha256)})`],{env:config.env,windowsHide:true,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});}
      catch {throw new Error('Disposable migration replay failed: '+name);}
    }
    for(const label of ['first','second','observer']){const c=new Connection(config,database,'phase5d-'+label);sessions.push(c);await c.init();}
    const [a,b,o]=sessions;
    const applied=JSON.parse(command('select json_agg(x order by ordinal) from test_harness.migrations x',database));
    assert.deepEqual(applied,migrationMap);evidence.migrations=applied;evidence.database=database;
    evidence.backends=sessions.map(c=>c.pid);assert.equal(new Set(evidence.backends).size,3);
    const one=sql=>o.one(sql), value=async sql=>(await one(sql)).r;
    async function waitForBlock(blocker=a,waiter=b) {
      const deadline=Date.now()+4000;
      while(Date.now()<deadline){const row=await one(`select pg_blocking_pids(${waiter.pid}) blockers,wait_event_type,wait_event from pg_stat_activity where pid=${waiter.pid}`);if(row?.blockers.includes(blocker.pid))return row;await new Promise(resolve=>setImmediate(resolve));}
      throw new Error('Expected independent PostgreSQL lock overlap was not observed');
    }
    async function race(label,first,second,{secondCode=null,coreExclude=[]}={}) {
      const before=await digest(coreExclude);
      await a.q('begin');await b.q('begin');const x=await a.one(first);
      const pending=b.one(second).then(result=>({result}),error=>({error}));
      const barrier=await waitForBlock();await a.q('commit');const y=await pending;
      const result={label,pids:[a.pid,b.pid],barrier,sqlstates:['00000',y.error?.code??'00000']};evidence.races.push(result);
      if(y.error){await b.q('rollback');assert.equal(y.error.code,secondCode);}else {await b.q('commit');assert.equal(secondCode,null);}
      assert.equal(await digest(coreExclude),before,'Surviving workspace/manual audit rows changed during race');result.coreAuditUnchanged=true;
      return [x,y.error?null:y.result];
    }
    async function owner() {
      const id=randomUUID(),project=randomUUID(),task=randomUUID(),run=randomUUID();
      await o.q(`insert into auth.users values(${lit(id)});insert into public.profiles(id,time_zone) values(${lit(id)},'UTC');
        insert into public.projects(id,user_id,slug,title) values(${lit(project)},${lit(id)},${lit(project)},'Disposable project');
        insert into public.tasks(id,user_id,project_id,title,priority,due_date) values(${lit(task)},${lit(id)},${lit(project)},'Disposable task','High',(clock_timestamp() at time zone 'UTC')::date)`);
      await o.q(`insert into private.agent_runs(id,user_id) values(${lit(run)},${lit(id)});
        insert into private.agent_actions(id,run_id,user_id,action_type,entity_id,project_id,title,payload,before_state,diff,expected_updated_at,status)
        select gen_random_uuid(),${lit(run)},${lit(id)},'update_task',${lit(task)},${lit(project)},'Historical task update','{"title":"Disposable task"}','{"title":"Original"}','[{"field":"title","before":"Original","after":"Disposable task"}]',updated_at,'applied' from public.tasks where id=${lit(task)}`);
      await value(`select public.agent_pulse_set_settings(${lit(id)},0,${json({mode:'workspace',cadence:'normal',checksConsent:true,aiConsent:false,aiProjectIds:[]})}) r`);
      return {id,project,task};
    }
    async function enableDue(user) {await o.q(`update private.agent_pulse_state set next_due_at=date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01') where user_id=${lit(user.id)}`);}
    const claim=(nonce,processingEnabled)=>{
      assert.equal(typeof processingEnabled,'boolean','PostgreSQL fixture dispatch requires explicit processing state');
      return `select public.agent_pulse_claim_dispatch(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01'),${lit(nonce)},date_trunc('second',clock_timestamp()),${lit(processingEnabled)}::boolean) r`;
    };
    const authorityArgs=p=>[p.userId,p.pulseId,p.leaseToken,p.fence,p.settingsRevision];
    const finish=p=>rpc('agent_pulse_finish',p.userId,p.pulseId,p.leaseToken,p.fence,'unknown');
    async function scan(p) {
      const source=await value(rpc('agent_pulse_read_source',p.userId,p.pulseId,p.leaseToken,p.fence));
      const {scanPulse}=await loadPulse('lib/ai/agent/pulse/scanner.ts'),{PULSE_POLICY}=await loadPulse('lib/ai/agent/pulse/policy.ts');
      return scanPulse(source,source.existing,PULSE_POLICY);
    }
    const publication=(p,s,commit=randomUUID())=>`select public.agent_pulse_publish_deterministic(${authorityArgs(p).map(lit).join(',')},${lit(commit)},${json({decisions:s.decisions,coverage:s.coverage})},${json(s.baselinePatches)}) r`;
    async function candidate(user,publish=true) {
      const running=await one(`select id,lease_token,fence from private.agent_pulses where user_id=${lit(user.id)} and status='running'`);
      if(running)await value(rpc('agent_pulse_finish',user.id,running.id,running.lease_token,running.fence,'unknown'));
      const row=await one(`select s.settings_revision,s.fence+1 fence,private.agent_pulse_stamp(coalesce((select max(scheduled_slot)+interval '4 hours' from private.agent_pulses where user_id=s.user_id),date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01'))) slot from private.agent_pulse_state s where user_id=${lit(user.id)}`);
      const p={userId:user.id,pulseId:randomUUID(),leaseToken:randomUUID(),fence:row.fence,settingsRevision:row.settings_revision,slot:row.slot};
      await o.q(`insert into private.agent_pulses(id,user_id,scheduled_slot,dispatch_nonce,fence,lease_token,lease_expires_at,settings_revision,policy_version) values(${lit(p.pulseId)},${lit(user.id)},${lit(p.slot)},gen_random_uuid(),${p.fence},${lit(p.leaseToken)},clock_timestamp()+interval '90 seconds',${p.settingsRevision},'pulse-v1');
        update private.agent_pulse_state set fence=${p.fence},lease_token=${lit(p.leaseToken)},lease_expires_at=(select lease_expires_at from private.agent_pulses where id=${lit(p.pulseId)}) where user_id=${lit(user.id)}`);
      if(publish)await value(publication(p,await scan(p)));
      const parent=await one(`select id,episode,row_revision,content_revision from private.agent_observations where user_id=${lit(user.id)} and target_id=${lit(user.task)} and kind='signal'`);
      return {p,parent};
    }
    const reserve=item=>rpc('agent_pulse_reserve_ai',...authorityArgs(item.p),item.parent.id,item.parent.episode);
    const settings=(user,revision)=>`select public.agent_pulse_set_settings(${lit(user.id)},${revision},${json({mode:'off',cadence:'normal',checksConsent:false,aiConsent:false,aiProjectIds:[]})}) r`;
    async function digest(exclude=[]) {
      const predicate=exclude.length?' where user_id not in('+exclude.map(lit).join(',')+')':'';
      return value(`select md5(jsonb_build_object('projects',(select jsonb_agg(to_jsonb(x) order by id) from public.projects x${predicate}),
        'tasks',(select jsonb_agg(to_jsonb(x) order by id) from public.tasks x${predicate}),'runs',(select jsonb_agg(to_jsonb(x) order by id) from private.agent_runs x${predicate}),
        'actions',(select jsonb_agg(to_jsonb(x) order by id) from private.agent_actions x${predicate}))::text) r`);
    }
    async function repository(connection=b) {
      const {createPulseRepository}=await loadPulse('lib/ai/agent/pulse/db.ts');
      const names=new Set(['agent_pulse_get_settings','agent_pulse_read_source','agent_pulse_publish_deterministic','agent_pulse_reserve_ai','agent_pulse_publish_ai','agent_pulse_recover','agent_pulse_finish','agent_pulse_claim_dispatch','agent_pulse_retain','agent_pulse_retain_installation']);
      return createPulseRepository({rpc:async(name,args)=>{
        assert.ok(names.has(name),'Test engine bridge permits fixed repository RPCs only');
        try {const data=(await connection.one('select public.'+name+'('+Object.values(args).map(value=>value!==null&&typeof value==='object'?json(value):lit(value)).join(',')+') r')).r;return {data,error:null};}
        catch(error){evidence.rpcErrors??=[];evidence.rpcErrors.push({name,sqlstate:error.code??null,pid:connection.pid});return {data:null,error:{code:error.code}};}
      }});
    }
    async function authority(p) {
      const row=await one('select private.agent_pulse_stamp(lease_expires_at) expires from private.agent_pulses where id='+lit(p.pulseId));
      return {...p,leaseExpiresAt:row.expires,policyVersion:'pulse-v1'};
    }
    async function ledgerInvariant() {
      const columns=JSON.parse(await o.q("select json_agg(attname order by attnum) from pg_attribute where attrelid='private.agent_pulse_installation_events'::regclass and attnum>0 and not attisdropped"));
      assert.deepEqual(columns,['id','event_kind','created_at','scheduled_slot','nonce_fingerprint','dispatch_outcome','claim_count','reservation_key']);
      assert.equal((await one("select count(*)::int n from pg_constraint where conrelid='private.agent_pulse_installation_events'::regclass and contype='f'")).n,0);
      assert.equal((await one("select count(*)::int n from private.agent_pulse_installation_events where (event_kind='provider_reservation' and (reservation_key is null or scheduled_slot is not null or nonce_fingerprint is not null or dispatch_outcome is not null or claim_count is not null)) or (event_kind='dispatch_slot' and (scheduled_slot is null or nonce_fingerprint is null or dispatch_outcome is null or claim_count not between 0 and 2 or reservation_key is not null))")).n,0);
      return {columns,foreignKeys:0,rows:(await one('select count(*)::int n from private.agent_pulse_installation_events')).n};
    }
    const f={a,b,o,one,value,race,waitForBlock,owner,enableDue,claim,candidate,scan,publication,reserve,finish,settings,digest,evidence,lit,json,rpc,repository,authority,ledgerInvariant};
    await fn(f);
    evidence.deadlocks=(await one('select deadlocks from pg_stat_database where datname=current_database()')).deadlocks;
    assert.equal(evidence.deadlocks,0);evidence.passed=true;console.log(JSON.stringify(evidence));
  } catch(error) {
    evidence.passed=false;evidence.error={sqlstate:error.code??null,constraint:error.constraint??null};console.log(JSON.stringify(evidence));throw error;
  } finally {
    await Promise.all(sessions.map(c=>c.close()));
    // Only this invocation's verified, locally created, uniquely named database is removed.
    assert.match(database,/^phase5d_test_[0-9a-f]{32}$/);command('drop database '+database);
  }
}
