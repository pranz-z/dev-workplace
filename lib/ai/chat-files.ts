import "server-only";
import { AiError } from "@/lib/ai/errors";
import { MAX_CHAT_EXTRACTED_TEXT, MAX_CHAT_FILE_BYTES, MAX_CHAT_FILES, MAX_CHAT_TOTAL_FILE_BYTES, type ChatFile } from "@/lib/ai/chat-contract";

const TEXT_MIME_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain", md: "text/plain", markdown: "text/plain", json: "application/json", csv: "text/csv",
  ts: "text/plain", tsx: "text/plain", js: "text/plain", jsx: "text/plain", mjs: "text/plain", cjs: "text/plain",
  py: "text/plain", html: "text/html", css: "text/css", scss: "text/plain", sql: "text/plain", yaml: "text/plain",
  yml: "text/plain", toml: "text/plain", xml: "application/xml", java: "text/plain", go: "text/plain", rs: "text/plain",
  sh: "text/plain", bash: "text/plain", c: "text/plain", h: "text/plain", cpp: "text/plain", hpp: "text/plain",
  cs: "text/plain", php: "text/plain", rb: "text/plain", swift: "text/plain", kt: "text/plain", vue: "text/plain", svelte: "text/plain",
};
const BINARY_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

export async function validateChatFiles(files: File[]): Promise<ChatFile[]> {
  if (files.length > MAX_CHAT_FILES) throw new AiError("INVALID_ATTACHMENT");
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_CHAT_TOTAL_FILE_BYTES) throw new AiError("INVALID_ATTACHMENT");
  let extractedLength = 0;
  const result: ChatFile[] = [];
  for (const file of files) {
    if (file.size <= 0 || file.size > MAX_CHAT_FILE_BYTES) throw new AiError("INVALID_ATTACHMENT");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const expectedMime = TEXT_MIME_BY_EXTENSION[extension] ?? BINARY_MIME_BY_EXTENSION[extension];
    if (!expectedMime) throw new AiError("INVALID_ATTACHMENT");
    const allowedTextMime = file.type.startsWith("text/") || ["application/json", "text/json", "application/javascript", "application/typescript", "text/javascript", "text/typescript", "application/xml"].includes(file.type);
    if (file.type && (BINARY_MIME_BY_EXTENSION[extension] ? file.type !== expectedMime : !allowedTextMime)) throw new AiError("INVALID_ATTACHMENT");
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (BINARY_MIME_BY_EXTENSION[extension]) {
      if (extension === "pdf" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new AiError("INVALID_ATTACHMENT");
      if (extension === "png" && !(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) throw new AiError("INVALID_ATTACHMENT");
      if ((extension === "jpg" || extension === "jpeg") && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) throw new AiError("INVALID_ATTACHMENT");
      if (extension === "webp" && !(new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP")) throw new AiError("INVALID_ATTACHMENT");
    } else {
      if (bytes.includes(0)) throw new AiError("INVALID_ATTACHMENT");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new AiError("INVALID_ATTACHMENT"); }
      extractedLength += text.length;
      if (extractedLength > MAX_CHAT_EXTRACTED_TEXT) throw new AiError("INVALID_ATTACHMENT");
      result.push({ name: safeDisplayFilename(file.name), mimeType: expectedMime, data: "", text, size: file.size });
      continue;
    }
    result.push({ name: safeDisplayFilename(file.name), mimeType: expectedMime, data: Buffer.from(buffer).toString("base64"), size: file.size });
  }
  return result;
}

export function safeDisplayFilename(name: string): string {
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(-100) || "attachment";
}
