import type { PublicAccountabilityHealth } from "@/types";

type Props = {
  health: PublicAccountabilityHealth;
  score: number | null;
};

export function PublicAccountabilityCard({ health, score }: Props) {
  return (
    <section className="public-card p-5 md:p-6" aria-label="Project accountability summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Project health</p>
          <h2 className="mt-2 text-2xl font-black text-[var(--ink)]">{health}</h2>
        </div>
        {score !== null && (
          <p className="rounded-full border border-[var(--public-border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-semibold text-[var(--ink)]">
            Accountability {score} / 100
          </p>
        )}
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        This reflects project follow-through and maintenance activity. It is not a measure of developer skill.
      </p>
    </section>
  );
}
