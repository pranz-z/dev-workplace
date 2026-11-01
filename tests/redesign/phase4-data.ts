import {callService as original,config} from './matrix-data';
import type {Task} from '@/types';
export function callService(name:string,args:unknown[]) {
  if(name==='loadWorkspaceData'&&config.variant==='phase4-loading')return new Promise(()=>{});
  if(name==='loadWorkspaceData'&&config.variant==='phase4-error')return Promise.reject(new Error('Synthetic source failure'));
  if(name==='loadWorkspaceData'&&config.variant?.startsWith('phase4-'))return Promise.resolve(original(name,args) as Promise<{tasks:Task[];[key:string]:unknown}>).then((data)=>{
    if(config.variant==='phase4-no-tasks')return {...data,tasks:[]};
    if(config.variant==='phase4-no-projects')return {...data,projects:[],tasks:[],plans:[],notes:[],technologies:[],milestones:[]};
    if(config.variant==='phase4-overdue')return {...data,tasks:data.tasks.map((task)=>({...task,dueDate:'2026-10-23'}))};
    return data;
  });
  return original(name,args);
}
