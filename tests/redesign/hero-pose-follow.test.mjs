import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../../components/portfolio/ascii-pose-follow.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {PoseFollower}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const enabled={fine:true,mobile:false,reduced:false,paused:false,visible:true,hidden:false,sip:false};
function step(f,from,to,flags=enabled){let state;for(let now=from;now<=to;now+=20)state=f.advance(20,now,flags);return state;}

test('head leads, torso lags, true directional body keys release the look-side arm',()=>{
 const f=new PoseFollower();f.point(-1,0,0);
 const early=step(f,0,140);assert.ok(early.headYaw< -10);assert.equal(early.bodyStep,0,'body must not jump with head');
 const settled=step(f,160,1400);assert.equal(settled.side,-1);assert.equal(settled.bodyStep,4);assert.ok(Math.abs(settled.torsoYaw+20)<1);assert.equal(settled.headYawKey,-40);
 const r=new PoseFollower();r.point(1,0,0);const right=step(r,0,1400);assert.equal(right.side,1);assert.equal(right.bodyStep,4);assert.equal(right.headYawKey,40);
});
test('pitch retains directional arm ownership and center keeps keyboard hands',()=>{
 for(const y of [-1,1]){const f=new PoseFollower();f.point(-1,y,0);const s=step(f,0,1400);assert.equal(s.side,-1);assert.equal(s.pitchKey,y*15)}
 const f=new PoseFollower();f.point(0,-1,0);const s=step(f,0,1400);assert.equal(s.side,0);assert.equal(s.bodyStep,0);assert.equal(s.pitchKey,-15);
});
test('side reversal returns the first hand to keyboard before releasing the opposite arm',()=>{
 const f=new PoseFollower();f.point(-1,0,0);step(f,0,1400);f.point(1,0,1420);const states=[];
 for(let now=1420;now<3000;now+=20)states.push(f.advance(20,now,enabled));
 const right=states.findIndex(s=>s.side===1&&s.bodyStep>0);assert.ok(right>0);assert.ok(states.slice(0,right).some(s=>s.side===0&&s.bodyStep===0));
 assert.equal(states.at(-1).side,1);
});
test('3-second pointer idle and explicit leave return to exact native default',()=>{
 const f=new PoseFollower();f.point(1,0,0);step(f,0,1400);assert.equal(f.advance(20,2900,enabled).active,true);
 const idle=step(f,2920,4500);assert.equal(idle.active,false);assert.equal(idle.bodyStep,0);
 f.point(-1,0,4600);step(f,4600,6000);f.release();const leave=step(f,6020,7600);assert.equal(leave.active,false);assert.equal(leave.bodyStep,0);
});
test('identical pointer coordinates do not extend the attention timeout',()=>{
 const f=new PoseFollower();f.point(1,0,0);step(f,0,1400);f.point(1,0,2900);assert.equal(step(f,1420,4500).active,false);
});
test('every follow eligibility gate and native sip exclude pose ownership',()=>{
 for(const blocked of [{fine:false},{mobile:true},{reduced:true},{visible:false},{hidden:true},{sip:true}]){const f=new PoseFollower();f.point(1,1,0);const s=step(f,0,1400,{...enabled,...blocked});assert.equal(s.active,false,JSON.stringify(blocked));assert.equal(s.bodyStep,0)}
 const f=new PoseFollower();f.point(1,0,0);const a=step(f,0,800);const b=f.advance(1000,1800,{...enabled,paused:true});assert.deepEqual(b,a,'pause holds pose without catch-up');
});
test('dead zone, hysteresis and 10Hz body-swap cap prevent mouse-noise flicker',()=>{
 const f=new PoseFollower();f.point(.04,.04,0);const center=step(f,0,500);assert.equal(center.headYawKey,0);assert.equal(center.bodyStep,0);
 f.point(1,0,520);const changes=[];let prior=0;for(let now=520;now<2000;now+=20){const s=f.advance(20,now,enabled);if(s.bodyStep!==prior){changes.push(now);prior=s.bodyStep}}
 for(let i=1;i<changes.length;i++)assert.ok(changes[i]-changes[i-1]>=100);
 const settled=f.advance(20,2020,enabled);assert.equal(settled.bodyStep,4);
});
test('quantized head changes are capped to at most one per75ms',()=>{
 const f=new PoseFollower(),changes=[];let prior=0;
 for(let now=0;now<=2500;now+=5){f.point(Math.sin(now/80),0,now);const s=f.advance(5,now,enabled);if(s.headYawKey!==prior){changes.push(now);prior=s.headYawKey}}
 for(let i=1;i<changes.length;i++)assert.ok(changes[i]-changes[i-1]>=75,'head swap cap');
});
