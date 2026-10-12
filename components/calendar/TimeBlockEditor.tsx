"use client";
import {useState} from "react";
import type {Project,Task} from "@/types";
import {localDateTime,localTimeToInstant,type WorkspaceTimeBlock,type TimeBlockKind,type TimeBlockStatus} from "@/data/timeBlocks";
import {saveTimeBlock} from "@/data/timeBlockService";

export function TimeBlockEditor({block,date,timeZone,projects,tasks,onSaved,onClose}:{block?:WorkspaceTimeBlock;date:string;timeZone:string;projects:Project[];tasks:Task[];onSaved:()=>void;onClose:()=>void}) {
  const [title,setTitle]=useState(block?.title??'');
  const [start,setStart]=useState(block?localDateTime(block.startAt,timeZone):`${date}T09:00`);
  const [end,setEnd]=useState(block?localDateTime(block.endAt,timeZone):`${date}T10:00`);
  const [projectId,setProjectId]=useState(block?.projectId??'');const [taskId,setTaskId]=useState(block?.taskId??'');
  const [kind,setKind]=useState<TimeBlockKind>(block?.kind??'focus');const [notes,setNotes]=useState(block?.notes??'');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function save(status:TimeBlockStatus=block?.status??'scheduled') {
    if(busy)return;setBusy(true);setError('');
    try {
      const result=await saveTimeBlock({title,startAt:localTimeToInstant(start,timeZone),endAt:localTimeToInstant(end,timeZone),projectId:projectId||null,taskId:taskId||null,kind,status,notes:notes||null},block?.id,block?.updatedAt);
      if(!result.ok){setError(result.error);return;}onSaved();
    }catch(e){setError(e instanceof Error?e.message:'Could not save block.');}finally{setBusy(false);}
  }
  const input='dark-input w-full min-w-0 rounded border border-[var(--edge-cream)] p-2';
  return <section role="dialog" aria-label={block?'Edit time block':'Create time block'} className="dark-panel min-w-0 space-y-3 p-4">
    <h3 className="font-semibold">{block?'Edit time block':'Create time block'}</h3><p className="text-xs t-dark-muted">Times in {timeZone}. Deadlines are separate.</p>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
      <label className="block text-sm">Block title<input required maxLength={180} className={input} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="block text-sm">Start time<input required type="datetime-local" className={input} value={start} onChange={e=>setStart(e.target.value)}/></label><label className="block text-sm">End time<input required type="datetime-local" className={input} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
      <label className="block text-sm">Linked project<select className={input} value={projectId} onChange={e=>{setProjectId(e.target.value);setTaskId('');}}><option value="">No project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block text-sm">Linked task<select className={input} value={taskId} onChange={e=>{setTaskId(e.target.value);const task=tasks.find(t=>t.id===e.target.value);if(task)setProjectId(task.projectId);}}><option value="">No task</option>{tasks.filter(t=>!projectId||t.projectId===projectId).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      <label className="block text-sm">Block kind<select className={input} value={kind} onChange={e=>setKind(e.target.value as TimeBlockKind)}>{['focus','task','break','custom'].map(k=><option key={k}>{k}</option>)}</select></label>
      <label className="block text-sm">Notes<textarea maxLength={4000} className={input} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      {error&&<p role="alert" className="text-sm">{error}</p>}
      <div className="flex flex-wrap gap-2"><button disabled={busy} className="ink-button primary p-2">Save block</button>{block&&block.status!=='cancelled'&&<><button type="button" disabled={busy} className="dark-chip p-2" onClick={()=>void save('completed')}>Mark complete</button><button type="button" disabled={busy} className="dark-chip p-2" onClick={()=>void save('cancelled')}>Cancel block</button></>}<button type="button" disabled={busy} className="dark-chip p-2" onClick={onClose}>Close editor</button></div>
    </form>
  </section>;
}
