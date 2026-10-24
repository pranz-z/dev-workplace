import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import { loadPulse, makeSource, project, task } from './phase5d-test-support.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=id(1), projectId=id(2), taskId=id(3), token='a'.repeat(64);
let privacyModule;
const api=()=>privacyModule??=loadPulse('lib/ai/agent/pulse/privacy.ts');
function source() {return makeSource({userId:owner,evaluatedAt:'2026-10-16T08:00:00Z',projects:[project({id:projectId,userId:owner,title:'Selected project',sourceToken:token})],
  tasks:[task({id:taskId,userId:owner,projectId,title:'Review parser',sourceToken:token,dueDate:'2026-10-16'})],
  coverage:{projects:{complete:true},tasks:{complete:true},milestones:{complete:true},blocks:{complete:true}},
  taskBlocks:{[taskId]:{coverage:{complete:true},sourceToken:token,blocks:[]}},tomorrowSourceToken:token});}
const settings=changes=>({mode:'workspace_ai',checksConsented:true,aiConsented:true,aiEligible:true,settingsRevision:1,policyVersion:'pulse-v1',aiProjectIds:[projectId],...changes});
function candidate(changes={}) {return {key:`task:${taskId}:attention`,target:{type:'task',id:taskId},family:'deadline',truth:'true',complete:true,reasonCodes:['DEADLINE_TODAY'],
  materialFingerprint:'b'.repeat(64),sourceToken:token,evidenceValidUntil:'2026-10-17T00:00:00Z',evidence:{title:'Review parser',summary:'Safe summary',explanation:'Recorded facts',evaluatedAt:'2026-10-16T08:00:00Z',date:'2026-10-16'},
  importance:'high',rank:0,deadline:'2026-10-16',priority:'High',parentId:id(4),parentEpisode:1,state:'active',seen:false,lastCheckedAt:'2026-10-16T08:00:00Z',...changes};}
const build=async(s=source(),c=[candidate()],p=settings())=>(await api()).buildProactiveContext(s,c,p);
const context=result=>{assert.equal(result.ok,true);return result.context;};
const body=result=>JSON.parse(context(result).contents);

test('manual_consent_does_not_enable_proactive',async()=>assert.equal((await build(undefined,undefined,{...settings(),mode:'workspace',aiConsented:false,manualConsent:true})).ok,false));
test('workspace_mode_makes_no_provider_context',async()=>assert.equal((await build(undefined,undefined,settings({mode:'workspace'}))).ok,false));
test('off_mode_makes_no_provider_context',async()=>assert.equal((await build(undefined,undefined,settings({mode:'off'}))).ok,false));
test('workspace_ai_requires_current_separate_consent',async()=>{for(const p of [{aiConsented:false},{checksConsented:false},{aiEligible:false},{aiConsentVersion:'ai-v0'},{policyVersion:'pulse-v0'},{settingsRevision:2}])assert.equal((await build(undefined,undefined,settings(p))).ok,false);});
test('empty_scope_sends_nothing',async()=>assert.equal((await build(undefined,undefined,settings({aiProjectIds:[]}))).ok,false));
test('twenty_project_scope_limit',async()=>{
  const s=source();s.projects=Array.from({length:20},(_,n)=>project({id:n===0?projectId:id(n+20),userId:owner,sourceToken:token}));
  assert.equal((await build(s,undefined,settings({aiProjectIds:s.projects.map(p=>p.id)}))).ok,true);
  assert.equal((await build(s,undefined,settings({aiProjectIds:[...s.projects.map(p=>p.id),id(90)]}))).ok,false);
  assert.equal((await build(s,undefined,settings({aiProjectIds:[projectId,projectId]}))).ok,false);
});
test('removed_or_foreign_project_excluded',async()=>{
  for(const s of [Object.assign(source(),{projects:[]}),Object.assign(source(),{projects:[project({id:projectId,userId:id(99),sourceToken:token})]})])assert.equal((await build(s)).ok,false);
  const s=source();s.tasks[0].userId=id(99);assert.equal((await build(s)).ok,false);
});
test('scope_never_broadens_from_child_links',async()=>{
  const s=source();s.projects.push(project({id:id(20),userId:owner,title:'Unselected',sourceToken:token}));s.tasks[0].projectId=id(20);
  assert.equal((await build(s)).ok,false);
});
test('prohibited_fields_never_copied',async()=>{
  const s=source(),c=candidate();const forbidden=['notes','files','sourceCode','repository','commitMessages','githubActivity','description','currentObjective','nextAction','prompt','response','agent_runs','before_state','auth','email','serviceRole','leaseToken','reservationKey','ledger','reasoning'];
  for(const key of forbidden){Object.defineProperty(s,key,{get(){throw new Error('Forbidden source field read: '+key);},enumerable:true});Object.defineProperty(s.tasks[0],key,{get(){throw new Error('Forbidden task field read: '+key);},enumerable:true});Object.defineProperty(c.evidence,key,{get(){throw new Error('Forbidden evidence field read: '+key);},enumerable:true});}
  const text=context(await build(s,[c])).contents;assert.doesNotMatch(text,/before_state|reasoning|description|repository|serviceRole|leaseToken/);
});
test('secret_title_rejected',async()=>{
  for(const title of ['Bearer abcdefghijklmnop1234','api_key=super-secret-value','-----BEGIN PRIVATE KEY-----','ghp_'+'a'.repeat(36),'github_pat_'+'a'.repeat(35),'sk-proj-'+'a'.repeat(30),'AIza'+'a'.repeat(35),'sb_secret_'+'a'.repeat(30),'SUPABASE_SERVICE_ROLE_KEY = sensitive-value','email me at private@example.com']){
    const s=source();s.tasks[0].title=title;assert.equal((await build(s)).ok,false,title.slice(0,12));
  }
});
test('secret_project_label_rejected',async()=>{const s=source();s.projects[0].title='password = hidden-password';assert.equal((await build(s)).ok,false);});
test('secret_guard_runs_before_title_truncation',async()=>{const s=source();s.tasks[0].title='x'.repeat(150)+' Bearer abcdefghijklmnop';assert.equal((await build(s)).ok,false);});
test('utf8_12kb_includes_instructions_and_schema',async()=>{
  const {proactiveInputBudget}=await api(),contents=context(await build()).contents,schema={type:'object',properties:{title:{type:'string'}}};
  const base=proactiveInputBudget(contents,'',schema);const exact=proactiveInputBudget(contents,'x'.repeat(12288-base.bytes),schema);assert.equal(exact.bytes,12288);assert.equal(exact.allowed,true);
  assert.equal(proactiveInputBudget(contents,'x'.repeat(12289-base.bytes),schema).allowed,false);
  assert.equal(proactiveInputBudget(contents,'😀'.repeat(4000),schema).allowed,false);
});
test('three_signals_max',async()=>{
  const s=source(),items=[];for(let i=0;i<5;i++){const tid=id(i+40);s.tasks.push(task({id:tid,userId:owner,projectId,sourceToken:token,dueDate:'2026-10-16'}));items.push(candidate({key:`task:${tid}:attention`,target:{type:'task',id:tid},parentId:id(i+50)}));}
  assert.equal(body(await build(s,items)).signals.length,3);
});
test('uuid_aliases_ephemeral',async()=>{
  const s=source(),before=JSON.stringify(s),ctx=context(await build(s));assert.equal(ctx.primaryAlias,'T1');assert.deepEqual(ctx.aliases.T1,{type:'task',id:taskId});assert.deepEqual(ctx.aliases.P1,{type:'project',id:projectId});
  assert.doesNotMatch(ctx.contents,/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i);assert.equal(JSON.stringify(s),before);
  assert.equal(context(await build()).primaryAlias,'T1');
});
test('primary_pinned_and_supporting_alias_cannot_replace_it',async()=>{
  const s=source(),tid=id(8);s.tasks.push(task({id:tid,userId:owner,projectId,sourceToken:token,dueDate:'2026-10-17'}));
  const primary=candidate(),support=candidate({target:{type:'task',id:tid},key:`task:${tid}:attention`,rank:3,deadline:'2026-10-17',reasonCodes:['DEADLINE_SOON'],parentId:id(9)});
  const ctx=context(await build(s,[support,primary]));assert.equal(ctx.parentId,primary.parentId);assert.equal(ctx.primaryAlias,'T1');
  const {isProactiveSelection}=await api();assert.equal(isProactiveSelection(ctx,'T1','review_deadline'),true);assert.equal(isProactiveSelection(ctx,'T2','review_deadline'),false);
});
test('allowed_categories_derive_only_from_primary_reason_codes',async()=>{
  const ctx=context(await build(undefined,[candidate({reasonCodes:['DEADLINE_TODAY','IMPORTANT_NO_WORK'],ideaCategory:'delete_task'})]));assert.deepEqual(ctx.allowedCategories,['review_deadline','consider_scheduling']);
  const {isProactiveSelection}=await api();assert.equal(isProactiveSelection(ctx,ctx.primaryAlias,'delete_task'),false);assert.equal(isProactiveSelection(ctx,ctx.primaryAlias,'review_quiet_project'),false);
});
test('unsupported_family_and_incompatible_reason_are_rejected',async()=>{
  for(const patch of [{family:'plan_items'},{family:'quiet_project'},{reasonCodes:['ARBITRARY']},{reasonCodes:['PROJECT_QUIET']}])assert.equal((await build(undefined,[candidate(patch)])).ok,false);
});
test('server_authority_never_enters_provider_serialization',async()=>{
  const c=candidate(),ctx=context(await build(undefined,[c]));assert.equal(ctx.parentId,c.parentId);assert.equal(ctx.parentEpisode,1);assert.equal(ctx.sourceToken,token);assert.equal(ctx.evidenceValidUntil,c.evidenceValidUntil);
  for(const value of [owner,projectId,taskId,c.parentId,token,c.materialFingerprint])assert.equal(ctx.contents.includes(value),false);
  assert.doesNotMatch(ctx.contents,/parentId|parentEpisode|sourceToken|evidenceValidUntil|lease|fence|aliases|owner/i);
});
test('equivalent_input_order_is_deterministic',async()=>{
  const s=source(),tid=id(8);s.tasks.push(task({id:tid,userId:owner,projectId,sourceToken:token,dueDate:'2026-10-16'}));const candidates=[candidate(),candidate({key:`task:${tid}:attention`,target:{type:'task',id:tid},parentId:id(9)})];
  const a=context(await build(s,candidates));const b=context(await build({...s,tasks:[...s.tasks].reverse(),projects:[...s.projects].reverse()},[...candidates].reverse()));assert.equal(a.contents,b.contents);assert.deepEqual(a.aliases,b.aliases);
});
test('Unicode_title_truncates_by_code_point_and_counts_bytes',async()=>{
  const s=source();s.tasks[0].title='😀'.repeat(121);const ctx=context(await build(s));assert.equal(Array.from(JSON.parse(ctx.contents).signals[0].title).length,120);
  const {proactiveInputBudget}=await api(),budget=proactiveInputBudget(ctx.contents,'',{});assert.ok(budget.bytes>ctx.contents.length);assert.equal(budget.allowed,true);
});
test('empty_invalid_and_identity_bearing_titles_are_omitted',async()=>{
  for(const title of ['', '   ',null,42,owner,token]){const s=source();s.tasks[0].title=title;assert.equal((await build(s)).ok,false);}
});
test('stale_source_parent_and_suppression_fail_closed',async()=>{
  for(const patch of [{sourceToken:'c'.repeat(64)},{evidenceValidUntil:'2026-10-16T08:00:00Z'},{complete:false},{truth:'unknown'},{state:'dismissed'},{state:'snoozed'},{seen:true},{parentId:undefined},{parentEpisode:0},{lastCheckedAt:'2026-10-15T08:00:00Z'}])assert.equal((await build(undefined,[candidate(patch)])).ok,false);
});
test('allowedFacts_are_only_minimized_literal_facts',async()=>{
  const ctx=context(await build());assert.equal(ctx.allowedFacts.has('2026-10-16'),true);assert.equal(ctx.allowedFacts.has('High'),true);assert.equal(ctx.allowedFacts.has('2030-01-01'),false);assert.equal(ctx.allowedFacts.has(owner),false);assert.equal(ctx.allowedFacts.has(token),false);
  for(const fact of ctx.allowedFacts)assert.ok(ctx.contents.includes(JSON.stringify(fact).slice(1,-1)));
});
async function tomorrowFixture(selected=5,other=5) {
  const s=source();s.tasks=[];s.projects.push(project({id:id(20),userId:owner,title:'Not selected',sourceToken:token}));
  for(let i=0;i<selected+other;i++)s.tasks.push(task({id:id(100+i),userId:owner,projectId:i<selected?projectId:id(20),dueDate:'2026-10-17',sourceToken:token}));
  const {evaluateTomorrow}=await loadPulse('lib/ai/agent/pulse/signals.ts');const d=evaluateTomorrow(s)[0];return {s,c:{...d,parentId:id(7),parentEpisode:1,state:'active',seen:false,lastCheckedAt:s.evaluatedAt}};
}
test('tomorrow_scope_is_not_whole_workspace',async()=>{const {s,c}=await tomorrowFixture();const signal=body(await build(s,[c])).signals[0];assert.equal(signal.facts.taskCount,5);assert.notEqual(signal.facts.taskCount,10);assert.equal(signal.title,'Tomorrow workload review');});
test('out_of_scope_workload_cannot_create_a_scoped_signal',async()=>{const {s,c}=await tomorrowFixture(1,9);assert.equal((await build(s,[c])).ok,false);});
test('incomplete_scoped_tomorrow_fails_closed',async()=>{for(const collection of ['projects','tasks','milestones','blocks']){const {s,c}=await tomorrowFixture();s.coverage[collection]={complete:false};assert.equal((await build(s,[c])).ok,false);}});
test('scoped_occupancy_excludes_unselected_project_blocks',async()=>{
  const {s,c}=await tomorrowFixture();s.preferences={workdayStart:'09:00',workdayEnd:'17:00',weekdays:[0,1,2,3,4,5,6],focusMinutes:60,bufferMinutes:0};
  s.blocks=[{id:id(200),userId:owner,projectId,taskId:null,kind:'focus',status:'scheduled',startAt:'2026-10-17T09:00:00Z',endAt:'2026-10-17T10:00:00Z'},
    {id:id(201),userId:owner,projectId:id(20),taskId:null,kind:'custom',status:'scheduled',startAt:'2026-10-17T10:00:00Z',endAt:'2026-10-17T17:00:00Z'}];
  const signal=body(await build(s,[c])).signals[0];assert.equal(signal.facts.occupancyPercent,12.5);assert.deepEqual(signal.reasonCodes,['TOMORROW_DEADLINES']);
});
test('privacy_import_graph_has_no_provider_database_or_mutation_capability',async()=>{
  await api();const visited=new Set();
  function inspect(file){if(visited.has(file))return;visited.add(file);const text=readFileSync(file,'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);const runtime=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
    assert.doesNotMatch(runtime,/\bfetch\s*\(|GoogleGenAI|createService|save_agent|apply_agent|cancel_agent|prepare_agent|process\.env|\bconsole\./);
    for(const node of tree.statements){if(!ts.isImportDeclaration(node)||node.importClause?.isTypeOnly)continue;const name=node.moduleSpecifier.text;assert.doesNotMatch(name,/@google|supabase|github|drive|privacy-provider|\/db$|\/gemini$|\/engine$|\/scheduler$/i);if(name.startsWith('.'))inspect(resolve(dirname(file),name+'.ts'));else if(name.startsWith('@/'))inspect(resolve(name.slice(2)+'.ts'));else assert.equal(name,'node:crypto');}}
  inspect(resolve('lib/ai/agent/pulse/privacy.ts'));assert.ok(visited.size>0);
});

test('missing_tomorrow_coverage_is_not_complete',async()=>{const {s,c}=await tomorrowFixture();delete s.coverage.blocks;assert.equal((await build(s,[c])).ok,false);});
test('incomplete_current_task_relationship_cannot_assert_missing_work',async()=>{
  for(const relation of [undefined,{coverage:{complete:false},sourceToken:token,blocks:[]}]){const s=source();s.taskBlocks[taskId]=relation;assert.equal((await build(s,[candidate({reasonCodes:['IMPORTANT_NO_WORK']})])).ok,false);}
});
test('new_qualifying_block_withdraws_missing_work_context',async()=>{const s=source();s.taskBlocks[taskId].blocks=[{id:id(60),userId:owner,projectId,taskId,kind:'task',status:'scheduled',startAt:'2026-10-16T10:00:00Z',endAt:'2026-10-16T11:00:00Z'}];assert.equal((await build(s,[candidate({reasonCodes:['IMPORTANT_NO_WORK']})])).ok,false);});
test('invalid_calendar_zone_produces_a_safe_skip',async()=>{const s=source();s.timeZone='Invalid/Zone';assert.equal((await build(s)).ok,false);});
test('milestone_context_has_only_current_owned_project_facts',async()=>{
  const s=source(),mid=id(30);s.milestones=[{id:mid,userId:owner,projectId,title:'Release candidate',status:'pending',targetDate:'2026-10-16',sourceToken:token}];
  const c=candidate({key:`milestone:${mid}:deadline`,target:{type:'milestone',id:mid},parentId:id(31)}),ctx=context(await build(s,[c]));
  assert.equal(ctx.primaryAlias,'M1');assert.deepEqual(ctx.allowedCategories,['review_deadline']);assert.equal(JSON.parse(ctx.contents).signals[0].date,'2026-10-16');
  s.milestones[0].projectId=id(99);assert.equal((await build(s,[c])).ok,false);
});
test('quiet_project_context_uses_verified_activity_and_category',async()=>{
  const s=source();s.projects[0].createdAt='2026-08-01T00:00:00Z';s.projects[0].updatedAt='2026-09-01T00:00:00Z';s.projectActivity={[projectId]:{coverage:{complete:true},sourceToken:token,lastActivityAt:'2026-09-02T00:00:00Z',invalidActivity:false}};
  const {evaluateQuietProjects}=await loadPulse('lib/ai/agent/pulse/signals.ts'),d=evaluateQuietProjects(s)[0],c={...d,parentId:id(32),parentEpisode:1,state:'active',seen:false,lastCheckedAt:s.evaluatedAt};
  const ctx=context(await build(s,[c]));assert.equal(ctx.primaryAlias,'P1');assert.deepEqual(ctx.allowedCategories,['review_quiet_project']);assert.equal(JSON.parse(ctx.contents).signals[0].facts.thresholdDays,14);assert.equal(ctx.allowedFacts.has('2026-09-02T00:00:00Z'),true);
  s.projectActivity[projectId].coverage.complete=false;assert.equal((await build(s,[c])).ok,false);
});
test('secret_obfuscation_and_jwt_titles_fail_closed',async()=>{
  for(const value of ['Ｂｅａｒｅｒ abcdefghijklmnop','Bea\u200brer abcdefghijklmnop','eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue','https://name:password@host.example']){const s=source();s.tasks[0].title=value;assert.equal((await build(s)).ok,false);}
});
test('invalid_scoped_block_links_omit_tomorrow_context',async()=>{const {s,c}=await tomorrowFixture();s.blocks=[{id:id(200),userId:owner,projectId,taskId:id(999),kind:'task',status:'scheduled',startAt:'2026-10-17T09:00:00Z',endAt:'2026-10-17T17:00:00Z'}];assert.equal((await build(s,[c])).ok,false);});
test('sensitive_candidate_is_omitted_before_primary_selection',async()=>{
  const s=source(),tid=id(8);s.tasks[0].title='Bearer abcdefghijklmnop';s.tasks.push(task({id:tid,userId:owner,projectId,title:'Safe supporting task',sourceToken:token,dueDate:'2026-10-17'}));
  const safe=candidate({target:{type:'task',id:tid},key:`task:${tid}:attention`,parentId:id(9),rank:3,reasonCodes:['DEADLINE_SOON']});const ctx=context(await build(s,[candidate(),safe]));assert.equal(ctx.parentId,id(9));assert.equal(ctx.primaryAlias,'T1');assert.equal(JSON.parse(ctx.contents).signals.length,1);
});
test('supporting_evidence_caps_context_validity_without_changing_primary',async()=>{
  const s=source(),tid=id(8);s.tasks.push(task({id:tid,userId:owner,projectId,sourceToken:token,dueDate:'2026-10-17'}));
  const support=candidate({key:`task:${tid}:attention`,target:{type:'task',id:tid},parentId:id(9),rank:3,reasonCodes:['DEADLINE_SOON'],evidenceValidUntil:'2026-10-16T08:01:00.000500Z'});
  const ctx=context(await build(s,[candidate({evidenceValidUntil:'2026-10-16T08:01:00.000600Z'}),support]));assert.equal(ctx.parentId,id(4));assert.equal(ctx.evidenceValidUntil,support.evidenceValidUntil);
});
test('privacy_construction_does_not_mutate_inputs',async()=>{
  function freeze(value){if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  assert.equal((await build(freeze(source()),freeze([candidate()]),freeze(settings()))).ok,true);
});
test('invalid_budget_components_fail_closed',async()=>{const {proactiveInputBudget}=await api();for(const args of [[undefined,'',{}],['',undefined,{}],['','',undefined],['','',null],['','',[]]])assert.equal(proactiveInputBudget(...args).allowed,false);});
test('bare_credential_assignments_and_basic_auth_are_rejected',async()=>{for(const value of ['token = sensitive-token','Authorization: Basic dXNlcjpwYXNzd29yZA==']){const s=source();s.tasks[0].title=value;assert.equal((await build(s)).ok,false);}});
test('ordinary_Basic_title_is_not_a_credential',async()=>{const s=source();s.tasks[0].title='Basic parser review';assert.equal((await build(s)).ok,true);});
test('tomorrow_counts_are_explicitly_labeled_as_selected_project_scope',async()=>{const {s,c}=await tomorrowFixture();assert.equal(body(await build(s,[c])).signals[0].scope,'selected_projects');});
