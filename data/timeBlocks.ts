export type TimeBlockKind = 'focus' | 'task' | 'break' | 'custom';
export type TimeBlockStatus = 'scheduled' | 'completed' | 'cancelled';
export interface TimeSlot { startAt: string; endAt: string }
export interface WorkspaceTimeBlock extends TimeSlot {
  id: string; userId: string; projectId: string | null; taskId: string | null;
  title: string; kind: TimeBlockKind; status: TimeBlockStatus; notes: string | null;
  createdAt: string; updatedAt: string;
}
export interface SchedulingPreferences {
  workdayStart: string; workdayEnd: string; weekdays: number[]; focusMinutes: number; bufferMinutes: number;
}
export const TIME_BLOCK_COLUMNS = 'id,user_id,project_id,task_id,title,start_at,end_at,kind,status,notes,created_at,updated_at';
export const PREFERENCE_COLUMNS = 'workday_start,workday_end,weekdays,focus_minutes,buffer_minutes';
export const MAX_BLOCK_MINUTES = 720;
const MINUTE = 60000;
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function validClock(value: string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function localDateTime(instant: Date | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
  const get = (type: string) => parts.find(p=>p.type===type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
/** Require a unique round-trip match. DST gaps and repeated wall times need clarification. */
export function localTimeToInstant(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !validDate(value.slice(0,10)) || !validClock(value.slice(11))) throw new Error('Enter a valid local date and time.');
  const wall = Date.parse(`${value}:00Z`);
  const offsets = new Set<number>();
  for (let hours=-48;hours<=48;hours+=6) {
    const probe=wall+hours*3600000;
    offsets.add(Date.parse(`${localDateTime(new Date(probe),timeZone)}:00Z`)-probe);
  }
  const matches=[...offsets].map(offset=>wall-offset).filter(candidate=>localDateTime(new Date(candidate),timeZone)===value);
  if(matches.length!==1) throw new Error('This local time is nonexistent or ambiguous. Choose another time.');
  return new Date(matches[0]).toISOString();
}
/** Earliest instant on a generated calendar day, including midnight gaps/folds.
 * This is for read boundaries only; user-entered wall times remain strict. */
export function dayBoundaryInstant(date: string, timeZone: string): string {
  if(!validDate(date)) throw new Error('Enter a valid date.');
  const wall=Date.parse(`${date}T00:00:00Z`);
  let low=wall-36*3600000,high=wall+36*3600000;
  while(high-low>1){const middle=Math.floor((low+high)/2);if(localDateTime(new Date(middle),timeZone).slice(0,10)<date)low=middle;else high=middle;}
  return new Date(high).toISOString();
}
export function canonicalInstant(value: string): string {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validDate(value.slice(0,10)) || !validClock(value.slice(11,16)) || Number(value.slice(17,19))>59 || !Number.isFinite(Date.parse(value))) throw new Error('Enter a valid timestamp with an explicit offset.');
  return new Date(value).toISOString();
}
/** Tool inputs may use local wall time or a timestamp, but ambiguous local times always fail. */
export function resolveBlockTime(value: string, timeZone: string): string {
  if(value.length===16) return localTimeToInstant(value,timeZone);
  const instant=canonicalInstant(value);
  localTimeToInstant(localDateTime(instant,timeZone),timeZone);
  return instant;
}
export function validateBlockRange(startAt: string,endAt: string): TimeSlot {
  const start=canonicalInstant(startAt),end=canonicalInstant(endAt),duration=Date.parse(end)-Date.parse(start);
  if(duration<=0 || duration>MAX_BLOCK_MINUTES*MINUTE) throw new Error('Blocks must last more than zero and at most 12 hours.');
  return {startAt:start,endAt:end};
}
export function validatePreferences(p: SchedulingPreferences): SchedulingPreferences {
  if(!validClock(p.workdayStart)||!validClock(p.workdayEnd)||p.workdayStart>=p.workdayEnd||!Array.isArray(p.weekdays)||!p.weekdays.length||new Set(p.weekdays).size!==p.weekdays.length||p.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||!Number.isInteger(p.focusMinutes)||p.focusMinutes<1||p.focusMinutes>180||!Number.isInteger(p.bufferMinutes)||p.bufferMinutes<0||p.bufferMinutes>120) throw new Error('Enter valid working hours, weekdays, focus duration (1–180) and buffer (0–120).');
  return p;
}
export function blocksOverlap(a: TimeSlot,b: TimeSlot) { return Date.parse(a.startAt)<Date.parse(b.endAt)&&Date.parse(a.endAt)>Date.parse(b.startAt); }
export interface AvailabilityInput {
  date:string; timeZone:string; preferences?:SchedulingPreferences|null; blocks:Array<TimeSlot & {status?:string}>;
  earliestTime?:string; latestTime?:string; durationMinutes:number; now?:Date;
}
export function workWindow(input: AvailabilityInput): TimeSlot | null {
  if(!validDate(input.date)) throw new Error('Enter a valid date.');
  if(input.preferences) validatePreferences(input.preferences);
  const explicit=Boolean(input.earliestTime&&input.latestTime);
  if(!explicit&&!input.preferences) throw new Error('Configure working hours or provide an explicit start and end time.');
  const weekday=new Date(`${input.date}T00:00:00Z`).getUTCDay();
  if(!explicit&&!input.preferences!.weekdays.includes(weekday)) return null;
  let earliest=input.earliestTime??input.preferences!.workdayStart,latest=input.latestTime??input.preferences!.workdayEnd;
  if(input.preferences) { earliest=earliest<input.preferences.workdayStart?input.preferences.workdayStart:earliest; latest=latest>input.preferences.workdayEnd?input.preferences.workdayEnd:latest; }
  if(!validClock(earliest)||!validClock(latest)||earliest>=latest) throw new Error('Enter a valid working time range.');
  return {startAt:localTimeToInstant(`${input.date}T${earliest}`,input.timeZone),endAt:localTimeToInstant(`${input.date}T${latest}`,input.timeZone)};
}
export function findFreeSlots(input: AvailabilityInput): TimeSlot[] {
  if(!Number.isInteger(input.durationMinutes)||input.durationMinutes<1||input.durationMinutes>MAX_BLOCK_MINUTES) throw new Error('Enter a duration from 1 to 720 minutes.');
  const window=workWindow(input);if(!window)return [];
  const buffer=(input.preferences?.bufferMinutes??0)*MINUTE,duration=input.durationMinutes*MINUTE,end=Date.parse(window.endAt);
  let cursor=Math.max(Date.parse(window.startAt),input.now?.getTime()??0);
  cursor=Math.ceil(cursor/MINUTE)*MINUTE;
  const occupied=input.blocks.filter(b=>b.status!=='cancelled').map(b=>[Date.parse(canonicalInstant(b.startAt))-buffer,Date.parse(canonicalInstant(b.endAt))+buffer]).sort((a,b)=>a[0]-b[0]);
  const gaps:number[][]=[];
  for(const [start,finish] of occupied) { if(finish<=cursor)continue;if(start>cursor)gaps.push([cursor,Math.min(start,end)]);cursor=Math.max(cursor,finish);if(cursor>=end)break; }
  if(cursor<end)gaps.push([cursor,end]);
  const slots:TimeSlot[]=[];
  for(const [start,finish] of gaps) for(let at=start;at+duration<=finish&&slots.length<11;at+=duration+buffer) slots.push({startAt:new Date(at).toISOString(),endAt:new Date(at+duration).toISOString()});
  return slots;
}
export interface PlanningTask { id:string; title:string; projectId?:string; status:string; priority?:string; projectPriority?:string; dueDate?:string|null; milestoneDate?:string|null; projectDate?:string|null }
export function planDay(input: Omit<AvailabilityInput,'durationMinutes'> & {durationMinutes?:number;tasks:PlanningTask[]}) {
  const duration=input.durationMinutes??input.preferences?.focusMinutes;
  if(!duration)throw new Error('Save a default focus duration or specify a duration.');
  const priorities:Record<string,number>={Critical:4,High:3,Medium:2,Low:1};
  const relevant=(task:PlanningTask)=>[task.dueDate,task.milestoneDate,task.projectDate].filter((d):d is string=>Boolean(d)).sort()[0]??'9999-12-31';
  const urgency=(task:PlanningTask)=>relevant(task)<input.date?0:relevant(task)<=new Date(Date.parse(input.date)+3*86400000).toISOString().slice(0,10)?1:2;
  const tasks=input.tasks.filter(t=>t.status!=='Completed').sort((a,b)=>urgency(a)-urgency(b)||(priorities[b.priority??'Medium']??2)-(priorities[a.priority??'Medium']??2)||relevant(a).localeCompare(relevant(b))||(priorities[b.projectPriority??'Medium']??2)-(priorities[a.projectPriority??'Medium']??2)||a.id.localeCompare(b.id));
  const slots=findFreeSlots({...input,durationMinutes:duration});
  const items=tasks.slice(0,Math.min(slots.length,6)).map((task,index)=>({...slots[index],taskId:task.id,projectId:task.projectId??null,title:task.title,kind:'focus' as const}));
  return {items,truncated:tasks.length>items.length,omittedCount:tasks.length-items.length,durationMinutes:duration};
}
