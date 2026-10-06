"use client";

import { useState } from "react";
import { Button, Card, Chip, UnderlineHeading } from "@/components/ui/notebook";
import { MarginTimeline } from "./NotebookInteractions";
import type { PublicProfessionalContent } from "@/lib/portfolio/resume-content";

function month(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return "";
  const [year, number] = value.split("-");
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(number) - 1]} ${year}`;
}
export function ProfessionalExperience({ content }: { content: PublicProfessionalContent }) {
  if (!content.sections.experience.enabled || !content.experience.length) return null;
  return <section id="experience" className="public-card p-6 md:p-8" aria-labelledby="experience-title">
    <p className="public-eyebrow">Professional experience</p>
    <h2 id="experience-title" className="mt-2 text-3xl font-black text-[var(--ink)]"><UnderlineHeading>Building with a team</UnderlineHeading></h2>
    <MarginTimeline><ol className="mt-6 space-y-7">{content.experience.map((entry) => <li key={entry.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-3"><h3 className="text-xl font-bold text-[var(--ink)]">{entry.company}</h3><p className="text-sm text-[var(--muted)]"><time dateTime={entry.start}>{month(entry.start)}</time>{(entry.current || entry.end) && <> – {entry.current ? "Present" : <time dateTime={entry.end}>{month(entry.end)}</time>}</>}</p></div>
      <p className="mt-1 font-semibold text-[var(--ink)]">{entry.role}</p>
      {(entry.employmentType || entry.location) && <p className="mt-2 text-sm text-[var(--muted)]">{[entry.employmentType, entry.location].filter(Boolean).join(" · ")}</p>}
      {entry.summary && <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-7 text-[var(--muted)]">{entry.summary}</p>}
      {entry.bullets.length > 0 && <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-[var(--muted)]">{entry.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul>}
      {entry.technologies.length > 0 && <p className="mt-4 text-sm text-[var(--muted)]">{entry.technologies.join(" · ")}</p>}
    </li>)}</ol></MarginTimeline>
  </section>;
}
export function ProfessionalSkills({ content, projectTechnologies }: { content: PublicProfessionalContent; projectTechnologies: string[] }) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  if (!content.sections.toolkit.enabled || !content.toolkit.length) return null;
  return <section id="skills" className="public-card p-6 md:p-8" aria-labelledby="skills-title"><p className="public-eyebrow">Technical toolkit</p><h2 id="skills-title" className="mt-2 text-3xl font-black text-[var(--ink)]"><UnderlineHeading>Skills & technologies</UnderlineHeading></h2>
    <div className="notebook-skill-filters" role="group" aria-label="Filter skills by group">{content.toolkit.map((group) => <Button key={group.id} aria-pressed={selectedGroup === group.id} onClick={() => setSelectedGroup((current) => current === group.id ? null : group.id)}>{group.label}</Button>)}</div>
    <div className="notebook-skill-chips">{content.toolkit.flatMap((group, groupIndex) => group.items.map((item, index) => <Chip key={item.id} rotation={((groupIndex + index) % 5) - 2} dimmed={selectedGroup !== null && selectedGroup !== group.id} highlighted={selectedGroup === group.id}>{item.name}</Chip>))}</div>
    {projectTechnologies.length > 0 && <details className="mt-6 border-t border-[var(--public-border)] pt-4"><summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Technologies in currently published projects</summary><p className="mt-3 text-sm leading-7 text-[var(--muted)]">{projectTechnologies.join(" · ")}</p></details>}
  </section>;
}
export function ProfessionalEducation({ content }: { content: PublicProfessionalContent }) {
  if (!content.sections.education.enabled || !content.education.length) return null;
  return <section id="education" className="space-y-7" aria-labelledby="education-title"><p id="education-title" className="public-eyebrow">Education</p>{content.education.map((entry) => <Card key={entry.id} animated>
    <h2 className="text-2xl font-black text-[var(--ink)]">{entry.degree}</h2><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="font-semibold text-[var(--ink)]">{entry.institution}</p>{entry.graduation && <p className="text-sm text-[var(--muted)]">Graduated <time dateTime={entry.graduation}>{month(entry.graduation)}</time></p>}</div>
    {entry.honors && <p className="mt-3 font-bold text-[var(--ink)]"><span className="marker-highlight">{entry.honors}</span></p>}
    {(entry.field || entry.location || entry.start) && <p className="mt-3 text-sm text-[var(--muted)]">{[entry.field, entry.location, entry.start && `Started ${month(entry.start)}`].filter(Boolean).join(" · ")}</p>}
    {entry.coursework.length > 0 && <p className="mt-4 text-sm leading-7 text-[var(--muted)]">Relevant coursework: {entry.coursework.join(" · ")}</p>}
    {entry.activities.length > 0 && <p className="mt-2 text-sm text-[var(--muted)]">Leadership / activities: {entry.activities.join(" · ")}</p>}
    {entry.notes && <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--muted)]">{entry.notes}</p>}
  </Card>)}</section>;
}
export function ProfessionalFocus({ content }: { content: PublicProfessionalContent }) {
  if (!content.sections.focus.enabled || !content.focus.length) return null;
  return <section id="engineering" aria-labelledby="engineering-title"><p className="public-eyebrow">Engineering focus</p><h2 id="engineering-title" className="mt-2 text-3xl font-black text-[var(--ink)]"><UnderlineHeading>From interfaces to architecture</UnderlineHeading></h2><div className="mt-5 grid gap-4 lg:grid-cols-3">{content.focus.map((area) => <Card key={area.id} className="p-5"><h3 className="text-xl font-bold text-[var(--ink)]">{area.title}</h3>{area.description && <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--muted)]">{area.description}</p>}</Card>)}</div></section>;
}
