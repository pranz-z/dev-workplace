import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const reactUrl = pathToFileURL(require.resolve("react")).href;
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const withoutImports = (source) => source.replace(/^import .*;\r?\n/gm, "");
const compiled = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(compiled(source)).toString("base64")}`;
const contentModule = await import(moduleUrl(read("./content.ts")));
const contentUrl = moduleUrl(read("./content.ts"));
const seedModule = await import(moduleUrl(read("./resume-seed.ts").replace('"./content"', JSON.stringify(contentUrl))));
const content = await import(moduleUrl(withoutImports(read("./resume-content.ts"))));
const cards = await import(moduleUrl(withoutImports(read("./project-card.ts"))));
const sectionsUrl = moduleUrl(`import React from ${JSON.stringify(reactUrl)};\n${withoutImports(read("../../components/portfolio/ProfessionalSections.tsx"))}`);
const sections = await import(sectionsUrl);
const doodlesUrl = moduleUrl(`import React from ${JSON.stringify(reactUrl)};\n${withoutImports(read("../../components/ui/SketchDoodle.tsx"))}`);
const portfolio = await import(moduleUrl(`
  import React from ${JSON.stringify(reactUrl)};
  import { SketchDoodle } from ${JSON.stringify(doodlesUrl)};
  import { ProfessionalEducation, ProfessionalExperience, ProfessionalSkills, ProfessionalFocus } from ${JSON.stringify(sectionsUrl)};
  const { useState, useMemo, useEffect } = React;
  const useAuth = () => ({ status: "unauthenticated" });
  const Link = ({ children, ...props }) => React.createElement("a", props, children);
  const ArrowUpRight = () => null, FolderGit2 = () => null, Moon = () => null, Sun = () => null;
  const isSupabaseConfigured = () => true;
  const PublicAiConcierge = () => null;
  ${withoutImports(read("../../components/portfolio/PublicPortfolio.tsx"))}
`));
const background = seedModule.resumePortfolioSeed();
const ownerProfile = { displayName: background.hero.name, headline: background.hero.headline, bio: background.bio };
const project = (overrides = {}) => ({ id: "test-project", slug: "actual-project", name: "Actual Published Project", type: "Personal", role: "Configured Role", featured: false, visibility: "Public", status: "Testing", description: "Configured safe project summary", technologies: ["TypeScript"], links: {}, ...overrides });
const renderPortfolio = (doc = background, projects = [], profile = ownerProfile) => renderToStaticMarkup(React.createElement(portfolio.default, {
  initialProfile: profile, initialProjects: projects, initialError: false, initialProfessionalContent: doc, introduction: content.publicProfessionalIntroduction(profile),
}));

test("production introduction never supplies static resume defaults, even for the matching name", () => {
  assert.equal(content.getPublicProfessionalContent(null), null);
  assert.equal(content.getPublicProfessionalContent({ displayName: "Franz Michael L. Cayanan" }), null);
  assert.equal(content.publicProfessionalIntroduction({ displayName: "Franz", headline: "", bio: "" }).bio, "");
  assert.equal(content.getPublicProfessionalContent({ portfolio: background }), background);
  assert.equal(content.publicProfessionalIntroduction({ ...ownerProfile, bio: "Configured bio" }).bio, "Configured bio");
});
test("resume import accurately represents identity, experience, education and all toolkit categories", () => {
  contentModule.validatePortfolio(background);
  assert.equal(background.hero.name, "Franz Michael L. Cayanan");
  const experience = renderToStaticMarkup(React.createElement(sections.ProfessionalExperience, { content: background }));
  for (const fact of ["BMWare", "Technical Intern &amp; System Architect", "2026-02", "2026-04", "Adsumus Dispatch", "InsureMe", "encrypted messaging", "geolocation tracking", "payment state"]) assert.ok(experience.includes(fact), fact);
  const education = renderToStaticMarkup(React.createElement(sections.ProfessionalEducation, { content: background }));
  for (const fact of ["Bachelor of Science in Computer Science", "Pampanga State University", "Magna Cum Laude", "September 2026"]) assert.ok(education.includes(fact), fact);
  const all = JSON.stringify(background);
  for (const fact of ["Flutter", "Laravel", "Developer Workplace", "Gemini", "Ollama", "OpenAI Codex", "GitHub Copilot", "Antigravity", "OmniRoute", "YOLOv11", "Unity Sentis", "Databases & Backend", "Tools & Practices"]) assert.ok(all.includes(fact), fact);
  assert.equal(background.toolkit.length, 6); assert.equal("projects" in background && "records" in background.projects, false);
});
test("updated database-backed bio, stack and professional sections render without identity matching", () => {
  const doc = structuredClone(background); doc.hero.name = "Updated owner"; doc.bio = "Updated CMS bio"; doc.stack[0].name = "Updated stack";
  const html = renderPortfolio(doc, [project()]);
  for (const fact of ["Updated owner", "Updated CMS bio", "Updated stack", "BMWare", "Configured Role", "Configured safe project summary"]) assert.ok(html.includes(fact), fact);
  assert.match(html, /href="\/projects\/actual-project"/);
});
test("disabled and empty sections do not produce empty headings or navigation", () => {
  const doc = contentModule.emptyPortfolio(); doc.sections.about.enabled = false; doc.sections.hero.enabled = false;
  const html = renderPortfolio(doc);
  for (const id of ["about", "experience", "education", "skills", "engineering", "contact"]) assert.ok(!html.includes(`id="${id}"`), id);
  assert.ok(!html.includes('class="public-hero'));
  assert.match(html, /Download Resume/);
  for (const component of [sections.ProfessionalExperience, sections.ProfessionalEducation, sections.ProfessionalSkills, sections.ProfessionalFocus]) assert.equal(renderToStaticMarkup(React.createElement(component, { content: doc, projectTechnologies: [] })), "");
});
test("education and toolkit retain public projection ordering", () => {
  const doc = structuredClone(background);
  doc.education.unshift({ ...doc.education[0], id: crypto.randomUUID(), institution: "First institution" });
  doc.toolkit[0].items.unshift({ id: crypto.randomUUID(), enabled: true, sort_order: 0, name: "First skill" });
  const html = renderPortfolio(doc);
  assert.ok(html.indexOf("First institution") < html.indexOf("Pampanga State University"));
  assert.ok(html.indexOf("First skill") < html.indexOf("Dart"));
});
test("only configured safe contact values render; hidden projection fields stay absent", () => {
  const doc = structuredClone(background); doc.contact.phone = ""; doc.contact.email = ""; doc.contact.location = ""; doc.links = [];
  const html = renderPortfolio(doc);
  assert.doesNotMatch(html, /mailto:|tel:|\+63|Guagua|gmail.com/);
  doc.links = [{ id: crypto.randomUUID(), enabled: true, sort_order: 0, type: "custom", label: "Unsafe", url: "javascript:alert(1)" }];
  assert.doesNotMatch(renderPortfolio(doc), /javascript:alert/);
});
test("projects continue using safe project records, visibility, URLs and configured ordering", () => {
  const html = renderPortfolio(background, [project({ name: "First configured project" }), project({ id: "second", name: "Second configured project" }), project({ id: "private", name: "Private sentinel", visibility: "Private" }), project({ id: "unlisted", name: "Unlisted sentinel", visibility: "Unlisted" })]);
  assert.ok(html.indexOf("First configured project") < html.indexOf("Second configured project"));
  assert.doesNotMatch(html, /Private sentinel|Unlisted sentinel/);
  const row = { id: "internal-uuid", user_id: "private-owner-id", slug: "public-project", title: "Actual Project", description: "Safe summary", project_type: "Personal", role: "Configured Role", is_featured: true, visibility: "Public", status: "Testing", technologies: ["React"], repository_url: "https://github.com/private/repo", show_repository: false, show_live_demo: false, private_notes: "Private note" };
  assert.doesNotMatch(JSON.stringify(cards.publicPortfolioProject(row)), /internal-uuid|private-owner-id|Private note|github.com\/private/);
  assert.equal(cards.publicPortfolioProject({ ...row, visibility: "Unlisted" }), null);
});
test("server validation rejects oversized, unsafe, malformed and duplicate content", () => {
  for (const mutate of [
    (d) => { d.bio = "x".repeat(2001); }, (d) => { d.links[0].url = "javascript:alert(1)"; },
    (d) => { d.contact.email = "invalid"; }, (d) => { d.contact.phone = "x".repeat(41); },
    (d) => { d.experience[0].end = "2025-01"; }, (d) => { d.stack.push(d.stack[0]); },
    (d) => { d.notes = "Private sentinel"; }, (d) => { d.hero.avatar = "https://user:password@example.com"; },
  ]) { const doc = structuredClone(background); mutate(doc); assert.throws(() => contentModule.validatePortfolio(doc)); }
});
test("ordered collection controls produce persistent sort_order and preserve IDs", () => {
  const items = background.stack;
  const moved = contentModule.moveItem(items, 1, -1);
  assert.equal(moved[0].id, items[1].id); assert.deepEqual(moved.map((item) => item.sort_order), moved.map((_, index) => index));
  assert.deepEqual(contentModule.moveItem(items, 0, -1), items);
});
test("the existing public resume PDF and download CTA remain intact", () => {
  const pdf = readFileSync(new URL("../../public/resume/Franz_Michael_Cayanan_Resume.pdf", import.meta.url));
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(renderPortfolio(background), /href="\/resume\/Franz_Michael_Cayanan_Resume\.pdf"[^>]*download/);
  assert.doesNotMatch(read("../../app/page.tsx"), /resumePortfolioSeed|resume-seed/);
  assert.doesNotMatch(read("../public-ai/service.ts"), /resumePortfolioSeed|resume-seed|getPublicProfessionalContent/);
});
