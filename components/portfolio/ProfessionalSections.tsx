import type { PublicProfessionalContent } from "@/lib/portfolio/resume-content";

export function ProfessionalExperience({ content }: { content: PublicProfessionalContent }) {
  const { experience } = content;
  return <section id="experience" className="public-card p-6 md:p-8" aria-labelledby="experience-title">
    <p className="public-eyebrow">Professional experience</p>
    <h2 id="experience-title" className="mt-2 text-3xl font-black text-[var(--ink)]">Building with a team</h2>
    <ol className="sketch-timeline mt-6 pl-5">
      <li>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-xl font-bold text-[var(--ink)]">{experience.employer}</h3>
          <p className="text-sm text-[var(--muted)]"><time dateTime={experience.start}>{experience.startLabel}</time> – <time dateTime={experience.end}>{experience.endLabel}</time></p>
        </div>
        <p className="mt-1 font-semibold text-[var(--ink)]">{experience.role}</p>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--muted)]">{experience.summary}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">{experience.systems.map((system) => <article key={system.name} className="rounded-2xl border border-[var(--public-border)] p-4">
          <h4 className="font-bold text-[var(--ink)]">{system.name}</h4>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{system.work}</p>
        </article>)}</div>
      </li>
    </ol>
  </section>;
}

export function ProfessionalSkills({ content, projectTechnologies }: { content: PublicProfessionalContent; projectTechnologies: string[] }) {
  return <section id="skills" className="public-card p-6 md:p-8" aria-labelledby="skills-title">
    <p className="public-eyebrow">Technical toolkit</p>
    <h2 id="skills-title" className="mt-2 text-3xl font-black text-[var(--ink)]">Skills & technologies</h2>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">A focus on full-stack applications, mobile development, and practical AI integration.</p>
    <div className="mt-5 flex flex-wrap gap-2" aria-label="Core application stack">{content.coreStack.map((skill) => <span key={skill} className="public-skill-core">{skill}</span>)}</div>
    <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{content.skillGroups.map((group) => <div key={group.label} className="min-w-0">
      <h3 className="handwritten text-xl font-bold text-[var(--ink)]">{group.label}</h3>
      <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{group.items.join(" · ")}</p>
    </div>)}</div>
    {projectTechnologies.length > 0 && <details className="mt-6 border-t border-[var(--public-border)] pt-4">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Technologies in currently published projects</summary>
      <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{projectTechnologies.join(" · ")}</p>
    </details>}
  </section>;
}

export function ProfessionalEducation({ content }: { content: PublicProfessionalContent }) {
  const { education } = content;
  return <section id="education" className="public-card p-6 md:p-8" aria-labelledby="education-title">
    <p className="public-eyebrow">Education</p>
    <h2 id="education-title" className="mt-2 text-2xl font-black text-[var(--ink)]">{education.degree}</h2>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="font-semibold text-[var(--ink)]">{education.institution}</p>
      <p className="text-sm text-[var(--muted)]">Graduated <time dateTime={education.graduated}>{education.graduationLabel.replace(/^Graduated /, "")}</time></p>
    </div>
    <p className="mt-3 font-bold text-[var(--ink)]"><span className="marker-highlight">{education.honor}</span></p>
    <p className="mt-4 text-sm leading-7 text-[var(--muted)]">Relevant coursework: {education.coursework.join(" · ")}</p>
    <p className="mt-2 text-sm text-[var(--muted)]">Leadership: {education.leadership}</p>
  </section>;
}

export function ProfessionalFocus({ content }: { content: PublicProfessionalContent }) {
  return <section id="engineering" aria-labelledby="engineering-title">
    <p className="public-eyebrow">Engineering focus</p>
    <h2 id="engineering-title" className="mt-2 text-3xl font-black text-[var(--ink)]">From interfaces to architecture</h2>
    <div className="mt-5 grid gap-4 lg:grid-cols-3">{content.focusAreas.map((area) => <article key={area.title} className="public-card p-5">
      <h3 className="text-xl font-bold text-[var(--ink)]">{area.title}</h3>
      <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{area.description}</p>
    </article>)}</div>
  </section>;
}
