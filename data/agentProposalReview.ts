import type { ProposalDraft } from '@/lib/ai/agent/contract';
import { localDateTime } from '@/data/timeBlocks';

export function buildAgentReviewPrompt(action: ProposalDraft, timeZone: string, labels?: Map<string, string>): string {
  if(action.type==='create_plan')return `Review creating Plan ${action.title} and prepare a fresh record-only proposal after checking current state.`;
  if(action.type==='update_plan')return `Review the current Plan ${action.title} (${action.entityId}) and prepare a fresh record-only proposal after checking current state.`;
  if(action.type==='create_milestone')return `Review creating milestone ${action.title} in ${labels?.get(`project:${action.projectId}`)??'the original project'} (project ${action.projectId}) and prepare a fresh proposal after checking current state.`;
  if(action.type==='update_milestone')return `Review the current milestone ${action.title} (${action.entityId}) and prepare a fresh proposal for the requested changes.`;
  if (action.type === 'create_time_block') {
    const start = localDateTime(action.payload.startAt!, timeZone);
    const end = localDateTime(action.payload.endAt!, timeZone);
    const minutes = (Date.parse(action.payload.endAt!) - Date.parse(action.payload.startAt!)) / 60000;
    const task = action.payload.taskId ? labels?.get(`task:${action.payload.taskId}`) : undefined;
    const project = action.payload.projectId ? labels?.get(`project:${action.payload.projectId}`) : undefined;
    const reason = action.status === 'conflict' ? 'is no longer available' : 'could not be applied';
    return `That slot (${start.replace('T', ' ')}–${end.slice(11)}, ${timeZone}) ${reason}. Find another ${minutes}-minute slot on ${start.slice(0, 10)} for ${task ?? action.title}${project ? ` in ${project}` : ''}. Ask me for working hours if none are saved.`;
  }
  if (action.type === 'update_time_block' || action.type === 'cancel_time_block') {
    const previous = localDateTime(action.before.startAt!, timeZone);
    const identity = `time block titled ${action.title} on ${previous.slice(0, 10)}`;
    if (action.type === 'cancel_time_block') return `Review the current persisted ${identity} and propose cancelling that block again.`;
    const target = action.payload.startAt ? localDateTime(action.payload.startAt, timeZone).replace('T', ' at ') : undefined;
    return `${action.status === 'conflict' ? 'The block changed since this proposal.' : 'This change could not be applied.'} Review the current ${identity}${target ? ` and try moving it to ${target} again, preserving its current duration` : ' and ask me which change to retry'}.`;
  }
  return `Review the current state of ${action.type === 'reschedule_milestone' ? 'milestone' : action.type === 'reschedule_project' ? 'project' : 'task'} ${action.title} (${action.entityId ?? action.taskId ?? action.projectId}) and prepare a fresh proposal for the requested changes.`;
}
