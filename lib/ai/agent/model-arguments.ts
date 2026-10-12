import "server-only";
import { wallClock } from "@/lib/ai/agent/block-resolution";
import {localTimeToInstant} from "@/data/timeBlocks";
import {AiError} from "@/lib/ai/errors";
export function isSchedulingTool(name: string | undefined) { return /^(?:list_time_blocks|get_day_schedule|find_free_time|propose_(?:find_time|plan_day|create_time_block|update_time_block|cancel_time_block))$/.test(name ?? ''); }

/** Normalize equivalent wall-clock spellings only. Strict parsers still own validation. */
export function normalizeSchedulingArguments(name: string, input: unknown, timeZone?:string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input as Record<string, unknown>;
  const result = { ...input } as Record<string, unknown>;
  if (['find_free_time', 'propose_find_time', 'propose_plan_day'].includes(name)) {
    for (const field of ['earliestTime', 'latestTime']) if (typeof result[field] === 'string') result[field] = wallClock(result[field]) ?? result[field];
  }
  if(name==='list_time_blocks'&&timeZone)for(const field of ['startAt','endAt']){
    const value=result[field];
    if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)){
      try{result[field]=localTimeToInstant(value,timeZone);}catch{throw new AiError('INVALID_INPUT');}
    }
  }
  return result;
}
