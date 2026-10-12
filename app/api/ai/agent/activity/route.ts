import {NextResponse} from 'next/server';
import {AiError} from '@/lib/ai/errors';
import {requireAuthenticatedAiUser} from '@/lib/ai/auth';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {getSupabaseAdminClient} from '@/lib/supabase/admin';
import {listAgentRuns,getAgentRun} from '@/lib/ai/agent/activity';
import {parseActivityQuery} from '@/data/agentActivity';
import {requireUuid} from '@/lib/ai/agent/proposal-schema';
import {validTimeZone} from '@/lib/ai/agent/schemas';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const supabase=await getSupabaseServerClient(),userId=(await requireAuthenticatedAiUser(supabase)).id;
  if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin))throw new AiError('FORBIDDEN');
  const params=new URL(request.url).searchParams,runId=params.get('runId');
  if(runId!==null){
   if([...params.keys()].some(k=>k!=='runId')||params.getAll('runId').length!==1)throw new AiError('INVALID_INPUT');
   requireUuid(runId);
   const {data:profile,error}=await supabase!.from('profiles').select('time_zone').eq('id',userId).maybeSingle();if(error)throw new AiError('UPSTREAM_ERROR');
   return NextResponse.json({run:await getAgentRun(getSupabaseAdminClient(),supabase!,userId,runId,validTimeZone(profile?.time_zone)?profile.time_zone:'UTC')},{headers:{'Cache-Control':'no-store'}});
  }
  let query;try{query=parseActivityQuery(params);}catch{throw new AiError('INVALID_INPUT');}
  return NextResponse.json(await listAgentRuns(getSupabaseAdminClient(),userId,query),{headers:{'Cache-Control':'no-store'}});
 }catch(error){const safe=error instanceof AiError?error:new AiError('UPSTREAM_ERROR');return NextResponse.json({error:{code:safe.code,message:safe.message}},{status:safe.status,headers:{'Cache-Control':'no-store'}});}
}
