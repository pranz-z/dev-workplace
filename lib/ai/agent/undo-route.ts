import 'server-only';
import {NextResponse} from 'next/server';
import {AiError} from '@/lib/ai/errors';
import {requireAuthenticatedAiUser} from '@/lib/ai/auth';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {getSupabaseAdminClient} from '@/lib/supabase/admin';
import {acquirePrivateAiLease,releasePrivateAiLease} from '@/lib/ai/private-concurrency';
import {boundedAgentBody} from '@/lib/ai/agent/request';
import {parseUndoSelection} from '@/lib/ai/agent/proposal-schema';
import {prepareAgentUndo} from '@/lib/ai/agent/undo';
export async function handlePrepareAgentUndo(request:Request) {
 try {
  const userId=(await requireAuthenticatedAiUser(await getSupabaseServerClient())).id;
  const origin=request.headers.get('origin');
  if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==new URL(request.url).origin))throw new AiError('FORBIDDEN');
  const admin=getSupabaseAdminClient();
  const {data:allowed,error}=await admin.rpc('consume_agent_action_limit',{p_user_id:userId});
  if(error||typeof allowed!=='boolean')throw new AiError('UPSTREAM_ERROR');if(!allowed)throw new AiError('RATE_LIMITED');
  const selection=parseUndoSelection(await boundedAgentBody(request,AbortSignal.any([request.signal,AbortSignal.timeout(15_000)])));
  const leaseId=await acquirePrivateAiLease(userId);if(!leaseId)throw new AiError('RATE_LIMITED');
  try{return NextResponse.json(await prepareAgentUndo(admin,userId,selection),{headers:{'Cache-Control':'no-store'}});}
  finally{await releasePrivateAiLease(userId,leaseId);}
 }catch(error){const safe=error instanceof AiError?error:new AiError('UPSTREAM_ERROR');return NextResponse.json({error:{code:safe.code,message:safe.message}},{status:safe.status,headers:{'Cache-Control':'no-store'}});}
}
