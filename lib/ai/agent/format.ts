/** Agent presentation only. Keep fenced and inline code verbatim. */
export function normalizeAgentAnswer(value: string): string {
  return value.split(/((?:```|~~~)[\s\S]*?(?:```|~~~)(?:\n|$))/g).map((block, index) => {
    if (index % 2) return block;
    return block.replace(/\*\*`([^`\n]+)`\*\*/g, "$1").split(/(`+[^`\n]*`+)/g).map((part, i) => i % 2 ? part : part
      .replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/__([^_\n]+)__/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "• ").replace(/^\s*[-*]\s+/gm, "• ")
      .replace(/^Based on (?:the )?current workspace data,\s*/i, "")
    ).join("");
  }).join("");
}
