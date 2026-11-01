'use client';

import {useEffect,useRef,useState} from 'react';
import {WorkspaceDialog} from '@/components/workspace/WorkspaceDialog';
import {agentOneShotService} from '@/data/agentOneShotService';
import type {OneShotListDto,OneShotPreviewDto} from '@/data/agentOneShot';

export function AgentOneShotAuthorization({revision}:{revision:number}){
 const [data,setData]=useState<OneShotListDto>({items:[],candidates:[]});
 const [preview,setPreview]=useState<OneShotPreviewDto|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null),flight=useRef(false),mounted=useRef(true);
 async function load(signal?:AbortSignal){const value=await agentOneShotService.list(signal);if(mounted.current&&!signal?.aborted)setData(value);}
 useEffect(()=>{mounted.current=true;const c=new AbortController();controller.current=c;
  void agentOneShotService.list(c.signal).then(value=>{if(!c.signal.aborted)setData(value);}).catch(()=>{if(!c.signal.aborted)setError('Unable to load authorization status. Refresh status.');});
  return()=>{mounted.current=false;c.abort();};},[revision]);
 async function action(operation:(signal:AbortSignal)=>Promise<void>){
  if(flight.current)return;flight.current=true;setBusy(true);setError('');const c=controller.current;
  try{if(!c||c.signal.aborted)return;await operation(c.signal);if(!c.signal.aborted)await load(c.signal);}
  catch{if(mounted.current&&!c?.signal.aborted){setPreview(null);setError('Unable to confirm the result. Refresh status before trying again.');}}
  finally{flight.current=false;if(mounted.current&&!c?.signal.aborted)setBusy(false);}
 }
 const pending=data.items.some(item=>item.status==='pending'||item.status==='consumed');
 return <section aria-label="One-shot proactive authorization" className="min-w-0 space-y-3 border-t border-[var(--edge-dark)] pt-4 text-sm">
  <h3 className="font-semibold">One natural AI trial</h3>
  <p>Authorize one exact unseen signal for the next natural scheduler slot. Persistent AI consent and project scope stay unchanged.</p>
  <button type="button" disabled={busy} className="dark-chip p-2" onClick={()=>void action(signal=>load(signal))}>Refresh status</button>
  {error&&<p role="alert">{error}</p>}
  {!data.candidates.length&&<p>No eligible unseen signal is available for the next natural slot. Refresh after the next successful workspace check.</p>}
  {data.candidates.map(candidate=><div key={candidate.parentId} className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
   <p>{candidate.projectTitle}: {candidate.signalTitle}</p>
   <button type="button" disabled={busy||pending} className="dark-chip max-w-full whitespace-normal p-2" onClick={()=>void action(async signal=>{
    const value=await agentOneShotService.preview(candidate.parentId,signal);if(!value)throw new Error('Changed');if(!signal.aborted)setPreview(value);
   })}>Authorize one natural AI trial: {candidate.signalTitle}</button>
  </div>)}
  {data.items.map(item=><article key={item.id} className="min-w-0 space-y-1 rounded-xl dark-inset p-3 [overflow-wrap:anywhere]">
   <p className="font-semibold">{item.projectTitle}: {item.signalTitle}</p><p>Status: {item.status}{item.reason?` — ${item.reason}`:''}</p>
   <p>Natural slot: {item.slot}</p><p>Execution expiry: {item.expiresAt}</p><p>Provider/model: {item.provider} / {item.model}</p>
   <p>Reserved allowances: {item.accounting.allowanceConsumed?1:0} / 1.</p>
   <p>Provider request count: {item.accounting.responseReceived?'1 confirmed':item.accounting.sendAttempted?'unknown (maximum 1)':'0; transport not started'}.</p>
   {!item.accounting.allowanceConsumed&&item.status==='pending'&&<p>AUTHORIZATION PENDING</p>}
   {item.accounting.allowanceConsumed&&<p>ALLOWANCE CONSUMED / RESERVED</p>}
   {item.accounting.sendAttempted&&<p>SEND ATTEMPTED</p>}
   {item.accounting.transport==='confirmed'&&<p>TRANSPORT CONFIRMED</p>}
   {item.accounting.transport==='unknown'&&<p>TRANSPORT UNKNOWN</p>}
   {item.accounting.responseReceived&&<p>PROVIDER RESPONSE RECEIVED</p>}
   {item.accounting.output==='accepted'&&<p>OUTPUT ACCEPTED</p>}
   {item.accounting.output==='rejected'&&<p>OUTPUT REJECTED</p>}
   {item.accounting.publicationCompleted&&<p>PUBLICATION COMPLETED — advisory only, owner review required.</p>}
   {item.status==='pending'&&<button type="button" disabled={busy} className="dark-chip p-2" onClick={()=>void action(async signal=>{await agentOneShotService.cancel(item.id,signal);})}>Cancel pending authorization</button>}
  </article>)}
  {preview&&<WorkspaceDialog label="Confirm one natural AI trial" onClose={()=>{if(!busy)setPreview(null);}}>
   <section className="max-h-[calc(100dvh-2rem)] max-w-xl min-w-0 space-y-3 overflow-y-auto p-4 text-sm [overflow-wrap:anywhere]">
    <h3 className="font-semibold">Confirm one natural AI trial</h3>
    <p>Project: {preview.projectTitle}</p><p>Signal: {preview.signalTitle}</p><p>Family: {preview.family}</p><p>Reason: {preview.reasonCodes.join(', ')}</p>
    <p>Content revision: {preview.contentRevision}</p><p>Natural slot (UTC): {preview.slot}</p>
    <p>Natural slot (your device timezone): {new Date(preview.slot).toLocaleString()}</p>
    <p>Evidence validity: {preview.evidenceValidUntil}</p><p>Execution expiry: {preview.expiresAt}</p><p>Provider/model: {preview.provider} / {preview.model}</p>
    <p>Billing tier UNKNOWN. Conservatively treated as an unpaid/free external service. Submitted facts and output may be used to improve provider products and reviewed by humans under applicable terms.</p>
    <p>Maximum requests: 1. No retry, fallback parent or model. Advisory-only output. No automatic workspace changes.</p>
    <p>Exact provider-visible minimized facts:</p><pre className="max-h-64 max-w-full overflow-auto whitespace-pre-wrap rounded-xl dark-inset p-2 text-xs">{preview.context}</pre>
    <div className="flex flex-wrap gap-2">
     <button type="button" autoFocus disabled={busy} className="dark-chip p-2" onClick={()=>setPreview(null)}>Keep workspace-only</button>
     <button type="button" disabled={busy} className="ink-button primary px-3 py-2" onClick={()=>void action(async signal=>{
      await agentOneShotService.create({parentId:preview.parentId,previewIdentity:preview.previewIdentity},signal);if(!signal.aborted)setPreview(null);
     })}>Confirm one natural AI trial</button>
    </div>
   </section>
  </WorkspaceDialog>}
 </section>;
}
