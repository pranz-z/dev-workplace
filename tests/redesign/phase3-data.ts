import {callService as readService,config,project,tasks} from './matrix-data';
import type {Task} from '@/types';
export function callService(name:string,args:unknown[]) {
  if(config.variant?.startsWith('phase3-ordering')&&name==='loadWorkspaceData')return (readService(name,args) as Promise<{tasks:Task[]}>).then(data=>({...data,tasks:[...data.tasks.map(task=>({...task,sortOrder:1})),{...tasks[0],id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000111',title:'Synthetic second Backlog task',sortOrder:2},...(config.variant==='phase3-ordering-before'?[{...tasks[0],id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000112',title:'Synthetic third Backlog task',sortOrder:3}]:[])]}));
  if(config.variant?.startsWith('phase3-')&&['createProject','updateProject','reorderProjectTasks'].includes(name)){
    window.matrixFixture.calls.push({name,args:structuredClone(args)});
    if(config.variant==='phase3-save-error')return Promise.resolve({ok:false,error:'Synthetic optional project data rejected.'});
    if(name==='reorderProjectTasks')return Promise.resolve({ok:true,data:null});
    const draft=(name==='createProject'?args[0]:args[1]) as Record<string,unknown>;
    return Promise.resolve({ok:true,data:{...project,...draft,id:name==='createProject'?'aaaaaaaa-aaaa-4aaa-8aaa-000000000333':args[0]}});
  }
  return readService(name,args);
}
