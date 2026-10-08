import { handleAgentActions } from "@/lib/ai/agent/action-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) { return handleAgentActions(request, "cancel"); }
