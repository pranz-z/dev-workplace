import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPulse,makeSource,project,task} from './phase5d-test-support.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const token='a'.repeat(64),owner=id(1),projectId=id(2),parentId=id(4),taskId=id(3);
function setup(){
 const source=makeSource({userId:owner,evaluatedAt:'2026-11-01T08:00:05Z',settingsRevision:1,
  projects:[project({id:projectId,userId:owner,title:'Authorized project',sourceToken:token})],
  tasks:[task({id:taskId,userId:owner,projectId,title:'Authorized task',sourceToken:token,dueDate:'2026-11-01'})]});
 const parent={key:`task:${taskId}:attention`,target:{type:'task',id:taskId},family:'deadline',truth:'true',complete:true,
  reasonCodes:['DEADLINE_TODAY'],materialFingerprint:'b'.repeat(64),sourceToken:token,evidenceValidUntil:'2026-11-02T00:00:00Z',
  evidence:{title:'Authorized task',summary:'Deadline today.',explanation:'Recorded facts.',evaluatedAt:source.evaluatedAt,date:'2026-11-01'},
  importance:'high',rank:0,deadline:'2026-11-01',priority:'High',parentId,parentEpisode:1,state:'active',seen:false,
  lastCheckedAt:source.evaluatedAt,contentRevision:1,attemptCount:0,attemptTerminal:false};
 const authorization={id:id(5),ownerId:owner,projectId,parentId,contentRevision:1,episode:1,family:'deadline',sourceToken:token,
  provider:'gemini',model:'fixture-model',slot:'2026-11-01T08:00:00Z',expiresAt:'2026-11-01T08:10:00Z',
  contextPolicyVersion:'one-shot-v1',authorizationVersion:'one-shot-v1',settingsRevision:1,contextFingerprint:''};
 const context=api.buildOneShotContext(source,[parent],authorization,{configured:true,provider:'gemini',model:'fixture-model'},'preview');
 assert.equal(context.ok,true);authorization.contextFingerprint=api.oneShotFingerprint(context.context.contents);
 return {source,parent,authorization};
}
const api=await loadPulse('lib/ai/agent/pulse/one-shot.ts');
const provider={configured:true,provider:'gemini',model:'fixture-model'};
test('exact serializer sends only authorized parent and requires no persistent consent',()=>{
 const f=setup(),other={...f.parent,parentId:id(6),key:`task:${id(7)}:attention`,target:{type:'task',id:id(7)},evidence:{get title(){throw Error('Sibling read');}}};
 f.source.tasks.push(task({id:id(7),userId:owner,projectId,title:'Unrelated sibling one',sourceToken:token,dueDate:'2026-11-01'}),task({id:id(8),userId:owner,projectId,title:'Unrelated sibling two',sourceToken:token,dueDate:'2026-11-01'}));
 const r=api.buildOneShotContext(f.source,[other,{...other,parentId:id(9),key:`task:${id(8)}:attention`,target:{type:'task',id:id(8)}},f.parent],f.authorization,provider);
 assert.equal(r.ok,true);const body=JSON.parse(r.context.contents);assert.equal(body.signals.length,1);
 assert.equal(body.signals[0].title,'Authorized task');assert.equal(r.context.parentId,parentId);
 assert.doesNotMatch(r.context.contents,/00000000|sourceToken|Sibling|sibling|description|objective/);
});
for(const [name,mutate] of [
 ['owner',f=>{f.authorization.ownerId=id(9);}],['project',f=>{f.authorization.projectId=id(9);}],
 ['parent',f=>{f.authorization.parentId=id(9);}],['revision',f=>{f.parent.contentRevision=2;}],
 ['episode',f=>{f.parent.parentEpisode=2;}],['family',f=>{f.authorization.family='quiet_project';}],
 ['source token',f=>{f.parent.sourceToken='c'.repeat(64);}],['seen',f=>{f.parent.seen=true;}],
 ['resolved',f=>{f.parent.state='resolved';}],['attempt terminal',f=>{f.parent.attemptTerminal=true;}],
 ['attempt limit',f=>{f.parent.attemptCount=2;}],['incomplete',f=>{f.parent.complete=false;}],
 ['false truth',f=>{f.parent.truth='false';}],['pre slot',f=>{f.source.evaluatedAt='2026-11-01T07:59:59Z';}],
 ['later slot',f=>{f.source.evaluatedAt='2026-11-01T12:00:00Z';}],
 ['expiry equality',f=>{f.source.evaluatedAt=f.authorization.expiresAt;}],
 ['parent expiry equality',f=>{f.parent.evidenceValidUntil=f.source.evaluatedAt;}],
 ['context fingerprint',f=>{f.authorization.contextFingerprint='f'.repeat(64);}],
 ['policy',f=>{f.authorization.contextPolicyVersion='other';}],
])test('exact context rejects '+name,()=>{const f=setup();mutate(f);assert.equal(api.buildOneShotContext(f.source,[f.parent],f.authorization,provider).ok,false);});
test('model mismatch and unconfigured provider are rejected',()=>{
 const f=setup();for(const p of [{...provider,model:'other'},{...provider,configured:false},{...provider,provider:'other'}])
  assert.equal(api.buildOneShotContext(f.source,[f.parent],f.authorization,p).ok,false);
});
test('preview permits future binding but execution does not',()=>{
 const f=setup();f.source.evaluatedAt='2026-11-01T07:30:00Z';f.parent.lastCheckedAt=f.source.evaluatedAt;
 assert.equal(api.buildOneShotContext(f.source,[f.parent],f.authorization,provider,'preview').ok,true);
 assert.equal(api.buildOneShotContext(f.source,[f.parent],f.authorization,provider).ok,false);
});
test('execution requires a committed context fingerprint',()=>{const f=setup();f.authorization.contextFingerprint='';assert.equal(api.buildOneShotContext(f.source,[f.parent],f.authorization,provider).ok,false);});
test('important-work exact context requires complete owned calendar relationships',()=>{
 const f=setup();f.parent.family='important_work';f.parent.reasonCodes=['IMPORTANT_NO_WORK'];f.authorization.family='important_work';
 f.source.taskBlocks[taskId]={coverage:{complete:true},sourceToken:token,blocks:[]};f.authorization.contextFingerprint='';
 const p=api.buildOneShotContext(f.source,[f.parent],f.authorization,provider,'preview');assert.equal(p.ok,true);
 f.authorization.contextFingerprint=api.oneShotFingerprint(p.context.contents);assert.equal(api.buildOneShotContext(f.source,[f.parent],f.authorization,provider).ok,true);
 assert.equal(JSON.parse(p.context.contents).signals[0].facts.qualifyingScheduledWork,false);
 f.source.taskBlocks[taskId].coverage.complete=false;assert.equal(api.buildOneShotContext(f.source,[f.parent],f.authorization,provider).ok,false);
});
test('quiet-project exact context contains only verified elapsed-activity facts',()=>{
 const f=setup();f.parent.family='quiet_project';f.parent.reasonCodes=['PROJECT_QUIET'];f.parent.target={type:'project',id:projectId};f.parent.key=`project:${projectId}:quiet_project`;f.authorization.family='quiet_project';
 f.source.projectActivity[projectId]={coverage:{complete:true},lastActivityAt:'2026-09-01T00:00:00Z',invalidActivity:false,sourceToken:token};f.authorization.contextFingerprint='';
 const p=api.buildOneShotContext(f.source,[f.parent],f.authorization,provider,'preview');assert.equal(p.ok,true);
 f.authorization.contextFingerprint=api.oneShotFingerprint(p.context.contents);assert.equal(api.buildOneShotContext(f.source,[f.parent],f.authorization,provider).ok,true);
 const signal=JSON.parse(p.context.contents).signals[0];assert.equal(signal.type,'project');assert.equal(signal.facts.thresholdDays,14);assert.equal(signal.date,undefined);
 f.source.projectActivity[projectId].invalidActivity=true;assert.equal(api.buildOneShotContext(f.source,[f.parent],f.authorization,provider).ok,false);
});
