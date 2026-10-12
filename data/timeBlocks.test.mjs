import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const file = new URL('./timeBlocks.ts', import.meta.url);
const source = existsSync(file) ? readFileSync(file,'utf8') : 'export {}';
const api = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`);
test('strict local times resolve Manila midnight and UTC',()=>{
  assert.equal(typeof api.localTimeToInstant,'function');
  assert.equal(api.localTimeToInstant('2026-10-12T00:30','Asia/Manila'),'2026-10-11T16:30:00.000Z');
  assert.equal(api.localTimeToInstant('2026-10-12T09:00','UTC'),'2026-10-12T09:00:00.000Z');
});
test('DST gap and fold require clarification; ordinary New York time resolves',()=>{
  assert.equal(typeof api.localTimeToInstant,'function');
  assert.throws(()=>api.localTimeToInstant('2026-03-08T02:30','America/New_York'));
  assert.throws(()=>api.localTimeToInstant('2026-11-01T01:30','America/New_York'));
  assert.equal(api.localTimeToInstant('2026-03-08T03:30','America/New_York'),'2026-03-08T07:30:00.000Z');
});
test('range validation rejects invalid, reversed and excessive blocks',()=>{
  assert.equal(typeof api.validateBlockRange,'function');
  for(const [a,b] of [['2026-02-30T09:00:00Z','2026-03-02T10:00:00Z'],['tomorrow','later'],['2026-10-12T10:00:00Z','2026-10-12T09:00:00Z'],['2026-10-12T09:00:00Z','2026-10-12T09:00:00Z'],['2026-10-12T09:00:00Z','2026-10-12T22:00:00Z']]) assert.throws(()=>api.validateBlockRange(a,b));
  assert.doesNotThrow(()=>api.validateBlockRange('2026-10-12T09:00:00Z','2026-10-12T21:00:00Z'));
});
const prefs={workdayStart:'09:00',workdayEnd:'17:00',weekdays:[1,2,3,4,5],focusMinutes:50,bufferMinutes:10};
const block=(start,end,status='scheduled')=>({startAt:`2026-10-12T${start}:00.000Z`,endAt:`2026-10-12T${end}:00.000Z`,status});
test('availability merges occupancy, applies buffer, ignores cancellations and bounds slots',()=>{
  assert.equal(typeof api.findFreeSlots,'function');
  const slots=api.findFreeSlots({date:'2026-10-12',timeZone:'UTC',preferences:prefs,blocks:[block('10:00','11:00'),block('10:30','12:00'),block('13:00','14:00','cancelled')],durationMinutes:90});
  assert.deepEqual(slots[0],{startAt:'2026-10-12T12:10:00.000Z',endAt:'2026-10-12T13:40:00.000Z'});
  assert.ok(slots.length<=10);
  assert.deepEqual(api.findFreeSlots({date:'2026-10-11',timeZone:'UTC',preferences:prefs,blocks:[],durationMinutes:90}),[]);
  assert.throws(()=>api.findFreeSlots({date:'2026-10-12',timeZone:'UTC',blocks:[],durationMinutes:90}));
});
test('half-open overlap permits adjacent blocks; planning excludes completed and ranks urgency',()=>{
  assert.equal(typeof api.planDay,'function');
  assert.equal(api.blocksOverlap(block('09:00','10:00'),block('10:00','11:00')),false);
  const tasks=[{id:'later',title:'Later',priority:'Critical',dueDate:'2026-10-20',status:'Backlog'},{id:'done',title:'Done',priority:'Critical',dueDate:'2026-10-01',status:'Completed'},{id:'urgent',title:'Urgent',priority:'High',dueDate:'2026-10-10',status:'Backlog'}];
  const result=api.planDay({date:'2026-10-12',timeZone:'UTC',preferences:prefs,blocks:[block('09:00','10:00')],tasks});
  assert.equal(result.items[0].taskId,'urgent');
  assert.equal(result.items[0].startAt,'2026-10-12T10:10:00.000Z');
  assert.equal(result.items.length,2);
  assert.ok(!result.items.some(b=>b.taskId==='done'));
});
for(const [value,zone,want] of [
 ['2026-10-12T09:00','Asia/Manila','2026-10-12T01:00:00.000Z'],
 ['2026-07-01T12:00','America/New_York','2026-07-01T16:00:00.000Z'],
 ['2026-12-01T12:00','America/New_York','2026-12-01T17:00:00.000Z'],
 ['2026-10-12T09:00','Asia/Kathmandu','2026-10-12T03:15:00.000Z'],
])test(`wall-time round trip ${zone} ${value}`,()=>assert.equal(api.localTimeToInstant(value,zone),want));
for(const value of ['2026-02-30T09:00','2026-10-12T24:00','2026-10-12T09:61','2026-1-12T09:00','not a date'])test(`invalid local time rejected: ${value}`,()=>assert.throws(()=>api.localTimeToInstant(value,'UTC')));
test('explicit work range permits planning without saved defaults, but duration remains required',()=>{
 assert.equal(api.findFreeSlots({date:'2026-10-12',timeZone:'UTC',blocks:[],earliestTime:'10:00',latestTime:'12:00',durationMinutes:90})[0].startAt,'2026-10-12T10:00:00.000Z');
 assert.throws(()=>api.planDay({date:'2026-10-12',timeZone:'UTC',blocks:[],earliestTime:'10:00',latestTime:'12:00',tasks:[]}));
});
test('no slot is fabricated when occupied or duration does not fit',()=>{
 for(const blocks of [[block('09:00','17:00')],[block('09:00','16:00')]])assert.deepEqual(api.findFreeSlots({date:'2026-10-12',timeZone:'UTC',preferences:prefs,blocks,durationMinutes:90}),[]);
});
test('cancelled blocks free time and completed blocks still occupy time',()=>{
 assert.equal(api.findFreeSlots({date:'2026-10-12',timeZone:'UTC',preferences:prefs,blocks:[block('09:00','10:00','cancelled')],durationMinutes:50})[0].startAt,'2026-10-12T09:00:00.000Z');
 assert.equal(api.findFreeSlots({date:'2026-10-12',timeZone:'UTC',preferences:prefs,blocks:[block('09:00','10:00','completed')],durationMinutes:50})[0].startAt,'2026-10-12T10:10:00.000Z');
});
test('today scheduling never allocates elapsed time',()=>{
 assert.equal(api.findFreeSlots({date:'2026-10-12',timeZone:'UTC',preferences:prefs,blocks:[],durationMinutes:50,now:new Date('2026-10-12T12:00:01Z')})[0].startAt,'2026-10-12T12:01:00.000Z');
});
test('bounded day plans disclose omitted tasks and never mutate task deadlines',()=>{
 const tasks=Array.from({length:20},(_,i)=>({id:`task-${i}`,title:'Work',status:'Backlog',priority:'Medium',dueDate:'2026-10-20'}));const original=structuredClone(tasks);
 const result=api.planDay({date:'2026-10-12',timeZone:'UTC',preferences:prefs,blocks:[],tasks});
 assert.equal(result.items.length,6);assert.equal(result.truncated,true);assert.equal(result.omittedCount,14);assert.deepEqual(tasks,original);
 for(let i=1;i<result.items.length;i++)assert.equal(api.blocksOverlap(result.items[i-1],result.items[i]),false);
});
test('milestone/project urgency contributes to server ordering',()=>{
 const tasks=[{id:'ordinary',title:'Ordinary',status:'Backlog',priority:'Critical'},{id:'milestone',title:'Milestone',status:'Backlog',priority:'Low',milestoneDate:'2026-10-11'}];
 assert.equal(api.planDay({date:'2026-10-12',timeZone:'UTC',preferences:prefs,blocks:[],tasks}).items[0].taskId,'milestone');
});

test('generated day boundaries tolerate midnight transitions, user inputs stay strict',()=>{
 assert.equal(api.dayBoundaryInstant('2026-11-01','America/Havana'),'2026-11-01T04:00:00.000Z');
 assert.equal(api.dayBoundaryInstant('2026-09-06','America/Santiago'),'2026-09-06T04:00:00.000Z');
 assert.throws(()=>api.localTimeToInstant('2026-11-01T00:00','America/Havana'));
});
test('project priority breaks otherwise equal deterministic task rankings',()=>{
 const tasks=[{id:'a',title:'Low',status:'Backlog',projectPriority:'Low'},{id:'z',title:'High',status:'Backlog',projectPriority:'High'}];
 assert.equal(api.planDay({date:'2026-10-12',timeZone:'UTC',preferences:prefs,blocks:[],tasks}).items[0].taskId,'z');
});
