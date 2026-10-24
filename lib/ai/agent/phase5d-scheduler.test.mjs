import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { fixture } from './phase5d-fixture.mjs';
import { loadPulse } from './phase5d-test-support.mjs';

const root = resolve(import.meta.dirname, '../../..'), require = createRequire(import.meta.url);
const path = '/api/internal/agent/pulse', secret = 'synthetic-scheduler-secret-never-transmitted-12345';
const now = Date.UTC(2026,9,16,10,1,3,999);
const canonical = { version: 1, scheduledSlot: '2026-10-16T08:00:00.000Z', issuedAt: Math.floor(now/1000), nonce: 'abcdef12-3456-4789-abcd-123456789abc' };
const text = (input, method = 'POST', signedPath = path) => [input.version,method,signedPath,input.scheduledSlot,input.issuedAt,input.nonce].join('\n');
const mac = (input = canonical, key = secret, method = 'POST', signedPath = path) => createHmac('sha256',key).update(text(input,method,signedPath)).digest('hex');
function request(input = canonical, options = {}) {
  const method = options.method ?? 'POST', headers = new Headers(options.headers);
  const signature = options.signature === undefined ? mac(input) : options.signature;
  if (signature !== null) headers.set('X-Agent-Pulse-Signature',signature);
  return new Request('https://scheduler.invalid'+(options.path ?? path), {
    method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.body ?? JSON.stringify(input), duplex: 'half' }),
  });
}
let schedulerModule;
const scheduler = () => schedulerModule ??= loadPulse('lib/ai/agent/pulse/scheduler.ts');
const parse = async (input = canonical, options = {}, key = secret, clock = now) => (await scheduler()).parseSchedulerRequest(request(input,options),key,clock);

test('valid canonical request yields only the four protocol fields', async () => assert.deepEqual(await parse(),canonical));
test('signing text exact line order, POST/path and no trailing newline', async () => {
  const actual = (await scheduler()).schedulerSigningText({ ...canonical, processingEnabled: true, ownerId: 'forbidden' });
  assert.equal(actual, `1\nPOST\n/api/internal/agent/pulse\n2026-10-16T08:00:00.000Z\n${canonical.issuedAt}\nabcdef12-3456-4789-abcd-123456789abc`);
  assert.equal(actual.endsWith('\n'),false); assert.equal(actual.split('\n').length,6);
  assert.doesNotMatch(actual,/processingEnabled|forbidden/);
});
test('signature authenticates canonical fields rather than JSON key order/whitespace', async () => {
  const body = `{ "nonce": ${JSON.stringify(canonical.nonce)}, "issuedAt": ${canonical.issuedAt}, "scheduledSlot": ${JSON.stringify(canonical.scheduledSlot)}, "version": 1 }`;
  assert.deepEqual(await parse(canonical,{body}),canonical);
});

const bad = [
  ['wrong key',canonical,{signature:mac(canonical,'wrong-synthetic-key')}],
  ['missing signature',canonical,{signature:null}],
  ['short signature',canonical,{signature:'a'.repeat(63)}],
  ['long signature',canonical,{signature:'a'.repeat(65)}],
  ['uppercase signature',canonical,{signature:mac().toUpperCase()}],
  ['nonhex signature',canonical,{signature:'g'.repeat(64)}],
  ['duplicate signature headers',canonical,{signature:mac()+', '+mac()}],
  ['signature for GET',canonical,{signature:mac(canonical,secret,'GET')}],
  ['signature for another path',canonical,{signature:mac(canonical,secret,'POST','/api/internal/agent/other')}],
  ['wrong request method',canonical,{method:'PUT'}],
  ['GET request',canonical,{method:'GET'}],
  ['wrong request path',canonical,{path:'/api/internal/agent/other'}],
  ['encoded path',canonical,{path:'/api/internal/agent/%70ulse'}],
  ['query credential',canonical,{path:path+'?secret=not-a-credential'}],
  ['wrong version',{...canonical,version:2}],
  ['unknown owner field',{...canonical,ownerId:'forbidden'}],
  ['processing flag in HTTP body',{...canonical,processingEnabled:false}],
  ['missing field',{version:canonical.version,scheduledSlot:canonical.scheduledSlot,issuedAt:canonical.issuedAt}],
  ['literal duplicate key',canonical,{body:JSON.stringify(canonical).replace(/}$/,',"nonce":"'+canonical.nonce+'"}')}],
  ['escaped-equivalent duplicate',canonical,{body:JSON.stringify(canonical).replace(/}$/,',"no\\u006ece":"'+canonical.nonce+'"}')}],
  ['nested object',{...canonical,nonce:{value:canonical.nonce}}],
  ['nested array',{...canonical,nonce:[canonical.nonce]}],
  ['top-level array',canonical,{body:'['+JSON.stringify(canonical)+']'}],
  ['trailing JSON',canonical,{body:JSON.stringify(canonical)+'{}'}],
  ['trailing comma',canonical,{body:JSON.stringify(canonical).replace(/}$/ ,',}')}],
  ['malformed JSON',canonical,{body:'{"version":'}],
  ['empty body',canonical,{body:''}],
  ['null body',canonical,{body:'null'}],
  ['invalid UTF8',canonical,{body:new Uint8Array([0xc3,0x28])}],
  ['UTF8 BOM',canonical,{body:new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(JSON.stringify(canonical))])}],
  ['1025 raw bytes',canonical,{body:JSON.stringify(canonical).padEnd(1025,' ')}],
  ['malformed UUID',{...canonical,nonce:'not-a-uuid'}],
  ['uppercase UUID',{...canonical,nonce:canonical.nonce.toUpperCase()}],
  ['braced UUID',{...canonical,nonce:'{'+canonical.nonce+'}'}],
  ['UUID trailing newline',{...canonical,nonce:canonical.nonce+'\n'}],
  ['UUID number',{...canonical,nonce:1}],
  ['malformed timestamp',{...canonical,scheduledSlot:'not-a-date'}],
  ['offset timestamp',{...canonical,scheduledSlot:'2026-10-16T08:00:00.000+00:00'}],
  ['missing timestamp milliseconds',{...canonical,scheduledSlot:'2026-10-16T08:00:00Z'}],
  ['local timestamp',{...canonical,scheduledSlot:'2026-10-16T08:00:00.000'}],
  ['non-four-hour slot',{...canonical,scheduledSlot:'2026-10-16T09:00:00.000Z'}],
  ['previous slot',{...canonical,scheduledSlot:'2026-10-16T04:00:00.000Z'}],
  ['future slot',{...canonical,scheduledSlot:'2026-10-16T12:00:00.000Z'}],
  ['fractional issuedAt',{...canonical,issuedAt:canonical.issuedAt+0.5}],
  ['string issuedAt',{...canonical,issuedAt:String(canonical.issuedAt)}],
  ['boolean issuedAt',{...canonical,issuedAt:true}],
  ['null issuedAt',{...canonical,issuedAt:null}],
  ['infinite issuedAt',canonical,{body:JSON.stringify(canonical).replace(String(canonical.issuedAt),'1e999')}],
  ['NaN JSON token',canonical,{body:JSON.stringify(canonical).replace(String(canonical.issuedAt),'NaN')}],
  ['601 seconds old',{...canonical,issuedAt:canonical.issuedAt-601}],
  ['61 seconds future',{...canonical,issuedAt:canonical.issuedAt+61}],
  ['Authorization only',canonical,{signature:null,headers:{Authorization:'Bearer '+secret}}],
  ['cookie only',canonical,{signature:null,headers:{Cookie:'scheduler='+secret}}],
];
const authenticationCases = new Set(['wrong key','missing signature','short signature','long signature','uppercase signature','nonhex signature','duplicate signature headers','signature for GET','signature for another path','Authorization only','cookie only']);
for (const [name,input,options = {}] of bad) test('reject '+name, async () => assert.rejects(parse(input,options),{code:authenticationCases.has(name)?'AUTHENTICATION_FAILED':'INVALID_REQUEST'}));
for (const age of [-60,0,600]) test(`inclusive freshness ${age} seconds`, async () => {
  const input = {...canonical,issuedAt:canonical.issuedAt-age}; assert.deepEqual(await parse(input),input);
});
for (const key of ['', ' ', 'short', 'x'.repeat(257), 'x'.repeat(32)+'\n']) test('invalid secret fails closed '+JSON.stringify(key.length), async () => assert.rejects(parse(canonical,{signature:mac(canonical,key)},key),{code:'AUTHENTICATION_FAILED'}));
for (const hour of [0,4,8,12,16,20]) test(`UTC slot ${hour} remains canonical through its last millisecond`, async () => {
  const first = Date.UTC(2026,9,16,hour);
  for (const clock of [first, first+14_400_000-1]) {
    const input = {...canonical,scheduledSlot:new Date(first).toISOString(),issuedAt:Math.floor(clock/1000)};
    assert.deepEqual(await parse(input,{},secret,clock),input);
  }
});
test('body exactly 1024 raw bytes accepted', async () => assert.deepEqual(await parse(canonical,{body:JSON.stringify(canonical).padEnd(1024,' ')}),canonical));
test('stream cancels on overflow before reading another chunk', async () => {
  let reads = 0, cancelled = 0;
  const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(reads === 1 ? 1024 : 1).fill(32)); }, cancel() { cancelled++; } },{highWaterMark:0});
  await assert.rejects(parse(canonical,{body}),{code:'INVALID_REQUEST'}); assert.equal(reads,2); assert.equal(cancelled,1);
});
test('duplicate parser never JSON.parses the complete object', async t => {
  const api = await scheduler(), original = JSON.parse;
  t.mock.method(JSON,'parse',(value,...args) => { assert.equal(value.trimStart().startsWith('{'),false); return original(value,...args); });
  await assert.rejects(api.parseSchedulerRequest(request(canonical,bad.find(x=>x[0]==='escaped-equivalent duplicate')[2]),secret,now));
});
test('scheduler HMAC uses decoded fixed bytes and timingSafeEqual', async () => {
  await scheduler(); const source = readFileSync(resolve(root,'lib/ai/agent/pulse/scheduler.ts'),'utf8');
  assert.match(source,/timingSafeEqual\(/); assert.match(source,/createHmac\(['"]sha256['"]/); assert.match(source,/Buffer\.from\([^\n]*['"]hex['"]/);
  assert.doesNotMatch(source,/console\.|JSON\.parse\((?:body|text|raw)\)/);
});

function env(t, values) {
  const originals = Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  for (const [key,value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  t.after(() => { for (const [key,value] of Object.entries(originals)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
function loadRoute(client, effects) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file,exports);
    const source = ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','exports',source)(name => {
      if (name === 'server-only') return {};
      if (name === '@/lib/supabase/admin') return { getSupabaseAdminClient: () => { effects.clients++; return client; } };
      if (name.startsWith('@/')) return load(resolve(root,name.slice(2)+'.ts'));
      if (name.startsWith('.')) return load(resolve(dirname(file),name+'.ts'));
      return require(name);
    },exports);
    return exports;
  }
  return load(resolve(root,'app/api/internal/agent/pulse/route.ts'));
}
async function routeHarness(t) {
  const f = await fixture(t), effects = {clients:0,rpcs:[],provider:0};
  env(t,{AGENT_PULSE_SCHEDULER_SECRET:secret,AGENT_PULSE_ENABLED:'false'});
  t.mock.method(globalThis,'fetch',async () => { effects.provider++; assert.fail('No live network/provider calls'); });
  const args = {
    agent_pulse_claim_dispatch:['p_slot','p_nonce','p_issued_at','p_processing_enabled'],
    agent_pulse_retain:['p_user_id','p_limit'],agent_pulse_retain_installation:['p_limit'],
    agent_pulse_get_settings:['p_user_id'],agent_pulse_recover:['p_user_id','p_pulse_id'],
    agent_pulse_read_source:['p_user_id','p_pulse_id','p_lease_token','p_fence'],
    agent_pulse_publish_deterministic:['p_user_id','p_pulse_id','p_lease_token','p_fence','p_settings_revision','p_commit_id','p_scan','p_baseline'],
    agent_pulse_finish:['p_user_id','p_pulse_id','p_lease_token','p_fence','p_ai_outcome'],
  };
  const client = {rpc: async (name,values) => {
    effects.rpcs.push({name,values}); assert.ok(args[name],'Only fixed deterministic worker RPCs permitted in this fixture');
    const parameters = args[name].map(key => typeof values[key] === 'object' && values[key] !== null ? JSON.stringify(values[key]) : values[key]);
    return {data:await f.sql(`select public.${name}(${parameters.map((_x,i)=>'$'+(i+1)).join(',')}) r`,parameters),error:null};
  }};
  const route = loadRoute(client,effects);
  const identity = async () => ({version:1,scheduledSlot:new Date((await f.one("select private.agent_pulse_stamp(date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')) s")).s).toISOString(),issuedAt:Math.floor(Date.now()/1000),nonce:randomUUID()});
  const snapshot = () => f.one(`select
    (select count(*)::int from private.agent_pulse_installation_events) events,
    (select count(*)::int from private.agent_pulses) pulses,
    (select count(*)::int from private.agent_observations) observations,
    (select coalesce(jsonb_agg(to_jsonb(s) order by user_id),'[]') from private.agent_pulse_state s) states`);
  const invoke = async (input,options) => {
    const response = await route.POST(request(input,options)); assert.equal(response.headers.get('Cache-Control'),'no-store');
    const body = await response.json(); assert.doesNotMatch(JSON.stringify(body),/11111111-|22222222-|lease|nonce|fingerprint|reservation|sourceToken|PRIVATE|synthetic-scheduler/);
    return {status:response.status,body};
  };
  return {...f,effects,route,identity,snapshot,invoke};
}

test('actual route rejects parser/auth/config layers with zero database and provider effects', async t => {
  const h = await routeHarness(t); await h.enable(); const before = await h.snapshot(), input = await h.identity();
  const cases = [
    ['wrong method',{}, {method:'PUT'}],['malformed body',{}, {body:'{'}],['duplicate',{}, {body:JSON.stringify(input).replace(/}$/ ,',"version":1}')}],
    ['invalid UTF8',{}, {body:new Uint8Array([0xc0,0x80])}],['oversize',{}, {body:' '.repeat(1025)}],
    ['wrong signature',{}, {signature:'a'.repeat(64)}],['no signature',{}, {signature:null}],
    ['wrong path',{}, {path:'/api/internal/agent/other'}],['unknown owner',{ownerId:'PRIVATE'},{}],
    ['body processing flag',{processingEnabled:true},{}],['expired',{issuedAt:input.issuedAt-601},{}],
    ['previous slot',{scheduledSlot:new Date(Date.parse(input.scheduledSlot)-14_400_000).toISOString()},{}],
  ];
  for (const [name,patch,options] of cases) await t.test(name,async () => {
    const result = await h.invoke({...input,...patch},options); assert.ok([400,401].includes(result.status));
    assert.deepEqual(Object.keys(result.body),['error']); assert.deepEqual(Object.keys(result.body.error),['code']);
    assert.deepEqual(await h.snapshot(),before); assert.equal(h.effects.clients,0); assert.deepEqual(h.effects.rpcs,[]); assert.equal(h.effects.provider,0);
  });
  for (const [name,key,value,status] of [
    ['missing secret','AGENT_PULSE_SCHEDULER_SECRET',undefined,401],['invalid secret','AGENT_PULSE_SCHEDULER_SECRET','',401],
    ['missing switch','AGENT_PULSE_ENABLED',undefined,503],['invalid switch','AGENT_PULSE_ENABLED','FALSE',503],
    ['padded switch','AGENT_PULSE_ENABLED',' false ',503],['empty switch','AGENT_PULSE_ENABLED','',503],
  ]) await t.test(name,async child => {
    env(child,{[key]:value}); const result = await h.invoke(input); assert.equal(result.status,status);
    assert.deepEqual(await h.snapshot(),before); assert.equal(h.effects.clients,0); assert.deepEqual(h.effects.rpcs,[]); assert.equal(h.effects.provider,0);
  });
});
test('actual route explicit false calls SQL, then true and changed nonce recover disabled', async t => {
  const h = await routeHarness(t); await h.enable(); const before = await h.snapshot(), input = await h.identity();
  assert.deepEqual(await h.invoke(input),{status:200,body:{accepted:true,outcome:'disabled',claimedCount:0,processedCount:0}});
  assert.equal(h.effects.rpcs.length,2); assert.equal(h.effects.rpcs[0].name,'agent_pulse_retain_installation'); assert.equal(h.effects.rpcs[0].values.p_limit,20); assert.equal(h.effects.rpcs[1].values.p_processing_enabled,false);
  const first = await h.snapshot(); assert.equal(first.events,1); assert.deepEqual(first.states,before.states); assert.equal(first.pulses,0);
  process.env.AGENT_PULSE_ENABLED = 'true';
  for (const nonce of [input.nonce,randomUUID()]) assert.deepEqual(await h.invoke({...input,nonce}),{status:200,body:{accepted:true,outcome:'recovered',claimedCount:0,processedCount:0}});
  assert.deepEqual(await h.snapshot(),first); assert.equal(h.effects.provider,0);
});
test('actual route accepts an authenticated request exactly 600 integer seconds old', async t => {
  const h = await routeHarness(t), input = await h.identity();
  const seconds = (await h.one('select floor(extract(epoch from clock_timestamp()))::bigint seconds')).seconds;
  t.mock.method(Date,'now',() => Number(seconds)*1000+500);
  input.issuedAt = Number(seconds)-600;
  assert.deepEqual(await (await scheduler()).parseSchedulerRequest(request(input),secret,Date.now()),input);
  const result = await h.invoke(input);
  const timing = await h.one(`select floor(extract(epoch from clock_timestamp()))::bigint-$1::bigint integer_age,
    extract(epoch from clock_timestamp()-$2::timestamptz)::float8 precise_age,
    $3::timestamptz=date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01') slot_matches`,
  [input.issuedAt,new Date(input.issuedAt*1000).toISOString(),input.scheduledSlot]);
  assert.equal(h.effects.rpcs.filter(r=>r.name==='agent_pulse_claim_dispatch').length,1);
  assert.equal(timing.integer_age,600); assert.equal(timing.precise_age,600.5); assert.equal(timing.slot_matches,true);
  t.diagnostic(JSON.stringify({...timing,http_status:result.status,events:(await h.snapshot()).events,provider_calls:h.effects.provider}));
  assert.deepEqual(result,{status:200,body:{accepted:true,outcome:'disabled',claimedCount:0,processedCount:0}});
  assert.equal((await h.snapshot()).events,1);
  assert.deepEqual(await h.sql('select public.agent_pulse_claim_dispatch($1,$2,$3,$4) r',
    [input.scheduledSlot,input.nonce,new Date(input.issuedAt*1000).toISOString(),false]),
  {slot:input.scheduledSlot.replace('.000Z','.000000Z'),replay:true,outcome:'disabled',claimCount:0,claims:[]});
});
for (const [name,delta,accepted] of [['age601',-601,false],['future60',60,true],['future61',61,false]]) test(`actual route integer freshness ${name} at +500ms`,async t => {
  const h = await routeHarness(t), input = await h.identity();
  const seconds = Number((await h.one('select floor(extract(epoch from clock_timestamp()))::bigint seconds')).seconds);
  t.mock.method(Date,'now',() => seconds*1000+500);
  input.issuedAt = seconds+delta;
  const result = await h.invoke(input);
  if (accepted) {
    assert.deepEqual(result,{status:200,body:{accepted:true,outcome:'disabled',claimedCount:0,processedCount:0}});
    assert.equal((await h.snapshot()).events,1); assert.equal(h.effects.rpcs.filter(r=>r.name==='agent_pulse_claim_dispatch').length,1);
  } else {
    assert.deepEqual(result,{status:400,body:{error:{code:'INVALID_REQUEST'}}});
    assert.equal((await h.snapshot()).events,0); assert.equal(h.effects.rpcs.length,0); assert.equal(h.effects.clients,0);
  }
  assert.equal((await h.snapshot()).pulses,0); assert.equal(h.effects.provider,0);
});
test('actual route enabled empty slot remains empty after later owner eligibility', async t => {
  const h = await routeHarness(t); process.env.AGENT_PULSE_ENABLED = 'true'; const input = await h.identity();
  assert.deepEqual(await h.invoke(input),{status:200,body:{accepted:true,outcome:'empty',claimedCount:0,processedCount:0}});
  await h.enable(); const before = await h.snapshot();
  assert.deepEqual(await h.invoke({...input,nonce:randomUUID()}),{status:200,body:{accepted:true,outcome:'recovered',claimedCount:0,processedCount:0}});
  assert.deepEqual(await h.snapshot(),before); assert.equal(h.effects.provider,0);
});
test('actual route enabled normal batch, same/different nonce and deleted owners admit no replacements', async t => {
  const h = await routeHarness(t); process.env.AGENT_PULSE_ENABLED = 'true'; await h.enable(); await h.enable(h.other);
  const input = await h.identity(), initial = await h.invoke(input);
  assert.deepEqual(initial,{status:200,body:{accepted:true,outcome:'claimed',claimedCount:2,processedCount:2}});
  const first = await h.snapshot(); assert.equal(first.events,1); assert.equal(first.pulses,2);
  for (const nonce of [input.nonce,randomUUID()]) {
    const replay = await h.invoke({...input,nonce}); assert.equal(replay.body.outcome,'recovered'); assert.equal(replay.body.claimedCount,2);
  }
  assert.deepEqual(await h.snapshot(),first);
  await h.db.query('delete from auth.users where id=any($1::uuid[])',[[h.owner,h.other]]);
  const replacement = randomUUID(); await h.db.query('insert into auth.users(id) values($1)',[replacement]); await h.enable(replacement);
  const afterDelete = await h.snapshot();
  assert.deepEqual(await h.invoke({...input,nonce:randomUUID()}),{status:200,body:{accepted:true,outcome:'recovered',claimedCount:2,processedCount:0}});
  assert.deepEqual(await h.snapshot(),afterDelete); assert.equal(h.effects.provider,0);
});
test('actual route hides database/bootstrap exceptions and never logs auth material', async t => {
  env(t,{AGENT_PULSE_SCHEDULER_SECRET:secret,AGENT_PULSE_ENABLED:'true'});
  const effects = {clients:0}; let logs = 0;
  for (const name of ['log','warn','error']) t.mock.method(console,name,() => {logs++;});
  const client = {rpc:async () => {throw new Error('PRIVATE_SQL '+secret);}};
  const route = loadRoute(client,effects);
  const input = {...canonical,scheduledSlot:new Date(Math.floor(Date.now()/14_400_000)*14_400_000).toISOString(),issuedAt:Math.floor(Date.now()/1000)};
  const response = await route.POST(request(input)); assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:{code:'SCHEDULER_UNAVAILABLE'}}); assert.equal(logs,0);
});
test('actual route Node/dynamic/maxDuration, automatic Next methods and no cache', async () => {
  const effects = {clients:0}, route = loadRoute({rpc:async () => assert.fail('No method may reach SQL')},effects);
  assert.equal(route.runtime,'nodejs'); assert.equal(route.dynamic,'force-dynamic'); assert.equal(route.maxDuration,60);
  assert.deepEqual(Object.keys(route).sort(),['POST','dynamic','maxDuration','runtime'].sort());
  const {autoImplementMethods} = require('next/dist/server/route-modules/app-route/helpers/auto-implement-methods');
  const methods = autoImplementMethods(route);
  for (const method of ['GET','HEAD','PUT','PATCH','DELETE']) assert.equal((await methods[method](request(canonical,{method}))).status,405);
  const options = await methods.OPTIONS(request(canonical,{method:'OPTIONS'})); assert.equal(options.status,204); assert.equal(options.headers.get('Allow'),'OPTIONS, POST');
  assert.equal(effects.clients,0);
});
test('scheduler and route runtime graph has only approved fixed capabilities', async () => {
  await scheduler(); const seen = new Set();
  const allowed = new Set(['app/api/internal/agent/pulse/route.ts','lib/ai/agent/pulse/scheduler.ts','lib/ai/agent/pulse/engine.ts',
    'lib/ai/agent/pulse/db.ts','lib/ai/agent/pulse/scanner.ts','lib/ai/agent/pulse/policy.ts','lib/ai/agent/pulse/signals.ts',
    'lib/ai/agent/pulse/fingerprints.ts','lib/ai/agent/pulse/completeness.ts','lib/ai/agent/pulse/privacy.ts','lib/ai/agent/pulse/gemini.ts',
    'lib/ai/agent/date-scheduling.ts','lib/calendar/date.ts','lib/calendar/time-zone.ts','lib/calendar/scheduling.ts',
    'lib/supabase/admin.ts','lib/supabase/env.ts','data/workspaceCalendar.ts','data/timeBlocks.ts','lib/ai/config.ts']);
  function walk(file) {
    if (seen.has(file)) return; seen.add(file);
    const relative = file.slice(root.length+1).replaceAll('\\','/'); assert.ok(allowed.has(relative),'Unexpected runtime module: '+relative);
    const source = ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
      const name = node.moduleSpecifier.text;
      if (relative.endsWith('/scheduler.ts')) assert.ok(name === 'node:crypto','Parser must remain pure');
      if (name.startsWith('@/') || name.startsWith('.')) walk(name.startsWith('@/') ? resolve(root,name.slice(2)+'.ts') : resolve(dirname(file),name+'.ts'));
      else assert.ok(['node:crypto','server-only','@google/genai','@supabase/supabase-js'].includes(name),'Unexpected external capability: '+name);
    }
    if (relative === 'app/api/internal/agent/pulse/route.ts') {
      const raw = source.text; assert.doesNotMatch(raw,/\.from\(|\.rpc\(|cookies\(|requireAuthenticated|console\.|fetch\(/);
      assert.match(raw,/processingEnabled:/); assert.match(raw,/createPulseRepository\(getSupabaseAdminClient\(\)\)/);
      assert.ok(raw.indexOf('await parseSchedulerRequest') < raw.indexOf('createPulseRepository(getSupabaseAdminClient())'));
    }
  }
  walk(resolve(root,'app/api/internal/agent/pulse/route.ts'));
});
