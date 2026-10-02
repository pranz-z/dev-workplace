export const MAX_CHAT_MESSAGE_LENGTH = 1500;
export const MAX_CHAT_HISTORY_MESSAGES = 8;
export const MAX_CHAT_ENTITIES = 8;
export const MAX_CHAT_FILES = 5;
export const MAX_CHAT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_CHAT_TOTAL_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_CHAT_MULTIPART_BYTES = Math.floor(4.4 * 1024 * 1024);
export const MAX_CHAT_EXTRACTED_TEXT = 60_000;

export type WorkspaceEntityType = "project" | "task" | "plan";
export interface WorkspaceEntityRef { type: WorkspaceEntityType; id: string }
export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface ChatFile { name: string; mimeType: string; data: string; text?: string; size: number }
export interface ParsedChatRequest { message: string; history: ChatTurn[]; workspaceContext: WorkspaceEntityRef[] }
