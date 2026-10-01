import type { Milestone, Task, WorkflowPhase } from "@/types";

/**
 * Deterministic project progress. The same formula - and the same weights - is
 * implemented in SQL inside private.public_project_rows() (supabase/schema.sql),
 * so the workspace and the public portfolio always agree:
 *
 *   workflow  40%   position in the ordered pipeline (IDEA -> COMPLETED)
 *   milestones 35%  completed milestones / total milestones
 *   tasks      25%  completed tasks / total tasks
 *
 * Weights are renormalised over the components that actually have data, so a
 * project without tasks is not punished for it. Statuses outside the ordered
 * pipeline (BLOCKED, ON_HOLD, CANCELLED) drop the workflow component entirely.
 * Nothing is stored, so progress can never drift from the work itself.
 */
export const WORKFLOW_PIPELINE: WorkflowPhase[] = [
  "IDEA",
  "PLANNING",
  "RESEARCH",
  "DEVELOPMENT",
  "TESTING",
  "DEPLOYMENT",
  "MAINTENANCE",
  "COMPLETED",
];

const WORKFLOW_WEIGHT = 0.4;
const MILESTONE_WEIGHT = 0.35;
const TASK_WEIGHT = 0.25;

export interface ProjectProgress {
  /** 0 - 100, rounded exactly like the SQL implementation. */
  total: number;
  taskPercent: number;
  milestonePercent: number;
  workflowPercent: number;
  hasTasks: boolean;
  hasMilestones: boolean;
  usesWorkflow: boolean;
}

export function calculateProjectProgress(input: {
  workflowStage: WorkflowPhase;
  tasks?: Array<Pick<Task, "status">>;
  milestones?: Array<Pick<Milestone, "status">>;
}): ProjectProgress {
  const tasks = input.tasks ?? [];
  const milestones = input.milestones ?? [];

  const pipelineIndex = WORKFLOW_PIPELINE.indexOf(input.workflowStage);
  const usesWorkflow = pipelineIndex >= 0;

  const workflowValue = usesWorkflow ? pipelineIndex / (WORKFLOW_PIPELINE.length - 1) : 0;
  const taskValue = tasks.length > 0 ? tasks.filter((task) => task.status === "Completed").length / tasks.length : 0;
  const milestoneValue =
    milestones.length > 0 ? milestones.filter((milestone) => milestone.status === "completed").length / milestones.length : 0;

  const workflowWeight = usesWorkflow ? WORKFLOW_WEIGHT : 0;
  const taskWeight = tasks.length > 0 ? TASK_WEIGHT : 0;
  const milestoneWeight = milestones.length > 0 ? MILESTONE_WEIGHT : 0;
  const weightTotal = workflowWeight + taskWeight + milestoneWeight;

  const total =
    weightTotal === 0
      ? 0
      : Math.round(((workflowValue * workflowWeight + taskValue * taskWeight + milestoneValue * milestoneWeight) / weightTotal) * 100);

  return {
    total: Math.min(100, Math.max(0, total)),
    taskPercent: Math.round(taskValue * 100),
    milestonePercent: Math.round(milestoneValue * 100),
    workflowPercent: Math.round(workflowValue * 100),
    hasTasks: tasks.length > 0,
    hasMilestones: milestones.length > 0,
    usesWorkflow,
  };
}
