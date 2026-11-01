import {callService as original,memoryResponse as originalResponse,config,project,publicProps} from './matrix-data';
export {config,publicProps};
const variant=config.variant??'';
const record=(name:string,args:unknown[])=>window.matrixFixture.calls.push({name,args:args.map(a=>typeof a==='function'?'local callback':a instanceof File?{name:a.name,size:a.size,type:a.type}:a instanceof AbortSignal?'AbortSignal':a)});
const repo={id:101,name:'synthetic-repository',fullName:'synthetic-owner/synthetic-repository',owner:'synthetic-owner',description:'Synthetic authorized repository for local evidence.',private:false,url:'https://github.invalid/synthetic-owner/synthetic-repository',language:'TypeScript',defaultBranch:'main',updatedAt:'2026-10-26T02:00:00Z',installationRecordId:'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',accountLogin:'synthetic-owner',linkedProjectId:null};
const folder={id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000080',name:'Synthetic project folder',mime_type:'application/vnd.google-apps.folder',size_bytes:0,modified_at:'2026-10-26T02:00:00Z',status:'active',project_id:project.id,task_id:null,parent_id:null,is_project_folder:true,created_at:'2026-10-26T02:00:00Z',updated_at:'2026-10-26T02:00:00Z'};
const file={...folder,id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000082',name:'Synthetic layout reference.pdf',mime_type:'application/pdf',size_bytes:2048,is_project_folder:false};
const custom={...folder,id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000081',name:'Synthetic folder',project_id:null,is_project_folder:false};
export async function memoryResponse(input:string,init:RequestInit={}){
 const url=new URL(input,location.origin),method=init.method??'GET';
 if(!variant.startsWith('drive-')&&!variant.startsWith('github-'))return originalResponse(input,init);
 if(url.origin!==location.origin)throw Error('Synthetic integrations accept loopback projections only');
 record(`synthetic:${method}:${url.pathname}`,init.body?[typeof init.body==='string'?JSON.parse(init.body):{syntheticBytes:(init.body as Blob).size,contentRange:new Headers(init.headers).get('Content-Range')}]:[]);
 if(url.pathname==='/api/drive/status')return Response.json({connected:variant!=='drive-disconnected'});
 if(url.pathname==='/api/drive/files'&&method==='GET'){
  if(variant==='drive-loading')return new Promise<Response>(()=>{});
  if(variant==='drive-error')return Response.json({error:'Synthetic Drive source unavailable. Retry loading files.'},{status:503});
  const files=['drive-disconnected','drive-empty'].includes(variant)?[]:[folder,variant==='drive-long'?{...custom,name:'Synthetic_long_folder_'.repeat(10)}:custom,variant==='drive-long'?{...file,name:'Synthetic_long_file_'.repeat(11)+'.pdf'}:file];
  return Response.json({files,count:files.length,nextOffset:files.length});
 }
 if(url.pathname==='/api/drive/folders'&&method==='POST')return Response.json({folder});
 if(url.pathname==='/api/drive/uploads'&&method==='POST')return Response.json({uploadId:'local-synthetic-upload',chunkSize:5,expiresAt:'2026-10-26T03:00:00Z'});
 if(url.pathname==='/api/drive/uploads/local-synthetic-upload'&&method==='PUT'){
  const range=new Headers(init.headers).get('Content-Range')??'',end=Number(/bytes \d+-(\d+)\//.exec(range)?.[1]??0)+1;
  if(variant==='drive-upload-failure')return Response.json({error:'Synthetic upload interrupted. Retry resumes from the confirmed position.'},{status:503});
  if(variant==='drive-upload-progress'&&end>5)return new Promise<Response>(()=>{});
  return Response.json({nextOffset:end});
 }
 if(url.pathname==='/api/drive/uploads/local-synthetic-upload/complete')return Response.json({file:{...file,id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000099',name:'synthetic-local-fixture.txt',mime_type:'text/plain',size_bytes:10}});
 if(url.pathname.startsWith('/api/drive/files/')&&method==='DELETE')return Response.json({ok:true});
 if(url.pathname==='/api/github/repositories'){
  if(variant==='github-loading')return new Promise<Response>(()=>{});
  if(variant==='github-error')return Response.json({connected:true,error:'Synthetic GitHub access unavailable. Try refreshing.'},{status:503});
  return Response.json({connected:variant!=='github-unconnected',repositories:['github-empty','github-unconnected'].includes(variant)?[]:[variant==='github-long'?{...repo,fullName:'synthetic-owner/'+('long-repository-name-'.repeat(10)),description:'Long synthetic repository description. '.repeat(12)}:repo],installations:[]});
 }
 if(url.pathname==='/api/github/link'){
  if(method==='POST'){sessionStorage.setItem('redesign-synthetic-github-link',String(init.body));return Response.json({ok:true,projectId:project.id});}
  return Response.json({connected:true,repository:{...repo,projectId:project.id}});
 }
 if(/\/api\/github\/projects\/.+\/activity/.test(url.pathname)){
  if(variant==='github-activity-loading')return new Promise<Response>(()=>{});
  if(variant==='github-activity-error')return Response.json({error:'Synthetic activity unavailable. Refresh activity to retry.'},{status:503});
  const empty=variant==='github-activity-empty';
  return Response.json({repository:{id:101,fullName:repo.fullName,private:false,archived:false,updatedAt:repo.updatedAt,pushedAt:repo.updatedAt},summary:{lastActivityAt:empty?null:repo.updatedAt,recentCommitCount:empty?0:1,recentPullRequestCount:0,recentIssueCount:0,latestReleaseAt:null},commits:empty?[]:[{sha:'abc123456789',shortSha:'abc1234',title:'Synthetic local activity entry',author:'Synthetic contributor',occurredAt:repo.updatedAt,url:'https://github.invalid/synthetic/commit/abc'}],pullRequests:[],issues:[],releases:[],fetchedAt:repo.updatedAt});
 }
 return originalResponse(input,init);
}
export function callService(name:string,args:unknown[]):unknown{
 if(name==='driveClientRequest'&&variant.startsWith('drive-'))return memoryResponse(String(args[0]),args[1] as RequestInit).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data;});
 if(name==='uploadDriveChunks'&&variant.startsWith('drive-upload')){
  record(name,args);const file=args[0] as File,progress=args[3] as (n:number)=>void;
  if(variant==='drive-upload-progress'){progress(Math.floor(file.size/2));return new Promise(()=>{});}
  if(variant==='drive-upload-failure')return Promise.reject(Error('Synthetic upload interrupted. Retry resumes from the confirmed position.'));
  progress(file.size);return Promise.resolve({file:{...folder,id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000099',name:file.name,mime_type:file.type,size_bytes:file.size,is_project_folder:false}});
 }
 return original(name,args);
}
