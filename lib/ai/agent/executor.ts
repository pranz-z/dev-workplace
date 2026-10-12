import "server-only";
import type { Content, Part } from "@google/genai";
import { AiError } from "@/lib/ai/errors";
import { MAX_AGENT_ROUNDS, MAX_TOOL_CALLS, type AgentRequest, type AgentResponse } from "@/lib/ai/agent/contract";
import { parseToolArguments } from "@/lib/ai/agent/schemas";
import { executeReadTool, type ToolContext } from "@/lib/ai/agent/tools";
import { collectProposal } from "@/lib/ai/agent/proposals";
import { proposalTools, parseProposalTool } from "@/lib/ai/agent/proposal-schema";
import { proposalSummary, type CalendarLoadDay } from "@/lib/ai/agent/schedule-summary";
import type { ProposalDraft } from "@/lib/ai/agent/contract";
import {normalizeSchedulingArguments,isSchedulingTool} from "@/lib/ai/agent/model-arguments";
import {resolveTimeBlockCandidates,isBlockMoveRequest,hasRequestedMoveTime} from "@/lib/ai/agent/block-resolution";

type Model = (contents: Content[]) => Promise<Content>;
export async function runAgentLoop(request: AgentRequest, context: ToolContext, generate: Model, execute: typeof executeReadTool = executeReadTool): Promise<AgentResponse & { drafts?: ProposalDraft[] }> {
  context = {...context,requestMessage:request.message};
  if(isBlockMoveRequest(request.message)){
    let resolved=await resolveTimeBlockCandidates(request.message,context);
    // A pronoun may inherit only the latest human reference, never a model-selected ID.
    if(!resolved.selectedId&&/^(?:move|reschedule|cancel)\s+(?:it|this block|that block)\b/i.test(request.message)){
      const previous=request.history.filter(turn=>turn.role==='user').at(-1);
      if(previous){
        const reference=await resolveTimeBlockCandidates(previous.content,context);
        if(reference.selectedId){resolved=reference;context.requestMessage=`${request.message} Referenced time block: ${reference.selectedId}.`;}
      }
    }
    if(!resolved.selectedId)return {answer:resolved.answer!,toolActivity:[]};
    if(/\b(move|reschedule)\b/i.test(request.message)&&!hasRequestedMoveTime(request.message))return {answer:'Please specify the new start date and time for this block. No changes have been proposed.',toolActivity:[]};
  }
  const contents: Content[] = [...request.history.map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.content }] })), { role: "user", parts: [{ text: request.message }] }];
  const toolActivity: AgentResponse["toolActivity"] = [];
  let calls = 0;
  const drafts: ProposalDraft[] = [];
  const load = new Map<string, CalendarLoadDay>();
  let partial = false;
  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    context.signal.throwIfAborted();
    const response = await generate(contents);
    if (!response.parts?.length) throw new AiError("MALFORMED_OUTPUT");
    const functions = response.parts.filter((part) => part.functionCall).map((part) => part.functionCall!);
    if (!functions.length) {
      const answer = response.parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("").trim();
      if (!answer || answer.length > 6000) throw new AiError("MALFORMED_OUTPUT");
      return { answer: drafts.length ? proposalSummary(drafts, [...load.values()], partial,context.timeZone) : answer, toolActivity, ...(drafts.length ? { drafts } : {}) };
    }
    calls += functions.length;
    if (calls > MAX_TOOL_CALLS || round === MAX_AGENT_ROUNDS - 1) throw new AiError("AGENT_LIMIT_REACHED");
    // Validate the entire round before any database reads.
    let validated;
    let validatingName:string|undefined;
    try { validated = functions.map((call) => {
      validatingName=call.name;
      if (typeof call.name !== "string") throw new AiError("MALFORMED_OUTPUT");
      const args=normalizeSchedulingArguments(call.name,call.args??{},context.timeZone);
      if (proposalTools.some(tool => tool.name === call.name)) { parseProposalTool(call.name,args); return { call, args, proposal: true }; }
      return { call, args: parseToolArguments(call.name,args), proposal: false };
    }); } catch(error) {
      if(!(error instanceof AiError)||error.code!=='INVALID_INPUT'||!isSchedulingTool(validatingName))throw error;
      return {answer:"I couldn't interpret that request safely. Please specify the block or task and a time such as '3:00 PM tomorrow' or '15:00 tomorrow'. No changes have been proposed.",toolActivity};
    }
    // Preserve original model parts, including Gemini thought signatures.
    contents.push({ ...response, role: "model" });
    const parts: Part[] = [];
    for (const { call, args, proposal } of validated) {
      context.signal.throwIfAborted();
      let result: Record<string, unknown>;
      try { result = proposal ? await collectProposal(call.name!, args, context, drafts) : await execute(call.name!, args, context); }
      catch(error){
        if(!isSchedulingTool(call.name))throw error;
        if(error instanceof AiError ? error.code!=='INVALID_INPUT' : !(error instanceof Error)||!/valid (local date|date|timestamp)|ambiguous|nonexistent|Blocks must|working hours|focus duration/i.test(error.message))throw error;
        return {answer:"I couldn't interpret that time or block safely. Please specify its title, date and a time such as '3:00 PM tomorrow' or '15:00 tomorrow'. No changes have been proposed.",toolActivity};
      }
      if (result.truncated === true) partial = true;
      if (call.name === "get_calendar_load" && Array.isArray(result.items)) for (const day of result.items as CalendarLoadDay[]) load.set(day.date, day);
      if (JSON.stringify(result).length > 60_000) throw new AiError("MALFORMED_OUTPUT");
      parts.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { untrustedWorkspaceData: result } } });
      const count = Array.isArray(result.items) ? result.items.length : undefined;
      toolActivity.push({ tool: call.name!, status: "success", summary: count === undefined ? "Reviewed workspace data" : `Found ${count} item${count === 1 ? "" : "s"}${result.truncated ? " (partial results)" : ""}` });
      if (result.requiresPreferences === true && drafts.length === 0 && validated.length === 1) {
        return { answer: "Please save your scheduling preferences, or specify working start/end times and a focus duration. No time blocks have been proposed or changed.", toolActivity };
      }
    }
    contents.push({ role: "user", parts });
  }
  throw new AiError("AGENT_LIMIT_REACHED");
}
