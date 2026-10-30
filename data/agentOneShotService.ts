import type {OneShotListDto,OneShotPreviewDto,OneShotStatusDto} from './agentOneShot';
const base='/api/ai/agent/one-shot';
async function request<T>(path:string,signal?:AbortSignal,body?:unknown):Promise<T>{
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal,
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 if(!response.ok)throw new Error(response.status===409?'Authorization facts changed. Refresh status and review again.':'Unable to confirm the result. Refresh status before trying again.');
 return response.json() as Promise<T>;
}
export const agentOneShotService={
 list:(signal?:AbortSignal)=>request<OneShotListDto>('',signal),
 preview:(parentId:string,signal?:AbortSignal)=>request<OneShotPreviewDto|null>('/preview?parentId='+encodeURIComponent(parentId),signal),
 create:(input:{parentId:string;previewIdentity:string},signal?:AbortSignal)=>request<OneShotStatusDto>('',signal,input),
 cancel:(authorizationId:string,signal?:AbortSignal)=>request<OneShotStatusDto>('/cancel',signal,{authorizationId}),
};
