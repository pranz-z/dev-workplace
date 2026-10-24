import { parseSchedulerRequest, SchedulerRequestError } from '@/lib/ai/agent/pulse/scheduler';
import { runPulseDispatch } from '@/lib/ai/agent/pulse/engine';
import { createPulseRepository } from '@/lib/ai/agent/pulse/db';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseSchedulerRequest(request,process.env.AGENT_PULSE_SCHEDULER_SECRET ?? '',Date.now());
    const enabled = process.env.AGENT_PULSE_ENABLED;
    if (enabled !== 'true' && enabled !== 'false') return Response.json({error:{code:'SCHEDULER_UNAVAILABLE'}},{status:503,headers});
    const result = await runPulseDispatch({...input,processingEnabled:enabled === 'true'}, {
      repository:createPulseRepository(getSupabaseAdminClient()),signal:request.signal,fetch:globalThis.fetch,
    });
    if (result.outcome === 'failed') return Response.json({error:{code:'SCHEDULER_UNAVAILABLE'}},{status:503,headers});
    return Response.json({accepted:true,outcome:result.outcome,claimedCount:result.claimed,processedCount:result.processed},{headers});
  } catch (error) {
    const code = error instanceof SchedulerRequestError ? error.code : 'SCHEDULER_UNAVAILABLE';
    const status = code === 'INVALID_REQUEST' ? 400 : code === 'AUTHENTICATION_FAILED' ? 401 : 503;
    return Response.json({error:{code}},{status,headers});
  }
}
