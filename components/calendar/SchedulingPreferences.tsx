"use client";
import {useEffect,useState} from "react";
import {getSchedulingPreferences,saveSchedulingPreferences} from "@/data/timeBlockService";
import type {SchedulingPreferences as Preferences} from "@/data/timeBlocks";
export function SchedulingPreferences() {
  const [value,setValue]=useState<Preferences>({workdayStart:'09:00',workdayEnd:'17:00',weekdays:[1,2,3,4,5],focusMinutes:50,bufferMinutes:10});
  const [message,setMessage]=useState('Loading scheduling preferences…');const [busy,setBusy]=useState(true);const [loaded,setLoaded]=useState(false);
  useEffect(()=>{let active=true;void getSchedulingPreferences().then(saved=>{if(!active)return;if(saved)setValue(saved);setLoaded(true);setMessage(saved?'Saved working hours loaded.':'Suggested values only. Save to enable planning.');}).catch(()=>{if(active)setMessage('Scheduling preferences could not be loaded. Reload before saving.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[]);
  const input='dark-input w-full min-w-0 rounded border border-[var(--edge-cream)] p-2';
  return <details className="dark-panel min-w-0 p-4"><summary className="cursor-pointer font-semibold">Scheduling preferences</summary><form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();if(busy||!loaded)return;setBusy(true);void saveSchedulingPreferences(value).then(result=>setMessage(result.ok?'Scheduling preferences saved.':result.error)).catch(()=>setMessage('Could not save preferences.')).finally(()=>setBusy(false));}}>
    <p className="text-xs">Uses your workspace timezone. Planning requires saved hours or an explicit range.</p>
    <fieldset className="flex flex-wrap gap-3"><legend>Working weekdays</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,index)=><label key={day} className="text-sm"><input type="checkbox" checked={value.weekdays.includes(index)} onChange={e=>setValue({...value,weekdays:e.target.checked?[...value.weekdays,index]:value.weekdays.filter(d=>d!==index)})}/>{day}</label>)}</fieldset>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{(['workdayStart','workdayEnd'] as const).map(key=><label key={key} className="text-sm">{key==='workdayStart'?'Workday start':'Workday end'}<input type="time" required className={input} value={value[key]} onChange={e=>setValue({...value,[key]:e.target.value})}/></label>)}{(['focusMinutes','bufferMinutes'] as const).map(key=><label key={key} className="text-sm">{key==='focusMinutes'?'Default focus minutes':'Buffer minutes'}<input type="number" required min={key==='focusMinutes'?1:0} max={key==='focusMinutes'?180:120} className={input} value={value[key]} onChange={e=>setValue({...value,[key]:Number(e.target.value)})}/></label>)}</div>
    <p role="status" className="text-sm">{message}</p><button disabled={busy||!loaded} className="ink-button primary p-2">Save scheduling preferences</button>
  </form></details>;
}
