import "server-only";
import { AiError } from "@/lib/ai/errors";
import { localDateTime, localTimeToInstant, MAX_BLOCK_MINUTES } from "@/data/timeBlocks";
import type { ToolContext } from "@/lib/ai/agent/tools";

type Block = { id: string; title: string; start_at: string; end_at: string; task_id: string | null; project_id: string | null };
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function wallClock(value: string): string | undefined {
  const match = value.trim().match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/i);
  if (!match || (!match[3] && !match[2])) return undefined;
  let hour = Number(match[1]);
  if (match[3]) { if (hour < 1 || hour > 12) return undefined; hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0); }
  if (hour > 23) return undefined;
  return `${String(hour).padStart(2, '0')}:${match[2] ?? '00'}`;
}
const clockPattern = '(?:\\d{1,2}:[0-5]\\d\\s*(?:AM|PM)?|\\d{1,2}\\s*(?:AM|PM))';
export function hasRequestedMoveTime(message: string) { return new RegExp(`(?:to|at|start(?:ing)?(?: at)?)\\s+${clockPattern}`, 'i').test(message); }
export function isBlockMoveRequest(message: string) {
  if(/\bmilestone\b/i.test(message)&&!/\bblock\b/i.test(message))return false;
  return /\b(move|reschedule|cancel)\b/i.test(message) && /\b(block|it|this)\b/i.test(message);
}

/** Model IDs are suggestions. Resolve against the human request and owned canonical rows. */
export async function resolveTimeBlockCandidates(message: string, context: ToolContext) {
  const requestedIds = message.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi) ?? [];
  let query = context.supabase.from('workspace_time_blocks').select('id,title,start_at,end_at,task_id,project_id').eq('user_id', context.userId).order('start_at').limit(501).abortSignal(context.signal);
  if(requestedIds.length===1)query=query.eq('id',requestedIds[0]);
  if (!/\bcancelled\b/i.test(message)) query = query.neq('status', 'cancelled');
  const { data, error } = await query;
  if (error) throw new AiError('UPSTREAM_ERROR');
  const rows = (data ?? []) as Block[];
  const exact = rows.filter(row => requestedIds.some(id => id.toLowerCase() === row.id.toLowerCase()));
  let matches = exact;
  if (!exact.length) {
    const today = localDateTime(context.now, context.timeZone).slice(0, 10);
    const next = new Date(`${today}T00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    const month = message.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i);
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const monthDate = month ? `${month[3] ?? today.slice(0,4)}-${String(months.indexOf(month[1].toLowerCase())+1).padStart(2,'0')}-${month[2].padStart(2,'0')}` : undefined;
    const date = message.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? monthDate ?? (/\btomorrow\b/i.test(message) ? next.toISOString().slice(0, 10) : /\btoday\b/i.test(message) ? today : undefined);
    const range = message.match(/\b(?:during|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:through|and|to)\s+(\d{4}-\d{2}-\d{2})\b/i);
    const validDate=(value:string)=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
    if((date&&!validDate(date))||(range&&(!validDate(range[2])||range[2]<range[1]||Date.parse(range[2])-Date.parse(range[1])>31*86400000))||(!date&&/\b(next|yesterday|week|month)\b/i.test(message)))return {selectedId:undefined,candidates:[],answer:'Please specify the existing block date as YYYY-MM-DD or today/tomorrow, and a range of at most 31 days.'};
    const inDate = (row: Block) => {
      const start=localDateTime(row.start_at,context.timeZone).slice(0,10),end=localDateTime(new Date(Date.parse(row.end_at)-1),context.timeZone).slice(0,10);
      return range ? start<=range[2]&&end>=range[1] : !date||start<=date&&end>=date;
    };
    matches = rows.filter(inDate);
    const sourceTime = message.match(new RegExp(`\\bfrom\\s+(${clockPattern})`, 'i'))?.[1];
    if (sourceTime) matches = matches.filter(row => localDateTime(row.start_at, context.timeZone).slice(11) === wallClock(sourceTime));
    const normalized = ` ${words(message)} `;
    const strong = matches.filter(row => normalized.includes(` ${words(row.title)} `));
    if (strong.length) matches = strong;
    else {
      const target = message.replace(/\b(?:to|at|on|from|in|for|during|between|tomorrow|today|until)\b[\s\S]*$/i, '').replace(/\b(move|reschedule|cancel|review|my|the|specific|persisted|time|titled|this|it|cancelled|for)\b/gi, '');
      const tokens = words(target).split(' ').filter(Boolean);
      matches = tokens.length ? matches.filter(row => tokens.every(token => words(row.title).split(' ').includes(token))) : [];
      if (!matches.length && /\bfor\b/i.test(message)) {
        const [tasks, projects] = await Promise.all([
          context.supabase.from('tasks').select('id,title').eq('user_id', context.userId).order('id').limit(501).abortSignal(context.signal),
          context.supabase.from('projects').select('id,title').eq('user_id', context.userId).order('id').limit(501).abortSignal(context.signal),
        ]);
        if (tasks.error || projects.error) throw new AiError('UPSTREAM_ERROR');
        if ((tasks.data?.length ?? 0) >= 501 || (projects.data?.length ?? 0) >= 501) matches = [];
        else {
          const taskIds = new Set((tasks.data ?? []).filter(row => normalized.includes(` ${words(row.title)} `)).map(row => row.id));
          const projectIds = new Set((projects.data ?? []).filter(row => normalized.includes(` ${words(row.title)} `)).map(row => row.id));
          matches = rows.filter(row => inDate(row) && (!sourceTime || localDateTime(row.start_at,context.timeZone).slice(11)===wallClock(sourceTime)) && (taskIds.size > 0 || projectIds.size > 0) && (!taskIds.size || taskIds.has(row.task_id)) && (!projectIds.size || projectIds.has(row.project_id)));
        }
      }
    }
  }
  if (!exact.length && matches.length && /\b(in|for|project|task)\b/i.test(message)) {
    const [tasks, projects] = await Promise.all([
      context.supabase.from('tasks').select('id,title').eq('user_id', context.userId).order('id').limit(501).abortSignal(context.signal),
      context.supabase.from('projects').select('id,title').eq('user_id', context.userId).order('id').limit(501).abortSignal(context.signal),
    ]);
    if (tasks.error || projects.error) throw new AiError('UPSTREAM_ERROR');
    const normalized = ` ${words(message)} `;
    const taskIds = new Set((tasks.data ?? []).filter(row => normalized.includes(` ${words(row.title)} `)).map(row => row.id));
    const projectIds = new Set((projects.data ?? []).filter(row => normalized.includes(` ${words(row.title)} `)).map(row => row.id));
    if ((tasks.data?.length ?? 0) >= 501 || (projects.data?.length ?? 0) >= 501) matches = [];
    else matches = /\bin\s+\S/i.test(message)&&!projectIds.size ? [] : matches.filter(row => (!taskIds.size || taskIds.has(row.task_id)) && (!projectIds.size || projectIds.has(row.project_id)));
  }
  const candidates = matches.slice(0, 5).map(row => ({ id: row.id, title: row.title.slice(0, 180), start: localDateTime(row.start_at, context.timeZone), end: localDateTime(row.end_at, context.timeZone) }));
  const selectedId = matches.length === 1 && (rows.length < 501 || exact.length === 1) ? matches[0].id : undefined;
  const answer = selectedId ? undefined : `Which time block should I change? Please specify its title, date and time.${candidates.length ? `\n${candidates.map(row => `• ${row.title} — ${row.start.replace('T', ' ')}–${row.end.slice(0,10)===row.start.slice(0,10)?row.end.slice(11):row.end.replace('T',' ')} (${context.timeZone})`).join('\n')}` : ''}${rows.length >= 501 || matches.length > 5 ? '\nMore blocks may match. Please narrow the date or title.' : ''}`;
  return { selectedId, candidates, answer };
}

/** Only explicit human duration/end intent may replace the persisted duration. */
export function moveEndFromCanonical(message: string, startAt: string, oldStart: string, oldEnd: string, timeZone: string) {
  const duration = message.match(/\bfor\s+(\d+)\s*(minutes?|mins?|hours?)\b/i);
  const end = message.match(new RegExp(`(?:until|end(?:ing)?(?: at)?)\\s+(${clockPattern})`, 'i'))?.[1]
    ?? message.match(new RegExp(`(?:to|between)\\s+${clockPattern}\\s*(?:to|and|–|-)\\s*(${clockPattern})`, 'i'))?.[1];
  if (end) return localTimeToInstant(`${localDateTime(startAt, timeZone).slice(0, 10)}T${wallClock(end)}`, timeZone);
  const milliseconds = duration ? Number(duration[1]) * (/hour/i.test(duration[2]) ? 3600000 : 60000) : Date.parse(oldEnd) - Date.parse(oldStart);
  if(!Number.isSafeInteger(milliseconds)||milliseconds<=0||milliseconds>MAX_BLOCK_MINUTES*60000)throw new AiError('INVALID_INPUT');
  return new Date(Date.parse(startAt) + milliseconds).toISOString();
}
