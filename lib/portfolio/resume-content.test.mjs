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
const content = await import(moduleUrl(withoutImports(read("./resume-content.ts"))));
const cards = await import(moduleUrl(withoutImports(read("./project-card.ts"))));
const sectionsUrl = moduleUrl(`import React from ${JSON.stringify(reactUrl)};\n${withoutImports(read("../../components/portfolio/ProfessionalSections.tsx"))}`);
const sections = await import(sectionsUrl);
const portfolio = await import(moduleUrl(`
  import React from ${JSON.stringify(reactUrl)};
  import { ProfessionalEducation, ProfessionalExperience, ProfessionalSkills, ProfessionalFocus } from ${JSON.stringify(sectionsUrl)};
  const { useState, useMemo, useEffect } = React;
  const useAuth = () => ({ status: "unauthenticated" });
  const Link = ({ children, ...props }) => React.createElement("a", props, children);
  const ArrowUpRight = () => null, FolderGit2 = () => null, Moon = () => null, Sun = () => null;
  const isSupabaseConfigured = () => true;
  const PublicAiConcierge = () => null;
  ${withoutImports(read("../../components/portfolio/PublicPortfolio.tsx"))}
`));

const ownerProfile = { displayName: "Franz Michael Cayanan", headline: "", bio: "" };
const background = content.getPublicProfessionalContent(ownerProfile);
const project = (overrides = {}) => ({ id: "test-project", slug: "actual-project", name: "Actual Published Project", type: "Personal", role: "Configured Role", featured: false, visibility: "Public", status: "Testing", description: "Configured safe project summary", technologies: ["TypeScript"], links: {}, ...overrides });
const renderPortfolio = (profile, projects = [], extra = {}) => renderToStaticMarkup(React.createElement(portfolio.default, {
  initialProfile: profile,
  initialProjects: projects,
  initialError: false,
  initialProfessionalContent: content.getPublicProfessionalContent(profile),
  introduction: content.publicProfessionalIntroduction(profile),
  ...extra,
}));

test("resume defaults require a matching public profile and configured introduction wins", () => {
  assert.equal(content.getPublicProfessionalContent(null), null);
  assert.equal(content.getPublicProfessionalContent({ displayName: "Another Developer" }), null);
  assert.equal(content.publicProfessionalIntroduction(ownerProfile).headline, "Full-Stack & AI Application Developer");
  const edited = content.publicProfessionalIntroduction({ ...ownerProfile, headline: "Configured title", bio: "Configured bio" });
  assert.equal(edited.headline, "Configured title");
  assert.equal(edited.bio, "Configured bio");
});

test("experience and education render exact resume roles, dates, university, and honor", () => {
  const experience = renderToStaticMarkup(React.createElement(sections.ProfessionalExperience, { content: background }));
  assert.match(experience, /BMWare/);
  assert.match(experience, /Technical Intern &amp; System Architect/);
  assert.match(experience, /dateTime="2026-02"/);
  assert.match(experience, /dateTime="2026-04"/);
  assert.match(experience, /Adsumus Dispatch/);
  assert.match(experience, /InsureMe/);
  const education = renderToStaticMarkup(React.createElement(sections.ProfessionalEducation, { content: background }));
  for (const fact of ["Bachelor of Science in Computer Science", "Pampanga State University", "Magna Cum Laude", "September 2026"]) assert.ok(education.includes(fact));
});

test("public profile rendering gates background, contacts, and navigation without fabricating resume cards", () => {
  const html = renderPortfolio(ownerProfile, [project(), project({ id: "private", slug: "private", name: "Private project", visibility: "Private" }), project({ id: "unlisted", slug: "unlisted", name: "Unlisted project", visibility: "Unlisted" })]);
  assert.match(html, /Full-Stack &amp; AI Application Developer/);
  assert.match(html, /href="#experience"/);
  assert.match(html, /href="\/projects\/actual-project"/);
  assert.match(html, /Configured Role/);
  assert.match(html, /Configured safe project summary/);
  for (const privateValue of ["Private project", "Unlisted project", "mailto:", "tel:", "+63", "Guagua", "Download Resume"]) assert.equal(html.includes(privateValue), false);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.equal((html.match(/<article class="public-card flex/g) ?? []).length, 1);
  const off = renderPortfolio(null);
  for (const fact of ["BMWare", "Magna Cum Laude", "Franz", 'href="#experience"']) assert.equal(off.includes(fact), false);
});

test("only explicitly configured contact links render; published project order is preserved", () => {
  const html = renderPortfolio({ ...ownerProfile, contactEmail: "public@example.com", githubUrl: "https://github.com/public-owner", linkedinUrl: "javascript:alert(1)" }, [project({ id: "second", name: "First by configured order" }), project({ id: "first", name: "Second by configured order" })]);
  assert.match(html, /mailto:public@example.com/);
  assert.match(html, /https:\/\/github.com\/public-owner/);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.ok(html.indexOf("First by configured order") < html.indexOf("Second by configured order"));
});

test("professional content is server-only, carries no resume contact details, and does not define project records", () => {
  const source = read("./resume-content.ts");
  assert.match(source, /^import "server-only"/);
  const serialized = JSON.stringify(background);
  assert.doesNotMatch(serialized, /@|\+63|Guagua|phone|Downloads|\.pdf|https?:\/\//i);
  assert.equal("projects" in background, false);
  const publicComponent = read("../../components/portfolio/PublicPortfolio.tsx");
  assert.match(publicComponent, /import type \{ PublicProfessionalContent \}/);
  assert.doesNotMatch(publicComponent, /import \{.*getPublicProfessionalContent/);
  assert.doesNotMatch(publicComponent, /BMWare|Franz Michael|Pampanga State/);
});

test("homepage transport strips internal IDs, counters, and non-shared URLs before rendering", () => {
  const row = { id: "internal-uuid", user_id: "private-owner-id", slug: "public-project", title: "Actual Project", description: "Safe summary", project_type: "Personal", role: "Configured Role", is_featured: true, visibility: "Public", status: "Testing", technologies: ["React"], total_tasks: 5, public_summary: null, repository_url: "https://github.com/private/repo", demo_url: "https://example.com", show_repository: false, show_live_demo: false, private_notes: "Private note" };
  const result = cards.publicPortfolioProject(row);
  assert.equal(result.name, "Actual Project");
  assert.equal(result.links.github, undefined);
  assert.equal(result.links.live, undefined);
  assert.doesNotMatch(JSON.stringify(result), /internal-uuid|private-owner-id|private_notes|Private note|total_tasks|github.com\/private/);
  assert.equal(cards.publicPortfolioProject({ ...row, visibility: "Unlisted" }), null);
  assert.equal(cards.publicPortfolioProject({ ...row, visibility: "Private" }), null);
});
