import {agentInboxService as base,fixture as original,authFixture,useAuth,AgentInboxError} from './fixtures';
import {config,projects} from './matrix-data';
import type {InboxItem,InboxAckInput,InboxFeedbackInput,InboxFilter} from '@/data/agentInbox';
export {authFixture,useAuth,AgentInboxError};
export {inboxErrorMessage} from './fixtures';
type Event={kind:string;[key:string]:unknown};
const events:Event[]=[],model=new Map<string,InboxItem>();
const behavior=()=>config.variant==='inbox-behavior';
function init(){if(!model.size){const item=original.snapshot().item;model.set(item.id,structuredClone(item));model.set('66666666-6666-4666-8666-666666666666',{...item,id:'66666666-6666-4666-8666-666666666666',title:'Synthetic second-page observation',contentRevision:4,rowRevision:5});}}
const log=(kind:string,data:Record<string,unknown>={})=>events.push({kind,...structuredClone(data)});
declare global{interface Window{phase5bFixture:{snapshot:()=>{events:Event[];items:InboxItem[]}}}}
window.phase5bFixture={snapshot:()=>structuredClone({events,items:[...model.values()]})};
export const agentInboxService={...base,
 async getPulseSettings(){const value=await base.getPulseSettings();if(config.variant==='settings-off'){value.settings={...value.settings,mode:'off',checksConsented:false,aiConsented:false,checksEnabled:false,aiEligible:false,aiProjectIds:[]};value.projectChoices=projects.map(p=>({id:p.id,title:p.name}));}return value;},
 async getInboxPage(params:{state?:InboxFilter;cursor?:string|null}={}){log('page-read',params);if(!behavior())return base.getInboxPage();init();const items=[...model.values()].filter(i=>!params.state||params.state==='all'||i.state===params.state);return {items:structuredClone(params.cursor?items.slice(1):items.slice(0,1)),nextCursor:!params.cursor&&items.length>1?'synthetic-page-two':null};},
 async ackInbox(input:InboxAckInput,signal?:AbortSignal){if(input.brief&&config.variant==='brief'){log('brief-ack',input as unknown as Record<string,unknown>);return {acknowledged:input.items.length};}if(!behavior())return base.ackInbox(input,signal);init();for(const requested of input.items){const item=model.get(requested.id);if(!item||requested.contentRevision!==item.contentRevision)throw new Error('Unexpected synthetic revision ACK');if(!item.seen){item.seen=true;item.rowRevision++;}}log('behavior-ack',{input,renderedTitles:[...document.querySelectorAll('section[aria-label="Agent Inbox"] article h3')].map(e=>e.textContent)});return {acknowledged:input.items.length};},
 async getInboxDetail(id:string){if(!behavior())return base.getInboxDetail();init();log('detail-read',{id});return {item:structuredClone(model.get(id)??null),reviewContext:{targetLabel:'Synthetic task',deterministicSummary:'Synthetic deadline only.',deterministicExplanation:null,advisoryIdea:null}};},
 async sendInboxFeedback(input:InboxFeedbackInput){if(!behavior())throw new Error('Feedback is restricted to explicit synthetic behavior fixture');init();const item=model.get(input.id);if(!item||item.rowRevision!==input.expectedRevision)throw new AgentInboxError('STATE_CHANGED');log('feedback',input as unknown as Record<string,unknown>);item.state=input.action==='snooze'?'snoozed':input.action==='dismiss'?'dismissed':'resolved';item.rowRevision++;return structuredClone(item);},
 async getPulseBrief(){await base.getPulseBrief();return {items:config.variant==='brief'?[original.snapshot().item]:[],lastCheckedAt:null};},
};
