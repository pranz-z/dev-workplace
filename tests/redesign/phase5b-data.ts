import {config,publicProps,callService,memoryResponse as base} from './matrix-data';
export {config,publicProps,callService};
export async function memoryResponse(input:string,init:RequestInit={}){
 const url=new URL(input,location.origin);if(url.origin!==location.origin)throw Error('Synthetic AI accepts loopback projections only');
 if(['/api/ai/chat','/api/ai/agent'].includes(url.pathname)){
  if(init.method!=='POST')throw Error('Synthetic AI expects explicit POST');
  const request=init.body instanceof FormData?JSON.parse(String(init.body.get('request'))):JSON.parse(String(init.body));window.matrixFixture.calls.push({name:`synthetic-ai:${url.pathname}`,args:[request]});
  if(config.variant==='chat-error')return Response.json({error:{message:'Synthetic AI response unavailable. Try again.'}},{status:503});
  return Response.json({answer:'Synthetic response only. Review the recorded workspace facts before deciding what to do. No workspace change has been applied.',...(url.pathname.endsWith('/agent')?{toolActivity:[{tool:'list_tasks',summary:'Synthetic task titles and statuses only.'}]}:{})});
 }
 if(url.pathname==='/api/ai/agent/activity'){
  window.matrixFixture.calls.push({name:'synthetic-activity-read',args:[url.search]});
  if(config.variant==='activity-error')return Response.json({error:'Synthetic unavailable'},{status:503});
  const run={id:'77777777-7777-4777-8777-777777777777',createdAt:'2026-10-26T02:00:00Z',completedAt:'2026-10-26T02:00:00Z',actionCount:0,counts:{pending:0,applied:0,cancelled:0,conflict:0,failed:0},primaryEntityLabel:'Synthetic project activity',status:'No actions',summary:'Synthetic read-only activity record.',actions:[]};
  return Response.json(url.searchParams.has('runId')?{run}:{items:config.variant==='activity-empty'?[]:[run],nextCursor:null});
 }
 return base(input,init);
}
