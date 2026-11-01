import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import test from 'node:test';import {gzipSync} from 'node:zlib';import ts from 'typescript';
const read=p=>readFile(new URL('../../components/portfolio/'+p,import.meta.url),'utf8');
const bytes=await read('ascii-data/poses.json'),data=JSON.parse(bytes),clip=JSON.parse(await read('ascii-data/animation.json'));
const {PoseBank}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(await read('ascii-pose-bank.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const C=clip.columns,R=clip.rows,at=(x,y)=>Math.round(y*R/105)*C+Math.round(x*C/180);
const native=(frame=0)=>{const g=[];for(const i of clip.frames[frame]){const[t,a,b=a]=clip.runs[i];for(let j=0;j<a.length;j++)if(a[j]!=='\n')g.push(+t|a.charCodeAt(j)<<8|b.charCodeAt(j)<<16)}return Uint32Array.from(g)};
test('combined head/body/arm pose data stays deferred and below60KiB gzip',async()=>{
 assert.ok(gzipSync(bytes).length<=61440);assert.equal(Object.keys(data.poses).filter(k=>k.startsWith('yaw-')).length,15);
 const shell=await read('AsciiCharacterScene.tsx');assert.ok(!shell.includes('poses.json'));assert.ok(shell.includes('import("./ascii-scene-player")'));
 assert.equal(data.poses['right-release-1'],undefined,'rejected upward arm must not ship');
});
test('drawn turn sprites preserve reserved grid, source palette, and visible static props',()=>{
 const bank=new PoseBank(data),source=native();
 for(const side of [-1,1])for(const pitch of [-15,0,15])for(const bodyStep of [1,2,3,4]){
  const grid=source.slice(),head=bank.apply(grid,{active:true,side,bodyStep,headYawKey:side*40,pitchKey:pitch});
  assert.ok(head);assert.equal(grid.length,C*R);assert.equal(head.rows.length,80);
  for(const row of head.rows){assert.equal(row.reduce((n,r)=>n+r[1].length,0),100);for(const[t]of row)assert.ok(t>=0&&t<=32)}
  for(const[x,y]of[[150,55],[115,42],[66,54],[44,80],[90,96]])assert.equal(grid[at(x,y)],source[at(x,y)],`static cell ${x},${y}`);
 }
});
test('inactive following changes nothing and early right release retains keyboard hold',()=>{
 const bank=new PoseBank(data),source=native(),grid=source.slice();assert.equal(bank.apply(grid,{active:false}),undefined);assert.deepEqual(grid,source);
 const early=bank.apply(grid,{active:true,side:1,bodyStep:1,headYawKey:20,pitchKey:0});assert.equal(early.bodyKey,'native');
});
test('right turns replace the old warm sleeve outline with the newly revealed chair',()=>{
 const bank=new PoseBank(data);
 for(const pitch of [-15,0,15])for(const step of [3,4]){
 const grid=native();bank.apply(grid,{active:true,side:1,bodyStep:step,headYawKey:40,pitchKey:pitch});
 // Source-reference chair samples along the vacated sleeve edge, not arbitrary black erasure.
 for(const[x,y]of[[53,32],[52,34],[51,35],[51,38],[52,41],[56,41]]){
  const value=grid[at(x,y)],tone=value&255;
  assert.ok(tone>=20&&tone!==24,`revealed chair cell ${x},${y} retained warm sleeve tone ${tone}`);
 }
 }
});

test('idle art and every drawn torso pose use the same fine cell aspect as the head',()=>{
 assert.deepEqual([clip.columns,clip.rows],[216,168]);
 assert.deepEqual([data.columns,data.rows],[clip.columns,clip.rows]);
 assert.equal((1080/clip.columns)/(1050/clip.rows),(450/data.headColumns)/(450/data.headRows));
 for(const pose of Object.values(data.poses))for(const index of pose.body){
  assert.equal(data.rowPool[index].length,clip.columns);
 }
});

test('left arm release replaces its whole cuff and hand footprint across every typing frame',()=>{
 const bank=new PoseBank(data);
 // Approved source illustrations show revealed wood at these vacated cuff/palm
 // samples. The opposite hand farther right must not be erased to pass this.
 const deskSamples=[[108,75],[109,76],[110,76],[121,71]];
 for(let frame=0;frame<16;frame++)for(const pitch of [-15,0,15])for(const bodyStep of [1,2,3,4]){
  const grid=native(frame);
  bank.apply(grid,{active:true,side:-1,bodyStep,headYawKey:-40,pitchKey:pitch});
  for(const[x,y]of deskSamples){
   const tone=grid[y*C+x]&255;
   assert.ok(tone>=8&&tone<=13,`left release step ${bodyStep}, pitch ${pitch}, native frame ${frame}: cuff/palm remnant at ${x},${y} (tone ${tone})`);
  }
 }
});

test('head-only pitch preserves the illustrated collar and shoulder beneath the neck',()=>{
 const bank=new PoseBank(data);
 // Upward reference: these are sweater/collar cells exposed beside the neck,
 // not head cells to erase. Test every typing frame and each head-leading angle.
 for(let frame=0;frame<16;frame++)for(const pitch of [-15,0,15])for(const yaw of [-20,0,20]){
  const grid=native(frame);bank.apply(grid,{active:true,side:0,bodyStep:0,headYawKey:yaw,pitchKey:pitch});
  for(const[x,y]of [[100,45],[101,45],[99,46],[100,46]]){
   const cell=grid[y*C+x];assert.notEqual((cell>>>8)&255,32,`collar hole ${x},${y} at pitch ${pitch}, yaw ${yaw}, frame ${frame}`);
   assert.ok((cell&255)<8,'source cream knit must remain under the neck');
  }
 }
});
