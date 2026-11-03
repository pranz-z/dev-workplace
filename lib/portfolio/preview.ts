/** Link-preview description: the first sentence of the first non-empty candidate, never cut mid-word. */
export function previewDescription(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const text = candidate?.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
    return sentence.length <= 300 ? sentence : `${sentence.slice(0, 297).replace(/\s+\S*$/, "")}…`;
  }
  return "";
}

/** Generated social card shared by the public portfolio pages. */
export const portfolioPreviewImage = { url: "/og", width: 1200, height: 630 };
