import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const file=new URL('./timeBlockService.ts',import.meta.url);
function url(source){return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;}
const helpers=url(ts.transpileModule(readFileSync(new URL('./timeBlocks.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
let source=existsSync(file)?readFileSync(file,'utf8'):'export {}';
source=source.replace(/import .*from ["']@\/data\/context["'];/,'const getWorkspaceContext=()=>globalThis.__blockContext;const isUuid=v=>typeof v==="string"&&/^[0-9a-f-]{36}$/i.test(v);').replace(/import .*from ["']@\/data\/serviceResult["'];/,'const serviceOk=data=>({ok:true,data});const serviceFail=error=>({ok:false,error});');
source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/['"]@\/data\/timeBlocks['"]/g,JSON.stringify(helpers));
const api=await import(url(source));
test('manual block writes reject missing auth and bad ranges without writing',async()=>{
 assert.equal(typeof api.saveTimeBlock,'function');globalThis.__blockContext=null;
 assert.equal((await api.saveTimeBlock({title:'Focus',startAt:'bad',endAt:'bad'})).ok,false);
 let writes=0;globalThis.__blockContext={userId:'owner',supabase:{from(){writes++;throw Error('should not query');}}};
 assert.equal((await api.saveTimeBlock({title:'Focus',startAt:'bad',endAt:'bad'})).ok,false);assert.equal(writes,0);
});
test('bounded range loading scopes user and reports truncation instead of hiding records',async()=>{
 assert.equal(typeof api.listTimeBlocks,'function');const calls=[];
 const q={select(){return this;},eq(...v){calls.push(v);return this;},lt(){return this;},gt(){return this;},order(){return this;},limit(n){calls.push(['limit',n]);return Promise.resolve({data:Array.from({length:501},(_,i)=>({id:String(i),start_at:'2026-10-12T09:00Z',end_at:'2026-10-12T10:00Z'})),error:null});}};
 globalThis.__blockContext={userId:'owner',supabase:{from(){return q;}}};
 const result=await api.listTimeBlocks('2026-10-01T00:00:00Z','2026-11-01T00:00:00Z');
 assert.equal(result.truncated,true);assert.equal(result.items.length,500);assert.ok(calls.some(c=>c[0]==='user_id'&&c[1]==='owner'));assert.ok(calls.some(c=>c[0]==='limit'&&c[1]===501));
});
