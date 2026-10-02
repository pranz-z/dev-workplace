import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const concierge = readFileSync(new URL("./public-ai-concierge.tsx", import.meta.url), "utf8");
const portfolio = readFileSync(new URL("../portfolio/PublicPortfolio.tsx", import.meta.url), "utf8");
const projectPage = readFileSync(new URL("../../app/projects/[slug]/page.tsx", import.meta.url), "utf8");

test("public concierge renders nothing until the public endpoint says it is available", () => {
  assert.match(concierge, /fetch\("\/api\/public-ai", \{ cache: "no-store" \}\)/);
  assert.match(concierge, /if \(!available\) return null/);
});

test("launcher opens the same mounted transcript and closing preserves it", () => {
  assert.match(concierge, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(concierge, /onClick=\{\(\) => setOpen\(false\)\}/);
  assert.match(concierge, /messages\.map/);
  assert.doesNotMatch(concierge, /setMessages\(\[\]\).*setOpen\(false\)/);
  assert.match(concierge, /const clearChat = \(\) => \{ setMessages\(\[\]\)/);
});

test("opening shows a local welcome without sending a Gemini request", () => {
  assert.match(concierge, /messages\.length === 0 && <ChatMessageBubble[^>]*>Hi!/);
  assert.match(concierge, /useEffect\(\(\) => \{\s*if \(open\) \{/);
  assert.equal((concierge.match(/fetch\("\/api\/public-ai", \{ cache: "no-store" \}\)/g) ?? []).length, 1);
  const openEffect = concierge.match(/useEffect\(\(\) => \{\s*if \(open\) \{([\s\S]*?)\}, \[open\]\);/);
  assert.ok(openEffect);
  assert.doesNotMatch(openEffect[1], /fetch\(/);
  assert.match(concierge, /fetch\("\/api\/public-ai", \{\s*method: "POST"/);
});

test("public suggested questions use the public request and public chat has no workspace controls", () => {
  assert.match(concierge, /suggestedQuestions\.slice\(0, 4\)/);
  assert.match(concierge, /onClick=\{\(\) => void ask\(suggestion\)\}/);
  assert.doesNotMatch(concierge, /\/api\/ai(?:\/chat)?|Attach file|Add context|Workspace AI|workspaceContext/);
});

test("public launcher is mounted on portfolio and public project pages", () => {
  assert.match(portfolio, /<PublicAiConcierge\s*\/>/);
  assert.match(projectPage, /import \{ PublicAiConcierge \} from "@\/components\/public-ai\/public-ai-concierge"/);
  assert.match(projectPage, /<PublicAiConcierge\s*\/>/);
});

test("public concierge exposes dialog semantics, keyboard close, focus, and public-only disclosure", () => {
  assert.match(concierge, /role="dialog" aria-modal="false"/);
  assert.match(concierge, /event\.key === "Escape"/);
  assert.match(concierge, /questionRef\.current\?\.focus\(\)/);
  assert.match(concierge, /launcherRef\.current\?\.focus\(\)/);
  assert.match(concierge, /Answers are based only on information the developer has chosen to make public/);
});
