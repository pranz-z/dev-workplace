"use client";
import {useEffect,useRef,useState} from 'react';
import {ACTIVITY_STATUSES,STATUS_LABELS,activityDateRange,activityQueryString,type ActivityPage,type AgentActivityRun,type ActivityTarget} from '@/data/agentActivity';
import {localDateTime} from '@/data/timeBlocks';
import type {ProposalBatch} from '@/lib/ai/agent/contract';
import {AgentProposalCards} from '@/components/ai/AgentProposalCards';

interface Props {timeZone:string;entityLabels:Map<string,string>;onReview:(prompt:string)=>void;onNavigate?:(target:ActivityTarget)=>void;onApplied?:()=>Promise<void>}
const empty:ActivityPage={items:[],nextCursor:null};
export function AgentActivity({timeZone,entityLabels,onReview,onNavigate,onApplied}:Props){
 const [page,setPage]=useState<ActivityPage>(empty),[status,setStatus]=useState(''),[period,setPeriod]=useState('7'),[revision,setRevision]=useState(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[runId,setRunId]=useState<string|null>(null),[detail,setDetail]=useState<AgentActivityRun|null>(null),[batch,setBatch]=useState<ProposalBatch|null>(null),[detailBusy,setDetailBusy]=useState(false),[detailError,setDetailError]=useState(''),[detailRevision,setDetailRevision]=useState(0);
 const listAbort=useRef<AbortController|null>(null);
 const stamp=(value:string|null)=>{if(!value)return 'Not recorded';try{return new Intl.DateTimeFormat(undefined,{timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch{return 'Not recorded';}};
 const query=()=>({limit:20,...(status?{status:status as typeof ACTIVITY_STATUSES[number]}:{}),...activityDateRange(period,timeZone)});
 useEffect(()=>{
  const controller=new AbortController();listAbort.current?.abort();listAbort.current=controller;
  void Promise.resolve().then(()=>{if(controller.signal.aborted)return;setLoading(true);setError('');setPage(empty);return fetch(`/api/ai/agent/activity?${activityQueryString({limit:20,...(status?{status:status as typeof ACTIVITY_STATUSES[number]}:{}),...activityDateRange(period,timeZone)})}`,{cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('Agent activity could not be loaded. Try again.');const result=await response.json() as ActivityPage;if(!controller.signal.aborted)setPage(result);}).catch(()=>{if(!controller.signal.aborted)setError('Agent activity could not be loaded. Try again.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});});
  return()=>{controller.abort();listAbort.current?.abort();};
 },[status,period,timeZone,revision]);
 useEffect(()=>{
  const controller=new AbortController();
  void Promise.resolve().then(async()=>{
   if(controller.signal.aborted)return;if(!runId){setDetailBusy(false);setDetailError('');return;}setDetailBusy(true);setDetail(null);setBatch(null);setDetailError('');
   try{const response=await fetch(`/api/ai/agent/activity?runId=${encodeURIComponent(runId)}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error();const result=await response.json() as {run:AgentActivityRun};if(controller.signal.aborted)return;setDetail(result.run);
    if(result.run.counts.pending){const recovered=await fetch(`/api/ai/agent/apply?runId=${encodeURIComponent(runId)}`,{cache:'no-store',signal:controller.signal});if(!recovered.ok)throw new Error();const current=await recovered.json() as {proposalBatch:ProposalBatch};if(!controller.signal.aborted)setBatch(current.proposalBatch);}
   }catch{if(!controller.signal.aborted)setDetailError('Current status could not be confirmed. Refresh status before approving.');}finally{if(!controller.signal.aborted)setDetailBusy(false);}
  });return()=>controller.abort();
 },[runId,detailRevision]);
 async function more(){if(!page.nextCursor||loading)return;const controller=new AbortController();listAbort.current?.abort();listAbort.current=controller;setLoading(true);setError('');try{const response=await fetch(`/api/ai/agent/activity?${activityQueryString({...query(),cursor:page.nextCursor})}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error();const next=await response.json() as ActivityPage;if(!controller.signal.aborted)setPage(old=>({items:[...old.items,...next.items.filter(r=>!old.items.some(existing=>existing.id===r.id))],nextCursor:next.nextCursor}));}catch{if(!controller.signal.aborted)setError('More activity could not be loaded. Try again.');}finally{if(!controller.signal.aborted)setLoading(false);}}
 const counts=ACTIVITY_STATUSES.map(s=>`${page.items.reduce((sum,r)=>sum+r.counts[s],0)} ${STATUS_LABELS[s].toLowerCase()}`).join(' · ');
 function value(field:string,text:string|null){if(text===null)return 'None';if(field==='startAt'||field==='endAt')try{return `${localDateTime(text,timeZone).replace('T',' ')} (${timeZone})`;}catch{return 'Unavailable time';}if(['taskId','projectId','milestoneId'].includes(field))return entityLabels.get(`${field.replace('Id','')}:${text}`)??'Unavailable linked item';return text;}
 return <section aria-label="Agent Activity" className="min-w-0 space-y-3 p-3 text-sm [overflow-wrap:anywhere]">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Agent Activity</h3><button type="button" className="dark-chip px-2 py-1" disabled={loading||detailBusy} onClick={()=>{setRevision(n=>n+1);setDetailRevision(n=>n+1);}}>Refresh status</button></div>
  <p className="text-xs t-dark-muted">Saved proposal history. Original requests are not stored. Reading activity never applies changes.</p>
  <div className="flex min-w-0 flex-wrap gap-2"><label className="min-w-0">Status <select aria-label="Activity status" className="dark-chip max-w-full p-1" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All</option>{ACTIVITY_STATUSES.map(s=><option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label><label>Dates <select aria-label="Activity dates" className="dark-chip p-1" value={period} onChange={e=>setPeriod(e.target.value)}><option value="today">Today</option><option value="7">7 days</option><option value="30">30 days</option><option value="all">All dates</option></select></label></div>
  <p className="text-xs">Loaded runs: {counts}</p>
  {loading&&<p role="status">Loading activity…</p>}{error&&<p role="alert">{error}</p>}
  {!loading&&!error&&!page.items.length&&<p>No Agent activity yet. Saved suggestions will appear here when you approve, cancel, or review them.</p>}
  <ol className="min-w-0 divide-y divide-[var(--edge-dark)]">{page.items.map((run,index)=>{let day='Unknown date';try{day=localDateTime(run.createdAt,timeZone).slice(0,10);}catch{}let previous='';try{previous=index?localDateTime(page.items[index-1].createdAt,timeZone).slice(0,10):'';}catch{}return <li key={run.id} className="min-w-0 py-2">{day!==previous&&<h4 className="mb-2 text-xs font-semibold">{day}</h4>}<button type="button" className="w-full min-w-0 space-y-1 text-left" aria-expanded={runId===run.id} onClick={()=>setRunId(run.id)}><span className="block font-semibold">{run.status} · {run.primaryEntityLabel??'Agent run'}</span><span className="block text-xs">{run.actionCount} proposed changes · {run.summary}</span><time className="block text-xs t-dark-muted">{stamp(run.createdAt)}</time></button></li>;})}</ol>
  {page.nextCursor&&<button type="button" disabled={loading} className="dark-chip p-2" onClick={()=>void more()}>Load more</button>}
  {runId&&<section aria-label="Agent run details" className="min-w-0 space-y-3 border-t border-[var(--edge-dark)] pt-3">
   <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Agent run details</h3><button type="button" className="dark-chip p-1" onClick={()=>{setRunId(null);setDetail(null);setBatch(null);}}>Close details</button></div>
   {detailBusy&&<p role="status">Loading current status…</p>}{detailError&&<p role="alert">{detailError}</p>}
   {detail&&<><p className="text-xs">{detail.summary}<br/>Created: {stamp(detail.createdAt)}<br/>Completed: {stamp(detail.completedAt)}</p>
    <ol className="min-w-0 space-y-3">{detail.actions?.map(action=><li key={action.id} className="min-w-0 border-l-2 border-[var(--edge-dark)] pl-2">
     <h4 className="font-semibold">{action.humanSummary}: {action.entityLabel}</h4><p>{STATUS_LABELS[action.status]}</p>
     {action.errorCode&&<p className="text-xs">{action.errorCode==='STALE_ENTITY'?'The item changed before approval.':action.errorCode==='TIME_BLOCK_OVERLAP'?'That time is no longer available.':'The change could not be applied safely.'}</p>}
     {action.diff.map((d,index)=><p key={index} className="whitespace-pre-wrap text-xs">{d.field.replace(/([A-Z])/g,' $1')}: {value(d.field,d.before)} → {value(d.field,d.after)}</p>)}
     <p className="mt-1 text-xs t-dark-muted">Created: {stamp(action.createdAt)}<br/>Approval/decision: {stamp(action.approvedAt)}<br/>Executed: {stamp(action.executedAt)}</p>
     <div className="mt-2 flex flex-wrap gap-2">{action.navigationTarget&&onNavigate&&<button type="button" className="dark-chip p-2" onClick={()=>onNavigate(action.navigationTarget!)}>Open {action.navigationTarget.type==='time_block'?'Calendar / time block':action.navigationTarget.type}</button>}{action.entityState==='missing'&&<span className="text-xs">Item no longer exists</span>}{action.entityState==='uncreated'&&<span className="text-xs">Item has not been created</span>}{action.reviewPrompt&&<button type="button" className="dark-chip p-2" onClick={()=>onReview(action.reviewPrompt!)}>Review again</button>}</div>
    </li>)}</ol>
    {batch&&!detailBusy&&!detailError&&<AgentProposalCards key={`${batch.runId}:${detailRevision}`} batch={batch} timeZone={timeZone} entityLabels={entityLabels} onReview={onReview} onApplied={onApplied} onChange={current=>{setBatch(current);setDetailRevision(n=>n+1);setRevision(n=>n+1);}}/>}
   </>}
  </section>}
 </section>;
}
