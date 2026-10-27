import {config,callService as original} from './matrix-data';
import type {WorkspaceTimeBlock} from '@/data/timeBlocks';
const row:WorkspaceTimeBlock={id:'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',userId:'11111111-1111-4111-8111-111111111111',projectId:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',taskId:'aaaaaaaa-aaaa-4aaa-8aaa-000000000010',title:'Synthetic planned focus block with a descriptive name',startAt:'2026-10-26T02:00:00Z',endAt:'2026-10-26T03:00:00Z',kind:'focus',status:'scheduled',notes:'Synthetic local notes only.',createdAt:'2026-10-26T01:00:00Z',updatedAt:'2026-10-26T01:00:00Z'};
export function callService(name:string,args:unknown[]){
 if(name==='listTimeBlocks'||name==='saveTimeBlock'){
  window.matrixFixture.calls.push({name:`phase7-memory:${name}`,args});
  if(name==='saveTimeBlock')return Promise.resolve({ok:false,error:'Synthetic time-block save failure. No persistence occurred.'});
  if(config.variant==='blocks-loading')return new Promise(()=>{});
  if(config.variant==='blocks-error')return Promise.reject(new Error('Synthetic local time-block read failure'));
  return Promise.resolve({items:[row,{...row,id:'bbbbbbbb-bbbb-4bbb-8bbb-000000000002',title:'Synthetic completed block',kind:'task',status:'completed'},{...row,id:'bbbbbbbb-bbbb-4bbb-8bbb-000000000003',title:'Synthetic cancelled block',kind:'custom',status:'cancelled'}],truncated:false});
 }
 return original(name,args);
}
