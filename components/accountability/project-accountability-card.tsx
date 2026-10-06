import type { AccountabilityResult } from "@/data/accountabilityService";

interface ProjectAccountabilityCardProps {
  projectName: string;
  result: AccountabilityResult;
}

export function ProjectAccountabilityCard({ projectName, result }: ProjectAccountabilityCardProps) {
  const scoreLabel = result.score !== null
    ? `${result.score} / 100`
    : ["Completed", "On Hold", "Blocked", "Cancelled"].includes(result.health)
      ? result.health
      : result.baseline
        ? "Building baseline"
        : "Insufficient data";

  return <section className="notebook-dense dark-panel p-4 md:p-5" aria-label={`${projectName} accountability`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="eyebrow t-mood">Project accountability</p>
        <h3 className="mt-1 text-lg font-semibold t-dark">{scoreLabel}</h3>
        <p className="mt-1 text-sm t-dark-muted">Project health: {result.health}</p>
      </div>
      <span className="dark-chip px-2.5 py-1 text-xs">{result.githubStatus === "loading" || result.githubStatus === "unavailable" ? "Repository recency unknown" : result.daysSinceActivity === null ? "Activity recency unknown" : `${result.daysSinceActivity}d since progress`}</span>
    </div>
    <p className="mt-3 text-xs t-dark-muted">A follow-through signal from planned workspace progress and available repository activity. Missing sources are excluded and remaining factors are normalized. It does not measure skill or code quality.</p>
    {result.score !== null && <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {result.factors.map((factor) => <div key={factor.key} className="dark-inset flex items-center justify-between gap-3 p-3 text-sm">
        <span className="t-dark-soft">{factor.label}</span>
        <span className="shrink-0 font-medium t-dark">{factor.available ? `${Math.round(factor.score)} / ${factor.max}` : factor.key === "github" ? result.githubStatus === "not-connected" ? "Not connected" : result.githubStatus === "loading" ? "Loading" : result.githubStatus === "unavailable" ? "Unavailable" : "Not used in this phase" : "No data"}</span>
      </div>)}
    </div>}
    <ul className="mt-4 space-y-2">
      {result.reasons.slice(0, 4).map((reason, index) => <li key={`${reason.kind}-${index}`} className={`text-sm ${reason.kind === "attention" ? "notebook-feedback-attention" : "t-dark-muted"}`}>{reason.kind === "progress" ? "✓ " : reason.kind === "attention" ? "! " : "· "}{reason.text}</li>)}
    </ul>
  </section>;
}
